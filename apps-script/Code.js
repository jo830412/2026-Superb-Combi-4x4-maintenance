const SPREADSHEET_ID = "1x2cBTx8BJ2Cy6ly65OWP0xT2ro0LixdPYKjfpb03UXI";

const SHEET_NAME = "保養紀錄";
const HEADER_ROW = 4;
const DATA_START_ROW = 5;
const HEADERS = ["日期", "里程", "類別", "花費", "詳細內容", "備註"];
const BACKUP_SHEET_NAME = "保養紀錄備份";
const BACKUP_HEADERS = ["備份時間", "備份批次", "原因"].concat(HEADERS);
const MAX_BACKUP_BATCHES = 20;
const MAX_SYNC_RECORDS = 5000;
const LAST_SYNC_AT_PROPERTY = "LAST_RECORD_SYNC_AT";
const NPC_FUEL_PRICE_SOURCE_URL = "https://www.npcgas.com.tw/Consultant/Oil";

function doGet(e) {
  const aiResponse = routeAiRecordAssistantGet_(e);
  if (aiResponse) return aiResponse;

  const fuelPriceResponse = routeFuelPriceGet_(e);
  if (fuelPriceResponse) return fuelPriceResponse;

  const sheet = getSheet();
  ensureHeaders(sheet);
  const records = readRecords_(sheet);
  const action = e && e.parameter && e.parameter.action;

  if (action === "syncState") {
    return createJsonResponse({
      records: records,
      fingerprint: computeRecordsFingerprint_(records),
      updatedAt: PropertiesService.getScriptProperties().getProperty(LAST_SYNC_AT_PROPERTY) || ""
    });
  }

  return createJsonResponse(records);
}

function readRecords_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];

  const numRows = lastRow - DATA_START_ROW + 1;
  const data = sheet
    .getRange(DATA_START_ROW, 1, numRows, HEADERS.length)
    .getDisplayValues();

  const records = [];

  data.forEach(row => {
    if (!row.some(cell => cell !== "")) return;

    records.push({
      date: row[0] || "",
      mileage: parseNumber(row[1], null),
      category: row[2] || "",
      cost: parseNumber(row[3], 0),
      detail: row[4] || "",
      note: row[5] || ""
    });
  });

  return records;
}

function doPost(e) {
  const aiResponse = routeAiRecordAssistantPost_(e);
  if (aiResponse) return aiResponse;

  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    const sheet = getSheet();
    ensureHeaders(sheet);

    let postData;
    try {
      postData = JSON.parse(e && e.postData && e.postData.contents || "");
    } catch (error) {
      throw createSyncRejection_("同步內容不是有效的 JSON");
    }
    const sync = normalizeSyncPayload_(postData);
    validateRecordPayload_(sync.records);

    const currentRecords = readRecords_(sheet);
    const currentFingerprint = computeRecordsFingerprint_(currentRecords);
    if (sync.expectedFingerprint && sync.expectedFingerprint !== currentFingerprint) {
      return createJsonResponse({
        status: "conflict",
        message: "雲端資料已變更，請重新載入後再試。",
        fingerprint: currentFingerprint,
        count: currentRecords.length
      });
    }

    validateDestructiveReplace_(currentRecords, sync.records, sync.allowDestructiveReplace);
    const normalizedRecords = normalizeRecordsForStorage_(sync.records);

    if (currentRecords.length > 0) {
      createBackupSnapshot_(sheet, currentRecords, sync.reason);
    }

    clearDataRows(sheet);

    if (normalizedRecords.length > 0) {
      const rows = normalizedRecords.map(record => [
        record.date,
        record.mileage,
        record.category,
        record.cost,
        record.detail,
        record.note
      ]);

      sheet
        .getRange(DATA_START_ROW, 1, rows.length, HEADERS.length)
        .setValues(rows);
    }

    const updatedAt = new Date().toISOString();
    const fingerprint = computeRecordsFingerprint_(normalizedRecords);
    PropertiesService.getScriptProperties().setProperty(LAST_SYNC_AT_PROPERTY, updatedAt);

    return createJsonResponse({
      status: "success",
      count: normalizedRecords.length,
      fingerprint: fingerprint,
      updatedAt: updatedAt
    });
  } catch (err) {
    return createJsonResponse({
      status: err && err.name === "SyncSafetyError" ? "rejected" : "error",
      message: err && err.message ? err.message : String(err)
    });
  } finally {
    lock.releaseLock();
  }
}

