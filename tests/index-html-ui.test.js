const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createElement() {
  return {
    value: "",
    textContent: "",
    innerHTML: "",
    className: "",
    style: { display: "none" },
    dataset: {},
    disabled: false,
    checked: false,
    hidden: false,
    options: [],
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(child) { this.options.push(child); return child; },
    addEventListener() {},
    click() {},
    getContext() { return {}; },
    querySelectorAll() { return []; },
    removeAttribute() {},
    setAttribute() {},
    getAttribute() { return null; },
    focus() {},
    reset() {},
    checkValidity() { return true; },
    reportValidity() {}
  };
}

function loadApp({ fetchImpl, urlApi, createElementImpl } = {}) {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .filter(source => source.trim())
    .at(-1);
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const localStore = new Map();
  const context = {
    AbortController,
    Blob,
    Date,
    JSON,
    Map,
    Math,
    Number,
    RegExp,
    String,
    TextEncoder,
    URL: urlApi || { createObjectURL() { return "blob:test"; }, revokeObjectURL() {} },
    console,
    document: {
      activeElement: null,
      addEventListener() {},
      createElement(tag) { return createElementImpl ? createElementImpl(tag) : createElement(); },
      getElementById: getElement,
      querySelector() { return createElement(); },
      querySelectorAll() { return []; }
    },
    Chart: class { destroy() {} },
    fetch: fetchImpl || (async () => ({ ok: true, json: async () => ({ status: "success" }) })),
    localStorage: {
      getItem(key) { return localStore.get(key) || null; },
      setItem(key, value) { localStore.set(key, value); }
    },
    setTimeout,
    clearTimeout,
    window: {}
  };
  vm.createContext(context);
  vm.runInContext(`${script}\n;const __downloadLabels = []; backupDownloadSpy = label => __downloadLabels.push(label); globalThis.__testApi = { openEditModal, openFuelLogModal, handleFuelLogSubmit, handleFormSubmit, runOwnerAction, handleDeleteConfirm, restoreDeletedRecord, buildBackupEnvelope, validateBackupEnvelope, getBackupDateRange, findLikelyDuplicates, requestRecordSave, confirmDuplicateSave, closeDuplicateModal, downloadJsonBackup, exportJsonBackup: typeof exportJsonBackup === "function" ? exportJsonBackup : null, stageBackupRestore, confirmBackupRestore, closeBackupRestoreModal, saveRecords, updateStats: typeof updateStats === "function" ? updateStats : null, buildOwnerActions: typeof buildOwnerActions === "function" ? buildOwnerActions : null, renderOwnerDashboard: typeof renderOwnerDashboard === "function" ? renderOwnerDashboard : null, renderOverviewRecentRecords: typeof renderOverviewRecentRecords === "function" ? renderOverviewRecentRecords : null, setRecordsSubtab: typeof setRecordsSubtab === "function" ? setRecordsSubtab : null, getFilteredRecords: typeof getFilteredRecords === "function" ? getFilteredRecords : null, getActiveRecordsSubtab: () => typeof activeRecordsSubtab === "undefined" ? null : activeRecordsSubtab, updateFilterSummary: typeof updateFilterSummary === "function" ? updateFilterSummary : null, trapModalFocus: typeof trapModalFocus === "function" ? trapModalFocus : null, openQuickEntryMenu: typeof openQuickEntryMenu === "function" ? openQuickEntryMenu : null, closeQuickEntryMenu: typeof closeQuickEntryMenu === "function" ? closeQuickEntryMenu : null, setDocumentActiveElement: value => { document.activeElement = value; }, escapeIcsText: typeof escapeIcsText === "function" ? escapeIcsText : null, foldIcsLine: typeof foldIcsLine === "function" ? foldIcsLine : null, buildCalendarUid: typeof buildCalendarUid === "function" ? buildCalendarUid : null, buildCalendarFile: typeof buildCalendarFile === "function" ? buildCalendarFile : null, getCalendarTask: typeof getCalendarTask === "function" ? getCalendarTask : null, openCalendarReminder: typeof openCalendarReminder === "function" ? openCalendarReminder : null, getPendingCalendarTask: () => typeof pendingCalendarTask === "undefined" ? null : pendingCalendarTask, downloadCalendarReminder: typeof downloadCalendarReminder === "function" ? downloadCalendarReminder : null, getOwnershipCostBuckets: typeof getOwnershipCostBuckets === "function" ? getOwnershipCostBuckets : null, getDataQualityIssues: typeof getDataQualityIssues === "function" ? getDataQualityIssues : null, renderDataQualityPanel: typeof renderDataQualityPanel === "function" ? renderDataQualityPanel : null, renderFuelLogSection: typeof renderFuelLogSection === "function" ? renderFuelLogSection : null, getFuelStats: typeof getFuelStats === "function" ? getFuelStats : null, getRecords: () => records, getDownloadLabels: () => __downloadLabels, setRecords: value => { records = value; }, setDeleteTargetIndex: value => { deleteTargetIndex = value; } };`, context);
  vm.runInContext(`Object.assign(globalThis.__testApi, {
    initData: typeof initData === "function" ? initData : null,
    parseCloudState: typeof parseCloudState === "function" ? parseCloudState : null,
    syncToCloud: typeof syncToCloud === "function" ? syncToCloud : null,
    getLastCloudFingerprint: () => typeof lastCloudFingerprint === "undefined" ? null : lastCloudFingerprint,
    setLastCloudFingerprint: value => { lastCloudFingerprint = value; }
  });`, context);
  return { api: context.__testApi, element: getElement, localStore };
}

