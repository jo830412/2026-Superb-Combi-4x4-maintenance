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

function loadApp() {
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
    URL: { createObjectURL() { return "blob:test"; }, revokeObjectURL() {} },
    console,
    document: {
      addEventListener() {},
      createElement() { return createElement(); },
      getElementById: getElement,
      querySelector() { return createElement(); },
      querySelectorAll() { return []; }
    },
    Chart: class { destroy() {} },
    fetch: async () => ({ ok: true, json: async () => ({ status: "success" }) }),
    localStorage: {
      getItem(key) { return localStore.get(key) || null; },
      setItem(key, value) { localStore.set(key, value); }
    },
    setTimeout,
    clearTimeout,
    window: {}
  };
  vm.createContext(context);
  vm.runInContext(`${script}\n;globalThis.__testApi = { openEditModal, openFuelLogModal, handleFuelLogSubmit, runOwnerAction, handleDeleteConfirm, restoreDeletedRecord, getRecords: () => records, setRecords: value => { records = value; }, setDeleteTargetIndex: value => { deleteTargetIndex = value; } };`, context);
  return { api: context.__testApi, element: getElement };
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

test("the README documents the UI regression command and fuel editing behavior", () => {
  const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");

  assert.match(readme, /node --test tests\\index-html-ui\.test\.js/);
  assert.match(readme, /加油紀錄.*完整.*加油表單/);
});
