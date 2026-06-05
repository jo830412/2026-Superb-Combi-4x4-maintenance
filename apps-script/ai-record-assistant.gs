/**
 * AI record assistant additions for the existing Apps Script web app.
 *
 * Merge this file into the deployed Apps Script project, then add these early
 * route checks to the existing handlers:
 *
 *   function doGet(e) {
 *     const aiResponse = routeAiRecordAssistantGet_(e);
 *     if (aiResponse) return aiResponse;
 *     // existing GET logic...
 *   }
 *
 *   function doPost(e) {
 *     const aiResponse = routeAiRecordAssistantPost_(e);
 *     if (aiResponse) return aiResponse;
 *     // existing array-sync POST logic...
 *   }
 *
 * Store the API key in Script Properties as OPENAI_API_KEY.
 * Optional Script Property: OPENAI_MODEL, defaults to gpt-5.4-mini.
 */

const AI_RECORD_DEFAULT_MODEL = "gpt-5.4-mini";

function routeAiRecordAssistantGet_(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action !== "aiStatus") return null;
  return jsonOutput_({
    ok: true,
    aiRecordAssistant: true,
    hasOpenAiKey: !!getOpenAiApiKey_(),
    model: getAiRecordModel_()
  });
}

function routeAiRecordAssistantPost_(e) {
  const body = parseJsonBody_(e);
  const action = (e && e.parameter && e.parameter.action) || (body && body.action);
  if (action !== "aiRecordAssistant") return null;

  try {
    return jsonOutput_(handleAiRecordAssistant_(body || {}));
  } catch (err) {
    return jsonOutput_({
      ok: false,
      mode: "unknown",
      message: err && err.message ? err.message : "AI record assistant failed",
      draft: emptyAiRecordDraft_()
    });
  }
}

function handleAiRecordAssistant_(payload) {
  const apiKey = getOpenAiApiKey_();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured in Apps Script properties");
  }

  const text = String(payload.text || "").trim();
  if (!text) {
    throw new Error("Missing text");
  }

  const requestBody = {
    model: getAiRecordModel_(),
    input: [
      {
        role: "developer",
        content: [{ type: "input_text", text: buildAiRecordInstructions_() }]
      },
      {
        role: "user",
        content: [{
          type: "input_text",
          text: JSON.stringify({
            text: text,
            today: payload.today || "",
            vehicle: payload.vehicle || {},
            records: Array.isArray(payload.records) ? payload.records : []
          })
        }]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "vehicle_record_draft",
        strict: true,
        schema: buildAiRecordSchema_()
      }
    },
    max_output_tokens: 1200
  };

  const response = UrlFetchApp.fetch("https://api.openai.com/v1/responses", {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + apiKey
    },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const raw = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error("OpenAI API error HTTP " + status);
  }

  const apiJson = JSON.parse(raw);
  const outputText = extractOpenAiOutputText_(apiJson);
  if (!outputText) {
    throw new Error("OpenAI response did not include structured output");
  }

  const result = JSON.parse(outputText);
  return normalizeAiRecordResult_(result, payload);
}

function buildAiRecordInstructions_() {
  return [
    "You extract Taiwanese vehicle maintenance records from casual Traditional Chinese text.",
    "Return only the JSON object required by the supplied schema.",
    "Use the user's full record list only as context for current mileage and wording patterns.",
    "Do not save data. Produce a draft for the web app to review before saving.",
    "Classify fuel records when text mentions 加油, 加油站, 中油, 全國, 台塑, 92, 95, or 98 in a fuel context.",
    "For fuel: use fuelType 98/95/92 when present; set liters and unitPrice to 0 when unknown; set mileage to currentMileage when no explicit mileage is present.",
    "For service records: category must be 保養, 維修, 更換, 保險, 檢驗/稅費, 清潔美容, 改裝升級, or 其他.",
    "Use 清潔美容 for 洗車, 美容, 鍍膜, 清潔.",
    "Use 更換 for 輪胎, 電瓶, or text with 換/更換 when a part is named.",
    "Use today's date when no date is present. Use empty strings and 0 values for unknown fields.",
    "The last obvious standalone currency-like number is usually cost. Mileage numbers usually include km, 公里, or 里程.",
    "Add uncertain or missing fields to missingFields. confidence is 0 to 1."
  ].join("\n");
}