function fuelRecord() {
  return {
    date: "2026-07-14",
    mileage: 1000,
    category: "加油",
    cost: 1000,
    detail: "加油｜98｜31.00 L｜加滿｜牌告 33.3 元/L｜優惠 1.8 元/L｜實付 31.5 元/L",
    note: "全國加油站"
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(next => { resolve = next; });
  return { promise, resolve };
}

test("editing a fuel record opens the fuel editor with parsed values", () => {
  const { api, element } = loadApp();
  api.setRecords([fuelRecord()]);

  api.openEditModal(0);

  assert.equal(element("fuelLogModal").style.display, "flex");
  assert.equal(element("modal").style.display, "none");
  assert.equal(element("fuelLogMileageInput").value, 1000);
  assert.equal(element("fuelLogLitersInput").value, "31.00");
  assert.equal(element("fuelLogUnitPriceInput").value, "33.3");
});

test("saving an edited fuel record replaces its original record", () => {
  const { api, element } = loadApp();
  api.setRecords([fuelRecord()]);
  api.openFuelLogModal({ editIndex: 0 });
  element("fuelLogDateInput").value = "2026-07-14";
  element("fuelLogMileageInput").value = "1000";
  element("fuelLogLitersInput").value = "32";
  element("fuelLogUnitPriceInput").value = "33.3";
  element("fuelLogDiscountInput").value = "1.8";
  element("fuelLogCostInput").value = "1008";
  element("fuelLogTypeInput").value = "98";
  element("fuelLogFullTankInput").value = "yes";
  element("fuelLogNoteInput").value = "已修正金額";

  api.handleFuelLogSubmit({ preventDefault() {}, submitter: createElement() });

  assert.equal(api.getRecords().length, 1);
  assert.equal(api.getRecords()[0].cost, 1008);
  assert.equal(api.getRecords()[0].note, "已修正金額");
});

test("a generic likely duplicate waits for Save Anyway", () => {
  const { api, element } = loadApp();
  const original = fuelRecord();
  api.setRecords([original]);
  element("editIndex").value = "-1";
  element("formDate").value = original.date;
  element("formMileage").value = String(original.mileage);
  element("formCategory").value = original.category;
  element("formCost").value = "1000";
  element("formDetail").value = "Duplicate candidate";
  element("formNote").value = "";

  api.handleFormSubmit({ preventDefault() {}, submitter: createElement() });

  assert.equal(element("duplicateModal").style.display, "flex");
  assert.equal(api.getRecords().length, 1);
  api.confirmDuplicateSave();
  assert.equal(api.getRecords().length, 2);
});

test("an unchanged fuel edit excludes itself from duplicate warnings", () => {
  const { api, element } = loadApp();
  const original = fuelRecord();
  api.setRecords([original]);
  api.openFuelLogModal({ editIndex: 0 });

  api.handleFuelLogSubmit({ preventDefault() {}, submitter: createElement() });

  assert.equal(element("duplicateModal").style.display, "none");
  assert.equal(api.getRecords().length, 1);
  assert.equal(api.findLikelyDuplicates(original, { excludeIndex: 0 }).length, 0);
});

test("the mobile UI provides view tabs and five quick-entry routes", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  assert.match(html, /function setActiveView\(/);
  assert.match(html, /id="overviewView"/);
  assert.match(html, /id="recordsView"/);
  assert.match(html, /id="analysisView"/);
  for (const action of ["fuel", "service", "mileage", "photo", "text"]) {
    assert.match(html, new RegExp(`data-quick-entry="${action}"`));
  }
});

test("the static site provides an inline favicon", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /rel="icon"[^>]*href="data:image\/svg\+xml/);
});

