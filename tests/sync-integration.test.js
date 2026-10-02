// End-to-end sync scenarios: the real app.js talking to the real Code.js on a fake sheet.
const assert = require("node:assert/strict");
const test = require("node:test");
const { loadApp } = require("./helpers/app-harness");
const { loadAppsScript, plain } = require("./helpers/apps-script-harness");

const STORAGE_KEY = "newSuperbMaintenanceRecords_v1";

function rec(day, extra = {}) {
  return {
    date: `2026-09-${String(day).padStart(2, "0")}`,
    mileage: day * 500,
    category: "保養",
    cost: 1000 + day,
    detail: `紀錄 ${day}`,
    note: "",
    ...extra
  };
}

function details(list) {
  return plain(list).map(item => item.detail).sort();
}

// A network between one device and the Apps Script backend.
function connect(backend) {
  const net = { offline: false, failNextGet: false, loseNextResponse: false, hold: false, held: [], posts: [] };
  net.fetch = async (url, options = {}) => {
    const method = (options.method || "GET").toUpperCase();
    if (net.offline) throw new TypeError("Failed to fetch");
    if (method === "GET" && net.failNextGet) {
      net.failNextGet = false;
      throw new Error("The operation was aborted");
    }
    const parameter = Object.fromEntries(new URL(url).searchParams);
    const output = method === "POST"
      ? backend.api.doPost({ parameter, postData: { contents: options.body } })
      : backend.api.doGet({ parameter });
    const body = JSON.parse(output.getContent());
    if (method === "POST") net.posts.push({ sent: JSON.parse(options.body), reply: body });
    if (method === "POST" && net.loseNextResponse) {
      net.loseNextResponse = false;
      throw new TypeError("Network connection was lost");
    }
    const response = { ok: true, status: 200, json: async () => body };
    if (net.hold) return new Promise(resolve => net.held.push(() => resolve(response)));
    return response;
  };
  net.release = () => {
    net.hold = false;
    while (net.held.length) net.held.shift()();
  };
  return net;
}

async function openDevice(backend, { localStore = new Map(), net = connect(backend) } = {}) {
  const device = loadApp({ fetchImpl: net.fetch, localStore });
  await device.api.initData();
  await device.api.whenSyncIdle();
  return { ...device, net, localStore };
}

test("deleting then quickly undoing never surfaces a conflict and keeps the record", async () => {
  const backend = loadAppsScript([rec(1), rec(2), rec(3), rec(4)]);
  const phone = await openDevice(backend);

  phone.net.hold = true;
  phone.api.setDeleteTargetIndex(0);
  phone.api.handleDeleteConfirm();
  phone.api.undoLastChange();
  phone.net.release();
  await phone.api.whenSyncIdle();
  phone.net.release();
  await phone.api.whenSyncIdle();

  assert.deepEqual(phone.net.posts.map(entry => entry.reply.status), ["success", "success"]);
  assert.deepEqual(details(backend.api.readRecords_(backend.mainSheet)), details([rec(1), rec(2), rec(3), rec(4)]));
  assert.match(phone.element("syncStatus").textContent, /已同步/);

  const reopened = await openDevice(backend, { localStore: phone.localStore });
  assert.equal(reopened.api.getRecords().length, 4);
});

test("a record saved offline is uploaded when the app is opened again", async () => {
  const backend = loadAppsScript([rec(1), rec(2)]);
  const phone = await openDevice(backend);

  phone.net.offline = true;
  phone.api.setRecords([...phone.api.getRecords(), rec(3, { category: "加油", detail: "加油｜98｜45.00 L｜加滿" })]);
  await phone.api.saveRecords(phone.api.getRecords());
  assert.match(phone.element("syncStatus").textContent, /未同步/);

  const net = connect(backend);
  const reopened = await openDevice(backend, { localStore: phone.localStore, net });

  assert.equal(reopened.api.getRecords().length, 3);
  assert.deepEqual(details(backend.api.readRecords_(backend.mainSheet)), details([rec(1), rec(2), rec(3, { detail: "加油｜98｜45.00 L｜加滿" })]));
});

test("a failed first read never writes without a cloud version and later merges", async () => {
  const backend = loadAppsScript([rec(1), rec(2), rec(3), rec(4), rec(5, { detail: "另一台裝置新增" })]);
  const staleLocal = [rec(1), rec(2), rec(3), rec(4)];
  const localStore = new Map([
    [STORAGE_KEY, JSON.stringify(staleLocal)],
    ["newSuperbSyncMeta_v1", JSON.stringify({
      version: 1,
      baseFingerprint: backend.api.computeRecordsFingerprint_(staleLocal),
      baseRecords: staleLocal,
      dirty: false,
      pendingRestore: false,
      lastAttempt: null
    })]
  ]);
  const net = connect(backend);
  net.failNextGet = true;
  const phone = await openDevice(backend, { localStore, net });

  phone.api.setRecords([...phone.api.getRecords(), rec(6, { detail: "手機新增" })]);
  await phone.api.saveRecords(phone.api.getRecords());
  await phone.api.whenSyncIdle();

  assert.ok(net.posts.every(entry => entry.sent.expectedFingerprint));
  assert.deepEqual(details(backend.api.readRecords_(backend.mainSheet)), details([
    rec(1), rec(2), rec(3), rec(4), rec(5, { detail: "另一台裝置新增" }), rec(6, { detail: "手機新增" })
  ]));
  assert.equal(phone.api.getRecords().length, 6);
});

