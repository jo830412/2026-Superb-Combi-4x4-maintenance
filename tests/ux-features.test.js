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

test("text quick-add uses local rules only and hands unknown text to the regular form", async () => {
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    return { ok: true, json: async () => ({}) };
  };
  const { api, element } = loadApp({ today: TODAY, fetchImpl });
  api.setRecords([fuel("2026-09-30", 6600, 50, 1700)]);

  api.openTextEntryModal();
  element("textEntryInput").value = "洗車 300";
  await api.handleTextEntrySubmit({ preventDefault() {} });
  assert.equal(element("formCategory").value, "清潔美容");
  assert.equal(element("formCost").value, 300);

  // 規則判斷不出來：內容帶進一般表單，類別留空讓使用者自己選。
  api.openTextEntryModal();
  element("textEntryInput").value = "後視鏡電動折疊模組";
  await api.handleTextEntrySubmit({ preventDefault() {} });
  assert.equal(element("formDetail").value, "後視鏡電動折疊模組");
  assert.equal(element("formCategory").value, "");
  assert.equal(element("formMileage").value, "6600");
  assert.match(element("formMessage").textContent, /需確認：類別、費用、里程/);
  assert.equal(fetches, 0);
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

test("the light theme toggle applies, remembers and reports its state", () => {
  const localStore = new Map();
  const { api, element, context } = loadApp({ localStore });
  const attributes = {};
  element("btnThemeToggle").setAttribute = (name, value) => { attributes[name] = value; };

  assert.equal(api.getTheme(), "dark");
  api.setTheme("light");

  assert.equal(context.document.documentElement.dataset.theme, "light");
  assert.equal(localStore.get("newSuperbTheme_v1"), "light");
  assert.equal(attributes["aria-pressed"], "true");
  api.setTheme("dark");
  assert.equal(attributes["aria-pressed"], "false");
});

test("the stored theme is applied before the stylesheet loads", () => {
  const html = readProjectFile("index.html");
  const themeScript = html.indexOf("localStorage.getItem(\"newSuperbTheme_v1\")");

  assert.ok(themeScript > 0 && themeScript < html.indexOf("rel=\"stylesheet\""));
  assert.match(readProjectFile("app.js"), /const THEME_STORAGE_KEY = "newSuperbTheme_v1";/);
});

test("the light theme overrides every colour token of the dark theme", () => {
  const css = readProjectFile("styles.css");
  const block = selector => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf("}", start));
  };
  const tokens = text => new Set([...text.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
  const dark = tokens(block(":root"));
  const light = tokens(block(":root[data-theme=\"light\"]"));
  const themeIndependent = new Set(["--radius-sm", "--radius-md", "--radius-lg", "--radius-xl", "--transition", "--font-sans", "--header-bg"]);

  assert.ok(dark.size > 40);
  for (const token of dark) {
    if (!themeIndependent.has(token)) assert.ok(light.has(token), `${token} has no light-theme value`);
  }
});

test("the page uses the system font stack instead of downloading web fonts", () => {
  assert.doesNotMatch(readProjectFile("index.html"), /fonts\.googleapis\.com/);
  assert.match(readProjectFile("styles.css"), /body \{\s+font-family: var\(--font-sans\);/);
});

test("the overview offers a one-tap fuel entry", () => {
  const html = readProjectFile("index.html");
  const hero = html.slice(html.indexOf("id=\"dashboardHero\""), html.indexOf("id=\"dashboardMetrics\""));

  assert.match(hero, /id="btnHeroFuel"[^>]*>[\s\S]*記錄加油/);
  assert.match(readProjectFile("app.js"), /getElementById\("btnHeroFuel"\)\.addEventListener\("click", \(\) => openFuelLogModal\(\)\)/);
});

test("the sync pill shows a short state and keeps the full message in its title", () => {
  const { api, element } = loadApp();
  const pill = element("syncStatus");

  api.setSyncStatus("warn", "未同步", "已存本機，連線後會自動上傳");
  assert.equal(pill.textContent, "未同步");
  assert.equal(pill.dataset.detail, "已存本機，連線後會自動上傳");
  assert.equal(pill.title, "未同步：已存本機，連線後會自動上傳（點擊可重試同步）");

  api.setSyncStatus("ok", "已同步", "下午09:59");
  assert.equal(pill.title, "已同步：下午09:59");
});

test("photo OCR, the OpenAI proxy and duplicate stats are gone", () => {
  const html = readProjectFile("index.html");
  const more = html.slice(html.indexOf('id="moreVehicleStatus"'), html.indexOf("</details>", html.indexOf('id="moreVehicleStatus"')));
  assert.deepEqual([...more.matchAll(/class="stat-value" id="(\w+)"/g)].map(match => match[1]),
    ["statWarrantyStart", "statTotalCost", "statUpgradeCost", "statFuelAdditive", "ownerNextLegal"]);
  assert.doesNotMatch(html, /btnUpdateMileage|categoryChart|photoModal|data-quick-entry="photo"|AI 紀錄助手/);
  assert.doesNotMatch(readProjectFile("app.js"), /tesseract|aiRecordAssistant|aiStatus|openai/i);
  assert.doesNotMatch(readProjectFile("sw.js"), /tesseract/);
  assert.doesNotMatch(readProjectFile("apps-script/Code.js"), /routeAiRecordAssistant/);
});

test("every CSS custom property in use is defined", () => {
  const css = readProjectFile("styles.css");
  const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map(match => match[1]));

  for (const token of used) {
    assert.match(css, new RegExp(`${token}\\s*:`), `${token} is used but never defined`);
  }
});

test("the next service card offers 記錄保養 once the service is close", () => {
  const { api, element } = loadApp({ today: TODAY });

  api.setRecords([fuel("2026-09-30", 6200, 50, 1700)]);
  api.renderMaintenanceHero(api.getMaintenanceSchedule(api.now()));
  assert.equal(element("btnLogMaintenance").hidden, true);

  api.setRecords([fuel("2026-09-30", 6600, 50, 1700)]);
  api.renderMaintenanceHero(api.getMaintenanceSchedule(api.now()));
  assert.equal(element("btnLogMaintenance").hidden, false);
  assert.match(readProjectFile("app.js"), /getElementById\("btnLogMaintenance"\)\.addEventListener\("click", \(\) => openMaintenanceRecordModal\(\)\)/);
});

test("記錄保養 fills in a routine service that restarts the 7,500 km countdown", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([fuel("2026-09-30", 6600, 50, 1700)]);

  api.openMaintenanceRecordModal();
  assert.equal(element("formDate").value, "2026-10-02");
  assert.equal(element("formMileage").value, "6600");
  assert.equal(element("formCategory").value, "保養");
  assert.equal(element("formDetail").value, "7,500 km 定期保養：機油、機油芯、基本檢查");
  assert.match(element("formMessage").textContent, /對照保養單確認里程/);

  element("formMileage").value = "6620";
  element("formCost").value = "4500";
  api.handleFormSubmit({ preventDefault() {}, submitter: createElement() });
  assert.equal(api.getRecords().length, 2);
  const schedule = api.getMaintenanceSchedule(api.now());
  assert.equal(schedule.baseMileage, 6620);
  assert.equal(schedule.dueMileage, 14120);
});