test("the focused overview exposes four primary surfaces in order", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const ids = ["dashboardHero", "dashboardMetrics", "dashboardTasks", "overviewRecentRecords"];
  const positions = ids.map(id => html.indexOf(`id="${id}"`));

  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(html, /id="moreVehicleStatus"/);
});

test("the next-service hero uses the delivery baseline before the first service", () => {
  const { api, element } = loadApp();
  api.setRecords([]);

  api.updateStats();

  assert.equal(element("statNextMaintenance").textContent, "剩 10,000 km · 2027-05-28");
});

test("a normal maintenance schedule remains an actionable dated task", () => {
  const { api } = loadApp();
  api.setRecords([
    fuelRecord(),
    { date: "2026-08-07", mileage: 3249, category: "其他", cost: 0, detail: "目前里程更新", note: "" },
    { date: "2026-04-01", mileage: 0, category: "檢驗/稅費", cost: 11230, detail: "使用牌照稅", note: "" },
    { date: "2026-07-01", mileage: 0, category: "檢驗/稅費", cost: 6180, detail: "公路養管費", note: "" }
  ]);

  const first = api.buildOwnerActions()[0];

  assert.equal(first.name, "下次定期保養");
  assert.equal(api.getCalendarTask(first).date, "2027-05-28");
});

test("the overview recent preview renders at most three records", () => {
  const { api, element } = loadApp();
  api.setRecords([0, 1, 2, 3].map(day => ({
    date: `2026-08-0${day + 1}`,
    mileage: 1000 + day,
    category: "保養",
    cost: 100,
    detail: `紀錄 ${day}`,
    note: ""
  })));

  assert.equal(typeof api.renderOverviewRecentRecords, "function");
  api.renderOverviewRecentRecords();
  assert.equal((element("overviewRecentRecords").innerHTML.match(/class="overview-record"/g) || []).length, 3);
});

test("record subtabs keep fuel analysis out of the all-records panel", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  assert.ok(html.indexOf('id="searchInput"') < html.indexOf('id="recordSubtabs"'));
  assert.match(html, /data-records-subtab="all"[^>]*>全部紀錄/);
  assert.match(html, /data-records-subtab="fuel"[^>]*>加油分析/);
  assert.match(html, /data-records-subtab="mileage"[^>]*>里程/);
  assert.match(html, /id="fuelAnalysisPanel"[^>]*hidden/);
});

test("the hidden attribute always removes inactive UI from layout", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});

test("the mileage subtab filters to mileage status records without clearing search", () => {
  const { api, element } = loadApp();
  api.setRecords([fuelRecord(), {
    date: "2026-08-07",
    mileage: 2000,
    category: "其他",
    cost: 0,
    detail: "目前里程更新",
    note: "用於儀表板里程計算"
  }]);
  element("searchInput").value = "";

  assert.equal(typeof api.setRecordsSubtab, "function");
  api.setRecordsSubtab("mileage");
  assert.equal(api.getActiveRecordsSubtab(), "mileage");
  assert.equal(api.getFilteredRecords().length, 1);
  assert.equal(api.getFilteredRecords()[0].detail, "目前里程更新");
  assert.equal(element("searchInput").value, "");
  assert.equal(element("filterSummary").textContent, "顯示 1 筆里程紀錄");
});

