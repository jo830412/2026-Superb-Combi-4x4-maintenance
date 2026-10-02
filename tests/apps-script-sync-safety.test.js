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
    note: "3/4"
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

test("the fuel price cache never crosses the Monday price change", () => {
  const { api } = loadAppsScript();

  // Sunday 23:00 in Taipei is 15:00 UTC.
  assert.equal(api.getFuelPriceCacheSeconds_(new Date("2026-10-04T15:00:00Z")), 3600);
  assert.equal(api.getFuelPriceCacheSeconds_(new Date("2026-10-05T01:00:00Z")), 3 * 60 * 60);
});
