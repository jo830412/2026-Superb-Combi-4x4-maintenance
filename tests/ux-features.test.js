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

test("a data-quality warning marked 沒問題 stays hidden until its numbers change", () => {
  const localStore = new Map();
  const { api, element } = loadApp({ today: TODAY, localStore });
  const regression = [
    fuel("2026-07-02", 2000, 50, 1700),
    { date: "2026-07-03", mileage: 1981, category: "其他", cost: 0, detail: "目前里程更新", note: "" }
  ];
  api.setRecords(regression);
  api.renderDataQualityPanel();
  const panel = () => element("dataQualityPanel").innerHTML;
  const id = panel().match(/data-quality-ignore="([^"]+)"/)[1];

  api.ignoreQualityIssue(id);
  assert.doesNotMatch(panel(), /里程比前一筆紀錄低/);
  assert.match(panel(), /已標記沒問題 1 項/);
  assert.deepEqual(JSON.parse(localStore.get("newSuperbIgnoredQualityIssues_v1")), [id]);

  element("toastAction").onclick();
  assert.match(panel(), /里程比前一筆紀錄低/);

  // 改了里程但仍然倒退：數字不同，視為新的提醒。
  api.ignoreQualityIssue(id);
  api.setRecords([regression[0], { ...regression[1], mileage: 1990 }]);
  api.renderDataQualityPanel();
  assert.match(panel(), /1,990 km，低於先前的 2,000 km/);

  // 重新開啟後仍記得；「全部重新顯示」會清掉。
  const reloaded = loadApp({ today: TODAY, localStore });
  reloaded.api.setRecords(regression);
  reloaded.api.renderDataQualityPanel();
  assert.doesNotMatch(reloaded.element("dataQualityPanel").innerHTML, /里程比前一筆紀錄低/);
  reloaded.api.restoreIgnoredQualityIssues();
  assert.match(reloaded.element("dataQualityPanel").innerHTML, /里程比前一筆紀錄低/);
});

test("fuel intervals marked 沒問題 lose their 待確認 flag", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([
    fuel("2026-08-01", 1000, 40, 1200),
    fuel("2026-08-08", 1500, 40, 1200),
    fuel("2026-08-15", 2000, 40, 1200),
    fuel("2026-08-22", 2500, 40, 1200),
    fuel("2026-08-29", 3000, 40, 1200),
    fuel("2026-09-05", 4000, 40, 1200),
    fuel("2026-09-12", 4500, 40, 1200)
  ]);
  api.renderFuelLogSection();
  assert.equal((element("fuelLogTableBody").innerHTML.match(/待確認/g) || []).length, 1);

  const outlier = api.getDataQualityIssues().find(issue => issue.type === "fuel-outlier");
  api.ignoreQualityIssue(api.getQualityIssueId(outlier));
  api.renderFuelLogSection();
  assert.doesNotMatch(element("fuelLogTableBody").innerHTML, /待確認/);
});

test("standalone non-oil 保養 items do not restart the 7,500 km countdown", () => {
  const { api } = loadApp({ today: TODAY });
  const service = detail => ({ date: "2026-10-15", mileage: 7000, category: "保養", cost: 1200, detail, note: "" });

  for (const detail of ["四輪平衡", "胎壓檢查", "冷媒補充", "冷卻液更換", "節氣門清潔", "噴油嘴清潔", "鍍膜", "洗車"]) {
    assert.equal(api.isRoutineMaintenanceRecord(service(detail)), false, detail);
  }
  // 有寫到定期保養或機油的仍算一次定期保養。
  assert.equal(api.isRoutineMaintenanceRecord(service("定期保養：機油、機油芯、冷卻液檢查")), true);
  assert.equal(api.isRoutineMaintenanceRecord(service("保養")), true);

  api.setRecords([fuel("2026-10-18", 7306, 50, 1600), service("四輪平衡")]);
  assert.equal(api.getMaintenanceSchedule(api.now()).dueMileage, 7500);
});

test("same-day purchases with different prices are not flagged as duplicates", () => {
  const { api } = loadApp({ today: TODAY });
  const tint = { date: "2026-05-28", mileage: 1, category: "其他", cost: 20000, detail: "隔熱紙", note: "" };
  const dashcam = { ...tint, cost: 16000, detail: "行車記錄器" };

  api.setRecords([tint, dashcam]);
  assert.equal(api.getDataQualityIssues().filter(issue => issue.type === "duplicate").length, 0);
  assert.equal(api.findLikelyDuplicates({ ...dashcam, detail: "行車記錄器（重複輸入）" }).length, 1);

  api.setRecords([tint, { ...tint, note: "重複登錄" }]);
  const duplicate = api.getDataQualityIssues().find(issue => issue.type === "duplicate");
  assert.match(duplicate.detail, /其他 · NT\$ 20,000 有 2 筆/);
});

