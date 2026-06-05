const SPREADSHEET_ID = "1x2cBTx8BJ2Cy6ly65OWP0xT2ro0LixdPYKjfpb03UXI";

const SHEET_NAME = "保養紀錄";
const HEADER_ROW = 4;
const DATA_START_ROW = 5;
const HEADERS = ["日期", "里程", "類別", "花費", "詳細內容", "備註"];

function doGet(e) {
  const aiResponse = routeAiRecordAssistantGet_(e);
  if (aiResponse) return aiResponse;

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