test("changes from two devices are merged instead of overwritten", async () => {
  const backend = loadAppsScript([rec(1), rec(2)]);
  const phone = await openDevice(backend);
  const laptop = await openDevice(backend);

  laptop.api.setRecords([...laptop.api.getRecords(), rec(3, { detail: "筆電新增" })]);
  await laptop.api.saveRecords(laptop.api.getRecords());

  phone.api.setRecords([...phone.api.getRecords().filter(item => item.detail !== "紀錄 1"), rec(4, { detail: "手機新增" })]);
  await phone.api.saveRecords(phone.api.getRecords());
  await phone.api.whenSyncIdle();

  const expected = details([rec(2), rec(3, { detail: "筆電新增" }), rec(4, { detail: "手機新增" })]);
  assert.deepEqual(details(backend.api.readRecords_(backend.mainSheet)), expected);
  assert.deepEqual(details(phone.api.getRecords()), expected);
  assert.match(phone.element("toastMessage").textContent, /已合併其他裝置的 1 項變更/);
});

test("a write whose response was lost is recognised instead of duplicated", async () => {
  const backend = loadAppsScript([rec(1)]);
  const phone = await openDevice(backend);

  phone.net.loseNextResponse = true;
  phone.api.setRecords([...phone.api.getRecords(), rec(2)]);
  await phone.api.saveRecords(phone.api.getRecords());
  assert.equal(phone.api.getSyncMeta().dirty, true);

  await phone.api.requestSync({ reconcile: true });
  await phone.api.whenSyncIdle();

  assert.equal(phone.api.getSyncMeta().dirty, false);
  assert.equal(phone.api.getSyncMeta().lastAttempt, null);
  assert.equal(phone.net.posts.length, 1);
  assert.deepEqual(details(backend.api.readRecords_(backend.mainSheet)), details([rec(1), rec(2)]));
});

test("checking sync while already synced does not use up backup batches", async () => {
  const backend = loadAppsScript([rec(1), rec(2), rec(3)]);
  const phone = await openDevice(backend);

  for (let tap = 0; tap < 5; tap += 1) {
    await phone.api.requestSync({ reconcile: true });
  }
  await phone.api.saveRecords(phone.api.getRecords());

  assert.equal(phone.net.posts.length, 1);
  assert.equal(phone.net.posts[0].reply.unchanged, true);
  assert.deepEqual(backend.backupBatches(), []);
});

test("a confirmed restore still replaces everything after another device changed the cloud", async () => {
  const backend = loadAppsScript([rec(1), rec(2), rec(3), rec(4), rec(5), rec(6)]);
  const phone = await openDevice(backend);
  const laptop = await openDevice(backend);
  laptop.api.setRecords([...laptop.api.getRecords(), rec(7)]);
  await laptop.api.saveRecords(laptop.api.getRecords());

  const backup = [rec(10, { detail: "備份 A" })];
  await phone.api.saveRecords(backup, { allowDestructiveReplace: true });
  await phone.api.whenSyncIdle();

  assert.deepEqual(details(backend.api.readRecords_(backend.mainSheet)), ["備份 A"]);
  assert.equal(phone.api.getSyncMeta().pendingRestore, false);
});

test("the first run after upgrading keeps a copy of local data that differs from the cloud", async () => {
  const backend = loadAppsScript([rec(1), rec(2)]);
  const localStore = new Map([[STORAGE_KEY, JSON.stringify([rec(1), rec(9, { detail: "舊版未同步" })])]]);

  const phone = await openDevice(backend, { localStore });

  assert.deepEqual(details(phone.api.getRecords()), details([rec(1), rec(2)]));
  const stash = JSON.parse(localStore.get("newSuperbLocalBeforeSyncUpgrade_v1"));
  assert.deepEqual(details(stash.records), details([rec(1), rec(9, { detail: "舊版未同步" })]));
  assert.equal(phone.element("btnLegacyStashDownload").hidden, false);
});

test("records are not replaced while an edit form is open", async () => {
  const backend = loadAppsScript([rec(1), rec(2)]);
  const phone = await openDevice(backend);
  const laptop = await openDevice(backend);
  laptop.api.setRecords([...laptop.api.getRecords(), rec(3, { detail: "筆電新增" })]);
  await laptop.api.saveRecords(laptop.api.getRecords());

  phone.api.openEditModal(0);
  await phone.api.requestSync({ reconcile: true });
  assert.equal(phone.api.getRecords().length, 2);

  phone.api.closeModal();
  await phone.api.whenSyncIdle();
  assert.equal(phone.api.getRecords().length, 3);
});