// 每 500 km 加 40 L（12.5 km/L）的六個區間。
function steadyFills() {
  return [
    fuel("2026-08-01", 1000, 40, 1200),
    fuel("2026-08-08", 1500, 40, 1200),
    fuel("2026-08-15", 2000, 40, 1200),
    fuel("2026-08-22", 2500, 40, 1200),
    fuel("2026-08-29", 3000, 40, 1200),
    fuel("2026-09-05", 3500, 40, 1200),
    fuel("2026-09-12", 4000, 40, 1200)
  ];
}

test("the fuel average leaves out abnormal intervals", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([...steadyFills(), fuel("2026-09-19", 5000, 40, 1200)]);

  const stats = api.getFuelStats();
  assert.equal(stats.averageKmPerLiter, 12.5);
  assert.equal(stats.excludedSegmentCount, 1);
  api.renderFuelLogSection();
  assert.match(element("fuelLogSummary").textContent, /平均 12\.5 km\/L（不含 1 段異常）/);
});

test("saving a full fill with an implausible km/L needs a second tap", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords(steadyFills());
  const submitter = createElement();

  api.openFuelLogModal({ skipPriceLoad: true });
  element("fuelLogMileageInput").value = "5000";
  element("fuelLogLitersInput").value = "40";
  element("fuelLogUnitPriceInput").value = "34";
  api.updateFuelLogMileageHint();
  assert.match(element("fuelLogMileageHint").textContent, /換算 25\.0 km\/L，明顯高於其他加滿區間（平常約 12\.5 km\/L）/);

  api.handleFuelLogSubmit({ preventDefault() {}, submitter });
  assert.equal(api.getRecords().length, 7);
  assert.match(element("fuelLogMessage").textContent, /可能漏記一次加油、上次沒加滿，或里程、公升打錯；確認無誤請再按一次儲存/);
  api.handleFuelLogSubmit({ preventDefault() {}, submitter });
  assert.equal(api.getRecords().length, 8);
});

test("a normal fill shows its km/L and counts liters of fills that were not full", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([
    ...steadyFills(),
    fuel("2026-09-20", 4250, 20, 600, { detail: "加油｜98｜20.00 L｜未加滿" })
  ]);

  api.openFuelLogModal({ skipPriceLoad: true });
  element("fuelLogMileageInput").value = "4500";
  element("fuelLogLitersInput").value = "20";
  element("fuelLogUnitPriceInput").value = "34";
  api.updateFuelLogMileageHint();
  // 500 km ÷（20 + 20）L：沒加滿那次的公升也要算進去。
  assert.match(element("fuelLogMileageHint").textContent, /換算約 12\.5 km\/L/);

  api.handleFuelLogSubmit({ preventDefault() {}, submitter: createElement() });
  assert.equal(api.getRecords().length, 9);
});

function stationFill(date, mileage, cost, pricing, note) {
  return { date, mileage, category: "加油", cost, detail: `加油｜98｜50.00 L｜加滿｜${pricing}`, note };
}

const NPC_SELF_FILL = stationFill("2026-09-25", 5000, 1645, "牌告 34.7 元/L｜優惠 1.8 元/L｜實付 32.9 元/L", "全國加油站自助");
const FORMOSA_CUBE_FILL = stationFill("2026-10-05", 5500, 1660, "牌告 34.7 元/L｜優惠 1.5 元/L｜實付 33.2 元/L｜回饋 2%", "台塑自助");

test("picking the 台塑 CUBE offer fills the price cut, the 2% rebate and the station", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([NPC_SELF_FILL]);
  api.openFuelLogModal({ skipPriceLoad: true });
  assert.equal(element("fuelLogOfferInput").value, "npc-self");
  element("fuelLogMileageInput").value = "5500";
  element("fuelLogLitersInput").value = "50";
  element("fuelLogUnitPriceInput").value = "34.7";

  element("fuelLogOfferInput").value = "formosa-cube";
  api.applyFuelOffer("formosa-cube");

  assert.equal(element("fuelLogDiscountInput").value, "1.2");
  assert.equal(element("fuelLogRebateInput").value, "2");
  assert.equal(element("fuelLogNoteInput").value, "台塑自助");
  assert.equal(element("fuelLogCostInput").value, 1675);
  assert.match(element("fuelLogOfferHint").textContent, /加油前先在 CUBE App 切到「台塑家」才有 2% 小樹點/);
  // 50 L × (34.7 − 1.2) = 1,675；2% 小樹點 34 點，回饋後 1,641 ÷ 50 L。
  assert.match(element("fuelLogNetPriceHint").textContent,
    /實付單價 33\.5 元\/L，預估油費 NT\$ 1,675；2% 回饋約 NT\$ 34，實際約 NT\$ 1,641（32\.8 元\/L）；若發票金額不同可直接修改/);

  api.handleFuelLogSubmit({ preventDefault() {}, submitter: createElement() });

  const saved = api.getRecords().find(record => record.note === "台塑自助");
  assert.equal(saved.cost, 1675);
  assert.equal(saved.detail, "加油｜98｜50.00 L｜加滿｜牌告 34.7 元/L｜優惠 1.2 元/L｜實付 33.5 元/L｜回饋 2%");
});