test("a mileage-tracked record without mileage needs a second tap to save", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([fuel("2026-09-30", 6600, 50, 1700)]);
  const submitter = createElement();

  api.openAddModal();
  element("formMileage").value = "";
  element("formCategory").value = "保養";
  element("formDetail").value = "定期保養";
  api.handleFormSubmit({ preventDefault() {}, submitter });
  assert.equal(api.getRecords().length, 1);
  assert.match(element("formMessage").textContent, /定期保養沒有填里程，就算不出下次 7,500 km 保養/);
  api.handleFormSubmit({ preventDefault() {}, submitter });
  assert.equal(api.getRecords().length, 2);

  api.openAddModal();
  element("formMileage").value = "";
  element("formCategory").value = "更換";
  element("formDetail").value = "輪胎更換 4 條";
  api.handleFormSubmit({ preventDefault() {}, submitter: createElement() });
  assert.equal(api.getRecords().length, 2);
  assert.match(element("formMessage").textContent, /輪胎沒有填里程/);
});

test("a new record starts with the current mileage only while it is dated today", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([
    { date: "2026-09-01", mileage: 6000, category: "保養", cost: 3000, detail: "機油、機油芯", note: "" },
    fuel("2026-09-30", 6600, 50, 1700)
  ]);

  api.openAddModal();
  assert.equal(element("formMileage").value, "6600");

  element("formDate").value = "2026-08-01";
  api.handleRecordFormInput("formDate");
  assert.equal(element("formMileage").value, "");
  element("formDate").value = "2026-10-02";
  api.handleRecordFormInput("formDate");
  assert.equal(element("formMileage").value, "6600");

  // 自己輸入過的里程，改日期也不會被覆蓋。
  element("formMileage").value = "6650";
  api.handleRecordFormInput("formMileage");
  element("formDate").value = "2026-08-01";
  api.handleRecordFormInput("formDate");
  assert.equal(element("formMileage").value, "6650");

  // 編輯舊紀錄時保留那筆的里程。
  api.openEditModal(0);
  assert.equal(element("formMileage").value, 6000);
  element("formDate").value = "2026-10-02";
  api.handleRecordFormInput("formDate");
  assert.equal(element("formMileage").value, 6000);
});

