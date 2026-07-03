const SPREADSHEET_ID = "1x2cBTx8BJ2Cy6ly65OWP0xT2ro0LixdPYKjfpb03UXI";

const SHEET_NAME = "保養紀錄";
const HEADER_ROW = 4;
const DATA_START_ROW = 5;
const HEADERS = ["日期", "里程", "類別", "花費", "詳細內容", "備註"];
const NPC_FUEL_PRICE_SOURCE_URL = "https://www.npcgas.com.tw/Consultant/Oil";

function doGet(e) {
  const aiResponse = routeAiRecordAssistantGet_(e);
  if (aiResponse) return aiResponse;

  const fuelPriceResponse = routeFuelPriceGet_(e);
  if (fuelPriceResponse) return fuelPriceResponse;

  const sheet = getSheet();
  ensureHeaders(sheet);

  const lastRow = sheet.getLastRow();

  if (lastRow < DATA_START_ROW) {
    return createJsonResponse([]);
  }

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

  return createJsonResponse(records);
}

function doPost(e) {
  const aiResponse = routeAiRecordAssistantPost_(e);
  if (aiResponse) return aiResponse;

  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    const sheet = getSheet();
    ensureHeaders(sheet);

    const postData = JSON.parse(e.postData.contents);

    if (!Array.isArray(postData)) {
      throw new Error("Invalid payload: expected an array");
    }

    clearDataRows(sheet);

    if (postData.length > 0) {
      const rows = postData.map(record => [
        record.date || "",
        record.mileage ?? "",
        record.category || "",
        record.cost ?? 0,
        record.detail || "",
        record.note || ""
      ]);

      sheet
        .getRange(DATA_START_ROW, 1, rows.length, HEADERS.length)
        .setValues(rows);
    }

    return createJsonResponse({
      status: "success",
      count: postData.length,
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    return createJsonResponse({
      status: "error",
      message: err.toString()
    });
  } finally {
    lock.releaseLock();
  }
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