test("bottom sheets trap tab focus and quick entry returns focus to its invoker", () => {
  const { api, element } = loadApp();
  const invoker = { focused: false, focus() { this.focused = true; } };
  const first = { disabled: false, hidden: false, tabIndex: 0, focused: false, focus() { this.focused = true; } };
  const last = { disabled: false, hidden: false, tabIndex: 0, focused: false, focus() { this.focused = true; } };
  const modal = element("quickEntryModal");
  modal.querySelectorAll = () => [first, last];

  api.setDocumentActiveElement(invoker);
  api.openQuickEntryMenu();
  assert.equal(first.focused, true);

  api.setDocumentActiveElement(last);
  let prevented = false;
  api.trapModalFocus({ key: "Tab", shiftKey: false, preventDefault() { prevented = true; } }, modal);
  assert.equal(prevented, true);
  assert.equal(first.focused, true);

  api.closeQuickEntryMenu();
  assert.equal(invoker.focused, true);
});

test("fuel analysis hides irrelevant record filters without clearing their values", () => {
  const { api, element } = loadApp();
  element("searchInput").value = "保險";

  api.setRecordsSubtab("fuel");

  assert.equal(element("recordFilterControls").hidden, true);
  assert.equal(element("filterSummary").hidden, true);
  api.setRecordsSubtab("all");
  assert.equal(element("recordFilterControls").hidden, false);
  assert.equal(element("filterSummary").hidden, false);
  assert.equal(element("searchInput").value, "保險");
});

test("quick entry prioritizes fuel and service with accessible mobile controls", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  assert.match(html, /class="quick-entry-primary"[\s\S]*data-quick-entry="fuel"[\s\S]*data-quick-entry="service"/);
  assert.match(html, /class="quick-entry-secondary"[\s\S]*data-quick-entry="mileage"[\s\S]*data-quick-entry="photo"[\s\S]*data-quick-entry="text"/);
  assert.match(html, /\.quick-entry-btn\s*\{[^}]*min-height:\s*44px/s);
  assert.match(html, /id="quickEntryModal"[^>]*role="dialog"[^>]*aria-modal="true"/);
});