test("drafts without a mileage only get the current mileage when dated today", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([fuel("2026-09-30", 6600, 50, 1700)]);
  const draft = fields => ({ localParser: true, draft: { cost: 1000, detail: "測試", ...fields } });

  api.applyServiceDraft(draft({ date: "2026-08-11", category: "改裝升級" }), "8/11 輪框");
  assert.equal(element("formMileage").value, "");
  api.applyServiceDraft(draft({ date: "2026-10-02", category: "清潔美容" }), "洗車");
  assert.equal(element("formMileage").value, "6600");
  api.applyServiceDraft(draft({ date: "2026-10-02", category: "保養", mileage: 6620 }), "保養");
  assert.equal(String(element("formMileage").value), "6620");
});

function ownershipRecords() {
  return [
    { date: "2026-05-28", mileage: 50, category: "保險", cost: 33000, detail: "丙式保險", note: "" },
    { date: "2026-05-28", mileage: 50, category: "其他", cost: 20000, detail: "前檔隔熱紙", note: "新車隔熱紙加價費用" },
    { date: "2026-06-05", mileage: 400, category: "清潔美容", cost: 37000, detail: "犀牛皮", note: "" },
    { date: "2026-08-11", mileage: 3249, category: "改裝升級", cost: 50000, detail: "輪框改裝\n水晶黑", note: "" },
    { date: "2026-09-30", mileage: 6000, category: "其他", cost: 0, detail: "目前里程更新", note: "" },
    fuel("2026-09-30", 6000, 60, 3000)
  ];
}

test("the overview shows running costs and keeps upgrades and cosmetics separate", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords(ownershipRecords());

  assert.deepEqual(JSON.parse(JSON.stringify(api.getCostSplit())), { running: 36000, fuel: 3000, upgrades: 107000, upgradeCount: 3 });
  // 清潔美容一律算美容，即使內容提到「保養」。
  assert.equal(api.isRunningCostRecord({ category: "清潔美容", detail: "鍍膜保養", note: "", cost: 1500 }), false);

  api.updateStats();
  assert.equal(element("statRecentCost").textContent, "3.6 萬");
  assert.equal(element("statRecentCostMeta").textContent, "每公里 6.0 元\n其中油錢 0.5 元");
  assert.equal(element("statUpgradeCost").textContent, "10.7 萬");
  assert.equal(element("statUpgradeLabel").textContent, "改裝美容 NT$・3 項");
  assert.equal(element("btnUpgradeList").hidden, false);
});

