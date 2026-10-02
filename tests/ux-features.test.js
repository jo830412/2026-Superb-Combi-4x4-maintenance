const assert = require("node:assert/strict");
const test = require("node:test");
const { createElement, loadApp, readProjectFile } = require("./helpers/app-harness");

const TODAY = "2026-10-02T09:00:00";

function fuel(date, mileage, liters, cost, extra = {}) {
  return {
    date,
    mileage,
    category: "加油",
    cost,
    detail: `加油｜98｜${liters.toFixed(2)} L｜加滿`,
    note: "",
    ...extra
  };
}

function isoDay(offset) {
  return new Date(Date.UTC(2026, 7, 1 + offset)).toISOString().slice(0, 10);
}

test("a new fuel entry reuses the previous fill's fuel type, discount and station", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([{
    date: "2026-09-25",
    mileage: 5000,
    category: "加油",
    cost: 1425,
    detail: "加油｜95｜50.00 L｜加滿｜牌告 31.0 元/L｜優惠 2.5 元/L｜實付 28.5 元/L",
    note: "中油自助，照片辨識"
  }]);

  api.openFuelLogModal({ skipPriceLoad: true });

  assert.equal(element("fuelLogTypeInput").value, "95");
  assert.equal(element("fuelLogDiscountInput").value, "2.5");
  assert.equal(element("fuelLogNoteInput").value, "中油自助");
  assert.match(element("fuelLogMileageHint").textContent, /上次加油 5,000 km（2026-09-25）/);
});

test("a likely mistyped fuel mileage needs a second tap to save", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([fuel("2026-09-25", 5000, 50, 1500)]);
  api.openFuelLogModal({ skipPriceLoad: true });
  element("fuelLogMileageInput").value = "50000";
  element("fuelLogLitersInput").value = "45";
  element("fuelLogUnitPriceInput").value = "31";
  const submitter = createElement();

  api.handleFuelLogSubmit({ preventDefault() {}, submitter });
  assert.equal(api.getRecords().length, 1);
  assert.match(element("fuelLogMessage").textContent, /距上次加油 \+45,000 km/);

  api.handleFuelLogSubmit({ preventDefault() {}, submitter });
  assert.equal(api.getRecords().length, 2);
});

test("a current mileage far above the latest record asks for confirmation", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([{ date: "2026-09-30", mileage: 5000, category: "其他", cost: 0, detail: "目前里程更新", note: "" }]);
  api.openMileageModal();
  element("currentMileageInput").value = "50000";
  const submitter = createElement();

  api.handleMileageSubmit({ preventDefault() {}, submitter });
  assert.match(element("mileageMessage").textContent, /比目前最高里程多 45,000 km/);
  assert.equal(api.getRecords().length, 1);

  api.handleMileageSubmit({ preventDefault() {}, submitter });
  assert.equal(api.getRecords().length, 2);
});

test("adding and editing records can be undone from the toast", () => {
  const { api, element } = loadApp({ today: TODAY });
  const original = { date: "2026-09-01", mileage: 3000, category: "保養", cost: 3000, detail: "機油、機油芯", note: "" };
  api.setRecords([original]);

  api.openEditModal(0);
  element("formCost").value = "3500";
  api.handleFormSubmit({ preventDefault() {}, submitter: createElement() });
  assert.equal(api.getRecords()[0].cost, 3500);
  assert.equal(element("toastAction").textContent, "復原");
  element("toastAction").onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(api.getRecords())), [original]);

  api.openAddModal();
  element("formMileage").value = "";
  element("formCategory").value = "清潔美容";
  element("formCost").value = "500";
  element("formDetail").value = "洗車";
  element("formNote").value = "";
  api.handleFormSubmit({ preventDefault() {}, submitter: createElement() });
  assert.equal(api.getRecords().length, 2);
  assert.match(element("toastMessage").textContent, /已新增清潔美容紀錄/);
  element("toastAction").onclick();
  assert.equal(api.getRecords().length, 1);
});

test("tapping outside a form with unsaved input keeps it open", () => {
  const { api, element } = loadApp();
  const form = createElement("recordForm");
  element("modal").querySelector = selector => selector === "form" ? form : null;

  api.openAddModal();
  form.dataset.dirty = "true";
  assert.equal(api.requestDialogDismiss("modal"), false);
  assert.equal(element("modal").style.display, "flex");
  assert.match(element("toastMessage").textContent, /尚未儲存/);

  api.closeModal();
  assert.equal(element("modal").style.display, "none");

  api.openAddModal();
  assert.equal(form.dataset.dirty, undefined);
  assert.equal(api.requestDialogDismiss("modal"), true);
  assert.equal(element("modal").style.display, "none");
});

test("data quality lists likely duplicates with a button to open the record", () => {
  const { api, element } = loadApp();
  const record = fuel("2026-09-10", 4000, 45, 1500);
  api.setRecords([record, { ...record, note: "重複" }]);

  const issue = api.getDataQualityIssues().find(item => item.type === "duplicate");
  api.renderDataQualityPanel();

  assert.equal(issue.recordIndex, 1);
  assert.match(element("dataQualityPanel").innerHTML, /可能重複的紀錄/);
  assert.match(element("dataQualityPanel").innerHTML, /data-quality-record="1"/);
});