test("calendar files contain an all-day event and two alarms", () => {
  const { api } = loadApp();

  assert.equal(typeof api.buildCalendarFile, "function");
  const ics = api.buildCalendarFile({
    title: "Superb 定期保養",
    date: "2027-05-28",
    type: "maintenance",
    description: "10,000 公里或日期，以先到者為準"
  }, new Date("2026-08-07T00:00:00Z"));

  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20270528\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20270529\r\n/);
  assert.match(ics, /TRIGGER:-P7D\r\n/);
  assert.match(ics, /TRIGGER:-P1D\r\n/);
  assert.match(ics, /DTSTAMP:20260807T000000Z\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test("calendar text is escaped folded and has a stable uid", () => {
  const { api } = loadApp();
  const task = {
    title: "保養,檢查;輪胎",
    date: "2027-05-28",
    type: "maintenance",
    description: "第一行\\測試\n第二行"
  };

  assert.equal(typeof api.buildCalendarFile, "function");
  const first = api.buildCalendarFile(task, new Date("2026-08-07T00:00:00Z"));
  const second = api.buildCalendarFile(task, new Date("2026-08-08T00:00:00Z"));
  assert.match(first, /SUMMARY:保養\\,檢查\\;輪胎/);
  assert.match(first, /DESCRIPTION:第一行\\\\測試\\n第二行/);
  assert.equal(first.match(/UID:(.+)\r\n/)[1], second.match(/UID:(.+)\r\n/)[1]);
  assert.ok(first.split("\r\n").every(line => new TextEncoder().encode(line.replace(/^ /, "")).length <= 75));
});

test("calendar eligibility requires a reliable date", () => {
  const { api } = loadApp();

  assert.equal(typeof api.getCalendarTask, "function");
  assert.equal(api.getCalendarTask({ name: "輪胎", dueMileage: 10000 }), null);
  assert.deepEqual(JSON.parse(JSON.stringify(api.getCalendarTask({
    name: "定期保養",
    dueDate: new Date("2027-05-28T00:00:00"),
    dueMileage: 10000
  }))), {
    title: "Superb 定期保養",
    date: "2027-05-28",
    type: "vehicle-reminder",
    description: "預計 2027-05-28 或 10,000 公里，以先到者為準"
  });
});

test("opening a calendar reminder shows the task and default alarms", () => {
  const { api, element } = loadApp();
  const task = {
    title: "Superb 使用牌照稅",
    date: "2027-04-01",
    type: "legal",
    description: "4 月繳納"
  };

  assert.equal(typeof api.openCalendarReminder, "function");
  api.openCalendarReminder(task);
  assert.equal(element("calendarReminderModal").style.display, "flex");
  assert.equal(element("calendarReminderTitle").textContent, task.title);
  assert.equal(element("calendarReminderDate").textContent, "2027-04-01");
  assert.match(element("calendarReminderAlarms").textContent, /7 天前.*1 天前/);
});

test("calendar download uses an ICS filename and success guidance", () => {
  const created = [];
  let createdBlob = null;
  const { api, element } = loadApp({
    urlApi: {
      createObjectURL(blob) { createdBlob = blob; return "blob:calendar"; },
      revokeObjectURL() {}
    },
    createElementImpl(tag) {
      const node = createElement();
      node.tagName = tag;
      node.click = () => { node.clicked = true; };
      created.push(node);
      return node;
    }
  });
  api.openCalendarReminder({
    title: "Superb 保養",
    date: "2027-05-28",
    type: "maintenance",
    description: "定期保養"
  });

  assert.equal(typeof api.downloadCalendarReminder, "function");
  assert.equal(api.downloadCalendarReminder(), true);
  const anchor = created.find(node => node.tagName === "a");
  assert.equal(anchor.clicked, true);
  assert.match(anchor.download, /^2027-05-28-.*\.ics$/);
  assert.equal(createdBlob.type, "text/calendar;charset=utf-8");
  assert.match(element("toastMessage").textContent, /已建立行事曆檔/);
});

test("calendar download failure keeps the reminder open and records unchanged", () => {
  const { api, element } = loadApp({
    urlApi: {
      createObjectURL() { throw new Error("blocked"); },
      revokeObjectURL() {}
    }
  });
  const original = [fuelRecord()];
  api.setRecords(original);
  api.openCalendarReminder({
    title: "Superb 保養",
    date: "2027-05-28",
    type: "maintenance",
    description: "定期保養"
  });

  assert.equal(typeof api.downloadCalendarReminder, "function");
  assert.equal(api.downloadCalendarReminder(), false);
  assert.deepEqual(api.getRecords(), original);
  assert.equal(element("calendarReminderModal").style.display, "flex");
  assert.match(element("toastMessage").textContent, /行事曆檔建立失敗/);
});

test("owner actions route to their forms and deleted records can be restored", () => {
  const { api, element } = loadApp();
  const original = fuelRecord();
  api.setRecords([original]);

  api.runOwnerAction("mileage");
  assert.equal(element("mileageModal").style.display, "flex");
  api.runOwnerAction("fuel");
  assert.equal(element("fuelLogModal").style.display, "flex");

  api.setDeleteTargetIndex(0);
  api.handleDeleteConfirm();
  assert.equal(api.getRecords().length, 0);
  assert.equal(element("toastAction").textContent, "復原");
  api.restoreDeletedRecord();
  assert.deepEqual(api.getRecords(), [original]);
});

test("routine sync completion does not replace an active delete Undo action", async () => {
  const pendingSync = deferred();
  const { api, element } = loadApp({ fetchImpl: () => pendingSync.promise });
  const original = fuelRecord();
  api.setRecords([original]);

  api.saveRecords([original]);
  api.setDeleteTargetIndex(0);
  api.handleDeleteConfirm();
  pendingSync.resolve({ ok: true });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(element("toastAction").hidden, false);
  assert.equal(element("toastAction").textContent, "復原");
  element("toastAction").onclick();
  assert.deepEqual(api.getRecords(), [original]);
});

test("cloud state accepts legacy arrays and versioned envelopes", () => {
  const { api } = loadApp();
  const record = fuelRecord();

  assert.equal(typeof api.parseCloudState, "function");
  assert.deepEqual(JSON.parse(JSON.stringify(api.parseCloudState([record]))), {
    records: [record],
    fingerprint: "",
    updatedAt: ""
  });
  assert.deepEqual(JSON.parse(JSON.stringify(api.parseCloudState({
    records: [record],
    fingerprint: "sheet-v2",
    updatedAt: "2026-09-04T08:00:00.000Z"
  }))), {
    records: [record],
    fingerprint: "sheet-v2",
    updatedAt: "2026-09-04T08:00:00.000Z"
  });
});

test("initial cloud read requests sync state and retains its fingerprint", async () => {
  const calls = [];
  const record = fuelRecord();
  const { api } = loadApp({
    fetchImpl: async url => {
      calls.push(url);
      return {
        ok: true,
        json: async () => ({ records: [record], fingerprint: "sheet-v2", updatedAt: "" })
      };
    }
  });

  assert.equal(typeof api.initData, "function");
  await api.initData();

  assert.match(calls[0], /\?action=syncState$/);
  assert.deepEqual(api.getRecords(), [record]);
  assert.equal(api.getLastCloudFingerprint(), "sheet-v2");
});

test("cloud writes use a guarded envelope and update the fingerprint", async () => {
  const calls = [];
  const record = fuelRecord();
  const { api } = loadApp({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ status: "success", fingerprint: "sheet-v3" }) };
    }
  });
  api.setLastCloudFingerprint("sheet-v2");

  assert.equal(await api.syncToCloud([record]), true);
  const payload = JSON.parse(calls[0].options.body);
  assert.deepEqual(payload, {
    records: [record],
    expectedFingerprint: "sheet-v2",
    allowDestructiveReplace: false,
    reason: "save"
  });
  assert.equal(api.getLastCloudFingerprint(), "sheet-v3");
});

