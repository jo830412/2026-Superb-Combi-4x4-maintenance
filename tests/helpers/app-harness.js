const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");

function readProjectFile(name) {
  return fs.readFileSync(path.join(ROOT, name), "utf8");
}

function createElement(id = "") {
  return {
    id,
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
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(child) { this.options.push(child); return child; },
    addEventListener() {},
    click() {},
    getContext() { return {}; },
    querySelector() { return null; },
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

// Elements that index.html renders with the hidden attribute start hidden in the fake DOM too.
const INITIALLY_HIDDEN_IDS = new Set(
  [...readProjectFile("index.html").matchAll(/<[a-z]+\b[^>]*>/gi)]
    .map(match => match[0])
    .filter(tag => /\shidden(?=[\s>/])/.test(tag))
    .map(tag => tag.match(/\sid="([^"]+)"/)?.[1])
    .filter(Boolean)
);

// Timers never keep the test process alive (sync retries use long delays).
function unrefTimer(callback, delay, ...args) {
  const handle = setTimeout(callback, delay, ...args);
  handle.unref?.();
  return handle;
}

function loadApp({ fetchImpl, urlApi, createElementImpl, localStore = new Map(), today } = {}) {
  const script = readProjectFile("app.js");
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) {
      const element = createElement(id);
      element.hidden = INITIALLY_HIDDEN_IDS.has(id);
      elements.set(id, element);
    }
    return elements.get(id);
  };
  const quietConsole = { ...console, error() {}, warn() {} };
  const context = {
    AbortController,
    Blob,
    Date,
    JSON,
    Map,
    Set,
    Math,
    Number,
    Promise,
    RegExp,
    String,
    TextEncoder,
    URL: urlApi || { createObjectURL() { return "blob:test"; }, revokeObjectURL() {} },
    console: quietConsole,
    document: {
      activeElement: null,
      visibilityState: "visible",
      documentElement: { dataset: { theme: "dark" } },
      addEventListener() {},
      createElement(tag) { return createElementImpl ? createElementImpl(tag) : createElement(); },
      getElementById: getElement,
      querySelector() { return createElement(); },
      querySelectorAll() { return []; }
    },
    Chart: class { destroy() {} },
    fetch: fetchImpl || (async () => ({ ok: true, json: async () => ({ status: "success" }) })),
    localStorage: {
      getItem(key) { return localStore.has(key) ? localStore.get(key) : null; },
      setItem(key, value) { localStore.set(key, String(value)); },
      removeItem(key) { localStore.delete(key); }
    },
    setTimeout: unrefTimer,
    clearTimeout,
    window: {}
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  const evaluate = expression => vm.runInContext(expression, context);
  const assign = (name, value) => {
    context.__assignValue = value;
    vm.runInContext(`${name} = globalThis.__assignValue`, context);
  };
  if (today) assign("nowOverride", today);
  vm.runInContext("globalThis.__downloadLabels = []; backupDownloadSpy = label => globalThis.__downloadLabels.push(label);", context);

  const helpers = {
    evaluate,
    assign,
    getRecords: () => evaluate("records"),
    setRecords: value => assign("records", value),
    getSyncMeta: () => evaluate("syncMeta"),
    setSyncMeta: value => assign("syncMeta", value),
    setDeleteTargetIndex: value => assign("deleteTargetIndex", value),
    setDocumentActiveElement: value => { context.document.activeElement = value; },
    getActiveRecordsSubtab: () => evaluate("activeRecordsSubtab"),
    getPendingCalendarTask: () => evaluate("pendingCalendarTask"),
    getDownloadLabels: () => context.__downloadLabels,
    whenSyncIdle: async () => {
      for (let round = 0; round < 50; round += 1) {
        const running = evaluate("syncRunning");
        if (!running) return;
        await running;
      }
    }
  };
  // Any other property resolves to the app's top-level function or variable of that name.
  const api = new Proxy(helpers, {
    get(target, name) {
      if (name in target) return target[name];
      if (typeof name !== "string") return undefined;
      return evaluate(name);
    }
  });
  return { api, element: getElement, elements, localStore, context };
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
  let reject;
  const promise = new Promise((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

module.exports = { readProjectFile, createElement, loadApp, fuelRecord, deferred };
