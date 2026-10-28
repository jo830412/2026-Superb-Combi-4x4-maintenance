const assert = require("node:assert/strict");
const test = require("node:test");
const { record, loadAppsScript, parseResponse, plain, post, syncState } = require("./helpers/apps-script-harness");

test("syncState returns records with a stable fingerprint", () => {
  const current = [record(1), record(2)];
  const { api } = loadAppsScript(current);

  const response = syncState(api);

  assert.deepEqual(response.records, current);
  assert.match(response.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(response.fingerprint, api.computeRecordsFingerprint_(current));
});

test("reads do not rewrite headers that are already present", () => {
  const { api, events } = loadAppsScript([record(1)]);

  syncState(api);

  assert.equal(events.some(event => event.type === "set"), false);
});

test("a matching fingerprint backs up the sheet before writing new rows", () => {
  const current = [record(1), record(2), record(3), record(4)];
  const incoming = current.map(value => ({ ...value, note: "已確認" }));
  const { api, events, mainSheet, sheets } = loadAppsScript(current);

  const response = post(api, {
    records: incoming,
    expectedFingerprint: api.computeRecordsFingerprint_(current),
    allowDestructiveReplace: false,
    reason: "save"
  });

  assert.equal(response.status, "success");
  assert.equal(response.fingerprint, syncState(api).fingerprint);
  assert.deepEqual(plain(api.readRecords_(mainSheet)), incoming);
  assert.ok(sheets.has("保養紀錄備份"));
  const backupSet = events.findIndex(event => event.type === "set" && event.sheet === "保養紀錄備份" && event.row >= 2);
  const mainWrite = events.findIndex(event => event.type === "set" && event.sheet === "保養紀錄" && event.row >= 5);
  assert.ok(backupSet >= 0 && mainWrite > backupSet, "backup must complete before the main sheet is rewritten");
});

test("shrinking writes new rows before clearing the stale tail", () => {
  const current = [record(1), record(2), record(3), record(4)];
  const incoming = current.slice(0, 3);
  const { api, events, mainSheet } = loadAppsScript(current);

  const response = post(api, {
    records: incoming,
    expectedFingerprint: api.computeRecordsFingerprint_(current),
    reason: "save"
  });

  assert.equal(response.status, "success");
  const mainEvents = events.filter(event => event.sheet === "保養紀錄" && (event.type === "set" || event.type === "clear"));
  assert.deepEqual(mainEvents.map(event => [event.type, event.row]), [["set", 5], ["clear", 8]]);
  assert.equal(mainEvents[1].numRows, 1);
  assert.deepEqual(plain(api.readRecords_(mainSheet)), incoming);
});

test("an unchanged payload succeeds without a backup batch or a write", () => {
  const current = [record(1), record(2)];
  const { api, events, sheets } = loadAppsScript(current);
  const fingerprint = api.computeRecordsFingerprint_(current);

  const response = post(api, { records: current, expectedFingerprint: fingerprint, reason: "save" });

  assert.equal(response.status, "success");
  assert.equal(response.unchanged, true);
  assert.equal(response.fingerprint, fingerprint);
  assert.equal(sheets.has("保養紀錄備份"), false);
  assert.equal(events.some(event => event.type === "set" || event.type === "clear"), false);
});

test("free-text columns keep values that Sheets would otherwise convert", () => {
  const current = [record(1)];
  const incoming = [...current, {
    date: "2026-09-02",
    mileage: 200,
    category: "其他",
    cost: 0,
    detail: "0912345678",
    note: "3/4",
    photos: ""
  }];
  const { api, mainSheet } = loadAppsScript(current);

  const response = post(api, {
    records: incoming,
    expectedFingerprint: api.computeRecordsFingerprint_(current),
    reason: "save"
  });

  assert.equal(response.status, "success");
  assert.deepEqual(plain(api.readRecords_(mainSheet)), incoming);
});

test("the returned fingerprint matches what the next sync state reads back", () => {
  const current = [record(1)];
  const incoming = [...current, { ...record(2), date: "2026/09/02" }];
  const { api } = loadAppsScript(current);

  const response = post(api, {
    records: incoming,
    expectedFingerprint: api.computeRecordsFingerprint_(current),
    reason: "save"
  });
  const state = syncState(api);

  assert.equal(response.status, "success");
  assert.equal(state.records[1].date, "2026/9/2");
  assert.equal(response.fingerprint, state.fingerprint);
});

test("writes grow the sheet when there are more records than rows", () => {
  const current = [record(1), record(2)];
  const incoming = [record(1), record(2), record(3), record(4), record(5), record(6)];
  const { api, events, mainSheet } = loadAppsScript(current, { maxRows: 8 });

  const response = post(api, {
    records: incoming,
    expectedFingerprint: api.computeRecordsFingerprint_(current),
    reason: "save"
  });

  assert.equal(response.status, "success");
  assert.ok(events.some(event => event.type === "insertRows" && event.sheet === "保養紀錄"));
  assert.deepEqual(plain(api.readRecords_(mainSheet)), incoming);
});

test("a backup failure stops the write before the main sheet changes", () => {
  const current = [record(1), record(2), record(3), record(4)];
  const loaded = loadAppsScript(current, { failBackupInsert: true });

  const response = post(loaded.api, {
    records: current.map(value => ({ ...value, note: "new" })),
    expectedFingerprint: loaded.api.computeRecordsFingerprint_(current),
    allowDestructiveReplace: false,
    reason: "save"
  });

  assert.equal(response.status, "error");
  assert.match(response.message, /backup unavailable/);
  assert.deepEqual(plain(loaded.api.readRecords_(loaded.mainSheet)), current);
  assert.equal(loaded.events.some(event => event.sheet === "保養紀錄" && (event.type === "set" || event.type === "clear")), false);
});

test("backup retention keeps only the newest twenty write batches", () => {
  const initial = [record(1), record(2), record(3), record(4)];
  const loaded = loadAppsScript(initial);
  let current = initial;

  for (let iteration = 1; iteration <= 21; iteration += 1) {
    const incoming = current.map(value => ({ ...value, note: `write-${iteration}` }));
    const response = post(loaded.api, {
      records: incoming,
      expectedFingerprint: loaded.api.computeRecordsFingerprint_(current),
      allowDestructiveReplace: false,
      reason: "save"
    });
    assert.equal(response.status, "success");
    current = incoming;
  }

  const backupSheet = loaded.sheets.get("保養紀錄備份");
  const batchIds = backupSheet.getRange(2, 2, backupSheet.getLastRow() - 1, 1)
    .getDisplayValues()
    .map(row => row[0]);
  assert.equal(new Set(batchIds).size, 20);
  assert.equal(batchIds.includes("batch-1"), false);
  assert.equal(batchIds.includes("batch-21"), true);
});

test("a stale fingerprint returns conflict without backup or mutation", () => {
  const current = [record(1), record(2), record(3), record(4)];
  const { api, events, mainSheet, sheets } = loadAppsScript(current);

  const response = post(api, {
    records: [record(9)],
    expectedFingerprint: "stale",
    allowDestructiveReplace: true,
    reason: "restore"
  });

  assert.equal(response.status, "conflict");
  assert.equal(response.fingerprint, api.computeRecordsFingerprint_(current));
  assert.deepEqual(plain(api.readRecords_(mainSheet)), current);
  assert.equal(sheets.has("保養紀錄備份"), false);
  assert.equal(events.some(event => event.type === "clear"), false);
});

test("legacy arrays and envelopes without a cloud fingerprint are rejected", () => {
  const current = [record(1), record(2)];

  for (const payload of [
    [record(1), record(2), record(3)],
    { records: [record(1), record(2), record(3)], reason: "save" },
    { records: [record(1), record(2), record(3)], expectedFingerprint: "  ", reason: "save" }
  ]) {
    const loaded = loadAppsScript(current);
    const response = post(loaded.api, payload);
    assert.equal(response.status, "rejected");
    assert.deepEqual(plain(loaded.api.readRecords_(loaded.mainSheet)), current);
    assert.equal(loaded.events.some(event => event.type === "set" || event.type === "clear"), false);
  }
});

test("empty and large destructive replacements require explicit restore intent", () => {
  const current = Array.from({ length: 10 }, (_, index) => record(index + 1));

  for (const incoming of [[], current.slice(0, 4)]) {
    const guarded = loadAppsScript(current);
    const response = post(guarded.api, {
      records: incoming,
      expectedFingerprint: guarded.api.computeRecordsFingerprint_(current),
      allowDestructiveReplace: false,
      reason: "save"
    });
    assert.equal(response.status, "rejected");
    assert.deepEqual(plain(guarded.api.readRecords_(guarded.mainSheet)), current);
    assert.equal(guarded.events.some(event => event.type === "clear"), false);
  }

  const allowed = loadAppsScript(current);
  const response = post(allowed.api, {
    records: [],
    expectedFingerprint: allowed.api.computeRecordsFingerprint_(current),
    allowDestructiveReplace: true,
    reason: "restore"
  });
  assert.equal(response.status, "success");
  assert.deepEqual(plain(allowed.api.readRecords_(allowed.mainSheet)), []);
});

test("malformed negative and oversized payloads are rejected before writing", () => {
  const invalidPayloads = [
    { records: [{ ...record(1), mileage: -1 }] },
    { records: [{ ...record(1), detail: { nested: true } }] },
    { records: Array.from({ length: 5001 }, (_, index) => record((index % 28) + 1)) }
  ];

  invalidPayloads.forEach(payload => {
    const current = [record(1)];
    const loaded = loadAppsScript(current);
    const response = post(loaded.api, {
      ...payload,
      expectedFingerprint: loaded.api.computeRecordsFingerprint_(current),
      allowDestructiveReplace: true,
      reason: "restore"
    });
    assert.equal(response.status, "rejected");
    assert.deepEqual(plain(loaded.api.readRecords_(loaded.mainSheet)), current);
    assert.equal(loaded.events.some(event => event.type === "set" || event.type === "clear"), false);
  });
});

test("fuel prices are cached between requests", () => {
  const page = "<p>零售參考價 115年10月6日零時 實行</p><p>92無鉛汽油 27.6 元</p><p>95+無鉛汽油 29.1 元</p><p>98無鉛汽油 31.1 元</p>";
  const loaded = loadAppsScript([], { fetchFuelPage: () => page });

  const first = parseResponse(loaded.api.doGet({ parameter: { action: "fuelPrice" } }));
  const second = parseResponse(loaded.api.doGet({ parameter: { action: "fuelPrice" } }));

  assert.equal(first.ok, true);
  assert.equal(first.prices["98"], 31.1);
  assert.deepEqual(second, first);
  assert.equal(loaded.fetchCalls.length, 1);
});

test("the fuel price cache never crosses the Monday price changes", () => {
  const { api } = loadAppsScript();

  // Sunday 23:00 in Taipei is 15:00 UTC: expire at CPC's Monday 00:00 change.
  assert.equal(api.getFuelPriceCacheSeconds_(new Date("2026-10-04T15:00:00Z")), 3600);
  // Monday 00:00 and 00:30: the NPC page still shows last week's price until 01:00.
  assert.equal(api.getFuelPriceCacheSeconds_(new Date("2026-10-04T16:00:00Z")), 3600);
  assert.equal(api.getFuelPriceCacheSeconds_(new Date("2026-10-04T16:30:00Z")), 1800);
  // From Monday 01:00 the next change is a week away, so the 3-hour cap applies.
  assert.equal(api.getFuelPriceCacheSeconds_(new Date("2026-10-04T17:00:00Z")), 3 * 60 * 60);
  assert.equal(api.getFuelPriceCacheSeconds_(new Date("2026-10-05T01:00:00Z")), 3 * 60 * 60);
  // Late Sunday after a week of caching still stops at Monday 00:00.
  assert.equal(api.getFuelPriceCacheSeconds_(new Date("2026-10-11T14:00:00Z")), 2 * 60 * 60);
});

const crypto = require("node:crypto");
const { jpegBase64 } = require("./helpers/apps-script-harness");

function withPhotos(value, photos) {
  return { ...value, photos };
}

function withoutPhotos({ photos, ...rest }) {
  return rest;
}

function upload(api, payload) {
  return post(api, { action: "uploadPhoto", ...payload });
}

function taipeiToday() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test("photo ids round-trip through the sheet, the fingerprint and the backup", () => {
  const current = [record(1), record(2)];
  const withIds = [withPhotos(record(1), "fakePhoto00000001,fakePhoto00000002"), record(2)];
  const { api, mainSheet, sheets } = loadAppsScript(current);

  const added = post(api, { records: withIds, expectedFingerprint: api.computeRecordsFingerprint_(current), reason: "save" });
  const state = syncState(api);

  assert.equal(added.status, "success");
  assert.deepEqual(state.records, withIds);
  assert.equal(added.fingerprint, state.fingerprint);
  assert.notEqual(state.fingerprint, api.computeRecordsFingerprint_(current));
  assert.equal(mainSheet.read(4, 7), "照片");
  assert.equal(mainSheet.formatAt(5, 7), "@");

  const edited = withIds.map(value => ({ ...value, note: "已確認" }));
  assert.equal(post(api, { records: edited, expectedFingerprint: state.fingerprint, reason: "save" }).status, "success");
  const backup = sheets.get("保養紀錄備份");
  assert.equal(backup.read(1, 10), "照片");
  assert.equal(backup.read(backup.getLastRow() - 1, 10), "fakePhoto00000001,fakePhoto00000002");
  assert.equal(backup.formatAt(backup.getLastRow(), 10), "@");
});

test("records without photos keep the fingerprint they had before the photo column", () => {
  const current = [record(1), record(2)];
  const { api } = loadAppsScript(current);
  const legacy = crypto.createHash("sha256").update(JSON.stringify(current.map(withoutPhotos)), "utf8").digest("hex");

  assert.equal(syncState(api).fingerprint, legacy);
});

test("an older site that sends records without photos is told to reload and changes nothing", () => {
  const current = [withPhotos(record(1), "fakePhoto00000001"), record(2)];
  const { api, events, mainSheet } = loadAppsScript(current);

  const response = post(api, {
    records: current.map(value => ({ ...withoutPhotos(value), note: "舊版網站改的" })),
    expectedFingerprint: api.computeRecordsFingerprint_(current),
    reason: "save"
  });

  assert.equal(response.status, "rejected");
  assert.match(response.message, /網站已更新，請重新整理/);
  assert.deepEqual(plain(api.readRecords_(mainSheet)), current);
  assert.equal(events.some(event => event.type === "set" || event.type === "clear"), false);
});

test("photo values must be a short list of Drive file ids", () => {
  const tooMany = Array.from({ length: 21 }, (_, index) => `fakePhoto${String(index).padStart(8, "0")}`).join(",");
  for (const photos of ["../../etc/passwd", "<img src=x onerror=alert(1)>", "short", 12, null, tooMany]) {
    const current = [record(1)];
    const loaded = loadAppsScript(current);
    const response = post(loaded.api, {
      records: [withPhotos(record(1), photos)],
      expectedFingerprint: loaded.api.computeRecordsFingerprint_(current),
      reason: "save"
    });
    assert.equal(response.status, "rejected", `photos=${photos}`);
    assert.equal(loaded.events.some(event => event.type === "set" || event.type === "clear"), false);
  }
});

test("photo cells edited by hand keep only the file ids", () => {
  const { api, mainSheet } = loadAppsScript([record(1)]);
  mainSheet.write(5, 7, "fakePhoto00000001, 手寫備註 ,fakePhoto00000001\nfakePhoto00000002");

  assert.equal(syncState(api).records[0].photos, "fakePhoto00000001,fakePhoto00000002");
});

test("an uploaded JPEG goes into one photo folder and only its file id comes back", () => {
  const { api, drive, events } = loadAppsScript([record(1)]);

  const first = upload(api, { name: "2026-09-19 改裝升級 ZL1/卡鉗.jpg", data: jpegBase64() });
  const second = upload(api, { name: "", data: jpegBase64(128) });

  assert.deepEqual(Object.keys(first).sort(), ["id", "status"]);
  assert.equal(first.status, "success");
  assert.equal(second.status, "success");
  assert.equal(drive.folders().length, 1);
  assert.equal(drive.folders()[0].name, "2026 Superb Combi 保養照片");
  const photos = drive.photos();
  assert.deepEqual(photos.map(photo => photo.id), [first.id, second.id]);
  assert.deepEqual(photos.map(photo => photo.name), ["2026-09-19 改裝升級 ZL1 卡鉗.jpg", "保養照片.jpg"]);
  assert.ok(photos.every(photo => photo.parents[0] === drive.folders()[0].id));
  assert.deepEqual([...photos[1].bytes.subarray(0, 3)], [0xFF, 0xD8, 0xFF]);
  assert.equal(photos[1].bytes.length, 128);
  assert.equal(events.some(event => event.type === "set" || event.type === "clear"), false);
});

test("uploads that are not JPEGs or are too large are rejected before reaching Drive", () => {
  const { api, drive } = loadAppsScript();
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).toString("base64");

  for (const data of [undefined, "", "not base64!", png, jpegBase64(4 * 1024 * 1024 + 3)]) {
    const response = upload(api, { name: "photo", data });
    assert.equal(response.status, "rejected");
  }
  assert.equal(drive.files.size, 0);
});