function normalizeSyncPayload_(payload) {
  if (Array.isArray(payload)) {
    return {
      records: payload,
      expectedFingerprint: "",
      allowDestructiveReplace: false,
      reason: "legacy",
      legacy: true
    };
  }
  if (!payload || !Array.isArray(payload.records)) {
    throw createSyncRejection_("同步內容缺少 records 陣列");
  }
  return {
    records: payload.records,
    expectedFingerprint: typeof payload.expectedFingerprint === "string" ? payload.expectedFingerprint : "",
    allowDestructiveReplace: payload.allowDestructiveReplace === true,
    reason: normalizeReason_(payload.reason),
    legacy: false
  };
}

function validateRecordPayload_(records) {
  if (!Array.isArray(records)) throw createSyncRejection_("records 必須是陣列");
  if (records.length > MAX_SYNC_RECORDS) {
    throw createSyncRejection_("單次同步不可超過 " + MAX_SYNC_RECORDS + " 筆紀錄");
  }

  records.forEach(function(record, index) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw createSyncRejection_("第 " + (index + 1) + " 筆紀錄格式不正確");
    }
    ["date", "category", "detail", "note"].forEach(function(field) {
      const value = record[field];
      if (value != null && !["string", "number", "boolean"].includes(typeof value)) {
        throw createSyncRejection_("第 " + (index + 1) + " 筆紀錄的 " + field + " 格式不正確");
      }
    });
    validateNonNegativeInteger_(record.mileage, "里程", index);
    validateNonNegativeInteger_(record.cost, "花費", index);
  });
}

function validateNonNegativeInteger_(value, label, index) {
  if (value === "" || value == null) return;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || !Number.isInteger(number)) {
    throw createSyncRejection_("第 " + (index + 1) + " 筆紀錄的" + label + "必須是非負整數");
  }
}

function normalizeRecordsForStorage_(records) {
  return records.map(function(record) {
    return {
      date: normalizeText_(record.date),
      mileage: record.mileage === "" || record.mileage == null ? null : Number(record.mileage),
      category: normalizeText_(record.category),
      cost: record.cost === "" || record.cost == null ? 0 : Number(record.cost),
      detail: normalizeText_(record.detail),
      note: normalizeText_(record.note)
    };
  });
}

function normalizeText_(value) {
  return value == null ? "" : String(value);
}

function normalizeReason_(value) {
  const reason = normalizeText_(value).trim();
  return (reason || "save").slice(0, 80);
}

function computeRecordsFingerprint_(records) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(records),
    Utilities.Charset.UTF_8
  );
  return digest.map(function(byte) {
    return ((byte + 256) % 256).toString(16).padStart(2, "0");
  }).join("");
}

function validateDestructiveReplace_(currentRecords, incomingRecords, allowDestructiveReplace) {
  if (allowDestructiveReplace || currentRecords.length === 0) return;
  if (incomingRecords.length === 0) {
    throw createSyncRejection_("安全保護已阻止清空所有雲端紀錄；請使用備份還原功能確認覆寫。");
  }
  const removedCount = currentRecords.length - incomingRecords.length;
  const removedRatio = removedCount / currentRecords.length;
  if (removedCount > 3 && removedRatio > 0.5) {
    throw createSyncRejection_("安全保護已阻止一次刪除過多紀錄；請使用備份還原功能確認覆寫。");
  }
}

function createBackupSnapshot_(sheet, records, reason) {
  if (!records.length) return;
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let backupSheet = spreadsheet.getSheetByName(BACKUP_SHEET_NAME);
  if (!backupSheet) backupSheet = spreadsheet.insertSheet(BACKUP_SHEET_NAME);

  backupSheet.getRange(1, 1, 1, BACKUP_HEADERS.length).setValues([BACKUP_HEADERS]);
  const timestamp = new Date().toISOString();
  const batchId = Utilities.getUuid();
  const normalizedReason = normalizeReason_(reason);
  const rows = normalizeRecordsForStorage_(records).map(function(record) {
    return [
      timestamp,
      batchId,
      normalizedReason,
      record.date,
      record.mileage,
      record.category,
      record.cost,
      record.detail,
      record.note
    ];
  });
  const startRow = Math.max(2, backupSheet.getLastRow() + 1);
  backupSheet.getRange(startRow, 1, rows.length, BACKUP_HEADERS.length).setValues(rows);
  pruneBackupSnapshots_(backupSheet);
}

