const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const HEADERS = ["日期", "里程", "類別", "花費", "詳細內容", "備註"];

function record(index = 1) {
  return {
    date: `2026-09-${String(index).padStart(2, "0")}`,
    mileage: index * 100,
    category: index % 2 ? "加油" : "保養維修",
    cost: index * 10,
    detail: `紀錄 ${index}`,
    note: ""
  };
}

function recordToRow(value) {
  return [value.date, value.mileage, value.category, value.cost, value.detail, value.note];
}

class FakeRange {
  constructor(sheet, row, column, numRows, numColumns) {
    Object.assign(this, { sheet, row, column, numRows, numColumns });
  }

  getDisplayValues() {
    return Array.from({ length: this.numRows }, (_, rowOffset) =>
      Array.from({ length: this.numColumns }, (_, columnOffset) => {
        const value = this.sheet.read(this.row + rowOffset, this.column + columnOffset);
        return value == null ? "" : String(value);
      })
    );
  }

  setValues(values) {
    values.forEach((row, rowOffset) => row.forEach((value, columnOffset) => {
      this.sheet.write(this.row + rowOffset, this.column + columnOffset, value);
    }));
    this.sheet.events.push({ type: "set", sheet: this.sheet.name, row: this.row, values });
    return this;
  }

  clearContent() {
    for (let rowOffset = 0; rowOffset < this.numRows; rowOffset += 1) {
      for (let columnOffset = 0; columnOffset < this.numColumns; columnOffset += 1) {
        this.sheet.write(this.row + rowOffset, this.column + columnOffset, "");
      }
    }
    this.sheet.events.push({ type: "clear", sheet: this.sheet.name, row: this.row });
    return this;
  }
}

class FakeSheet {
  constructor(name, events) {
    this.name = name;
    this.events = events;
    this.rows = [];
  }

  read(row, column) {
    return this.rows[row - 1]?.[column - 1] ?? "";
  }

  write(row, column, value) {
    while (this.rows.length < row) this.rows.push([]);
    while (this.rows[row - 1].length < column) this.rows[row - 1].push("");
    this.rows[row - 1][column - 1] = value;
  }

  seedRecords(records) {
    HEADERS.forEach((value, index) => this.write(4, index + 1, value));
    records.forEach((value, index) => {
      recordToRow(value).forEach((cell, column) => this.write(5 + index, column + 1, cell));
    });
  }

  getName() { return this.name; }
  getMaxRows() { return Math.max(100, this.rows.length); }
  getLastRow() {
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      if ((this.rows[index] || []).some(value => value !== "" && value != null)) return index + 1;
    }
    return 0;
  }
  getRange(row, column, numRows = 1, numColumns = 1) {
    return new FakeRange(this, row, column, numRows, numColumns);
  }
  deleteRows(start, count) {
    this.rows.splice(start - 1, count);
    this.events.push({ type: "deleteRows", sheet: this.name, start, count });
  }
}

function loadAppsScript(initialRecords = [], { failBackupInsert = false } = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps-script", "Code.js"), "utf8");
  const events = [];
  const sheets = new Map();
  const mainSheet = new FakeSheet("保養紀錄", events);
  mainSheet.seedRecords(initialRecords);
  sheets.set(mainSheet.name, mainSheet);
  const properties = new Map();
  let uuidCounter = 0;
  const spreadsheet = {
    getSheetByName(name) { return sheets.get(name) || null; },
    insertSheet(name) {
      if (failBackupInsert && name === "保養紀錄備份") {
        throw new Error("backup unavailable");
      }
      const sheet = new FakeSheet(name, events);
      sheets.set(name, sheet);
      events.push({ type: "insertSheet", sheet: name });
      return sheet;
    }
  };
  const context = {
    console,
    Date,
    JSON,
    Math,
    Number,
    String,
    SpreadsheetApp: { openById() { return spreadsheet; } },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput(text) {
        return {
          text,
          setMimeType() { return this; },
          getContent() { return this.text; }
        };
      }
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest(_algorithm, value) {
        return [...crypto.createHash("sha256").update(value, "utf8").digest()];
      },
      getUuid() {
        uuidCounter += 1;
        return `batch-${uuidCounter}`;
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) { return properties.get(key) || null; },
          setProperty(key, value) { properties.set(key, value); }
        };
      }
    },
    LockService: {
      getScriptLock() {
        return {
          waitLock() { events.push({ type: "lock" }); },
          releaseLock() { events.push({ type: "unlock" }); }
        };
      }
    },
    routeAiRecordAssistantGet_() { return null; },
    routeAiRecordAssistantPost_() { return null; },
    UrlFetchApp: { fetch() { throw new Error("not used"); } }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  vm.runInContext(`globalThis.__testApi = {
    doGet,
    doPost,
    readRecords_: typeof readRecords_ === "function" ? readRecords_ : null,
    normalizeSyncPayload_: typeof normalizeSyncPayload_ === "function" ? normalizeSyncPayload_ : null,
    validateRecordPayload_: typeof validateRecordPayload_ === "function" ? validateRecordPayload_ : null,
    computeRecordsFingerprint_: typeof computeRecordsFingerprint_ === "function" ? computeRecordsFingerprint_ : null,
    validateDestructiveReplace_: typeof validateDestructiveReplace_ === "function" ? validateDestructiveReplace_ : null
  };`, context);
  return { api: context.__testApi, events, sheets, mainSheet };
}

function parseResponse(output) {
  return JSON.parse(output.getContent());
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function post(api, payload) {
  return parseResponse(api.doPost({ postData: { contents: JSON.stringify(payload) } }));
}

test("syncState returns records with a stable fingerprint", () => {
  const current = [record(1), record(2)];
  const { api } = loadAppsScript(current);

  const response = parseResponse(api.doGet({ parameter: { action: "syncState" } }));

  assert.deepEqual(response.records, current);
  assert.match(response.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(response.fingerprint, api.computeRecordsFingerprint_(current));
});

test("a matching fingerprint writes after creating a backup snapshot", () => {
  const current = [record(1), record(2), record(3), record(4)];
  const incoming = current.map(value => ({ ...value, note: "已確認" }));
  const { api, events, mainSheet, sheets } = loadAppsScript(current);
  const expectedFingerprint = api.computeRecordsFingerprint_(current);

  const response = post(api, {
    records: incoming,
    expectedFingerprint,
    allowDestructiveReplace: false,
    reason: "save"
  });

  assert.equal(response.status, "success");
  assert.match(response.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(plain(api.readRecords_(mainSheet)), incoming);
  assert.ok(sheets.has("保養紀錄備份"));
  const backupSet = events.findIndex(event => event.type === "set" && event.sheet === "保養紀錄備份" && event.row >= 2);
  const mainClear = events.findIndex(event => event.type === "clear" && event.sheet === "保養紀錄");
  assert.ok(backupSet >= 0 && mainClear > backupSet, "backup must complete before the main sheet is cleared");
});

test("a backup failure stops the write before the main sheet is cleared", () => {
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
  assert.equal(loaded.events.some(event => event.type === "clear"), false);
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
  assert.deepEqual(plain(api.readRecords_(mainSheet)), current);
  assert.equal(sheets.has("保養紀錄備份"), false);
  assert.equal(events.some(event => event.type === "clear"), false);
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

test("malformed negative and oversized payloads are rejected before clearing", () => {
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
    assert.equal(loaded.events.some(event => event.type === "clear"), false);
  });
});