function buildAiRecordSchema_() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean" },
      mode: { type: "string", enum: ["fuel", "service", "unknown"] },
      message: { type: "string" },
      draft: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: { type: "string" },
          mileage: { type: "integer" },
          category: {
            type: "string",
            enum: ["保養", "維修", "更換", "保險", "檢驗/稅費", "清潔美容", "改裝升級", "其他", ""]
          },
          detail: { type: "string" },
          cost: { type: "integer" },
          fuelType: { type: "string", enum: ["98", "95", "92", "其他", ""] },
          liters: { type: "number" },
          unitPrice: { type: "number" },
          discount: { type: "number" },
          fullTank: { type: "boolean" },
          note: { type: "string" },
          confidence: { type: "number" },
          missingFields: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: [
          "date",
          "mileage",
          "category",
          "detail",
          "cost",
          "fuelType",
          "liters",
          "unitPrice",
          "discount",
          "fullTank",
          "note",
          "confidence",
          "missingFields"
        ]
      }
    },
    required: ["ok", "mode", "message", "draft"]
  };
}

function normalizeAiRecordResult_(result, payload) {
  const draft = result && result.draft ? result.draft : {};
  const today = String(payload.today || "");
  const vehicle = payload.vehicle || {};
  const mode = result && result.mode === "fuel"
    ? "fuel"
    : result && result.mode === "service"
      ? "service"
      : "unknown";

  return {
    ok: result && result.ok !== false,
    mode: mode,
    message: String(result && result.message || "已產生紀錄草稿，請確認後儲存。"),
    draft: {
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(draft.date || "")) ? draft.date : today,
      mileage: Math.max(0, Math.round(Number(draft.mileage) || (mode === "fuel" ? Number(vehicle.currentMileage) || 0 : 0))),
      category: String(draft.category || ""),
      detail: String(draft.detail || payload.text || ""),
      cost: Math.max(0, Math.round(Number(draft.cost) || 0)),
      fuelType: String(draft.fuelType || (mode === "fuel" ? vehicle.defaultFuelType || "98" : "")),
      liters: Math.max(0, Number(draft.liters) || 0),
      unitPrice: Math.max(0, Number(draft.unitPrice) || 0),
      discount: Math.max(0, Number(draft.discount) || Number(vehicle.defaultDiscount) || 0),
      fullTank: draft.fullTank !== false,
      note: String(draft.note || ""),
      confidence: Math.max(0, Math.min(1, Number(draft.confidence) || 0)),
      missingFields: Array.isArray(draft.missingFields) ? draft.missingFields.map(String) : []
    }
  };
}

function emptyAiRecordDraft_() {
  return {
    date: "",
    mileage: 0,
    category: "",
    detail: "",
    cost: 0,
    fuelType: "",
    liters: 0,
    unitPrice: 0,
    discount: 0,
    fullTank: true,
    note: "",
    confidence: 0,
    missingFields: []
  };
}

function extractOpenAiOutputText_(apiJson) {
  if (apiJson && apiJson.output_text) return apiJson.output_text;
  const output = apiJson && apiJson.output;
  if (!Array.isArray(output)) return "";
  for (const item of output) {
    const content = item && item.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part.text === "string") return part.text;
      if (part && typeof part.output_text === "string") return part.output_text;
    }
  }
  return "";
}

function parseJsonBody_(e) {
  const body = e && e.postData && e.postData.contents;
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch (err) {
    return null;
  }
}

function getOpenAiApiKey_() {
  return PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY") || "";
}

function getAiRecordModel_() {
  return PropertiesService.getScriptProperties().getProperty("OPENAI_MODEL") || AI_RECORD_DEFAULT_MODEL;
}

function jsonOutput_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