test("the fill after a 台塑 CUBE fill keeps the offer, its rebate and that station's own price cut", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([NPC_SELF_FILL, FORMOSA_CUBE_FILL]);

  api.openFuelLogModal({ skipPriceLoad: true });

  assert.equal(element("fuelLogOfferInput").value, "formosa-cube");
  assert.equal(element("fuelLogDiscountInput").value, "1.5");
  assert.equal(element("fuelLogRebateInput").value, "2");
  assert.equal(element("fuelLogNoteInput").value, "台塑自助");

  // 換回全國加油站：折抵與回饋跟著改，備註其餘文字保留。
  element("fuelLogNoteInput").value = "台塑自助，胎壓 36 psi";
  api.applyFuelOffer("npc-self");
  assert.equal(element("fuelLogDiscountInput").value, "1.8");
  assert.equal(element("fuelLogRebateInput").value, "0");
  assert.equal(element("fuelLogNoteInput").value, "全國加油站自助，胎壓 36 psi");
});

test("offers replace only the station part of the note", () => {
  const { api } = loadApp({ today: TODAY });
  const formosa = api.FUEL_OFFERS.find(offer => offer.id === "formosa-cube");

  assert.equal(api.replaceFuelStation("全國加油站自助", formosa), "台塑自助");
  assert.equal(api.replaceFuelStation("中油，跳停一次", formosa), "台塑自助，跳停一次");
  assert.equal(api.replaceFuelStation("台亞自助", formosa), "台亞自助");
  assert.equal(api.replaceFuelStation("胎壓 36 psi", formosa), "台塑自助，胎壓 36 psi");
  assert.equal(api.replaceFuelStation("", formosa), "台塑自助");
  assert.equal(api.findFuelOffer("統一速邁樂自助", 2)?.id, "formosa-cube");
  assert.equal(api.findFuelOffer("台塑自助", 0), null);
});

test("every fuel offer is listed in the fuel form", () => {
  const { api } = loadApp();
  const html = readProjectFile("index.html");
  for (const offer of api.FUEL_OFFERS) {
    assert.ok(html.includes(`<option value="${offer.id}">${offer.label}</option>`), offer.id);
  }
  assert.ok(html.includes('<option value="custom">'));
  for (const id of ["fuelLogRebateInput", "fuelLogFCoinInput", "fuelLogCouponInput"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /<th>油費<\/th><th>回饋<\/th>/);
});

test("the fuel analysis shows the card rebate while costs stay at the paid amount", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([NPC_SELF_FILL, FORMOSA_CUBE_FILL]);

  const [npc, formosa] = api.getFuelLogs();
  assert.equal(npc.rebatePercent, 0);
  assert.equal(npc.rebate, 0);
  assert.equal(formosa.rebatePercent, 2);
  assert.equal(formosa.rebate, 33);
  assert.equal(api.getFuelStats().totalCost, 3305);

  api.renderFuelLogSection();
  assert.match(element("fuelLogSummary").textContent, /累計 NT\$ 3,305 · 刷卡回饋約 NT\$ 33 · 平均/);
  const html = element("fuelLogTableBody").innerHTML;
  assert.match(html, /<td data-label="折抵">1\.5<\/td>/);
  assert.match(html, /<td data-label="回饋">NT\$ 33<\/td>/);
  assert.match(html, /<td data-label="回饋">—<\/td>/);
});

test("the 台塑 CUBE offer asks to check the terms once its campaign period is over", () => {
  const { api, element } = loadApp({ today: "2027-01-05T09:00:00" });
  api.setRecords([NPC_SELF_FILL, FORMOSA_CUBE_FILL]);

  api.openFuelLogModal({ skipPriceLoad: true });

  assert.equal(element("fuelLogOfferInput").value, "formosa-cube");
  assert.match(element("fuelLogOfferHint").textContent, /活動期間是 2026\/06\/01–2026\/12\/31，加油日不在期間內/);
});

test("an unreadable card rebate blocks saving", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([NPC_SELF_FILL]);
  api.openFuelLogModal({ skipPriceLoad: true });
  element("fuelLogMileageInput").value = "5500";
  element("fuelLogLitersInput").value = "50";
  element("fuelLogUnitPriceInput").value = "34.7";
  element("fuelLogRebateInput").value = "兩趴";

  api.handleFuelLogSubmit({ preventDefault() {}, submitter: createElement() });

  assert.equal(api.getRecords().length, 1);
  assert.match(element("fuelLogMessage").textContent, /刷卡回饋請輸入 0 到 100 之間的百分比/);
});