test("the cost summary lists upgrades newest first with their total", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords(ownershipRecords());

  api.renderOwnershipCostPanel();
  assert.match(element("ownershipSummary").textContent, /用車 NT\$ 36,000/);
  // 與總覽的「每公里 6.0 元」相同：都從交車基準起算，不是交車當天補登的 50 km。
  assert.match(element("ownershipSummary").textContent, /每公里 NT\$ 6\.0/);
  assert.match(element("ownershipSummary").textContent, /改裝美容 NT\$ 107,000/);
  assert.match(element("ownershipCostGrid").innerHTML, /用車[\s\S]*保養維修[\s\S]*改裝美容[\s\S]*美容與其他/);
  assert.equal(element("upgradeCostList").hidden, false);
  assert.equal(element("upgradeCostSummary").textContent, "改裝美容清單 · 3 項 · NT$ 107,000");
  const order = [...element("upgradeCostItems").innerHTML.matchAll(/data-upgrade-record="(\d+)"/g)].map(match => Number(match[1]));
  assert.deepEqual(order, [3, 2, 1]);
  assert.match(element("upgradeCostItems").innerHTML, /<strong>輪框改裝<\/strong>/);
});

test("the yearly cost chart stacks running costs and upgrades per year", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([
    { date: "2025-12-01", mileage: 0, category: "改裝升級", cost: 10000, detail: "車標", note: "" },
    { date: "2026-07-01", mileage: 1000, category: "保養", cost: 3000, detail: "機油", note: "" },
    fuel("2026-07-14", 1500, 40, 1200),
    { date: "2026-08-11", mileage: 3249, category: "改裝升級", cost: 50000, detail: "輪框", note: "" }
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(api.getYearlyCostSplit())), [
    { year: "2025", running: 0, upgrades: 10000 },
    { year: "2026", running: 4200, upgrades: 50000 }
  ]);
  api.renderCostLegend();
  assert.match(element("costLegend").innerHTML, /chart-legend-running[\s\S]*用車[\s\S]*chart-legend-upgrades[\s\S]*改裝美容/);
});

test("the Haldex oil is due after two years or 60,000 km, whichever comes first", () => {
  const { api } = loadApp({ today: TODAY });
  const rule = api.CONSUMABLE_RULES.find(item => item.name === "四驅油");

  api.setRecords([fuel("2026-09-30", 6000, 50, 1700)]);
  const state = api.buildTrackerState(rule);
  assert.equal(state.status, "ok");
  assert.equal(state.meta, "下一次約 2028-05-28 或達 60,000 km");
  const task = api.getCalendarTask({ name: rule.name, ...api.getTrackerCalendarSchedule(rule, state) });
  assert.equal(task.date, "2028-05-28");
  assert.equal(task.description, "預計 2028-05-28 或 60,000 公里，以先到者為準");

  // 里程先到時改看里程。
  api.setRecords([fuel("2026-09-30", 58000, 50, 1700)]);
  const busy = api.buildTrackerState(rule);
  assert.equal(busy.status, "soon");
  assert.equal(busy.value, "剩 2,000 km");
  assert.match(busy.next, /^最晚 2028-05-28，以先到者為準。/);

  // 換過之後從那一次重新計算。
  api.setRecords([
    { date: "2026-09-01", mileage: 5000, category: "保養", cost: 3000, detail: "四驅（Haldex）油更換", note: "" },
    fuel("2026-09-30", 6000, 50, 1700)
  ]);
  assert.equal(api.buildTrackerState(rule).meta, "下一次約 2028-09-01 或達 65,000 km");
});