test("each Taipei day accepts at most 60 photo uploads", () => {
  const loaded = loadAppsScript();
  const day = new Date("2026-10-28T03:00:00Z");

  for (let count = 0; count < 60; count += 1) loaded.api.reservePhotoUpload_(day);
  assert.throws(() => loaded.api.reservePhotoUpload_(day), /今天已上傳 60 張照片/);
  // 00:30 the next day in Taipei is 16:30 UTC.
  assert.doesNotThrow(() => loaded.api.reservePhotoUpload_(new Date("2026-10-28T16:30:00Z")));

  loaded.properties.set("PHOTO_UPLOAD_COUNT", JSON.stringify({ date: taipeiToday(), count: 60 }));
  const response = upload(loaded.api, { name: "photo", data: jpegBase64() });
  assert.equal(response.status, "rejected");
  assert.equal(loaded.drive.photos().length, 0);
});

test("a trashed photo folder is replaced, but a Drive outage is reported instead", () => {
  const { api, drive } = loadAppsScript();
  assert.equal(upload(api, { name: "a", data: jpegBase64() }).status, "success");

  drive.folders()[0].trashed = true;
  const afterTrash = upload(api, { name: "b", data: jpegBase64() });
  assert.equal(afterTrash.status, "success");
  assert.equal(drive.folders().length, 2);
  assert.equal(drive.files.get(afterTrash.id).parents[0], drive.folders()[1].id);

  drive.Files.get = () => { throw new Error("API call to drive.files.get failed with error: Internal Error"); };
  const duringOutage = upload(api, { name: "c", data: jpegBase64() });
  assert.equal(duringOutage.status, "error");
  assert.equal(drive.folders().length, 2);
});

test("setupPhotoStorage creates the folder and lists anything already in column G", () => {
  const clean = loadAppsScript([record(1), record(2)]);
  clean.api.setupPhotoStorage();
  assert.equal(clean.drive.folders().length, 1);
  assert.match(clean.logs.join("\n"), /drive\.google\.com\/drive\/folders\/fakeFolder00000001/);
  assert.match(clean.logs.join("\n"), /G 欄是空的/);

  const occupied = loadAppsScript([record(1), record(2)]);
  occupied.mainSheet.write(4, 7, "");
  occupied.mainSheet.write(6, 7, "舊的手寫筆記");
  occupied.api.setupPhotoStorage();
  assert.match(occupied.logs.join("\n"), /G6：舊的手寫筆記/);
  assert.doesNotMatch(occupied.logs.join("\n"), /G4/);
});

test("syncState names the photo folder once it exists", () => {
  const { api, drive } = loadAppsScript([record(1)]);
  assert.equal(syncState(api).photoFolderId, "");

  api.setupPhotoStorage();

  assert.equal(syncState(api).photoFolderId, drive.folders()[0].id);
  assert.equal(syncState(api).fingerprint, api.computeRecordsFingerprint_([record(1)]));
});