test("a text entry that names 台塑 uses the CUBE price cut and rebate", () => {
  const { api } = loadApp({ today: TODAY });
  api.setRecords([NPC_SELF_FILL]);

  const draft = api.parseLocalRecordDraft("台塑 98 加 45L 1500").draft;
  assert.equal(draft.discount, 1.2);
  assert.equal(draft.rebatePercent, 2);
  assert.equal(draft.note, "台塑");

  // 上次也在台塑體系：沿用上次那站的降價；沒寫加油站就沿用上次加油。
  api.setRecords([NPC_SELF_FILL, FORMOSA_CUBE_FILL]);
  assert.equal(api.parseLocalRecordDraft("台亞 加油 45L 1500").draft.discount, 1.5);
  const unnamed = api.parseLocalRecordDraft("加油 45L 1500").draft;
  assert.equal(unnamed.discount, 1.5);
  assert.equal(unnamed.rebatePercent, 2);
});

const WEDNESDAY = "2026-10-21T09:00:00";
const FORMOSA_PAY_FILL = stationFill("2026-10-14", 6000, 1660,
  "牌告 34.7 元/L｜優惠 1.2 元/L｜實付 33.5 元/L｜加油券 15 元｜回饋 2%｜F幣 1.2 點/L", "台塑自助");

test("the 台塑石油 Pay offer adds F幣 and takes the Wednesday coupon off a 25 L+ fill", () => {
  const { api, element } = loadApp({ today: WEDNESDAY });
  api.setRecords([NPC_SELF_FILL]);
  api.openFuelLogModal({ skipPriceLoad: true });
  assert.equal(element("fuelLogExtraOffer").hidden, true);
  element("fuelLogMileageInput").value = "5500";
  element("fuelLogLitersInput").value = "50";
  element("fuelLogUnitPriceInput").value = "34.7";

  element("fuelLogOfferInput").value = "formosa-pay";
  api.applyFuelOffer("formosa-pay");

  assert.equal(element("fuelLogExtraOffer").hidden, false);
  assert.equal(element("fuelLogDiscountInput").value, "1.2");
  assert.equal(element("fuelLogRebateInput").value, "2");
  assert.equal(element("fuelLogFCoinInput").value, "1.2");
  assert.equal(element("fuelLogCouponInput").value, "15");
  assert.equal(element("fuelLogNoteInput").value, "台塑自助");
  assert.match(element("fuelLogOfferHint").textContent, /加油機上要取消「累 F幣」才會同時降價/);
  assert.match(element("fuelLogExtraHint").textContent, /加油日是週三：週三加滿 25 公升用 App 的週三加油券再折 15 元，沒用到請改成 0/);
  assert.match(element("fuelLogExtraHint").textContent, /用 F幣折抵的那次，油費填折抵前的金額/);
  // 50 L × 33.5 = 1,675，週三券 −15 → 1,660；2% 回饋 33、F幣 60 點 → 實際 1,567 ÷ 50 L。
  assert.equal(element("fuelLogCostInput").value, 1660);
  assert.match(element("fuelLogNetPriceHint").textContent,
    /實付單價 33\.5 元\/L，加油券折 15 元，預估油費 NT\$ 1,660；2% 回饋約 NT\$ 33、F幣約 60 點，實際約 NT\$ 1,567（31\.3 元\/L）/);

  api.handleFuelLogSubmit({ preventDefault() {}, submitter: createElement() });

  const saved = api.getRecords().find(record => record.note === "台塑自助");
  assert.equal(saved.cost, 1660);
  assert.equal(saved.detail, "加油｜98｜50.00 L｜加滿｜牌告 34.7 元/L｜優惠 1.2 元/L｜實付 33.5 元/L｜加油券 15 元｜回饋 2%｜F幣 1.2 點/L");

  // 換回刷卡：F幣與週三券都歸零，欄位收起來。
  api.applyFuelOffer("formosa-cube");
  assert.equal(element("fuelLogFCoinInput").value, "0");
  assert.equal(element("fuelLogCouponInput").value, "0");
  assert.equal(element("fuelLogExtraOffer").hidden, true);
  element("fuelLogOfferInput").value = "custom";
  api.applyFuelOffer("custom");
  assert.equal(element("fuelLogExtraOffer").hidden, false);
});