test("cloud conflicts keep the local copy and show an actionable warning", async () => {
  const { api, element } = loadApp({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ status: "conflict", message: "雲端資料已變更，請重新載入後再試。" })
    })
  });
  api.setLastCloudFingerprint("sheet-v2");

  assert.equal(await api.syncToCloud([fuelRecord()]), false);
  assert.equal(api.getLastCloudFingerprint(), "sheet-v2");
  assert.match(element("syncStatus").textContent, /雲端資料已變更/);
  assert.match(element("syncStatus").textContent, /本機資料仍保留/);
});

test("confirmed restore explicitly allows a destructive cloud replacement", async () => {
  let payload;
  const { api } = loadApp({
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return { ok: true, json: async () => ({ status: "success", fingerprint: "restored-v1" }) };
    }
  });
  api.setLastCloudFingerprint("sheet-v2");

  await api.syncToCloud([fuelRecord()], { allowDestructiveReplace: true, reason: "restore" });

  assert.equal(payload.allowDestructiveReplace, true);
  assert.equal(payload.reason, "restore");
});

test("backup helpers validate the envelope and find only likely duplicates", () => {
  const { api } = loadApp();
  const original = fuelRecord();
  const second = { ...original, date: "2026-07-13", detail: "Second record" };
  const envelope = api.buildBackupEnvelope([original, second], "2026-07-14T00:00:00.000Z");

  assert.equal(envelope.format, "superb-maintenance-backup");
  assert.equal(envelope.version, 1);
  assert.equal(envelope.exportedAt, "2026-07-14T00:00:00.000Z");
  assert.notEqual(envelope.records[0], original);
  assert.notEqual(envelope.records[1], second);
  assert.equal(api.validateBackupEnvelope(envelope).ok, true);
  assert.equal(api.validateBackupEnvelope({ format: "wrong", version: 1, records: [] }).ok, false);
  assert.equal(api.validateBackupEnvelope({ format: envelope.format, version: 1, records: {} }).ok, false);
  assert.equal(api.validateBackupEnvelope({ format: envelope.format, version: 1, records: [{ ...original, detail: "" }] }).ok, false);

  api.setRecords([original]);
  assert.equal(api.findLikelyDuplicates({ ...original }).length, 1);
  assert.equal(api.findLikelyDuplicates({ ...original, category: "different category" }).length, 0);
  assert.equal(api.findLikelyDuplicates({ ...original }, { excludeIndex: 0 }).length, 0);
});

