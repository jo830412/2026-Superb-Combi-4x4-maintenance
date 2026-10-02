const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
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

// Mimics how Google Sheets parses typed values unless the cell is plain text ("@").
function autoConvert(value) {
  if (typeof value !== "string") return value;
  if (/^0\d+$/.test(value)) return Number(value);
  if (/^\d{1,2}\/\d{1,2}$/.test(value)) return `2026/${value}`;
  const slashDate = value.match(/^(\d{4})\/0?(\d{1,2})\/0?(\d{1,2})$/);
  if (slashDate) return `${slashDate[1]}/${slashDate[2]}/${slashDate[3]}`;
  return value;
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
      const targetRow = this.row + rowOffset;
      const targetColumn = this.column + columnOffset;
      const stored = this.sheet.formatAt(targetRow, targetColumn) === "@"
        ? (value == null ? "" : String(value))
        : autoConvert(value);
      this.sheet.write(targetRow, targetColumn, stored);
    }));
    this.sheet.events.push({ type: "set", sheet: this.sheet.name, row: this.row, values });
    return this;
  }

  setNumberFormat(format) {
    for (let rowOffset = 0; rowOffset < this.numRows; rowOffset += 1) {
      for (let columnOffset = 0; columnOffset < this.numColumns; columnOffset += 1) {
        this.sheet.formats.set(`${this.row + rowOffset}:${this.column + columnOffset}`, format);
      }
    }
    return this;
  }

  clearContent() {
    for (let rowOffset = 0; rowOffset < this.numRows; rowOffset += 1) {
      for (let columnOffset = 0; columnOffset < this.numColumns; columnOffset += 1) {
        this.sheet.write(this.row + rowOffset, this.column + columnOffset, "");
      }
    }
    this.sheet.events.push({ type: "clear", sheet: this.sheet.name, row: this.row, numRows: this.numRows });
    return this;
  }
}

class FakeSheet {
  constructor(name, events, { maxRows = 1000 } = {}) {
    this.name = name;
    this.events = events;
    this.rows = [];
    this.formats = new Map();
    this.maxRows = maxRows;
  }

  read(row, column) {
    return this.rows[row - 1]?.[column - 1] ?? "";
  }

  write(row, column, value) {
    while (this.rows.length < row) this.rows.push([]);
    while (this.rows[row - 1].length < column) this.rows[row - 1].push("");
    this.rows[row - 1][column - 1] = value;
  }

  formatAt(row, column) {
    return this.formats.get(`${row}:${column}`) || "";
  }

  seedRecords(records) {
    HEADERS.forEach((value, index) => this.write(4, index + 1, value));
    records.forEach((value, index) => {
      recordToRow(value).forEach((cell, column) => this.write(5 + index, column + 1, cell));
    });
  }

  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  getLastRow() {
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      if ((this.rows[index] || []).some(value => value !== "" && value != null)) return index + 1;
    }
    return 0;
  }
  getRange(row, column, numRows = 1, numColumns = 1) {
    if (row + numRows - 1 > this.maxRows) {
      throw new Error("The coordinates of the range are outside the dimensions of the sheet.");
    }
    return new FakeRange(this, row, column, numRows, numColumns);
  }
  insertRowsAfter(afterRow, count) {
    this.maxRows += count;
    this.events.push({ type: "insertRows", sheet: this.name, afterRow, count });
  }
  deleteRows(start, count) {
    this.rows.splice(start - 1, count);
    this.events.push({ type: "deleteRows", sheet: this.name, start, count });
  }
}

function loadAppsScript(initialRecords = [], { failBackupInsert = false, maxRows = 1000, fetchFuelPage } = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "apps-script", "Code.js"), "utf8");
  const events = [];
  const sheets = new Map();
  const mainSheet = new FakeSheet("保養紀錄", events, { maxRows });
  mainSheet.seedRecords(initialRecords);
  sheets.set(mainSheet.name, mainSheet);
  const properties = new Map();
  const cache = new Map();
  const fetchCalls = [];
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
    SpreadsheetApp: {
      openById() { return spreadsheet; },
      flush() { events.push({ type: "flush" }); }
    },
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
    CacheService: {
      getScriptCache() {
        return {
          get(key) { return cache.has(key) ? cache.get(key).value : null; },
          put(key, value, seconds) { cache.set(key, { value, seconds }); }
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
    UrlFetchApp: {
      fetch(url) {
        fetchCalls.push(url);
        if (!fetchFuelPage) throw new Error("not used");
        return {
          getResponseCode() { return 200; },
          getContentText() { return fetchFuelPage(); }
        };
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  vm.runInContext(`globalThis.__testApi = {
    doGet,
    doPost,
    readRecords_,
    computeRecordsFingerprint_,
    getFuelPriceCacheSeconds_
  };`, context);
  const backupBatches = () => {
    const backup = sheets.get("保養紀錄備份");
    if (!backup || backup.getLastRow() < 2) return [];
    return [...new Set(backup.getRange(2, 2, backup.getLastRow() - 1, 1).getDisplayValues().map(row => row[0]))];
  };
  return { api: context.__testApi, events, sheets, mainSheet, cache, fetchCalls, backupBatches };
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

function syncState(api) {
  return parseResponse(api.doGet({ parameter: { action: "syncState" } }));
}

module.exports = {
  HEADERS,
  record,
  FakeSheet,
  loadAppsScript,
  parseResponse,
  plain,
  post,
  syncState
};