test("the Wednesday coupon follows the date and litres until it is changed by hand", () => {
  const { api, element } = loadApp({ today: WEDNESDAY });
  api.setRecords([NPC_SELF_FILL, FORMOSA_PAY_FILL]);

  api.openFuelLogModal({ skipPriceLoad: true });
  assert.equal(element("fuelLogOfferInput").value, "formosa-pay");
  assert.equal(element("fuelLogFCoinInput").value, "1.2");
  assert.equal(element("fuelLogCouponInput").value, "15");

  element("fuelLogLitersInput").value = "20";
  assert.equal(api.refreshFuelCouponDefault(), true);
  assert.equal(element("fuelLogCouponInput").value, "0");
  api.updateFuelOfferDetails();
  assert.match(element("fuelLogExtraHint").textContent, /未滿 25 公升，不能用週三加油券/);

  element("fuelLogLitersInput").value = "40";
  element("fuelLogDateInput").value = "2026-10-22";
  api.refreshFuelCouponDefault();
  assert.equal(element("fuelLogCouponInput").value, "0");
  api.updateFuelOfferDetails();
  assert.match(element("fuelLogExtraHint").textContent, /^週三加滿 25 公升用 App 的週三加油券再折 15 元。/);

  // 這週的券已經用掉：自己改成 0 之後，改回週三也不會再帶入。
  element("fuelLogDateInput").value = "2026-10-21";
  element("fuelLogCouponInput").dataset.edited = "true";
  assert.equal(api.refreshFuelCouponDefault(), false);
  assert.equal(element("fuelLogCouponInput").value, "0");

  // 編輯舊紀錄保留原本的加油券。
  api.openFuelLogModal({ editIndex: 1 });
  assert.equal(element("fuelLogCouponInput").value, "15");
  assert.equal(element("fuelLogOfferInput").value, "formosa-pay");
});

test("litres inferred from the paid amount add the coupon back", () => {
  const { api, element } = loadApp({ today: WEDNESDAY });
  api.setRecords([NPC_SELF_FILL, FORMOSA_PAY_FILL]);
  api.openFuelLogModal({ skipPriceLoad: true });
  element("fuelLogUnitPriceInput").value = "34.7";
  element("fuelLogCostInput").value = "1660";

  assert.equal(api.getFuelLogInferredLiters().liters.toFixed(2), "50.00");
});

test("the fuel analysis shows coupons as a discount and F幣 as a reward", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([NPC_SELF_FILL, FORMOSA_PAY_FILL]);

  const pay = api.getFuelLogs()[1];
  assert.equal(pay.coupon, 15);
  assert.equal(pay.fCoinPerLiter, 1.2);
  assert.equal(pay.fCoins, 60);
  assert.equal(pay.rebate, 33);
  assert.equal(api.getFuelCoinAmount(49.57, 1.2), 59.48);

  api.renderFuelLogSection();
  assert.match(element("fuelLogSummary").textContent, /刷卡回饋約 NT\$ 33 · F幣約 60 點/);
  const html = element("fuelLogTableBody").innerHTML;
  assert.match(html, /<td data-label="折抵">1\.2 \+ 券 15<\/td>/);
  assert.match(html, /<td data-label="回饋">NT\$ 33 \+ F幣 60<\/td>/);
});

test("unreadable F幣 or coupon values block saving", () => {
  const { api, element } = loadApp({ today: WEDNESDAY });
  api.setRecords([NPC_SELF_FILL, FORMOSA_PAY_FILL]);
  api.openFuelLogModal({ skipPriceLoad: true });
  element("fuelLogMileageInput").value = "6500";
  element("fuelLogLitersInput").value = "50";
  element("fuelLogUnitPriceInput").value = "34.7";

  element("fuelLogFCoinInput").value = "很多";
  api.handleFuelLogSubmit({ preventDefault() {}, submitter: createElement() });
  assert.match(element("fuelLogMessage").textContent, /F幣回饋請輸入每公升幾點/);

  element("fuelLogFCoinInput").value = "1.2";
  element("fuelLogCouponInput").value = "-15";
  api.handleFuelLogSubmit({ preventDefault() {}, submitter: createElement() });
  assert.match(element("fuelLogMessage").textContent, /加油券折抵請輸入金額/);
  assert.equal(api.getRecords().length, 2);
});

test("text entries pick the 台塑石油 Pay offer only where it can be used", () => {
  const { api } = loadApp({ today: TODAY });
  api.setRecords([NPC_SELF_FILL, FORMOSA_PAY_FILL]);

  assert.equal(api.parseLocalRecordDraft("台塑 加油 45L 1500").draft.fCoinPerLiter, 1.2);
  // 統一速邁樂不能用台塑石油 Pay：改用刷卡的優惠。
  const smile = api.parseLocalRecordDraft("速邁樂 加油 45L 1500").draft;
  assert.equal(smile.fCoinPerLiter, 0);
  assert.equal(smile.rebatePercent, 2);
  // 沒有優惠的加油站不帶回饋與 F幣。
  const cpc = api.parseLocalRecordDraft("中油 加油 45L 1500").draft;
  assert.equal(cpc.rebatePercent, 0);
  assert.equal(cpc.fCoinPerLiter, 0);
});