test("backup date ranges sort valid dates and fall back for empty backups", () => {
  const { api } = loadApp();

  assert.equal(api.getBackupDateRange([
    { date: "2026-07-14" },
    { date: "2026-07-01" },
    { date: "invalid" }
  ]), "2026-07-01 ～ 2026-07-14");
  assert.equal(api.getBackupDateRange([]), "無日期資料");
});

test("confirmed restore creates a recovery backup then replaces every record", () => {
  const { api, element } = loadApp();
  api.setRecords([{ ...fuelRecord(), detail: "目前資料" }]);
  const incoming = [{ ...fuelRecord(), date: "2026-07-13", detail: "備份資料" }];

  assert.equal(api.stageBackupRestore(JSON.stringify(api.buildBackupEnvelope(incoming))).ok, true);
  assert.equal(api.getRecords()[0].detail, "目前資料");
  api.confirmBackupRestore();

  assert.deepEqual(JSON.parse(JSON.stringify(api.getRecords())), incoming);
  assert.equal(api.getDownloadLabels().length, 1);
  assert.match(api.getDownloadLabels()[0], /還原前/);
  assert.match(element("toastMessage").textContent, /已還原 1 筆紀錄/);
});

test("backup download errors keep restore confirmation and current records intact", () => {
  const { api, element } = loadApp({
    urlApi: {
      createObjectURL() { throw new Error("download unavailable"); },
      revokeObjectURL() {}
    }
  });
  const original = [{ ...fuelRecord(), detail: "目前資料" }];
  const incoming = [{ ...fuelRecord(), date: "2026-07-13", detail: "備份資料" }];
  api.setRecords(original);
  assert.equal(api.stageBackupRestore(JSON.stringify(api.buildBackupEnvelope(incoming))).ok, true);

  assert.doesNotThrow(() => api.confirmBackupRestore());
  assert.deepEqual(api.getRecords(), original);
  assert.equal(element("backupRestoreModal").style.display, "flex");
  assert.match(element("toastMessage").textContent, /備份下載失敗/);
});

test("manual backup export catches download errors", () => {
  const { api, element } = loadApp({
    urlApi: {
      createObjectURL() { throw new Error("download unavailable"); },
      revokeObjectURL() {}
    }
  });

  assert.equal(typeof api.exportJsonBackup, "function");
  assert.doesNotThrow(() => api.exportJsonBackup());
  assert.match(element("toastMessage").textContent, /備份下載失敗/);
});

test("invalid restore files preserve current records and show an error", () => {
  const { api, element } = loadApp();
  const original = [{ ...fuelRecord(), detail: "不能變更" }];
  api.setRecords(original);

  assert.equal(api.stageBackupRestore("not json").ok, false);
  assert.deepEqual(api.getRecords(), original);
  assert.match(element("toastMessage").textContent, /備份檔無法還原/);

  assert.equal(api.stageBackupRestore(JSON.stringify({ format: "wrong", version: 1, records: [] })).ok, false);
  assert.deepEqual(api.getRecords(), original);
  assert.match(element("toastMessage").textContent, /備份檔無法還原/);
});

test("explicit categories win over ownership keyword inference", () => {
  const { api } = loadApp();
  api.setRecords([{
    date: "2026-06-18",
    mileage: 1250,
    category: "改裝升級",
    cost: 10000,
    detail: "Evo模塊、離手、外置濾網",
    note: ""
  }]);

  const buckets = Object.fromEntries(
    api.getOwnershipCostBuckets().map(item => [item.key, item.total])
  );

  assert.equal(buckets.service, 0);
  assert.equal(buckets.accessory, 10000);
});

test("data quality reports a mileage regression by date", () => {
  const { api } = loadApp();
  api.setRecords([
    { date: "2026-07-02", mileage: 2000, category: "加油", cost: 1694, detail: "加油｜98｜52.78 L｜加滿", note: "" },
    { date: "2026-07-03", mileage: 1981, category: "其他", cost: 0, detail: "目前里程更新", note: "用於儀表板里程計算" }
  ]);

  assert.equal(typeof api.getDataQualityIssues, "function");
  const issue = api.getDataQualityIssues().find(item => item.type === "mileage-regression");
  assert.equal(issue.date, "2026-07-03");
  assert.match(issue.detail, /1,981 km/);
  assert.match(issue.detail, /2,000 km/);
});