test("fuel analysis reports the fuel cost per kilometre for each full-tank interval", () => {
  const { api, element } = loadApp();
  api.setRecords([fuel("2026-09-01", 1000, 40, 1200), fuel("2026-09-10", 1600, 40, 1300)]);

  const stats = api.getFuelStats();
  api.renderFuelLogSection();

  assert.equal(stats.segments[0].costPerKm.toFixed(2), "2.17");
  assert.match(element("fuelLogTableBody").innerHTML, /NT\$ 2\.17/);
  assert.match(element("fuelLogSummary").textContent, /每公里 NT\$ 2\.17/);
  assert.equal(element("fuelTrend").hidden, true);
});

test("long record lists render in pages with a show-more button", () => {
  const { api, element } = loadApp();
  api.setRecords(Array.from({ length: 120 }, (_, index) => ({
    date: isoDay(index),
    mileage: 1000 + index,
    category: "保養",
    cost: 100,
    detail: `紀錄 ${index}`,
    note: ""
  })));

  api.renderRecords();
  const html = element("recordsContainer").innerHTML;

  assert.equal((html.match(/class="record-item /g) || []).length, 50);
  assert.match(html, /顯示更多（還有 70 筆）/);
});

test("the AI assistant only receives the most recent records", () => {
  const { api } = loadApp();
  api.setRecords(Array.from({ length: 40 }, (_, index) => ({
    date: isoDay(index),
    mileage: 1000 + index * 10,
    category: "保養",
    cost: 0,
    detail: `紀錄 ${index}`,
    note: ""
  })));

  const payload = api.buildAiRequestPayload("洗車 300");

  assert.equal(payload.records.length, 20);
  assert.equal(payload.records[0].mileage, 1390);
});

test("a fuel price fetched this week fills in without waiting for the network", async () => {
  let fetches = 0;
  const localStore = new Map([["newSuperbFuelPrices_v2", JSON.stringify({
    source: "全國加油站",
    effectiveAt: "",
    prices: { "92": 27.6, "95": 29.1, "98": 31.1 },
    cachedAt: new Date().toISOString()
  })]]);
  const { api, element } = loadApp({
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("offline");
    },
    localStore
  });
  element("fuelLogTypeInput").value = "98";

  await api.loadFuelPriceForSelectedType({ force: true });

  assert.equal(element("fuelLogUnitPriceInput").value, "31.1");
  assert.equal(fetches, 0);
});

test("a backup exported from records with blank details can be restored", () => {
  const { api } = loadApp();
  const fromSheet = [{ date: "2026-09-02", mileage: null, category: "其他", cost: 0, detail: "", note: "在試算表手動補的列" }];

  const envelope = JSON.parse(JSON.stringify(api.buildBackupEnvelope(fromSheet)));

  assert.equal(api.validateBackupEnvelope(envelope).ok, true);
});

test("the offline cache precaches the files index.html requests for this release", () => {
  const html = readProjectFile("index.html");
  const sw = readProjectFile("sw.js");
  const version = readProjectFile("app.js").match(/const APP_VERSION = "v([\d.]+)"/)[1];
  const manifest = JSON.parse(readProjectFile("manifest.webmanifest"));

  assert.match(sw, new RegExp(`CACHE_NAME = "superb-maintenance-v${version.replace(/\./g, "\\.")}"`));
  for (const asset of [...html.matchAll(/(?:href|src)="((?:styles\.css|app\.js)\?v=[\d.]+)"/g)].map(match => match[1])) {
    assert.ok(sw.includes(`"./${asset}"`), `${asset} is not precached`);
  }
  for (const icon of manifest.icons) {
    assert.ok(readProjectFile(icon.src).length > 0, `${icon.src} is missing`);
  }
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest" \/>/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png" \/>/);
});

test("the service worker only handles site files and pinned CDN libraries", () => {
  const vm = require("node:vm");
  const listeners = {};
  const context = {
    URL,
    Request: class { constructor(url, init) { Object.assign(this, { url, ...init }); } },
    caches: { open: async () => ({ match: async () => undefined, put: async () => {}, addAll: async () => {} }), keys: async () => [] },
    fetch: async () => ({ ok: true, clone() { return this; } }),
    setTimeout,
    self: {
      location: { origin: "https://example.github.io" },
      addEventListener(type, handler) { listeners[type] = handler; },
      skipWaiting() {},
      clients: { claim() {} }
    }
  };
  vm.createContext(context);
  vm.runInContext(readProjectFile("sw.js"), context);
  const handled = (url, mode = "cors") => {
    let responded = false;
    listeners.fetch({ request: { url, method: "GET", mode }, respondWith() { responded = true; } });
    return responded;
  };

  assert.equal(handled("https://example.github.io/repo/", "navigate"), true);
  assert.equal(handled("https://example.github.io/repo/app.js?v=2026.10.02.1"), true);
  assert.equal(handled("https://example.github.io/repo/api?action=syncState"), false);
  assert.equal(handled("https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js"), true);
  assert.equal(handled("https://script.google.com/macros/s/abc/exec?action=syncState"), false);
});

test("every CSS custom property in use is defined", () => {
  const css = readProjectFile("styles.css");
  const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map(match => match[1]));

  for (const token of used) {
    assert.match(css, new RegExp(`${token}\\s*:`), `${token} is used but never defined`);
  }
});