test("clearing the F幣 field to retype it keeps the F幣 and coupon fields open", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([NPC_SELF_FILL, FORMOSA_PAY_FILL]);
  api.openFuelLogModal({ skipPriceLoad: true });
  assert.equal(element("fuelLogOfferInput").value, "formosa-pay");
  assert.equal(element("fuelLogCouponInput").value, "0");
  assert.equal(element("fuelLogExtraOffer").hidden, false);

  element("fuelLogFCoinInput").value = "";
  api.syncFuelOfferSelect();
  assert.equal(element("fuelLogExtraOffer").hidden, false);

  // 從選單換成不用 F幣 的優惠才收起來。
  api.applyFuelOffer("npc-self");
  assert.equal(element("fuelLogExtraOffer").hidden, true);
});

const { deferred } = require("./helpers/app-harness");

const PHOTO_A = "fakePhoto00000001";
const PHOTO_B = "fakePhoto00000002";

function syncedMeta(records = []) {
  return { version: 1, baseFingerprint: "sheet-v1", baseRecords: records, dirty: false, pendingRestore: false, lastAttempt: null };
}

// 假後端：照片依序拿到檔案 ID（可指定第幾張失敗、或先卡住不回應），同步照常成功。
function photoBackend({ fail = () => false, hold = false } = {}) {
  const backend = { uploads: [], syncs: [], held: [] };
  backend.fetchImpl = async (url, options = {}) => {
    if ((options.method || "GET") === "GET") {
      return { ok: true, json: async () => ({ records: [], fingerprint: "sheet-v1", updatedAt: "" }) };
    }
    const body = JSON.parse(options.body);
    if (body.action !== "uploadPhoto") {
      backend.syncs.push(body);
      return { ok: true, json: async () => ({ status: "success", fingerprint: `sheet-v${backend.syncs.length + 1}` }) };
    }
    backend.uploads.push(body);
    const reply = fail(backend.uploads.length)
      ? { status: "rejected", message: "只接受 JPEG 照片" }
      : { status: "success", id: `fakePhoto${String(backend.uploads.length).padStart(8, "0")}` };
    const response = { ok: true, json: async () => reply };
    if (!hold) return response;
    const pending = deferred();
    backend.held.push(() => pending.resolve(response));
    return pending.promise;
  };
  return backend;
}

function pickPhotos(api, count) {
  const files = Array.from({ length: count }, (_, index) => ({ name: `IMG_${index}.HEIC` }));
  return api.handleFormPhotoInput({ target: { files, value: "IMG_0.HEIC" } });
}

function flushAsync() {
  return new Promise(resolve => setImmediate(resolve));
}

test("picking photos uploads nothing until the record is saved", async () => {
  const backend = photoBackend();
  const { api, element } = loadApp({ today: TODAY, fetchImpl: backend.fetchImpl });
  api.assign("compressPhoto", async file => `/9j/${file.name}`);
  api.setRecords([]);
  api.setSyncMeta(syncedMeta());

  api.openAddModal();
  element("formCategory").value = "改裝升級";
  element("formCost").value = "71000";
  element("formDetail").value = "ZL1 卡鉗\n含盤 380";
  await pickPhotos(api, 2);

  assert.equal(backend.uploads.length, 0);
  assert.match(element("formPhotoList").innerHTML, /新照片 2/);
  assert.doesNotMatch(element("formPhotoList").innerHTML, /drive\.google\.com/);

  await api.handleFormSubmit({ preventDefault() {}, submitter: createElement() });
  await api.whenSyncIdle();

  assert.deepEqual(backend.uploads.map(upload => upload.data), ["/9j/IMG_0.HEIC", "/9j/IMG_1.HEIC"]);
  assert.deepEqual(backend.uploads.map(upload => upload.name), ["2026-10-02 改裝升級 ZL1 卡鉗 1.jpg", "2026-10-02 改裝升級 ZL1 卡鉗 2.jpg"]);
  assert.equal(api.getRecords()[0].photos, `${PHOTO_A},${PHOTO_B}`);
  assert.equal(backend.syncs.at(-1).records[0].photos, `${PHOTO_A},${PHOTO_B}`);
  assert.equal(element("modal").style.display, "none");
});