function pruneBackupSnapshots_(backupSheet) {
  const lastRow = backupSheet.getLastRow();
  if (lastRow < 2) return;
  const batchIds = backupSheet.getRange(2, 2, lastRow - 1, 1)
    .getDisplayValues()
    .map(function(row) { return row[0]; });
  const retained = {};
  let retainedCount = 0;
  for (let index = batchIds.length - 1; index >= 0; index -= 1) {
    const batchId = batchIds[index];
    if (!retained[batchId]) {
      if (retainedCount >= MAX_BACKUP_BATCHES) {
        backupSheet.deleteRows(2, index + 1);
        return;
      }
      retained[batchId] = true;
      retainedCount += 1;
    }
  }
}

function createSyncRejection_(message) {
  const error = new Error(message);
  error.name = "SyncSafetyError";
  return error;
}

function getSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  return sheet;
}

function ensureHeaders(sheet) {
  sheet.getRange(HEADER_ROW, 1, 1, HEADERS.length).setValues([HEADERS]);
}

function clearDataRows(sheet) {
  const maxRows = sheet.getMaxRows();
  const numRows = maxRows - DATA_START_ROW + 1;

  if (numRows > 0) {
    sheet.getRange(DATA_START_ROW, 1, numRows, HEADERS.length).clearContent();
  }
}

function parseNumber(value, fallback) {
  if (value === "" || value == null) return fallback;

  const normalized = String(value)
    .replace(/,/g, "")
    .replace(/NT\$/g, "")
    .replace(/km/g, "")
    .trim();

  const parsed = parseInt(normalized, 10);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function routeFuelPriceGet_(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action !== "fuelPrice") return null;

  try {
    return createJsonResponse(fetchNpcFuelPrices_());
  } catch (err) {
    return createJsonResponse({
      ok: false,
      source: "全國加油站",
      message: err && err.message ? err.message : String(err)
    });
  }
}

function fetchNpcFuelPrices_() {
  const response = UrlFetchApp.fetch(NPC_FUEL_PRICE_SOURCE_URL, {
    muteHttpExceptions: true,
    followRedirects: true
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error("NPC fuel price page returned HTTP " + status);
  }

  const html = response.getContentText("UTF-8");
  return parseNpcFuelPricePage_(html);
}

function parseNpcFuelPricePage_(html) {
  const text = normalizeFuelPricePage_(html);
  const prices = {
    "92": readNpcFuelPrice_(text, /92無鉛汽油\s*([0-9]+(?:\.[0-9]+)?)\s*元/),
    "95": readNpcFuelPrice_(text, /95\+?無鉛汽油\s*([0-9]+(?:\.[0-9]+)?)\s*元/),
    "98": readNpcFuelPrice_(text, /98無鉛汽油\s*([0-9]+(?:\.[0-9]+)?)\s*元/)
  };

  if (!Number.isFinite(prices["92"]) && !Number.isFinite(prices["95"]) && !Number.isFinite(prices["98"])) {
    throw new Error("NPC fuel price page did not contain gasoline prices");
  }

  const effectiveMatch = text.match(/零售參考價\s*([^，。]+?)\s*實行/);
  return {
    ok: true,
    source: "全國加油站",
    effectiveAt: effectiveMatch ? effectiveMatch[1].trim() : "",
    updatedAt: new Date().toISOString(),
    prices
  };
}

function readNpcFuelPrice_(text, pattern) {
  const match = text.match(pattern);
  return match ? parseFloat(match[1]) : null;
}

function normalizeFuelPricePage_(html) {
  return decodeHtmlEntities_(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities_(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, function(_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    })
    .replace(/&#(\d+);/g, function(_, dec) {
      return String.fromCharCode(parseInt(dec, 10));
    })
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