test("brake fluid is due three years after delivery and then every two years", () => {
  const { api } = loadApp({ today: TODAY });
  const rule = api.CONSUMABLE_RULES.find(item => item.name === "煞車油");

  api.setRecords([fuel("2026-09-30", 6000, 50, 1700)]);
  assert.equal(api.buildTrackerState(rule).meta, "下一次約 2029-05-28");

  api.setRecords([
    { date: "2026-08-11", mileage: 3249, category: "保養", cost: 0, detail: "煞車油更換", note: "ZL1 卡鉗安裝時一併更換" },
    fuel("2026-09-30", 6000, 50, 1700)
  ]);
  assert.equal(api.buildTrackerState(rule).meta, "下一次約 2028-08-11");
  api.assign("nowOverride", "2028-06-01T09:00:00");
  assert.equal(api.buildTrackerState(rule).status, "ok");
  api.assign("nowOverride", "2028-06-12T09:00:00");
  assert.equal(api.buildTrackerState(rule).status, "soon");
});

test("ZL1 pads count from the caliper install, skip rear pads and restart after a check", () => {
  const { api } = loadApp({ today: TODAY });
  const rule = api.CONSUMABLE_RULES.find(item => item.name === "ZL1 來令片");
  const install = { date: "2026-08-11", mileage: 3249, category: "改裝升級", cost: 71000, detail: "ZL1 卡鉗\n含盤380/鋼質油管/來令片", note: "" };
  const latestFuel = fuel("2026-09-30", 6238, 50, 1700);

  api.setRecords([install, latestFuel]);
  const state = api.buildTrackerState(rule);
  assert.equal(state.value, "剩 27,011 km");
  assert.equal(state.meta, "上次 3,249 km / 已跑 2,989 km");
  assert.match(state.next, /剩 3 mm 以下就換/);

  api.setRecords([install, { date: "2026-09-20", mileage: 6000, category: "更換", cost: 3000, detail: "後來令片更換", note: "" }, latestFuel]);
  assert.equal(api.buildTrackerState(rule).meta, "上次 3,249 km / 已跑 2,989 km");

  api.setRecords([install, { date: "2026-09-25", mileage: 6100, category: "保養", cost: 0, detail: "來令片檢查，剩 9 mm", note: "" }, latestFuel]);
  assert.equal(api.buildTrackerState(rule).meta, "上次 6,100 km / 已跑 138 km");
  // 檢查來令片不算一次定期保養。
  assert.equal(api.getLastMaintenanceRecord(), undefined);
});

test("spark plugs and the air filter follow km unless their deadline comes first", () => {
  const { api } = loadApp({ today: TODAY });
  const rule = name => api.CONSUMABLE_RULES.find(item => item.name === name);
  api.setRecords([fuel("2026-09-30", 6238, 50, 1700)]);

  const air = api.buildTrackerState(rule("空氣濾芯"));
  assert.equal(air.value, "剩 23,762 km");
  assert.match(air.next, /^最晚 2028-05-28，以先到者為準。/);
  const plugs = api.buildTrackerState(rule("火星塞"));
  assert.equal(plugs.value, "剩 53,762 km");
  assert.match(plugs.next, /^最晚 2030-05-28，以先到者為準。/);

  // 新範本會被對應的項目認得，也不會被當成定期保養。
  const html = readProjectFile("index.html");
  for (const [key, name] of [["haldex", "四驅油"], ["sparkPlugs", "火星塞"], ["airFilter", "空氣濾芯"], ["brakeFluid", "煞車油"]]) {
    const template = api.RECORD_TEMPLATES[key];
    const record = { date: "2026-10-01", mileage: 6238, category: template.category, cost: 1000, detail: template.detail, note: template.note };
    assert.equal(api.recordMatchesRule(record, rule(name)), true, key);
    assert.equal(api.isRoutineMaintenanceRecord(record), false, key);
    assert.match(html, new RegExp(`<option value="${key}">`), key);
  }
});