test("cancelling a form or removing a new photo uploads nothing", async () => {
  const backend = photoBackend();
  const { api, element } = loadApp({ today: TODAY, fetchImpl: backend.fetchImpl });
  api.assign("compressPhoto", async file => `/9j/${file.name}`);
  api.setRecords([]);
  api.setSyncMeta(syncedMeta());

  api.openAddModal();
  await pickPhotos(api, 1);
  api.closeModal();
  assert.equal(backend.uploads.length, 0);
  assert.equal(element("formPhotoList").hidden, true);

  api.openAddModal();
  element("formCategory").value = "清潔美容";
  element("formDetail").value = "鍍膜";
  await pickPhotos(api, 2);
  api.removeNewFormPhoto(0);
  await api.handleFormSubmit({ preventDefault() {}, submitter: createElement() });

  assert.deepEqual(backend.uploads.map(upload => upload.data), ["/9j/IMG_1.HEIC"]);
  assert.equal(api.getRecords()[0].photos, PHOTO_A);
});

test("a failed upload keeps the form open and the next save sends only what is left", async () => {
  const backend = photoBackend({ fail: count => count === 2 });
  const { api, element } = loadApp({ today: TODAY, fetchImpl: backend.fetchImpl });
  api.assign("compressPhoto", async file => `/9j/${file.name}`);
  api.setRecords([]);
  api.setSyncMeta(syncedMeta());

  api.openAddModal();
  element("formCategory").value = "改裝升級";
  element("formDetail").value = "G025 輪框";
  await pickPhotos(api, 2);
  await api.handleFormSubmit({ preventDefault() {}, submitter: createElement() });

  assert.equal(api.getRecords().length, 0);
  assert.equal(element("modal").style.display, "flex");
  assert.match(element("formMessage").textContent, /照片沒有傳上去（只接受 JPEG 照片），紀錄還沒儲存/);
  assert.match(element("formPhotoList").innerHTML, /fakePhoto00000001/);
  assert.match(element("formPhotoList").innerHTML, /新照片 1/);

  await api.handleFormSubmit({ preventDefault() {}, submitter: createElement() });
  assert.deepEqual(backend.uploads.map(upload => upload.data), ["/9j/IMG_0.HEIC", "/9j/IMG_1.HEIC", "/9j/IMG_1.HEIC"]);
  assert.equal(api.getRecords()[0].photos, "fakePhoto00000001,fakePhoto00000003");
});

test("saving offline with new photos sends nothing until they are removed or the phone is online", async () => {
  const backend = photoBackend();
  const { api, element, context } = loadApp({ today: TODAY, fetchImpl: backend.fetchImpl });
  api.assign("compressPhoto", async () => "/9j/");
  api.setRecords([]);
  api.setSyncMeta(syncedMeta());
  context.navigator = { onLine: false };

  api.openAddModal();
  element("formCategory").value = "清潔美容";
  element("formDetail").value = "洗車";
  await pickPhotos(api, 1);
  await api.handleFormSubmit({ preventDefault() {}, submitter: createElement() });

  assert.equal(backend.uploads.length, 0);
  assert.equal(api.getRecords().length, 0);
  assert.match(element("formMessage").textContent, /目前沒有網路，新照片傳不上去/);

  // 移除新照片後，沒網路也能先存紀錄。
  api.removeNewFormPhoto(0);
  await api.handleFormSubmit({ preventDefault() {}, submitter: createElement() });
  assert.equal(api.getRecords().length, 1);
  assert.equal(api.getRecords()[0].photos, "");
});

test("closing the form while photos upload saves nothing, and a second tap does not upload twice", async () => {
  const backend = photoBackend({ hold: true });
  const { api, element } = loadApp({ today: TODAY, fetchImpl: backend.fetchImpl });
  api.assign("compressPhoto", async () => "/9j/");
  api.setRecords([]);
  api.setSyncMeta(syncedMeta());

  api.openAddModal();
  element("formCategory").value = "清潔美容";
  element("formDetail").value = "鍍膜";
  await pickPhotos(api, 2);
  const saving = api.handleFormSubmit({ preventDefault() {}, submitter: createElement() });
  await flushAsync();
  assert.match(element("formMessage").textContent, /正在上傳照片 1\/2/);
  api.handleFormSubmit({ preventDefault() {}, submitter: createElement() });
  assert.equal(backend.uploads.length, 1);

  api.closeModal();
  backend.held[0]();
  await saving;
  assert.equal(backend.uploads.length, 1);
  assert.equal(api.getRecords().length, 0);
});