test("data quality flags a fuel outlier without changing the fuel average", () => {
  const { api } = loadApp();
  const fuel = (date, mileage, liters) => ({
    date,
    mileage,
    category: "加油",
    cost: Math.round(liters * 32),
    detail: `加油｜98｜${liters.toFixed(2)} L｜加滿｜牌告 34.0 元/L｜優惠 2.0 元/L｜實付 32.0 元/L`,
    note: "全國加油站自助"
  });
  api.setRecords([
    fuel("2026-01-01", 100, 50),
    fuel("2026-01-08", 650, 50),
    fuel("2026-01-15", 1200, 50),
    fuel("2026-01-22", 1750, 50),
    fuel("2026-01-29", 2300, 50),
    fuel("2026-02-05", 2850, 50),
    fuel("2026-02-12", 3735, 50)
  ]);

  assert.equal(typeof api.getDataQualityIssues, "function");
  const averageBefore = api.getFuelStats().averageKmPerLiter;
  const issue = api.getDataQualityIssues().find(item => item.type === "fuel-outlier");

  assert.equal(issue.date, "2026-02-12");
  assert.match(issue.detail, /17\.7 km\/L/);
  assert.equal(api.getFuelStats().averageKmPerLiter, averageBefore);
});

test("data quality panel renders actionable text instead of color-only warnings", () => {
  const { api, element } = loadApp();
  api.setRecords([
    { date: "2026-07-02", mileage: 2000, category: "加油", cost: 1694, detail: "加油｜98｜52.78 L｜加滿", note: "" },
    { date: "2026-07-03", mileage: 1981, category: "其他", cost: 0, detail: "目前里程更新", note: "" }
  ]);

  assert.equal(typeof api.renderDataQualityPanel, "function");
  api.renderDataQualityPanel();

  assert.match(element("dataQualityPanel").innerHTML, /1 項待確認/);
  assert.match(element("dataQualityPanel").innerHTML, /里程比前一筆紀錄低/);
  assert.match(element("dataQualityPanel").innerHTML, /請確認日期或里程/);
});

test("fuel analysis labels suspicious consumption as pending review", () => {
  const { api, element } = loadApp();
  const fuel = (date, mileage, liters) => ({
    date,
    mileage,
    category: "加油",
    cost: Math.round(liters * 32),
    detail: `加油｜98｜${liters.toFixed(2)} L｜加滿`,
    note: ""
  });
  api.setRecords([
    fuel("2026-01-01", 100, 50),
    fuel("2026-01-08", 650, 50),
    fuel("2026-01-15", 1200, 50),
    fuel("2026-01-22", 1750, 50),
    fuel("2026-01-29", 2300, 50),
    fuel("2026-02-05", 2850, 50),
    fuel("2026-02-12", 3735, 50)
  ]);

  api.renderFuelLogSection();

  assert.match(element("fuelLogTableBody").innerHTML, /17\.7 km\/L/);
  assert.match(element("fuelLogTableBody").innerHTML, /待確認/);
});

test("the README documents the UI regression command and fuel editing behavior", () => {
  const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");

  assert.match(readme, /node --test tests\\index-html-ui\.test\.js/);
  assert.match(readme, /加油紀錄.*完整.*加油表單/);
});

test("the README documents backups and overrideable duplicate warnings", () => {
  const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");

  assert.match(readme, /JSON backups?.*recovery backup.*duplicate warnings?/i);
});

test("the README documents focused mobile and iPhone calendar verification", () => {
  const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");

  assert.match(readme, /375 px/);
  assert.match(readme, /全部紀錄.*加油分析.*里程/);
  assert.match(readme, /\.ics/);
  assert.match(readme, /7 天前.*1 天前/);
  assert.match(readme, /iPhone.*確認/);
});

test("the release documents sync conflicts server backups and deployment order", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");

  assert.match(html, /const APP_VERSION = "v2026\.09\.04\.1"/);
  assert.match(readme, /同步衝突/);
  assert.match(readme, /本機資料仍保留/);
  assert.match(readme, /保養紀錄備份/);
  assert.match(readme, /最近 20/);
  assert.match(readme, /先部署 Apps Script/);
});