test("the photo help links to the Drive folder once the cloud reports it", async () => {
  const folder = "fakeFolder00000009";
  const { api, element, localStore } = loadApp({
    today: TODAY,
    fetchImpl: async () => ({ ok: true, json: async () => ({ records: [], fingerprint: "sheet-v1", updatedAt: "", photoFolderId: folder }) })
  });
  api.openAddModal();
  assert.match(element("formPhotoHelp").innerHTML, /按「儲存」才會上傳/);
  assert.doesNotMatch(element("formPhotoHelp").innerHTML, /開啟照片資料夾/);

  await api.requestSync({ reconcile: true });
  assert.match(element("formPhotoHelp").innerHTML, /href="https:\/\/drive\.google\.com\/drive\/folders\/fakeFolder00000009" target="_blank" rel="noopener">開啟照片資料夾</);
  assert.equal(localStore.get("newSuperbPhotoFolderId_v1"), folder);

  // 下次開啟時就算離線，也用記住的資料夾。
  const reopened = loadApp({ today: TODAY, localStore, fetchImpl: async () => { throw new TypeError("offline"); } });
  reopened.api.openAddModal();
  assert.match(reopened.element("formPhotoHelp").innerHTML, /folders\/fakeFolder00000009/);
});

test("editing keeps a record's photos and removing one keeps the rest", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([{ date: "2026-09-19", mileage: 5600, category: "改裝升級", cost: 71000, detail: "ZL1", note: "", photos: `${PHOTO_A},${PHOTO_B}` }]);

  api.openEditModal(0);
  assert.match(element("formPhotoList").innerHTML, /照片 2/);
  api.removeFormPhoto(0);
  assert.match(element("formMessage").textContent, /照片檔仍留在雲端硬碟/);
  api.handleFormSubmit({ preventDefault() {}, submitter: createElement() });

  assert.equal(api.getRecords()[0].photos, PHOTO_B);
});

test("forms without a photo field keep the photos of the record they update", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([{ date: "2026-10-02", mileage: 6000, category: "其他", cost: 0, detail: "目前里程更新", note: "用於儀表板里程計算", photos: PHOTO_A }]);

  api.openMileageModal();
  element("currentMileageInput").value = "6100";
  api.handleMileageSubmit({ preventDefault() {}, submitter: createElement() });

  assert.equal(api.getRecords().length, 1);
  assert.equal(api.getRecords()[0].mileage, 6100);
  assert.equal(api.getRecords()[0].photos, PHOTO_A);
});

test("record lists link each photo to Drive and drop anything that is not a file id", () => {
  const { api, element } = loadApp({ today: TODAY });
  api.setRecords([{ date: "2026-09-19", mileage: 5600, category: "改裝升級", cost: 71000, detail: "ZL1", note: "", photos: `${PHOTO_A}, "><img src=x>,${PHOTO_A}\n${PHOTO_B}` }]);

  api.renderRecords();
  api.renderUpgradeCostList();
  const html = element("recordsContainer").innerHTML;

  // 手機摘要與桌面欄位各一組。
  assert.equal(html.match(/class="photo-link"/g).length, 4);
  assert.match(html, /href="https:\/\/drive\.google\.com\/file\/d\/fakePhoto00000002\/view" target="_blank" rel="noopener" aria-label="在雲端硬碟開啟照片 2"/);
  assert.doesNotMatch(html, /<img/);
  assert.match(element("upgradeCostItems").innerHTML, /· 📷 2</);
  assert.equal(api.canonicalizeRecord(api.getRecords()[0]).photos, `${PHOTO_A},${PHOTO_B}`);
});

test("records saved without a photos field still sync one for the updated Apps Script", async () => {
  const backend = photoBackend();
  const { api } = loadApp({ today: TODAY, fetchImpl: backend.fetchImpl });
  api.setRecords([]);
  api.setSyncMeta(syncedMeta());

  api.setRecords([{ date: "2026-10-02", mileage: 6000, category: "其他", cost: 0, detail: "目前里程更新", note: "" }]);
  await api.saveRecords(api.getRecords());

  assert.equal(backend.syncs[0].records[0].photos, "");
});

test("backups from before photos still restore, and the CSV lists photo links", async () => {
  let csvBlob = null;
  const { api } = loadApp({
    today: TODAY,
    urlApi: { createObjectURL(blob) { csvBlob = blob; return "blob:test"; }, revokeObjectURL() {} }
  });
  const older = { date: "2026-09-19", mileage: 5600, category: "改裝升級", cost: 71000, detail: "ZL1", note: "" };

  assert.equal(api.validateBackupEnvelope({ format: "superb-maintenance-backup", version: 1, records: [older] }).ok, true);
  assert.equal(api.validateBackupEnvelope({ format: "superb-maintenance-backup", version: 1, records: [{ ...older, photos: [PHOTO_A] }] }).ok, false);

  api.setRecords([{ ...older, photos: `${PHOTO_A},${PHOTO_B}` }]);
  api.exportCSV();
  const csv = await csvBlob.text();
  assert.match(csv, /,備註,照片\n/);
  assert.match(csv, /,https:\/\/drive\.google\.com\/file\/d\/fakePhoto00000001\/view https:\/\/drive\.google\.com\/file\/d\/fakePhoto00000002\/view$/);
});
