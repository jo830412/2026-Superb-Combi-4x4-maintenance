// ============================================================
// 初始資料（從 Excel 匯出）
// ============================================================
const INITIAL_DATA = [];

// ============================================================
// 雲端與本地儲存管理
// ============================================================
const STORAGE_KEY = "newSuperbMaintenanceRecords_v1";
const BACKUP_FORMAT = "superb-maintenance-backup";
const BACKUP_VERSION = 1;
const APP_VERSION = "v2026.09.04.1";
const API_URL = "https://script.google.com/macros/s/AKfycbwg3zHXptNuR1tCFs_lFYxroASHXEpkl569YBdUD4WFBQc-icvnaHI4NHL0YgCQHVZ3BA/exec";
const WARRANTY_START_DATE = "2026-05-28";
const VEHICLE_DELIVERY_DATE = WARRANTY_START_DATE;
const VEHICLE_DELIVERY_MILEAGE_KM = 0;
const WARRANTY_MONTHS = 48;
const FIRST_INSPECTION_INTERVAL_MONTHS = 60;
const MAINTENANCE_INTERVAL_KM = 10000;
const MAINTENANCE_DUE_KM = 12000;
const MAINTENANCE_INTERVAL_MONTHS = 12;
const MAINTENANCE_DUE_MONTHS = 13;
const DEFAULT_FUEL_TYPE = "98";
const DEFAULT_FUEL_DISCOUNT = 1.8;
const FUEL_PRICE_SOURCE_URL = "https://www.npcgas.com.tw/Consultant/Oil";
const FUEL_PRICE_CACHE_KEY = "newSuperbFuelPrices_v2";
const FUEL_PRICE_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const VEHICLE_PROFILE = {
  name: "2026 Superb Combi 2.0 TSI 4x4",
  displacementCc: 1984,
  fuel: "汽油"
};
const FIXED_OWNER_COSTS = [
  {
    name: "使用牌照稅",
    icon: "牌",
    terms: ["牌照稅", "使用牌照稅"],
    month: 4,
    startDay: 1,
    endDay: 30,
    amount: 11230
  },
  {
    name: "公路養管費",
    icon: "路",
    terms: ["燃料稅", "燃料費", "汽燃費", "公路養管費"],
    month: 7,
    startDay: 1,
    endDay: 31,
    amount: 6180
  }
];

let records = [];
let currentFilter = "全部";
let currentSearch = "";
let currentYear = "";
let deleteTargetIndex = -1;
let costChart = null;
let catChart = null;
let lastSyncAt = null;
let lastCloudFingerprint = "";
let photoMode = "fuel";
let photoParsed = null;
let photoPreviewUrl = "";
let aiBackendReady = null;
let fuelEditIndex = -1;
let activeView = "overview";
let activeRecordsSubtab = "all";
let deletedRecordSnapshot = null;
let toastTimer = null;
let pendingRestoreRecords = null;
let pendingDuplicateSave = null;
let backupDownloadSpy = null;
let pendingCalendarTask = null;
let renderedOwnerActions = [];
let calendarReminderInvoker = null;
let quickEntryInvoker = null;

const RECORD_TEMPLATES = {
  oil: {
    category: "保養",
    detail: "機油、機油芯",
    note: "例行機油保養"
  },
  regularMaintenance: {
    category: "保養",
    detail: "定期保養、基本檢查",
    note: "可補充工單號碼、保養項目與下次建議"
  },
  tire: {
    category: "更換",
    detail: "輪胎更換、安裝、平衡",
    note: "可補充品牌、規格與胎壓"
  },
  battery: {
    category: "更換",
    detail: "電瓶更換",
    note: "可補充品牌、容量與保固"
  },
  brake: {
    category: "維修",
    detail: "煞車皮、煞車油、煞車系統檢查",
    note: ""
  },
  transmission: {
    category: "保養",
    detail: "變速箱油、濾網、油底殼檢查",
    note: "變速箱相關保養"
  },
  insuranceRenewal: {
    category: "保險",
    detail: "強制險、任意險續保",
    note: "可補充保險公司、保單號碼與保障期間"
  },
  licenseTax: {
    category: "檢驗/稅費",
    detail: "牌照稅",
    note: "年度稅費"
  },
  fuelTax: {
    category: "檢驗/稅費",
    detail: "燃料稅",
    note: "年度稅費"
  },
  inspection: {
    category: "檢驗/稅費",
    detail: "驗車、定期檢驗",
    note: "可補充驗車結果與下次檢驗日期"
  },
  fuelAdditive: {
    category: "其他",
    detail: "汽油精添加",
    note: "每 3,000-4,000 km 添加"
  }
};

function loadLocalRecords() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("讀取本機資料失敗", e);
    return [];
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

const CONSUMABLE_RULES = [
  { name: "機油保養", icon: "🛢", terms: ["機油"], intervalKm: 10000, dueKm: 12000 },
  { name: "變速箱油", icon: "⚙", terms: ["變速箱油", "閥體油"], intervalKm: 40000, dueKm: 60000 },
  { name: "輪胎", icon: "輪", terms: ["輪胎"], intervalKm: 40000, dueKm: 50000 },
  { name: "電瓶", icon: "🔋", terms: ["電瓶"], intervalMonths: 36, dueMonths: 48 },
  { name: "煞車油", icon: "制", terms: ["煞車油"], intervalMonths: 24, dueMonths: 36 },
  { name: "冷氣濾網", icon: "❄", terms: ["冷氣濾網", "冷氣濾心"], intervalKm: 10000, dueKm: 15000 },
  { name: "保險", icon: "🛡", terms: ["保險", "強制險", "任意險"], intervalMonths: 12, dueMonths: 13 },
  {
    name: "驗車",
    icon: "📅",
    terms: ["驗車", "定檢", "定期檢驗", "車輛檢驗"],
    intervalMonths: 12,
    dueMonths: 13,
    firstDueFrom: VEHICLE_DELIVERY_DATE,
    firstDueMonths: FIRST_INSPECTION_INTERVAL_MONTHS,
    firstDueMeta: "自用小客車新車未滿 5 年免定檢"
  }
];

function parseCloudState(payload) {
  if (Array.isArray(payload)) {
    return { records: payload, fingerprint: "", updatedAt: "" };
  }
  if (payload && Array.isArray(payload.records)) {
    return {
      records: payload.records,
      fingerprint: typeof payload.fingerprint === "string" ? payload.fingerprint : "",
      updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : ""
    };
  }
  throw new Error("雲端資料格式不正確");
}

async function initData() {
  document.getElementById("recordsContainer").innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>正在從雲端同步資料...</p></div>';
  setSyncStatus("syncing", "同步中");
  
  try {
    const res = await fetchWithTimeout(API_URL + "?action=syncState");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const cloudState = parseCloudState(await res.json());
    const data = cloudState.records;
    lastCloudFingerprint = cloudState.fingerprint;
    
    if (Array.isArray(data) && data.length > 0) {
      records = data;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
      lastSyncAt = new Date();
      setSyncStatus("ok", "已同步 " + formatTime(lastSyncAt));
    } else {
      const localRecords = loadLocalRecords();
      if (localRecords.length > 0) {
        records = localRecords;
        setSyncStatus("warn", "本機已保存，雲端無資料");
      } else if (INITIAL_DATA.length > 0) {
        records = [...INITIAL_DATA];
        await syncToCloud(records);
      } else {
        records = [];
        setSyncStatus("ok", "雲端無資料");
      }
    }
  } catch(e) {
    console.error("讀取雲端失敗，使用本機資料", e);
    const localRecords = loadLocalRecords();
    records = localRecords.length ? localRecords : [...INITIAL_DATA];
    setSyncStatus("error", "本機已保存，雲端讀取失敗");
  }
  refresh();
}

async function syncToCloud(data, { allowDestructiveReplace = false, reason = "save" } = {}) {
  setSyncStatus("syncing", "同步中");
  try {
    const res = await fetchWithTimeout(API_URL, {
      method: 'POST',
      body: JSON.stringify({
        records: data,
        expectedFingerprint: lastCloudFingerprint,
        allowDestructiveReplace,
        reason
      }),
      redirect: 'follow'
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const result = typeof res.json === "function"
      ? await res.json()
      : { status: "success" };
    if (result && result.status === "conflict") {
      const message = result.message || "雲端資料已變更，請重新載入後再試。";
      setSyncStatus("error", message + " 本機資料仍保留。");
      return false;
    }
    if (result && result.status && result.status !== "success") {
      const message = result.message || "雲端拒絕這次同步";
      setSyncStatus("error", message + " 本機資料仍保留。");
      return false;
    }
    if (result && typeof result.fingerprint === "string") {
      lastCloudFingerprint = result.fingerprint;
    }
    lastSyncAt = new Date();
    setSyncStatus("ok", "已同步 " + formatTime(lastSyncAt));
    return true;
  } catch(e) {
    console.error("同步至雲端失敗", e);
    setSyncStatus("error", "本機已保存，點擊重試同步");
    return false;
  }
}

function saveRecords(data, { announce = true, allowDestructiveReplace = false, reason = "save" } = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  setSyncStatus("syncing", "本機已保存，同步中");
  if (announce) showToast("已儲存到本機，正在同步…", null, { routine: true });
  syncToCloud(data, { allowDestructiveReplace, reason }).then(ok => {
    if (announce) showToast(ok ? "已同步雲端" : "同步失敗，本機資料仍保留", null, { routine: true });
  });
}

function hideToast() {
  const toast = document.getElementById("toast");
  if (toast) toast.hidden = true;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
}

function showToast(message, action = null, { routine = false } = {}) {
  const toast = document.getElementById("toast");
  const messageEl = document.getElementById("toastMessage");
  const actionBtn = document.getElementById("toastAction");
  if (!toast || !messageEl || !actionBtn) return;
  if (routine && !toast.hidden && !actionBtn.hidden) return;

  if (toastTimer) clearTimeout(toastTimer);
  messageEl.textContent = message;
  toast.hidden = false;
  actionBtn.hidden = !action;
  actionBtn.textContent = action ? action.label : "";
  actionBtn.onclick = action ? () => {
    hideToast();
    action.onClick();
  } : null;
  toastTimer = setTimeout(hideToast, action ? 7000 : 3500);
}

// ============================================================
// 狀態
// ============================================================
function formatTime(date) {
  return date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}

function setSyncStatus(state, text) {
  const el = document.getElementById("syncStatus");
  if (!el) return;
  el.className = "sync-status sync-" + state;
  el.textContent = text;
  el.title = state === "error" || state === "warn" ? "本機資料仍保留，點擊可重試同步" : "最後同步狀態";
}

// ============================================================
// 工具函式
// ============================================================
function formatCost(n) {
  if (!n) return "NT$ 0";
  return "NT$ " + n.toLocaleString("zh-TW");
}
function formatCompactCost(n) {
  if (!n) return "0";
  return n >= 10000 ? (n / 10000).toFixed(1) + " 萬" : n.toLocaleString("zh-TW");
}
function formatCompactCurrency(n) {
  return "NT$ " + formatCompactCost(n);
}
function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function formatMileage(n) {
  if (n == null || n === "") return "—";
  return Number(n).toLocaleString("zh-TW") + " km";
}
function formatNumberOrDash(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}
function parseDecimalInput(value) {
  const normalized = String(value ?? "").trim().replace(/[，,．]/g, ".");
  return normalized ? Number(normalized) : NaN;
}
function normalizeOcrNumber(value) {
  if (value == null) return NaN;
  const normalized = String(value)
    .replace(/[ＯOo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[，,]/g, "")
    .replace("．", ".")
    .trim();
  return normalized ? Number(normalized) : NaN;
}
function normalizeOcrText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[：﹕]/g, ":")
    .replace(/[　\t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function getYear(dateStr) {
  return dateStr ? dateStr.substring(0, 4) : "";
}
function parseDate(dateStr) {
  const d = dateStr ? new Date(dateStr + "T00:00:00") : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}
function formatDateYMD(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function escapeIcsText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldIcsLine(line) {
  const chunks = [];
  let current = "";
  let bytes = 0;

  for (const char of String(line)) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 73 && current) {
      chunks.push(current);
      current = " ";
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  chunks.push(current);
  return chunks.join("\r\n");
}

function buildCalendarUid(task) {
  const source = `${VEHICLE_PROFILE.name}|${task.type || "reminder"}|${task.date}|${task.title}`;
  let hash = 2166136261;
  for (const char of source) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  }
  return `${(hash >>> 0).toString(16)}-${task.date.replace(/-/g, "")}@superb-maintenance.local`;
}

function buildCalendarFile(task, now = new Date()) {
  const start = parseDate(task?.date);
  if (!start) throw new Error("提醒日期無效");

  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const compactDate = date => formatDateYMD(date).replace(/-/g, "");
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const title = task.title || "Superb 車輛提醒";
  const description = task.description || "請開啟 Superb 保養紀錄確認詳細內容。";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Superb Maintenance//Vehicle Reminder//ZH-TW",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${buildCalendarUid({ ...task, title })}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compactDate(start)}`,
    `DTEND;VALUE=DATE:${compactDate(end)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    "BEGIN:VALARM",
    "TRIGGER:-P7D",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(title)}`,
    "END:VALARM",
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

function getStoredRecordValidationError(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return "Record must be an object.";
  }
  for (const field of ["date", "category", "detail"]) {
    if (typeof record[field] !== "string" || !record[field].trim()) {
      return `Record ${field} must be a non-empty string.`;
    }
  }
  if (record.mileage !== null && !Number.isFinite(record.mileage)) {
    return "Record mileage must be a finite number or null.";
  }
  if (!Number.isFinite(record.cost)) {
    return "Record cost must be a finite number.";
  }
  if (typeof record.note !== "string") {
    return "Record note must be a string.";
  }
  return "";
}

function isValidStoredRecord(record) {
  return !getStoredRecordValidationError(record);
}

function buildBackupEnvelope(sourceRecords, exportedAt = new Date().toISOString()) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    records: sourceRecords.map(record => ({ ...record }))
  };
}

function validateBackupEnvelope(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, error: "Backup must be an object." };
  }
  if (candidate.format !== BACKUP_FORMAT) {
    return { ok: false, error: "Backup format is not supported." };
  }
  if (candidate.version !== BACKUP_VERSION) {
    return { ok: false, error: "Backup version is not supported." };
  }
  if (!Array.isArray(candidate.records)) {
    return { ok: false, error: "Backup records must be an array." };
  }

  for (const record of candidate.records) {
    const error = getStoredRecordValidationError(record);
    if (error) return { ok: false, error };
  }
  return { ok: true, records: candidate.records.map(record => ({ ...record })) };
}

function getBackupDateRange(sourceRecords) {
  const datedRecords = sourceRecords
    .map(record => {
      const date = typeof record?.date === "string" ? record.date.trim() : "";
      const parsedDate = parseDate(date);
      return parsedDate && formatDateYMD(parsedDate) === date ? { date } : null;
    })
    .filter(Boolean)
    .sort(compareRecordsNewestFirst);

  if (!datedRecords.length) return "無日期資料";
  const newest = datedRecords[0].date;
  const oldest = datedRecords[datedRecords.length - 1].date;
  return newest === oldest ? newest : `${oldest} ～ ${newest}`;
}

function revokeObjectUrlSafely(url) {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch (error) {}
}

function downloadJsonBackup(sourceRecords, label) {
  let url = "";
  try {
    const backup = JSON.stringify(buildBackupEnvelope(sourceRecords), null, 2);
    const blob = new Blob([backup], { type: "application/json;charset=utf-8" });
    url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `車輛保養紀錄備份_${label}_${formatDateYMD(new Date())}.json`;
    anchor.click();
    revokeObjectUrlSafely(url);
    if (backupDownloadSpy) backupDownloadSpy(label);
    return true;
  } catch (error) {
    revokeObjectUrlSafely(url);
    return false;
  }
}

function exportJsonBackup() {
  if (!downloadJsonBackup(records, "手動備份")) {
    showToast("備份下載失敗，請再試一次。");
  }
}

function stageBackupRestore(fileText) {
  try {
    const validation = validateBackupEnvelope(JSON.parse(fileText));
    if (!validation.ok) throw new Error(validation.error);

    pendingRestoreRecords = validation.records.map(record => ({ ...record }));
    document.getElementById("backupRestoreSummary").textContent =
      `筆數：${pendingRestoreRecords.length} 筆／日期：${getBackupDateRange(pendingRestoreRecords)}`;
    document.getElementById("backupRestoreModal").style.display = "flex";
    return { ok: true };
  } catch (error) {
    pendingRestoreRecords = null;
    const message = error instanceof Error ? error.message : String(error);
    showToast("備份檔無法還原：" + message);
    return { ok: false, error: message };
  }
}

function closeBackupRestoreModal() {
  pendingRestoreRecords = null;
  document.getElementById("backupRestoreModal").style.display = "none";
}

function confirmBackupRestore() {
  if (!pendingRestoreRecords) return;

  if (!downloadJsonBackup(records, "還原前")) {
    showToast("還原前備份下載失敗，尚未還原資料，請再試一次。");
    return;
  }
  records = pendingRestoreRecords.map(record => ({ ...record }));
  pendingRestoreRecords = null;
  saveRecords(records, { announce: false, allowDestructiveReplace: true, reason: "restore" });
  closeBackupRestoreModal();
  refresh();
  showToast(`已還原 ${records.length} 筆紀錄`);
}

function findLikelyDuplicates(record, { excludeIndex = -1 } = {}) {
  const getDuplicateKey = value => [value.date, value.mileage ?? "", value.category]
    .map(part => String(part).trim())
    .join("|");
  const key = getDuplicateKey(record);
  return records.filter((candidate, index) => index !== excludeIndex && getDuplicateKey(candidate) === key);
}

function requestRecordSave(record, { editIndex = -1, commit }) {
  const candidates = findLikelyDuplicates(record, { excludeIndex: editIndex });
  if (!candidates.length) {
    commit();
    return;
  }

  pendingDuplicateSave = commit;
  document.getElementById("duplicateList").innerHTML = candidates.map(candidate => `
    <li>${escapeHtml(candidate.date)} · ${escapeHtml(candidate.mileage ?? "—")} km · ${escapeHtml(candidate.category)}</li>
  `).join("");
  document.getElementById("duplicateModal").style.display = "flex";
}

function closeDuplicateModal() {
  pendingDuplicateSave = null;
  document.getElementById("duplicateModal").style.display = "none";
}

function confirmDuplicateSave() {
  const commit = pendingDuplicateSave;
  pendingDuplicateSave = null;
  closeDuplicateModal();
  if (commit) commit();
}

function formatDateYM(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}
function compareRecordsNewestFirst(a, b) {
  const dateCompare = String(b.date || "").localeCompare(String(a.date || ""));
  if (dateCompare) return dateCompare;

  const mileageA = Number(a.mileage);
  const mileageB = Number(b.mileage);
  const hasMileageA = Number.isFinite(mileageA);
  const hasMileageB = Number.isFinite(mileageB);
  if (hasMileageA && hasMileageB && mileageA !== mileageB) return mileageB - mileageA;
  if (hasMileageA !== hasMileageB) return hasMileageB ? 1 : -1;

  return records.indexOf(b) - records.indexOf(a);
}
function compareFuelLogsOldestFirst(a, b) {
  const dateCompare = String(a.date || "").localeCompare(String(b.date || ""));
  if (dateCompare) return dateCompare;
  if (a.mileage !== b.mileage) return a.mileage - b.mileage;
  return (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0);
}
function compareFuelLogsNewestFirst(a, b) {
  return -compareFuelLogsOldestFirst(a, b);
}
function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}
function diffMonths(from, to = new Date()) {
  if (!from) return 0;
  return Math.max(0, (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth());
}
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function diffDays(from, to = new Date()) {
  if (!from) return 0;
  return Math.ceil((startOfDay(from) - startOfDay(to)) / 86400000);
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}
function firstFinite(...values) {
  return values.find(value => Number.isFinite(value)) ?? null;
}
function getMaxMileage(excludeIndex = -1) {
  const values = records
    .map((r, i) => i === excludeIndex ? null : Number(r.mileage))
    .filter(v => Number.isFinite(v) && v > 0);
  return values.length ? Math.max(...values) : 0;
}
function getCurrentMileage() {
  return getMaxMileage();
}
function getVehicleBaselineDate() {
  return parseDate(VEHICLE_DELIVERY_DATE);
}
function getVehicleBaselineMileage() {
  return VEHICLE_DELIVERY_MILEAGE_KM;
}
function getEffectiveCurrentMileage() {
  const currentMileage = getCurrentMileage();
  return currentMileage > 0 ? currentMileage : getVehicleBaselineMileage();
}
function getBaselineMetaPrefix() {
  const baselineDate = getVehicleBaselineDate();
  const dateText = baselineDate ? formatDateYMD(baselineDate) : "交車日";
  return `${dateText} 交車 ${getVehicleBaselineMileage().toLocaleString("zh-TW")} km 起算`;
}
function isMileageUpdateRecord(r) {
  return r && r.category === "其他" && r.detail === "目前里程更新";
}
function isFuelLogRecord(r) {
  return r && r.category === "加油";
}
function getServiceRecords() {
  return records.filter(r => !isMileageUpdateRecord(r));
}
function getCostRecords() {
  return getServiceRecords().filter(r => asNumber(r.cost) > 0);
}
function parseFuelLogFullTank(detail) {
  const parts = String(detail || "").split("｜").map(part => part.trim());
  return parts.includes("加滿");
}
function parseFuelLog(r, sourceIndex = -1) {
  if (!isFuelLogRecord(r)) return null;
  const detail = r.detail || "";
  const litersMatch = detail.match(/([0-9]+(?:\.[0-9]+)?)\s*L/i);
  const unitPriceMatch = detail.match(/牌告\s*([0-9]+(?:\.[0-9]+)?)/);
  const discountMatch = detail.match(/優惠\s*([0-9]+(?:\.[0-9]+)?)/);
  const netPriceMatch = detail.match(/實付\s*([0-9]+(?:\.[0-9]+)?)/);
  const mileage = Number(r.mileage);
  const liters = litersMatch ? parseFloat(litersMatch[1]) : NaN;
  if (!Number.isFinite(mileage) || mileage <= 0 || !Number.isFinite(liters) || liters <= 0) return null;
  return {
    date: r.date || "",
    mileage,
    liters,
    cost: asNumber(r.cost),
    fullTank: parseFuelLogFullTank(detail),
    fuelType: (detail.split("｜")[1] || "").trim(),
    unitPrice: unitPriceMatch ? parseFloat(unitPriceMatch[1]) : null,
    discount: discountMatch ? parseFloat(discountMatch[1]) : null,
    netPrice: netPriceMatch ? parseFloat(netPriceMatch[1]) : null,
    note: r.note || "",
    sourceIndex
  };
}
function getFuelLogs() {
  return records
    .map(parseFuelLog)
    .filter(Boolean)
    .sort(compareFuelLogsOldestFirst);
}
function getFuelStats() {
  const logs = getFuelLogs();
  const totalCost = logs.reduce((sum, log) => sum + log.cost, 0);
  let anchor = null;
  let litersSinceAnchor = 0;
  const segments = [];

  logs.forEach(log => {
    if (!anchor) {
      if (log.fullTank) anchor = log;
      return;
    }

    litersSinceAnchor += log.liters;
    if (log.fullTank) {
      const distance = log.mileage - anchor.mileage;
      if (distance > 0 && litersSinceAnchor > 0) {
        segments.push({
          date: log.date,
          mileage: log.mileage,
          distance,
          liters: litersSinceAnchor,
          kmPerLiter: distance / litersSinceAnchor
        });
      }
      anchor = log;
      litersSinceAnchor = 0;
    }
  });

  const totalDistance = segments.reduce((sum, segment) => sum + segment.distance, 0);
  const totalLiters = segments.reduce((sum, segment) => sum + segment.liters, 0);
  return {
    logs,
    segments,
    totalCost,
    averageKmPerLiter: totalDistance > 0 && totalLiters > 0 ? totalDistance / totalLiters : null,
    latestKmPerLiter: segments.length ? segments[segments.length - 1].kmPerLiter : null
  };
}
function getMedian(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
function getFuelSegmentQuality(segment, medianKmPerLiter) {
  const value = Number(segment?.kmPerLiter);
  if (!Number.isFinite(value) || !Number.isFinite(medianKmPerLiter) || medianKmPerLiter <= 0) {
    return { suspicious: false, reason: "" };
  }

  const high = value > 18 || value > medianKmPerLiter * 1.45;
  const low = value < 5 || value < medianKmPerLiter * 0.70;
  if (!high && !low) return { suspicious: false, reason: "" };

  return {
    suspicious: true,
    reason: high
      ? "明顯高於其他加滿區間"
      : "明顯低於其他加滿區間"
  };
}
function getMileageRegressionIssues() {
  const mileageByDate = new Map();
  records.forEach(record => {
    const mileage = Number(record?.mileage);
    if (!record?.date || !Number.isFinite(mileage) || mileage <= 0) return;
    const current = mileageByDate.get(record.date);
    mileageByDate.set(record.date, current == null ? mileage : Math.max(current, mileage));
  });

  let priorMax = null;
  return [...mileageByDate.entries()]
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .flatMap(([date, mileage]) => {
      const issue = priorMax != null && mileage < priorMax
        ? [{
            type: "mileage-regression",
            date,
            title: "里程比前一筆紀錄低",
            detail: `${date} 為 ${mileage.toLocaleString("zh-TW")} km，低於先前的 ${priorMax.toLocaleString("zh-TW")} km。請確認日期或里程。`,
            key: `mileage|${date}|${mileage}`
          }]
        : [];
      priorMax = priorMax == null ? mileage : Math.max(priorMax, mileage);
      return issue;
    });
}
function getDataQualityIssues() {
  const issues = getMileageRegressionIssues();
  const fuelStats = getFuelStats();
  if (fuelStats.segments.length < 5) return issues;

  const medianKmPerLiter = getMedian(fuelStats.segments.map(segment => segment.kmPerLiter));
  fuelStats.segments.forEach(segment => {
    const quality = getFuelSegmentQuality(segment, medianKmPerLiter);
    if (!quality.suspicious) return;
    issues.push({
      type: "fuel-outlier",
      date: segment.date,
      title: "油耗區間待確認",
      detail: `${segment.date} 計算為 ${segment.kmPerLiter.toFixed(1)} km/L，${quality.reason}。請確認里程、是否漏登加油，或是否真的加滿。`,
      key: `fuel|${segment.date}|${segment.mileage}`
    });
  });
  return issues;
}
function recordMatchesTerms(r, terms) {
  if (isMileageUpdateRecord(r)) return false;
  const text = `${r.category || ""} ${r.detail || ""} ${r.note || ""}`;
  return terms.some(term => text.includes(term));
}
function getTodayString() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function parseOcrDate(text) {
  const raw = String(text || "");
  const western = raw.match(/(20\d{2})[./\-\s年]+(\d{1,2})[./\-\s月]+(\d{1,2})/);
  if (western) {
    const year = Number(western[1]);
    const month = String(Number(western[2])).padStart(2, "0");
    const day = String(Number(western[3])).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const roc = raw.match(/(?:民國|中華民國)?\s*(1\d{2})[./\-\s年]+(\d{1,2})[./\-\s月]+(\d{1,2})/);
  if (roc) {
    const year = Number(roc[1]) + 1911;
    const month = String(Number(roc[2])).padStart(2, "0");
    const day = String(Number(roc[3])).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return getTodayString();
}

function findLineNumber(text, keywords, range = {}) {
  const lines = String(text || "").split("\n");
  for (const line of lines) {
    if (!keywords.some(keyword => line.includes(keyword))) continue;
    const nums = [...line.matchAll(/(?:NT\$?\s*)?([0-9][0-9,]*(?:[.][0-9]+)?)/gi)]
      .map(match => normalizeOcrNumber(match[1]))
      .filter(value => Number.isFinite(value));
    const matched = nums.find(value =>
      (range.min == null || value >= range.min) &&
      (range.max == null || value <= range.max)
    );
    if (Number.isFinite(matched)) return matched;
  }
  return null;
}

function parseMoneyFromOcr(text) {
  const labeled = findLineNumber(text, ["總計", "合計", "金額", "應收", "實收", "小計", "刷卡"], { min: 1, max: 500000 });
  if (Number.isFinite(labeled)) return Math.round(labeled);
  const numbers = [...String(text || "").matchAll(/(?:NT\$?\s*)?([0-9][0-9,]{2,}(?:[.][0-9]+)?)/gi)]
    .map(match => normalizeOcrNumber(match[1]))
    .filter(value => Number.isFinite(value) && value >= 50 && value <= 500000);
  return numbers.length ? Math.round(Math.max(...numbers)) : null;
}

function parseMileageFromOcr(text) {
  const labeled = findLineNumber(text, ["里程", "公里", "km", "KM"], { min: 1, max: 999999 });
  if (Number.isFinite(labeled)) return Math.round(labeled);
  return getCurrentMileage() || null;
}

function parseFuelPhotoText(rawText) {
  const text = normalizeOcrText(rawText);
  const litersMatch =
    text.match(/(?:加油量|公升|升數|數量|油量)[^\d]{0,8}([0-9]{1,3}(?:[.,.][0-9]{1,3})?)/i) ||
    text.match(/([0-9]{1,3}(?:[.,.][0-9]{1,3})?)\s*(?:L|公升|升)\b/i);
  const unitPriceMatch =
    text.match(/(?:單價|牌告|油價)[^\d]{0,8}([0-9]{2}(?:[.,.][0-9])?)/) ||
    text.match(/([0-9]{2}(?:[.,.][0-9])?)\s*(?:元\s*\/?\s*L|\/\s*L)/i);
  const fuelTypeMatch = text.match(/(?:無鉛|汽油)?\s*(92|95|98)|\b(92|95|98)\s*(?:無鉛|汽油)/);
  const stationMatch = text.match(/(中油|台塑|全國|統一精工|山隆|福懋|台亞|速邁樂|加油站)/);
  const liters = litersMatch ? normalizeOcrNumber(litersMatch[1]) : null;
  const unitPrice = unitPriceMatch ? normalizeOcrNumber(unitPriceMatch[1]) : null;
  const cost = parseMoneyFromOcr(text);
  const mileage = parseMileageFromOcr(text);
  return {
    mode: "fuel",
    rawText: text,
    date: parseOcrDate(text),
    mileage,
    liters: Number.isFinite(liters) ? liters : null,
    unitPrice: Number.isFinite(unitPrice) ? unitPrice : null,
    cost,
    fuelType: fuelTypeMatch ? (fuelTypeMatch[1] || fuelTypeMatch[2]) : DEFAULT_FUEL_TYPE,
    fullTank: true,
    note: stationMatch ? `${stationMatch[1]}，照片辨識` : "照片辨識"
  };
}

function inferServiceCategory(text) {
  if (/保險|強制險|任意險|保單/.test(text)) return "保險";
  if (/驗車|檢驗|牌照稅|燃料稅|稅/.test(text)) return "檢驗/稅費";
  if (/輪胎|電瓶|更換/.test(text)) return "更換";
  if (/故障|維修|檢修|漏|異音/.test(text)) return "維修";
  if (/洗車|美容|鍍膜|清潔/.test(text)) return "清潔美容";
  return "保養";
}

function buildServiceDetailFromOcr(text) {
  const lines = normalizeOcrText(text).split("\n")
    .map(line => line.trim())
    .filter(line => line.length >= 2)
    .filter(line => !/統一編號|電話|地址|發票|收據|刷卡|信用卡/.test(line));
  const useful = lines.filter(line => /機油|保養|維修|更換|輪胎|電瓶|煞車|變速箱|保險|驗車|牌照稅|燃料稅|工資|零件/.test(line));
  return (useful.length ? useful : lines).slice(0, 4).join("、") || "照片辨識紀錄";
}

function parseServicePhotoText(rawText) {
  const text = normalizeOcrText(rawText);
  return {
    mode: "service",
    rawText: text,
    date: parseOcrDate(text),
    mileage: parseMileageFromOcr(text),
    category: inferServiceCategory(text),
    cost: parseMoneyFromOcr(text),
    detail: buildServiceDetailFromOcr(text),
    note: "照片辨識，請確認欄位"
  };
}
function getCategoryEmoji(cat) {
  const map = { 保養:"🔧", 維修:"🚨", 更換:"🔄", 加油:"⛽", 保險:"🛡", "檢驗/稅費":"📅", 清潔美容:"✨", 改裝升級:"⚡", 其他:"📌" };
  return map[cat] || "📌";
}

function getCategoryBadgeClass(cat) {
  const map = {
    "檢驗/稅費": "badge-inspection",
    "保險": "badge-insurance",
    "清潔美容": "badge-cleaning"
  };
  return map[cat] || "badge-" + escapeHtml(cat);
}

// ============================================================
// 統計卡片
// ============================================================
function updateStats() {
  const sorted = [...records].sort(compareRecordsNewestFirst);
  const serviceRecords = getServiceRecords();
  const sortedServiceRecords = [...serviceRecords].sort(compareRecordsNewestFirst);
  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  document.getElementById("statTotalRecords").textContent = serviceRecords.length;

  const total = serviceRecords.reduce((s, r) => s + asNumber(r.cost), 0);
  document.getElementById("statTotalCost").textContent = total > 0
    ? formatCompactCost(total)
    : "0";

  const maxMile = getEffectiveCurrentMileage();
  document.getElementById("statCurrentMileage").textContent =
    maxMile.toLocaleString("zh-TW");

  const lastMaint = sortedServiceRecords.find(r => r.category === "保養");
  document.getElementById("statLastMaintenance").textContent =
    lastMaint ? lastMaint.date.substring(0, 7) : "—";

  const recentTotal = serviceRecords.reduce((sum, r) => {
    const d = parseDate(r.date);
    return d && d >= oneYearAgo ? sum + asNumber(r.cost) : sum;
  }, 0);
  document.getElementById("statRecentCost").textContent = recentTotal > 0
    ? formatCompactCost(recentTotal)
    : "0";

  const ownershipCost = getCostRecords().reduce((sum, r) => sum + asNumber(r.cost), 0);
  document.getElementById("statCostPerKm").textContent = maxMile > 0 && ownershipCost > 0
    ? "NT$ " + (ownershipCost / maxMile).toFixed(1)
    : "—";

  const fuelStats = getFuelStats();
  document.getElementById("statAvgFuel").textContent = fuelStats.averageKmPerLiter
    ? fuelStats.averageKmPerLiter.toFixed(1)
    : fuelStats.logs.length ? "待計算" : "—";
  document.getElementById("statLastFuel").textContent = fuelStats.latestKmPerLiter
    ? fuelStats.latestKmPerLiter.toFixed(1)
    : fuelStats.logs.length ? "待計算" : "—";
  const warrantyStart = parseDate(WARRANTY_START_DATE);
  document.getElementById("statWarrantyStart").textContent = warrantyStart
    ? formatDateYMD(addMonths(warrantyStart, WARRANTY_MONTHS))
    : "—";

  const nextMaintEl = document.getElementById("statNextMaintenance");
  const maintenanceSchedule = getMaintenanceCalendarSchedule();
  const nextMaintenanceParts = [];
  if (Number.isFinite(maintenanceSchedule.dueMileage)) {
    const remainingKm = Math.max(maintenanceSchedule.dueMileage - maxMile, 0);
    nextMaintenanceParts.push(remainingKm > 0 ? `剩 ${remainingKm.toLocaleString("zh-TW")} km` : "已達里程");
  }
  if (maintenanceSchedule.dueDate) {
    nextMaintenanceParts.push(formatDateYMD(maintenanceSchedule.dueDate));
  }
  nextMaintEl.textContent = nextMaintenanceParts.join(" · ") || "—";

  const fuelAdditiveEl = document.getElementById("statFuelAdditive");
  const fuelAdditiveLabel = document.getElementById("statFuelAdditiveLabel");
  const lastFuelAdditive = sorted.find(r => recordMatchesTerms(r, ["汽油精"]));
  const lastFuelMileage = lastFuelAdditive ? Number(lastFuelAdditive.mileage) : null;
  if (!lastFuelAdditive) {
    fuelAdditiveEl.textContent = "未記錄";
    fuelAdditiveLabel.textContent = "每 3,000-4,000 km 添加";
  } else if (maxMile > 0 && Number.isFinite(lastFuelMileage) && lastFuelMileage > 0) {
    const usedKm = Math.max(maxMile - lastFuelMileage, 0);
    if (usedKm >= 4000) {
      fuelAdditiveEl.textContent = "該添加了";
    } else if (usedKm >= 3000) {
      fuelAdditiveEl.textContent = "可添加";
    } else {
      fuelAdditiveEl.textContent = "剩 " + (3000 - usedKm).toLocaleString("zh-TW") + " km";
    }
    fuelAdditiveLabel.textContent =
      "目前 " + maxMile.toLocaleString("zh-TW") +
      " / 上次 " + lastFuelMileage.toLocaleString("zh-TW") +
      " / 已跑 " + usedKm.toLocaleString("zh-TW") + " km";
  } else {
    fuelAdditiveEl.textContent = lastFuelAdditive.date ? lastFuelAdditive.date.substring(0, 7) : "已記錄";
    fuelAdditiveLabel.textContent = "缺少上次添加里程";
  }
}

function getLatestMatchingRecord(terms) {
  return [...records]
    .sort(compareRecordsNewestFirst)
    .find(r => recordMatchesTerms(r, terms));
}

function buildTrackerState(rule) {
  const currentMileage = getEffectiveCurrentMileage();
  const latest = getLatestMatchingRecord(rule.terms);
  if (!latest && rule.firstDueMonths) {
    const startDate = parseDate(rule.firstDueFrom);
    if (!startDate) {
      return { status: "missing", value: "缺日期", meta: "缺少新車起算日" };
    }
    const firstDueDate = addMonths(startDate, rule.firstDueMonths);
    const remainingMonths = diffMonths(new Date(), firstDueDate);
    const dueLabel = formatDateYMD(firstDueDate);
    if (remainingMonths <= 0) {
      return {
        status: "due",
        value: "該驗車",
        meta: `下一次約 ${dueLabel}`,
        next: rule.firstDueMeta || ""
      };
    }
    return {
      status: "ok",
      value: "剩 " + remainingMonths + " 個月",
      meta: `下一次約 ${dueLabel}`,
      next: rule.firstDueMeta || ""
    };
  }
  if (!latest) {
    const baselineDate = getVehicleBaselineDate();
    const baselineMileage = getVehicleBaselineMileage();
    if (rule.intervalKm) {
      const usedKm = Math.max(currentMileage - baselineMileage, 0);
      const meta = `${getBaselineMetaPrefix()} / 已跑 ${usedKm.toLocaleString("zh-TW")} km`;
      if (usedKm >= rule.dueKm) {
        return { status: "due", value: "該處理", meta };
      }
      if (usedKm >= rule.intervalKm) {
        return { status: "soon", value: "可安排", meta };
      }
      return {
        status: "ok",
        value: "剩 " + (rule.intervalKm - usedKm).toLocaleString("zh-TW") + " km",
        meta,
        next: "尚無更換紀錄，先以新車交車基準推估。"
      };
    }
    if (rule.intervalMonths && baselineDate) {
      const usedMonths = diffMonths(baselineDate);
      const nextDate = addMonths(baselineDate, rule.intervalMonths);
      const nextLabel = formatDateYMD(nextDate);
      const next = `交車 ${formatDateYM(baselineDate)} / 已過 ${usedMonths} 個月`;
      if (usedMonths >= rule.dueMonths) {
        return { status: "due", value: "該處理", meta: `下一次約 ${nextLabel}`, next };
      }
      if (usedMonths >= rule.intervalMonths) {
        return { status: "soon", value: "可安排", meta: `下一次約 ${nextLabel}`, next };
      }
      return {
        status: "ok",
        value: "剩 " + (rule.intervalMonths - usedMonths) + " 個月",
        meta: `下一次約 ${nextLabel}`,
        next: next + " / 尚無更換紀錄，先以新車交車基準推估。"
      };
    }
    return {
      status: "missing",
      value: "未記錄",
      meta: rule.intervalKm
        ? `建議每 ${rule.intervalKm.toLocaleString("zh-TW")} km 檢查`
        : `建議每 ${rule.intervalMonths} 個月檢查`
    };
  }

  if (rule.intervalKm) {
    const lastMileage = Number(latest.mileage);
    if (!Number.isFinite(lastMileage) || lastMileage <= 0 || !currentMileage) {
      return {
        status: "missing",
        value: "缺里程",
        meta: latest.date ? `最近 ${latest.date}` : "最近紀錄缺少里程"
      };
    }
    const usedKm = Math.max(currentMileage - lastMileage, 0);
    if (usedKm >= rule.dueKm) {
      return {
        status: "due",
        value: "該處理",
        meta: `上次 ${lastMileage.toLocaleString("zh-TW")} km / 已跑 ${usedKm.toLocaleString("zh-TW")} km`
      };
    }
    if (usedKm >= rule.intervalKm) {
      return {
        status: "soon",
        value: "可安排",
        meta: `上次 ${lastMileage.toLocaleString("zh-TW")} km / 已跑 ${usedKm.toLocaleString("zh-TW")} km`
      };
    }
    return {
      status: "ok",
      value: "剩 " + (rule.intervalKm - usedKm).toLocaleString("zh-TW") + " km",
      meta: `上次 ${lastMileage.toLocaleString("zh-TW")} km / 已跑 ${usedKm.toLocaleString("zh-TW")} km`
    };
  }

  const latestDate = parseDate(latest.date);
  if (!latestDate) {
    return { status: "missing", value: "缺日期", meta: "最近紀錄缺少日期" };
  }
  const usedMonths = diffMonths(latestDate);
  const nextDate = addMonths(latestDate, rule.intervalMonths);
  const nextLabel = formatDateYMD(nextDate);
  if (usedMonths >= rule.dueMonths) {
    return {
      status: "due",
      value: "該處理",
      meta: `下一次約 ${nextLabel}`,
      next: `上次 ${latest.date.substring(0, 7)} / 已過 ${usedMonths} 個月`
    };
  }
  if (usedMonths >= rule.intervalMonths) {
    return {
      status: "soon",
      value: "可安排",
      meta: `下一次約 ${nextLabel}`,
      next: `上次 ${latest.date.substring(0, 7)} / 已過 ${usedMonths} 個月`
    };
  }
  return {
    status: "ok",
    value: "剩 " + (rule.intervalMonths - usedMonths) + " 個月",
    meta: `下一次約 ${nextLabel}`,
    next: `上次 ${latest.date.substring(0, 7)} / 已過 ${usedMonths} 個月`
  };
}

function getLastMaintenanceRecord() {
  return [...getServiceRecords()]
    .sort(compareRecordsNewestFirst)
    .find(r => r.category === "保養");
}

function getMaintenanceActionState() {
  const currentMileage = getEffectiveCurrentMileage();
  const latest = getLastMaintenanceRecord();
  if (!latest) {
    const baselineDate = getVehicleBaselineDate();
    const baselineMileage = getVehicleBaselineMileage();
    const usedKm = Math.max(currentMileage - baselineMileage, 0);
    const usedMonths = baselineDate ? diffMonths(baselineDate) : null;
    const nextMileage = baselineMileage + MAINTENANCE_INTERVAL_KM;
    const nextDate = baselineDate ? addMonths(baselineDate, MAINTENANCE_INTERVAL_MONTHS) : null;
    const metaParts = [
      "新車交車基準",
      "下次約 " + nextMileage.toLocaleString("zh-TW") + " km"
    ];
    if (nextDate) metaParts.push("或 " + formatDateYMD(nextDate));
    metaParts.push("已跑 " + usedKm.toLocaleString("zh-TW") + " km");
    if (usedMonths != null) metaParts.push("已過 " + usedMonths + " 個月");

    if (usedKm >= MAINTENANCE_DUE_KM || (usedMonths != null && usedMonths >= MAINTENANCE_DUE_MONTHS)) {
      return {
        status: "due",
        name: "安排首保/定期保養",
        statusText: "該保養",
        meta: metaParts.join(" / ")
      };
    }
    if (usedKm >= MAINTENANCE_INTERVAL_KM || (usedMonths != null && usedMonths >= MAINTENANCE_INTERVAL_MONTHS)) {
      return {
        status: "soon",
        name: "安排首保/定期保養",
        statusText: "可安排",
        meta: metaParts.join(" / ")
      };
    }
    return {
      status: "ok",
      name: "首保/定期保養",
      statusText: "正常",
      meta: metaParts.join(" / ")
    };
  }

  const lastMileage = Number(latest.mileage);
  const latestDate = parseDate(latest.date);
  const usedKm = Number.isFinite(lastMileage) && currentMileage
    ? Math.max(currentMileage - lastMileage, 0)
    : null;
  const usedMonths = latestDate ? diffMonths(latestDate) : null;
  const nextMileage = Number.isFinite(lastMileage) && lastMileage > 0
    ? lastMileage + MAINTENANCE_INTERVAL_KM
    : null;
  const nextDate = latestDate ? addMonths(latestDate, MAINTENANCE_INTERVAL_MONTHS) : null;
  const metaParts = [];
  if (nextMileage) metaParts.push("下次約 " + nextMileage.toLocaleString("zh-TW") + " km");
  if (nextDate) metaParts.push("或 " + formatDateYMD(nextDate));
  if (usedKm != null) metaParts.push("已跑 " + usedKm.toLocaleString("zh-TW") + " km");
  if (usedMonths != null) metaParts.push("已過 " + usedMonths + " 個月");

  if ((usedKm != null && usedKm >= MAINTENANCE_DUE_KM) || (usedMonths != null && usedMonths >= MAINTENANCE_DUE_MONTHS)) {
    return {
      status: "due",
      name: "安排定期保養",
      statusText: "該保養",
      meta: metaParts.join(" / ")
    };
  }
  if ((usedKm != null && usedKm >= MAINTENANCE_INTERVAL_KM) || (usedMonths != null && usedMonths >= MAINTENANCE_INTERVAL_MONTHS)) {
    return {
      status: "soon",
      name: "安排定期保養",
      statusText: "可安排",
      meta: metaParts.join(" / ")
    };
  }
  return {
    status: "ok",
    name: "定期保養",
    statusText: "正常",
    meta: metaParts.join(" / ") || "最近保養：" + (latest.date || "未填日期")
  };
}

function hasMatchingRecordInYear(terms, year) {
  return records.some(r => getYear(r.date) === String(year) && recordMatchesTerms(r, terms));
}

function getFixedCostState(item, today = new Date()) {
  const year = today.getFullYear();
  const paidThisYear = hasMatchingRecordInYear(item.terms, year);
  const dueStart = new Date(year, item.month - 1, item.startDay);
  const dueEnd = new Date(year, item.month - 1, item.endDay);
  const daysToStart = diffDays(dueStart, today);
  const daysToEnd = diffDays(dueEnd, today);
  const amountText = "NT$ " + item.amount.toLocaleString("zh-TW");

  if (paidThisYear) {
    const nextDueStart = today > dueEnd
      ? new Date(year + 1, item.month - 1, item.startDay)
      : dueStart;
    return {
      ...item,
      status: "ok",
      statusText: "已記錄",
      dueDate: nextDueStart,
      meta: `${year} 年已記錄，年度金額 ${amountText}`
    };
  }
  if (daysToStart <= 0 && daysToEnd >= 0) {
    return {
      ...item,
      status: "due",
      statusText: "本月繳納",
      dueDate: dueStart,
      meta: `${item.month}/${item.startDay}-${item.month}/${item.endDay}，預估 ${amountText}`
    };
  }
  if (daysToEnd < 0) {
    return {
      ...item,
      status: "due",
      statusText: "未記錄",
      dueDate: dueStart,
      meta: `${year} 年繳費期已過，若已繳請補登紀錄。`
    };
  }
  if (daysToStart <= 45) {
    return {
      ...item,
      status: "soon",
      statusText: "快到了",
      dueDate: dueStart,
      meta: `${item.month}/${item.startDay}-${item.month}/${item.endDay}，預估 ${amountText}`
    };
  }
  return {
    ...item,
    status: "ok",
    statusText: "未到期",
    dueDate: dueStart,
    meta: `${item.month}/${item.startDay}-${item.month}/${item.endDay}，預估 ${amountText}`
  };
}

function getNextLegalState() {
  const today = new Date();
  const states = FIXED_OWNER_COSTS.map(item => getFixedCostState(item, today));
  const actionable = states.find(state => state.status === "due" || state.status === "soon");
  if (actionable) return actionable;
  return [...states].sort((a, b) => a.dueDate - b.dueDate)[0] || null;
}

function getWarrantyState(today = new Date()) {
  const startDate = parseDate(WARRANTY_START_DATE);
  if (!startDate) return null;
  const endDate = addMonths(startDate, WARRANTY_MONTHS);
  const daysLeft = diffDays(endDate, today);
  if (daysLeft < 0) {
    return {
      status: "due",
      name: "確認保固權益",
      statusText: "已到期",
      dueDate: endDate,
      calendarType: "warranty",
      meta: `原廠/延長保固推估至 ${formatDateYMD(endDate)}，請依保固書確認。`
    };
  }
  if (daysLeft <= 90) {
    return {
      status: "soon",
      name: "保固到期前檢查",
      statusText: "快到期",
      dueDate: endDate,
      calendarType: "warranty",
      meta: `推估 ${formatDateYMD(endDate)} 到期，建議到期前安排健檢。`
    };
  }
  return {
    status: "ok",
    name: "保固期限",
    statusText: "有效",
    dueDate: endDate,
    calendarType: "warranty",
    meta: `推估至 ${formatDateYMD(endDate)}，仍建議以保固書為準。`
  };
}

function getMaintenanceCalendarSchedule() {
  const latest = getLastMaintenanceRecord();
  const baselineDate = latest ? parseDate(latest.date) : getVehicleBaselineDate();
  const baselineMileage = latest && Number.isFinite(Number(latest.mileage))
    ? Number(latest.mileage)
    : getVehicleBaselineMileage();
  return {
    dueDate: baselineDate ? addMonths(baselineDate, MAINTENANCE_INTERVAL_MONTHS) : null,
    dueMileage: Number.isFinite(baselineMileage) ? baselineMileage + MAINTENANCE_INTERVAL_KM : null,
    calendarType: "maintenance"
  };
}

function getTrackerCalendarSchedule(rule) {
  if (!rule.intervalMonths) return {};
  const latest = getLatestMatchingRecord(rule.terms);
  const baselineDate = latest ? parseDate(latest.date) : getVehicleBaselineDate();
  const firstDueDate = !latest && rule.firstDueMonths && parseDate(rule.firstDueFrom)
    ? addMonths(parseDate(rule.firstDueFrom), rule.firstDueMonths)
    : null;
  const dueDate = firstDueDate || (baselineDate ? addMonths(baselineDate, rule.intervalMonths) : null);
  return dueDate ? { dueDate, calendarType: "vehicle-reminder" } : {};
}

function getCalendarTask(action) {
  const dueDate = action?.dueDate instanceof Date ? action.dueDate : parseDate(action?.dueDate);
  if (!dueDate) return null;

  const date = formatDateYMD(dueDate);
  const description = Number.isFinite(action.dueMileage)
    ? `預計 ${date} 或 ${Number(action.dueMileage).toLocaleString("zh-TW")} 公里，以先到者為準`
    : action.meta || `預計日期 ${date}`;
  return {
    title: `Superb ${action.name}`,
    date,
    type: action.calendarType || "vehicle-reminder",
    description
  };
}

function openCalendarReminder(task, invoker = null) {
  if (!task) return;
  pendingCalendarTask = { ...task };
  calendarReminderInvoker = invoker || document.activeElement || null;
  document.getElementById("calendarReminderTitle").textContent = task.title;
  document.getElementById("calendarReminderDate").textContent = task.date;
  document.getElementById("calendarReminderCondition").textContent = task.description || "";
  document.getElementById("calendarReminderAlarms").textContent = "提醒：7 天前、1 天前";
  document.getElementById("calendarReminderModal").style.display = "flex";
  document.getElementById("calendarReminderConfirmBtn")?.focus();
}

function getModalFocusableElements(modal) {
  if (!modal?.querySelectorAll) return [];
  return [...modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(element => !element.disabled && !element.hidden && element.getAttribute?.("aria-hidden") !== "true");
}

function trapModalFocus(event, modal) {
  if (event.key !== "Tab") return;
  const focusable = getModalFocusableElements(modal);
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const current = document.activeElement;
  if (event.shiftKey && (current === first || !focusable.includes(current))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (current === last || !focusable.includes(current))) {
    event.preventDefault();
    first.focus();
  }
}

function closeCalendarReminder() {
  document.getElementById("calendarReminderModal").style.display = "none";
  pendingCalendarTask = null;
  if (calendarReminderInvoker?.focus) calendarReminderInvoker.focus();
  calendarReminderInvoker = null;
}

function getCalendarFilename(task) {
  const safeTitle = String(task?.title || "Superb-車輛提醒")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${task.date}-${safeTitle || "Superb-車輛提醒"}.ics`;
}

function downloadCalendarReminder() {
  if (!pendingCalendarTask) return false;

  const task = { ...pendingCalendarTask };
  let objectUrl = "";
  try {
    const blob = new Blob([buildCalendarFile(task)], { type: "text/calendar;charset=utf-8" });
    objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = getCalendarFilename(task);
    anchor.click();
    closeCalendarReminder();
    showToast("已建立行事曆檔；若未自動開啟，請從下載項目開啟");
    return true;
  } catch (error) {
    showToast("行事曆檔建立失敗，請稍後重試");
    return false;
  } finally {
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

function getDataHealthText() {
  const checks = [
    getCurrentMileage() > 0 || Number.isFinite(getVehicleBaselineMileage()),
    !!getLastMaintenanceRecord() || !!getVehicleBaselineDate(),
    getFuelLogs().length > 0,
    !!getLatestMatchingRecord(["保險", "強制險", "任意險"]),
    !!getLatestMatchingRecord(["牌照稅", "燃料稅", "燃料費", "汽燃費", "公路養管費"])
  ];
  const done = checks.filter(Boolean).length;
  return `${done}/${checks.length} 項`;
}

function buildOwnerActions() {
  const actions = [];
  const currentMileage = getCurrentMileage();
  const maintenance = { ...getMaintenanceActionState(), ...getMaintenanceCalendarSchedule() };
  const warranty = getWarrantyState();
  const fuelStats = getFuelStats();

  if (!currentMileage) {
    actions.push({
      status: "info",
      name: "更新目前里程",
      statusText: "建議",
      meta: "里程是保養、耗材與油耗追蹤的基準。",
      action: "mileage",
      actionLabel: "更新里程"
    });
  }
  actions.push(maintenance);

  CONSUMABLE_RULES
    .map(rule => ({ rule, state: buildTrackerState(rule) }))
    .filter(({ state }) => state.status === "due" || state.status === "soon" || state.status === "missing")
    .forEach(({ rule, state }) => {
      actions.push({
        status: state.status,
        name: rule.name,
        statusText: state.value,
        meta: [state.meta, state.next].filter(Boolean).join(" / "),
        ...getTrackerCalendarSchedule(rule)
      });
    });

  FIXED_OWNER_COSTS
    .map(item => getFixedCostState(item))
    .filter(state => state.status === "due" || state.status === "soon")
    .forEach(state => {
      actions.push({
        status: state.status,
        name: state.name,
        statusText: state.statusText,
        meta: state.meta,
        dueDate: state.dueDate,
        calendarType: "legal"
      });
    });

  if (warranty && warranty.status !== "ok") actions.push(warranty);
  if (!fuelStats.logs.length) {
    actions.push({
      status: "info",
      name: "建立第一筆加油紀錄",
      statusText: "油耗基準",
      meta: "連續兩次加滿後會開始計算平均與最近油耗。",
      action: "fuel",
      actionLabel: "新增加油"
    });
  }

  const rank = { due: 0, soon: 1, missing: 2, info: 3, ok: 4 };
  actions.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));

  if (!actions.some(action => action.status !== "ok")) {
    const nextLegal = getNextLegalState();
    return [
      {
        ...maintenance,
        name: "下次定期保養"
      },
      nextLegal ? {
        status: nextLegal.status,
        name: nextLegal.name,
        statusText: nextLegal.statusText,
        meta: nextLegal.meta
      } : null,
      warranty
    ].filter(Boolean);
  }

  return actions.slice(0, 6);
}

function renderOwnerDashboard() {
  const title = document.getElementById("ownerPriorityTitle");
  const meta = document.getElementById("ownerPriorityMeta");
  const fixedCost = document.getElementById("ownerFixedCost");
  const nextLegalEl = document.getElementById("ownerNextLegal");
  const dataHealth = document.getElementById("ownerDataHealth");
  const list = document.getElementById("ownerActionList");
  if (!title || !meta || !fixedCost || !nextLegalEl || !dataHealth || !list) return;

  const actions = buildOwnerActions().slice(0, 3);
  const urgentCount = actions.filter(action => action.status === "due").length;
  const soonCount = actions.filter(action => action.status === "soon").length;
  const missingCount = actions.filter(action => action.status === "missing").length;
  const infoCount = actions.filter(action => action.status === "info").length;
  const nextLegal = getNextLegalState();
  const annualFixedCost = FIXED_OWNER_COSTS.reduce((sum, item) => sum + item.amount, 0);

  title.textContent = urgentCount
    ? `${urgentCount} 項需要處理`
    : soonCount
      ? `${soonCount} 項近期可安排`
      : missingCount
        ? `${missingCount} 項資料待補齊`
        : infoCount
          ? `${infoCount} 項建議補登`
          : "車況追蹤正常";
  meta.textContent = `${VEHICLE_PROFILE.name}，${VEHICLE_PROFILE.displacementCc} c.c. ${VEHICLE_PROFILE.fuel}；依目前紀錄排序下一步。`;
  fixedCost.textContent = "約 NT$ " + annualFixedCost.toLocaleString("zh-TW");
  nextLegalEl.textContent = nextLegal ? `${nextLegal.name} ${formatDateYMD(nextLegal.dueDate)}` : "—";
  dataHealth.textContent = getDataHealthText();

  renderedOwnerActions = actions;
  list.innerHTML = actions.map((action, index) => {
    const calendarTask = getCalendarTask(action);
    return `
    <div class="owner-action owner-action-${escapeHtml(action.status)}">
      <div class="owner-action-top">
        <div class="owner-action-name">${escapeHtml(action.name)}</div>
        <div class="owner-action-control">
          <div class="owner-action-status">${escapeHtml(action.statusText)}</div>
          ${action.action ? `<button class="btn btn-ghost btn-sm" type="button" data-owner-action="${escapeHtml(action.action)}">${escapeHtml(action.actionLabel)}</button>` : ""}
          ${calendarTask ? `<button class="btn btn-ghost btn-sm calendar-action" type="button" data-calendar-task="${index}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M8 3v4M16 3v4M3 10h18"></path></svg><span>加入行事曆</span></button>` : ""}
        </div>
      </div>
      <div class="owner-action-meta">${escapeHtml(action.meta || "")}</div>
    </div>
  `;
  }).join("");

  list.querySelectorAll("[data-owner-action]").forEach(button => {
    button.addEventListener("click", () => runOwnerAction(button.dataset.ownerAction));
  });
  list.querySelectorAll("[data-calendar-task]").forEach(button => {
    button.addEventListener("click", () => {
      const action = renderedOwnerActions[Number(button.dataset.calendarTask)];
      openCalendarReminder(getCalendarTask(action), button);
    });
  });
}

function renderOverviewRecentRecords() {
  const container = document.getElementById("overviewRecentRecords");
  if (!container) return;

  const recent = [...records].sort(compareRecordsNewestFirst).slice(0, 3);
  container.innerHTML = recent.length ? recent.map(record => `
    <button class="overview-record" type="button" data-overview-record-index="${records.indexOf(record)}">
      <span>
        <strong>${escapeHtml(isMileageUpdateRecord(record) ? "里程狀態" : (record.category || "其他"))}</strong>
        <small>${escapeHtml(record.detail || "未填詳細內容")}</small>
      </span>
      <span>${escapeHtml(record.date || "未填日期")}</span>
    </button>
  `).join("") : `<div class="empty-compact">尚無紀錄，先新增第一筆資料。</div>`;

  container.querySelectorAll("[data-overview-record-index]").forEach(button => {
    button.addEventListener("click", () => openEditModal(Number(button.dataset.overviewRecordIndex)));
  });
}

function runOwnerAction(action) {
  if (action === "mileage") {
    openMileageModal();
  } else if (action === "fuel") {
    setActiveView("records");
    openFuelLogModal();
  }
}

const OWNERSHIP_CATEGORY_BUCKETS = Object.freeze({
  保養: "service",
  維修: "service",
  更換: "service",
  加油: "fuel",
  保險: "legal",
  "檢驗/稅費": "legal",
  改裝升級: "accessory"
});

function getOwnershipCostBucketKey(record, buckets) {
  const explicitKey = OWNERSHIP_CATEGORY_BUCKETS[record.category];
  if (explicitKey) return explicitKey;

  const text = `${record.category || ""} ${record.detail || ""} ${record.note || ""}`;
  const inferred = buckets.find(item =>
    item.key !== "other" && item.terms.some(term => text.includes(term))
  );
  return inferred ? inferred.key : "other";
}

function getOwnershipCostBuckets() {
  const buckets = [
    {
      key: "service",
      name: "保養維修",
      terms: ["保養", "維修", "更換", "機油", "輪胎", "電瓶", "煞車", "變速箱", "濾網"],
      total: 0
    },
    {
      key: "fuel",
      name: "燃料加油",
      terms: ["加油", "油費", "汽油"],
      total: 0
    },
    {
      key: "legal",
      name: "保險稅費",
      terms: ["保險", "強制險", "任意險", "牌照稅", "燃料稅", "燃料費", "汽燃費", "公路養管費", "驗車", "檢驗"],
      total: 0
    },
    {
      key: "accessory",
      name: "配件改裝",
      terms: ["改裝", "升級", "隔熱紙", "行車記錄器", "車標", "配件"],
      total: 0
    },
    {
      key: "other",
      name: "其他",
      terms: [],
      total: 0
    }
  ];

  getCostRecords().forEach(record => {
    const bucketKey = getOwnershipCostBucketKey(record, buckets);
    const bucket = buckets.find(item => item.key === bucketKey) || buckets[buckets.length - 1];
    bucket.total += asNumber(record.cost);
  });

  return buckets;
}

function getOwnershipMonths() {
  const start = parseDate(VEHICLE_DELIVERY_DATE);
  if (!start) return 1;
  return Math.max(1, diffMonths(start) + 1);
}
function getOwnershipPeriodLabel() {
  return `交車第 ${getOwnershipMonths()} 個月`;
}

function renderOwnershipCostPanel() {
  const summary = document.getElementById("ownershipSummary");
  const grid = document.getElementById("ownershipCostGrid");
  if (!summary || !grid) return;

  const buckets = getOwnershipCostBuckets();
  const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
  const currentMileage = getCurrentMileage();
  const monthlyAverage = total / getOwnershipMonths();
  const costPerKm = currentMileage > 0 && total > 0 ? total / currentMileage : null;

  if (!total) {
    summary.textContent = "尚無費用資料";
    grid.innerHTML = "";
    return;
  }

  summary.textContent = [
    getOwnershipPeriodLabel(),
    `累計 ${formatCost(total)}`,
    `月均 ${formatCompactCurrency(Math.round(monthlyAverage))}`,
    costPerKm ? `${currentMileage < 1000 ? "每公里暫估" : "每公里"} NT$ ${costPerKm.toFixed(1)}` : "每公里待里程"
  ].join(" · ");

  grid.innerHTML = buckets.map(bucket => {
    const share = total ? Math.round((bucket.total / total) * 100) : 0;
    return `
      <div class="ownership-item">
        <div class="ownership-item-name">${escapeHtml(bucket.name)}</div>
        <div class="ownership-item-value">${formatCompactCurrency(bucket.total)}</div>
        <div class="ownership-item-share">${share}%</div>
      </div>
    `;
  }).join("");
}

function renderDataQualityPanel() {
  const panel = document.getElementById("dataQualityPanel");
  if (!panel) return;
  const issues = getDataQualityIssues().sort((a, b) => b.date.localeCompare(a.date));
  const summary = issues.length ? `${issues.length} 項待確認` : "未發現明顯異常";
  const content = issues.length
    ? `<div class="data-quality-list">${issues.map(issue => `
        <div class="data-quality-item">
          <strong>${escapeHtml(issue.title)}</strong>
          <span>${escapeHtml(issue.detail)}</span>
        </div>
      `).join("")}</div>`
    : `<div class="data-quality-empty">目前的日期、里程與加滿油耗區間沒有明顯異常。</div>`;

  panel.innerHTML = `
    <div class="data-quality-header">
      <h2 class="data-quality-title">資料檢查</h2>
      <div class="data-quality-summary">${escapeHtml(summary)}</div>
    </div>
    ${content}
  `;
}

function renderConsumableTrackers() {
  const container = document.getElementById("consumableTrackers");
  if (!container) return;
  container.innerHTML = CONSUMABLE_RULES.map(rule => {
    const state = buildTrackerState(rule);
    return `
      <div class="tracker-card tracker-${state.status}">
        <div class="tracker-head">
          <div class="tracker-name">${rule.icon} ${escapeHtml(rule.name)}</div>
        </div>
        <div class="tracker-value">${escapeHtml(state.value)}</div>
        <div class="tracker-meta">${escapeHtml(state.meta)}</div>
        ${state.next ? `<div class="tracker-next">${escapeHtml(state.next)}</div>` : ""}
      </div>`;
  }).join("");
}

// ============================================================
// 年份篩選 Select
// ============================================================
function populateYearFilter() {
  const years = [...new Set(records.map(r => getYear(r.date)).filter(Boolean))].sort((a,b)=>b-a);
  const sel = document.getElementById("yearFilter");
  sel.innerHTML = "<option value=\"\">所有年份</option>";
  years.forEach(y => {
    const opt = document.createElement("option");
    opt.value = y; opt.textContent = y + " 年";
    sel.appendChild(opt);
  });
  if (currentYear && !years.includes(currentYear)) currentYear = "";
  sel.value = currentYear;
}

function updateFilterPills() {
  const serviceRecords = getServiceRecords();
  const counts = serviceRecords.reduce((map, r) => {
    map[r.category] = (map[r.category] || 0) + 1;
    return map;
  }, {});

  document.querySelectorAll("#filterPills .pill").forEach(btn => {
    const cat = btn.dataset.cat;
    const count = cat === "全部" ? serviceRecords.length : (counts[cat] || 0);
    btn.innerHTML = `${escapeHtml(cat)}<span class="pill-count">${count}</span>`;
  });
}

function updateFilterSummary(filtered) {
  const el = document.getElementById("filterSummary");
  if (!el) return;
  if (activeRecordsSubtab === "mileage") {
    const scopeParts = [];
    if (currentYear) scopeParts.push(currentYear + " 年");
    if (currentSearch) scopeParts.push("搜尋「" + currentSearch + "」");
    const scope = scopeParts.length ? "（" + scopeParts.join(" / ") + "）" : "";
    el.textContent = `顯示 ${filtered.length} 筆里程紀錄${scope}`;
    return;
  }
  const filteredServiceRecords = filtered.filter(r => !isMileageUpdateRecord(r));
  const total = filteredServiceRecords.reduce((sum, r) => sum + asNumber(r.cost), 0);
  const parts = [];
  if (currentFilter !== "全部") parts.push(currentFilter);
  if (currentYear) parts.push(currentYear + " 年");
  if (currentSearch) parts.push("搜尋「" + currentSearch + "」");

  const scope = parts.length ? "（" + parts.join(" / ") + "）" : "";
  const statusCount = filtered.length - filteredServiceRecords.length;
  const statusText = statusCount ? `，另有 ${statusCount} 筆里程狀態` : "";
  el.textContent = `顯示 ${filteredServiceRecords.length} / ${getServiceRecords().length} 筆${scope}${statusText}，合計 ${formatCost(total)}`;
}

// ============================================================
// 圖表
// ============================================================
function buildCharts() {
  if (typeof Chart === "undefined") return;
  buildCostChart();
  buildCategoryChart();
}

function buildCostChart() {
  // 按年度加總費用
  const yearMap = {};
  getServiceRecords().forEach(r => {
    const y = getYear(r.date);
    if (!y) return;
    yearMap[y] = (yearMap[y] || 0) + asNumber(r.cost);
  });
  const years = Object.keys(yearMap).sort();
  const vals  = years.map(y => yearMap[y]);

  const canvas = document.getElementById("costChart");
  if (costChart) { costChart.destroy(); costChart = null; }

  costChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: years,
      datasets: [{
        label: "年度費用 (NT$)",
        data: vals,
        backgroundColor: "rgba(88,166,255,0.65)",
        borderColor: "rgba(88,166,255,1)",
        borderWidth: 2,
        borderRadius: 6,
        hoverBackgroundColor: "rgba(121,184,255,0.85)"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: "easeOutQuart" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1c2333",
          borderColor: "#30363d",
          borderWidth: 1,
          titleColor: "#e6edf3",
          bodyColor: "#8b949e",
          callbacks: {
            label: ctx => "  NT$ " + ctx.raw.toLocaleString("zh-TW")
          }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(48,54,61,0.5)" },
          ticks: { color: "#8b949e", font: { size: 11 } }
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(48,54,61,0.5)" },
          ticks: {
            color: "#8b949e",
            font: { size: 11 },
            callback: v => {
              if (v >= 10000) return (v/10000).toFixed(0) + "萬";
              return v.toLocaleString();
            }
          }
        }
      }
    }
  });
}

function buildCategoryChart() {
  const catColors = {
    保養: "#3fb950", 維修: "#f85149", 更換: "#58a6ff",
    加油: "#f0883e", 保險: "#059669", "檢驗/稅費": "#d29922",
    清潔美容: "#db2777", 改裝升級: "#bc8cff", 其他: "#484f58"
  };
  const catMap = {};
  getServiceRecords().forEach(r => {
    const cost = asNumber(r.cost);
    if (!cost) return;
    catMap[r.category] = (catMap[r.category] || 0) + cost;
  });
  const cats = Object.keys(catMap);
  const vals  = cats.map(c => catMap[c]);
  const colors = cats.map(c => catColors[c] || "#484f58");

  const ctx = document.getElementById("categoryChart").getContext("2d");
  if (catChart) catChart.destroy();

  catChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: cats,
      datasets: [{
        data: vals,
        backgroundColor: colors.map(c => c + "cc"),
        borderColor: colors,
        borderWidth: 2,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "60%",
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#8b949e", font: { size: 11 }, padding: 12 }
        },
        tooltip: {
          backgroundColor: "#1c2333",
          borderColor: "#30363d",
          borderWidth: 1,
          titleColor: "#e6edf3",
          bodyColor: "#8b949e",
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a,b)=>a+b,0);
              const pct = ((ctx.raw/total)*100).toFixed(1);
              return "NT$ " + ctx.raw.toLocaleString("zh-TW") + " (" + pct + "%)";
            }
          }
        }
      }
    }
  });
}

// ============================================================
// 渲染紀錄列表
// ============================================================
function getFilteredRecords() {
  let list = [...records];

  if (activeRecordsSubtab === "mileage") {
    list = list.filter(isMileageUpdateRecord);
  }

  // 類別篩選
  if (currentFilter !== "全部") {
    list = list.filter(r => r.category === currentFilter);
  }
  // 年份篩選
  if (currentYear) {
    list = list.filter(r => getYear(r.date) === currentYear);
  }
  // 文字搜尋
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    list = list.filter(r =>
      (r.detail || "").toLowerCase().includes(q) ||
      (r.note   || "").toLowerCase().includes(q) ||
      (r.category || "").toLowerCase().includes(q) ||
      (r.date || "").includes(q)
    );
  }

  // 日期排序：新到舊
  list.sort(compareRecordsNewestFirst);
  return list;
}

function renderRecords() {
  const container = document.getElementById("recordsContainer");
  const emptyState = document.getElementById("emptyState");
  const filtered = getFilteredRecords();
  updateFilterSummary(filtered);

  if (filtered.length === 0) {
    container.innerHTML = "";
    emptyState.style.display = "block";
    return;
  }
  emptyState.style.display = "none";

  // 標題列
  let html = `<div class="records-header">
    <span>日期</span>
    <span style="text-align:right">里程</span>
    <span>類別</span>
    <span>詳細內容</span>
    <span style="text-align:right">費用</span>
    <span style="text-align:right">操作</span>
  </div>`;

  filtered.forEach(r => {
    // 在原始 records 中找出真實 index
    const origIdx = records.indexOf(r);
    const isStatus = isMileageUpdateRecord(r);
    const year = getYear(r.date);
    const monthDay = r.date ? r.date.substring(5) : "";
    const emoji = getCategoryEmoji(r.category);
    const safeCategory = escapeHtml(isStatus ? "里程狀態" : r.category);
    const badgeClass = isStatus ? "badge-status" : getCategoryBadgeClass(r.category);
    const mileageValue = asNumber(r.mileage);
    const costValue = asNumber(r.cost);
    const compactDate = r.date || "未填日期";
    const compactMileage = mileageValue ? mileageValue.toLocaleString("zh-TW") + " km" : "未填里程";
    const compactCost = costValue ? "NT$ " + costValue.toLocaleString("zh-TW") : "—";
    const safeDetail = r.detail ? escapeHtml(r.detail) : "—";
    const noteHtml = r.note ? `<div class="record-note">📝 ${escapeHtml(r.note)}</div>` : "";
    const mobileNoteHtml = r.note ? `<div class="record-mobile-meta">${compactMileage} · ${escapeHtml(r.note)}</div>` : `<div class="record-mobile-meta">${compactMileage}</div>`;

    html += `
    <div class="record-item ${isStatus ? "record-status" : ""}" data-idx="${origIdx}">
      <div class="record-mobile-summary">
        <div class="record-mobile-main">
          <span class="record-mobile-date">${escapeHtml(compactDate)}</span>
          <span class="record-badge ${badgeClass}">${isStatus ? "📍" : emoji} ${safeCategory}</span>
        </div>
        <div class="record-mobile-cost ${costValue ? "" : "cost-zero"}">${compactCost}</div>
        <div class="record-mobile-detail">${safeDetail}${mobileNoteHtml}</div>
      </div>
      <div class="record-date record-field">
        <span class="mobile-label">日期</span>
        <span class="field-value"><strong>${monthDay}</strong>${year}</span>
      </div>
      <div class="record-mileage record-field">
        <span class="mobile-label">里程</span>
        <span class="field-value"><strong>${mileageValue ? mileageValue.toLocaleString("zh-TW") : "—"}</strong>${mileageValue ? "km" : ""}</span>
      </div>
      <div class="record-field record-category">
        <span class="mobile-label">類別</span>
        <span class="record-badge ${badgeClass}">${isStatus ? "📍" : emoji} ${safeCategory}</span>
      </div>
      <div class="record-detail record-field">
        <span class="mobile-label">詳細內容</span>
        <span class="field-value">${safeDetail}${noteHtml}</span>
      </div>
      <div class="record-cost record-field ${costValue ? "" : "cost-zero"}">
        <span class="mobile-label">費用</span>
        <span class="field-value">${costValue ? "NT$ " + costValue.toLocaleString("zh-TW") : "—"}</span>
      </div>
      <div class="record-actions">
        <button class="btn btn-ghost btn-sm edit-btn" data-idx="${origIdx}" title="編輯" aria-label="編輯">✏️</button>
        <button class="btn btn-ghost btn-sm delete-btn" data-idx="${origIdx}" title="刪除" aria-label="刪除">🗑️</button>
      </div>
    </div>`;
  });

  container.innerHTML = html;

  // 綁定編輯/刪除按鈕
  container.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      openEditModal(parseInt(btn.dataset.idx));
    });
  });
  container.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      openDeleteModal(parseInt(btn.dataset.idx));
    });
  });
}

// ============================================================
// 新增/編輯 Modal
// ============================================================
function showFormMessage(type, text) {
  const el = document.getElementById("formMessage");
  el.className = "form-message form-message-" + type;
  el.textContent = text;
}

function clearFormMessage() {
  const el = document.getElementById("formMessage");
  el.className = "form-message";
  el.textContent = "";
  const saveBtn = document.querySelector("#recordForm button[type='submit']");
  if (saveBtn) delete saveBtn.dataset.confirmedMileage;
}

function updateMileageHint(idx = parseInt(document.getElementById("editIndex").value)) {
  const maxMileage = getMaxMileage(idx);
  const el = document.getElementById("mileageHint");
  el.textContent = maxMileage > 0
    ? "目前最高里程 " + maxMileage.toLocaleString("zh-TW") + " km；補登舊資料可低於此數值。"
    : "";
}

function applyRecordTemplate(key) {
  const template = RECORD_TEMPLATES[key];
  if (!template) return;
  document.getElementById("formCategory").value = template.category;
  document.getElementById("formDetail").value = template.detail;
  if (!document.getElementById("formNote").value.trim()) {
    document.getElementById("formNote").value = template.note;
  }
  clearFormMessage();
}

function openAddModal() {
  document.getElementById("modalTitle").textContent = "新增保養/維修紀錄";
  document.getElementById("editIndex").value = "-1";
  document.getElementById("recordForm").reset();
  document.getElementById("formDate").value = getTodayString();
  clearFormMessage();
  updateMileageHint(-1);
  document.getElementById("modal").style.display = "flex";
}

function openEditModal(idx) {
  const r = records[idx];
  if (isFuelLogRecord(r)) {
    openFuelLogModal({ editIndex: idx });
    return;
  }
  document.getElementById("modalTitle").textContent = "編輯紀錄";
  document.getElementById("editIndex").value = idx;
  document.getElementById("formDate").value = r.date || "";
  document.getElementById("formMileage").value = r.mileage || "";
  document.getElementById("formCategory").value = r.category || "";
  document.getElementById("formCost").value = r.cost || "";
  document.getElementById("formTemplate").value = "";
  document.getElementById("formDetail").value = r.detail || "";
  document.getElementById("formNote").value = r.note || "";
  clearFormMessage();
  updateMileageHint(idx);
  document.getElementById("modal").style.display = "flex";
}

function closeModal() {
  document.getElementById("modal").style.display = "none";
  clearFormMessage();
}

function showMileageMessage(type, text) {
  const el = document.getElementById("mileageMessage");
  el.className = "form-message form-message-" + type;
  el.textContent = text;
}

function clearMileageMessage() {
  const el = document.getElementById("mileageMessage");
  el.className = "form-message";
  el.textContent = "";
}

function showFuelMessage(type, text) {
  const el = document.getElementById("fuelMessage");
  el.className = "form-message form-message-" + type;
  el.textContent = text;
}

function clearFuelMessage() {
  const el = document.getElementById("fuelMessage");
  el.className = "form-message";
  el.textContent = "";
}

function showFuelLogMessage(type, text) {
  const el = document.getElementById("fuelLogMessage");
  el.className = "form-message form-message-" + type;
  el.textContent = text;
}

function clearFuelLogMessage() {
  const el = document.getElementById("fuelLogMessage");
  el.className = "form-message";
  el.textContent = "";
  const saveBtn = document.querySelector("#fuelLogForm button[type='submit']");
  if (saveBtn) delete saveBtn.dataset.confirmedMileage;
}

function showPhotoMessage(type, text) {
  const el = document.getElementById("photoMessage");
  el.className = "form-message form-message-" + type;
  el.textContent = text;
}

function clearPhotoMessage() {
  const el = document.getElementById("photoMessage");
  el.className = "form-message";
  el.textContent = "";
}

function showAiMessage(type, text) {
  const el = document.getElementById("aiMessage");
  el.className = "form-message form-message-" + type;
  el.textContent = text;
}

function clearAiMessage() {
  const el = document.getElementById("aiMessage");
  el.className = "form-message";
  el.textContent = "";
}

function renderAiResultNote(text) {
  const el = document.getElementById("aiResultNote");
  if (!text) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }
  el.innerHTML = text;
  el.style.display = "block";
}

function setFuelPriceStatus(text) {
  const el = document.getElementById("fuelLogPriceStatus");
  if (el) el.textContent = text || "";
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function repairMojibake(value) {
  const text = String(value || "");
  if (!/[ÂÃÄÅÆÇÈÉÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèé]/.test(text)) return text;
  if (typeof TextDecoder === "undefined") return text;
  try {
    const bytes = Uint8Array.from([...text], ch => ch.charCodeAt(0) & 255);
    const repaired = new TextDecoder("utf-8").decode(bytes);
    return repaired.includes("油價") || repaired.includes("無鉛汽油") ? repaired : text;
  } catch {
    return text;
  }
}

function normalizeFuelPricePage(html) {
  return repairMojibake(decodeHtmlEntities(html))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFuelPriceValue(value) {
  if (value === "" || value == null) return NaN;
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : NaN;
}

function parseFuelPricePage(html) {
  const text = normalizeFuelPricePage(html);
  const readPrice = pattern => {
    const match = text.match(pattern);
    return match ? parseFloat(match[1]) : null;
  };
  const effectiveMatch = text.match(/零售參考價\s*([^，。]+?)\s*實行/);
  return {
    source: "全國加油站",
    effectiveAt: effectiveMatch ? effectiveMatch[1].trim() : "",
    prices: {
      "92": readPrice(/92無鉛汽油\s*([0-9]+(?:\.[0-9]+)?)\s*元/),
      "95": readPrice(/95\+?無鉛汽油\s*([0-9]+(?:\.[0-9]+)?)\s*元/),
      "98": readPrice(/98無鉛汽油\s*([0-9]+(?:\.[0-9]+)?)\s*元/)
    }
  };
}

function getFuelPriceCache({ allowStale = false } = {}) {
  try {
    const cached = JSON.parse(localStorage.getItem(FUEL_PRICE_CACHE_KEY) || "null");
    const data = normalizeFuelPriceData(cached);
    if (!data) return null;
    const cachedAt = Date.parse(cached.cachedAt || "");
    const isFresh = Number.isFinite(cachedAt) && (Date.now() - cachedAt) <= FUEL_PRICE_CACHE_MAX_AGE_MS;
    return allowStale || isFresh ? data : null;
  } catch {
    return null;
  }
}

function saveFuelPriceCache(data) {
  localStorage.setItem(FUEL_PRICE_CACHE_KEY, JSON.stringify({
    ...data,
    cachedAt: new Date().toISOString()
  }));
}

async function fetchTextWithTimeout(url, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeFuelPriceData(data) {
  if (!data || Array.isArray(data) || !data.prices) return null;
  const prices = {
    "92": parseFuelPriceValue(data.prices["92"]),
    "95": parseFuelPriceValue(data.prices["95"]),
    "98": parseFuelPriceValue(data.prices["98"])
  };
  if (!Number.isFinite(prices["98"]) && !Number.isFinite(prices["95"]) && !Number.isFinite(prices["92"])) return null;
  return {
    source: data.source || "油價來源",
    effectiveAt: data.effectiveAt || data.updatedAt || "",
    cachedAt: data.cachedAt || "",
    prices
  };
}

async function fetchCurrentFuelPrices() {
  let lastError = null;
  const strategies = [
    async () => {
      const text = await fetchTextWithTimeout(API_URL + "?action=fuelPrice", 6500);
      const data = normalizeFuelPriceData(JSON.parse(text));
      if (!data) throw new Error("Apps Script fuel price proxy is not enabled");
      return data;
    },
    async () => parseFuelPricePage(await fetchTextWithTimeout(FUEL_PRICE_SOURCE_URL, 6500)),
    async () => {
      const text = await fetchTextWithTimeout(
        "https://api.allorigins.win/get?url=" + encodeURIComponent(FUEL_PRICE_SOURCE_URL),
        9000
      );
      const json = JSON.parse(text);
      return parseFuelPricePage(json.contents || "");
    },
    async () => parseFuelPricePage(await fetchTextWithTimeout(
      "https://api.allorigins.win/raw?url=" + encodeURIComponent(FUEL_PRICE_SOURCE_URL),
      9000
    ))
  ];

  for (const strategy of strategies) {
    try {
      const data = normalizeFuelPriceData(await strategy());
      if (data) {
        saveFuelPriceCache(data);
        return data;
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Fuel price unavailable");
}

function getLatestRecordedFuelPrice(fuelType) {
  return getFuelLogs()
    .filter(log => log.fuelType === fuelType && Number.isFinite(log.unitPrice))
    .sort(compareFuelLogsNewestFirst)[0]?.unitPrice || null;
}

async function loadFuelPriceForSelectedType({ force = false } = {}) {
  const typeInput = document.getElementById("fuelLogTypeInput");
  const priceInput = document.getElementById("fuelLogUnitPriceInput");
  if (!typeInput || !priceInput) return;

  const fuelType = typeInput.value;
  if (fuelType === "其他") {
    setFuelPriceStatus("其他油品請手動輸入牌告油價。");
    return;
  }
  if (priceInput.value && !force) return;

  setFuelPriceStatus(`正在抓取全國加油站 ${fuelType} 今日牌價...`);
  let staleCached = null;
  try {
    const data = await fetchCurrentFuelPrices();
    const price = data.prices[fuelType];
    if (Number.isFinite(price)) {
      priceInput.value = price.toFixed(1);
      setFuelPriceStatus(`已抓取 ${data.source} ${fuelType} 牌價 ${price.toFixed(1)} 元/L${data.effectiveAt ? "，" + data.effectiveAt + " 實行" : ""}。`);
      updateFuelLogCostFromDiscount();
      return;
    }
  } catch {
    const cached = getFuelPriceCache();
    const cachedPrice = cached?.prices?.[fuelType];
    if (Number.isFinite(cachedPrice)) {
      priceInput.value = cachedPrice.toFixed(1);
      setFuelPriceStatus(`無法更新即時油價，先使用上次抓到的 ${fuelType} 牌價 ${cachedPrice.toFixed(1)} 元/L。`);
      updateFuelLogCostFromDiscount();
      return;
    }
    staleCached = getFuelPriceCache({ allowStale: true });
  }

  const staleCachedPrice = staleCached?.prices?.[fuelType];
  if (Number.isFinite(staleCachedPrice)) {
    setFuelPriceStatus(`無法更新今日油價；上次快取的 ${fuelType} 牌價為 ${staleCachedPrice.toFixed(1)} 元/L，已過期所以未自動套用。`);
    return;
  }

  const latestRecorded = getLatestRecordedFuelPrice(fuelType);
  if (Number.isFinite(latestRecorded)) {
    setFuelPriceStatus(`無法抓取今日油價；最近紀錄的 ${fuelType} 牌價為 ${latestRecorded.toFixed(1)} 元/L，為避免誤用舊油價，請確認後手動輸入。`);
    return;
  }
  setFuelPriceStatus("暫時抓不到今日油價，請手動輸入牌告油價。");
}

function getFuelLogCalculatedCost() {
  const liters = parseDecimalInput(document.getElementById("fuelLogLitersInput").value);
  const unitPrice = parseDecimalInput(document.getElementById("fuelLogUnitPriceInput").value);
  const discount = parseDecimalInput(document.getElementById("fuelLogDiscountInput").value) || 0;
  if (!Number.isFinite(liters) || liters <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  return {
    unitPrice,
    discount,
    netPrice: Math.max(unitPrice - discount, 0),
    total: Math.round(liters * Math.max(unitPrice - discount, 0))
  };
}

function getFuelLogInferredLiters() {
  const cost = parseDecimalInput(document.getElementById("fuelLogCostInput").value);
  const unitPrice = parseDecimalInput(document.getElementById("fuelLogUnitPriceInput").value);
  const discount = parseDecimalInput(document.getElementById("fuelLogDiscountInput").value) || 0;
  const netPrice = Number.isFinite(unitPrice) ? Math.max(unitPrice - discount, 0) : 0;
  if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0 || netPrice <= 0) {
    return null;
  }
  return {
    liters: cost / netPrice,
    unitPrice,
    discount,
    netPrice,
    total: Math.round(cost)
  };
}

function updateFuelLogCostFromDiscount(options = {}) {
  const preserveCostInput = Boolean(options.preserveCostInput);
  const calc = getFuelLogCalculatedCost();
  const costInput = document.getElementById("fuelLogCostInput");
  const hint = document.getElementById("fuelLogNetPriceHint");
  if (calc) {
    if (!preserveCostInput) {
      costInput.value = calc.total;
    }
    hint.textContent =
      "實付單價 " + calc.netPrice.toFixed(1) +
      " 元/L，預估油費 NT$ " + calc.total.toLocaleString("zh-TW") +
      "；若發票金額不同可直接修改。";
    return;
  }

  const inferred = getFuelLogInferredLiters();
  if (inferred) {
    hint.textContent =
      "實付單價 " + inferred.netPrice.toFixed(1) +
      " 元/L，會依油費 NT$ " + inferred.total.toLocaleString("zh-TW") +
      " 反推約 " + inferred.liters.toFixed(2) + " L。";
    return;
  }

  hint.textContent = "輸入加油量與油價會自動試算；若忘記公升數，可填油費與油價反推。";
}

function openMileageModal() {
  const currentMileage = getCurrentMileage();
  document.getElementById("currentMileageInput").value = currentMileage || "";
  document.getElementById("currentMileageHint").textContent = currentMileage > 0
    ? "目前紀錄最高里程是 " + currentMileage.toLocaleString("zh-TW") + " km。"
    : "";
  clearMileageMessage();
  document.getElementById("mileageModal").style.display = "flex";
}

function closeMileageModal() {
  document.getElementById("mileageModal").style.display = "none";
  clearMileageMessage();
}

function openFuelLogModal({ skipPriceLoad = false, editIndex = -1 } = {}) {
  const editing = Number.isInteger(editIndex) && editIndex >= 0 && isFuelLogRecord(records[editIndex]);
  const record = editing ? records[editIndex] : null;
  const parsed = editing ? parseFuelLog(record, editIndex) : null;
  const currentMileage = getCurrentMileage();
  fuelEditIndex = editing ? editIndex : -1;
  document.getElementById("fuelLogModalTitle").textContent = editing ? "編輯加油紀錄" : "新增加油紀錄";
  document.getElementById("fuelLogSaveBtn").textContent = editing ? "💾 儲存變更" : "💾 儲存加油";
  document.getElementById("fuelLogDateInput").value = editing ? (record.date || getTodayString()) : getTodayString();
  document.getElementById("fuelLogMileageInput").value = editing ? (record.mileage || "") : (currentMileage || "");
  document.getElementById("fuelLogLitersInput").value = parsed ? parsed.liters.toFixed(2) : "";
  document.getElementById("fuelLogUnitPriceInput").value = Number.isFinite(parsed?.unitPrice) ? parsed.unitPrice.toFixed(1) : "";
  document.getElementById("fuelLogDiscountInput").value = Number.isFinite(parsed?.discount) ? parsed.discount.toFixed(1) : String(DEFAULT_FUEL_DISCOUNT);
  document.getElementById("fuelLogCostInput").value = editing ? (record.cost || "") : "";
  document.getElementById("fuelLogNetPriceHint").textContent = "輸入加油量與油價後會自動試算，實際付款金額可直接修改。";
  document.getElementById("fuelLogTypeInput").value = ["92", "95", "98", "其他"].includes(parsed?.fuelType) ? parsed.fuelType : DEFAULT_FUEL_TYPE;
  document.getElementById("fuelLogFullTankInput").value = parsed?.fullTank === false ? "no" : "yes";
  document.getElementById("fuelLogNoteInput").value = editing ? (record.note || "") : "全國加油站自助";
  setFuelPriceStatus(editing ? "已帶入原加油資料；修改後會重新試算金額。" : "預設 98，會嘗試抓取全國加油站今日牌價。");
  clearFuelLogMessage();
  const saveBtn = document.querySelector("#fuelLogForm button[type='submit']");
  if (saveBtn) delete saveBtn.dataset.confirmedMileage;
  document.getElementById("fuelLogModal").style.display = "flex";
  updateFuelLogCostFromDiscount({ preserveCostInput: editing });
  if (!editing && !skipPriceLoad) loadFuelPriceForSelectedType({ force: true });
}

function setActiveView(view) {
  const nextView = ["overview", "records", "analysis"].includes(view) ? view : "overview";
  activeView = nextView;
  ["overview", "records", "analysis"].forEach(name => {
    const panel = document.getElementById(name + "View");
    if (panel) panel.hidden = name !== nextView;
  });
  document.querySelectorAll(".app-tab").forEach(button => {
    const selected = button.dataset.view === nextView;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function setRecordsSubtab(tab) {
  activeRecordsSubtab = ["all", "fuel", "mileage"].includes(tab) ? tab : "all";
  const allPanel = document.getElementById("allRecordsPanel");
  const fuelPanel = document.getElementById("fuelAnalysisPanel");
  const categoryFilters = document.getElementById("filterPills");
  const filterControls = document.getElementById("recordFilterControls");
  const filterSummary = document.getElementById("filterSummary");
  const searchInput = document.getElementById("searchInput");
  const yearFilter = document.getElementById("yearFilter");

  if (allPanel) allPanel.hidden = activeRecordsSubtab === "fuel";
  if (fuelPanel) fuelPanel.hidden = activeRecordsSubtab !== "fuel";
  if (filterControls) filterControls.hidden = activeRecordsSubtab === "fuel";
  if (filterSummary) filterSummary.hidden = activeRecordsSubtab === "fuel";
  if (categoryFilters) categoryFilters.hidden = activeRecordsSubtab !== "all";
  if (searchInput) searchInput.disabled = activeRecordsSubtab === "fuel";
  if (yearFilter) yearFilter.disabled = activeRecordsSubtab === "fuel";

  document.querySelectorAll("[data-records-subtab]").forEach(button => {
    const selected = button.dataset.recordsSubtab === activeRecordsSubtab;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  renderRecords();
}

function openQuickEntryMenu(invoker = null) {
  const modal = document.getElementById("quickEntryModal");
  quickEntryInvoker = invoker?.focus ? invoker : document.activeElement || null;
  modal.style.display = "flex";
  const focusable = getModalFocusableElements(modal);
  const primaryAction = focusable.find(element => element.dataset?.quickEntry === "fuel");
  (primaryAction || focusable[0])?.focus();
}

function closeQuickEntryMenu({ restoreFocus = true } = {}) {
  document.getElementById("quickEntryModal").style.display = "none";
  if (restoreFocus && quickEntryInvoker?.focus) quickEntryInvoker.focus();
  quickEntryInvoker = null;
}

function runQuickEntry(action) {
  closeQuickEntryMenu({ restoreFocus: false });
  if (action === "fuel") {
    setActiveView("records");
    openFuelLogModal();
  } else if (action === "service") {
    setActiveView("records");
    openAddModal();
  } else if (action === "mileage") {
    openMileageModal();
  } else if (action === "photo") {
    openPhotoModal();
  } else if (action === "text") {
    openAiModal();
  }
}

function closeFuelLogModal() {
  document.getElementById("fuelLogModal").style.display = "none";
  fuelEditIndex = -1;
  clearFuelLogMessage();
}

function openFuelModal() {
  const currentMileage = getCurrentMileage();
  document.getElementById("fuelMileageInput").value = currentMileage || "";
  document.getElementById("fuelCostInput").value = "";
  document.getElementById("fuelNoteInput").value = "";
  clearFuelMessage();
  document.getElementById("fuelModal").style.display = "flex";
}

function closeFuelModal() {
  document.getElementById("fuelModal").style.display = "none";
  clearFuelMessage();
}

function setPhotoMode(mode) {
  photoMode = mode === "service" ? "service" : "fuel";
  document.querySelectorAll(".photo-mode-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.photoMode === photoMode);
  });
  if (photoParsed?.rawText) {
    photoParsed = photoMode === "fuel"
      ? parseFuelPhotoText(photoParsed.rawText)
      : parseServicePhotoText(photoParsed.rawText);
    renderPhotoResult(photoParsed);
  }
}

function openPhotoModal() {
  photoMode = "fuel";
  photoParsed = null;
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = "";
  document.getElementById("photoCameraInput").value = "";
  document.getElementById("photoLibraryInput").value = "";
  document.getElementById("photoRawText").value = "";
  document.getElementById("photoPreview").style.display = "none";
  document.getElementById("photoPreview").removeAttribute("src");
  document.getElementById("photoResult").style.display = "none";
  document.getElementById("photoResultGrid").innerHTML = "";
  document.getElementById("photoApplyBtn").disabled = true;
  clearPhotoMessage();
  setPhotoMode("fuel");
  document.getElementById("photoModal").style.display = "flex";
}

function closePhotoModal() {
  document.getElementById("photoModal").style.display = "none";
  clearPhotoMessage();
}

function renderPhotoResult(parsed) {
  const result = document.getElementById("photoResult");
  const grid = document.getElementById("photoResultGrid");
  const fields = parsed.mode === "fuel"
    ? [
        ["日期", parsed.date],
        ["里程", parsed.mileage ? parsed.mileage.toLocaleString("zh-TW") + " km" : "需確認"],
        ["公升", parsed.liters ? parsed.liters.toFixed(2) + " L" : "未讀到"],
        ["油品", parsed.fuelType || "需確認"],
        ["單價", parsed.unitPrice ? parsed.unitPrice.toFixed(1) + " 元/L" : "未讀到"],
        ["油費", parsed.cost ? "NT$ " + parsed.cost.toLocaleString("zh-TW") : "未讀到"]
      ]
    : [
        ["日期", parsed.date],
        ["里程", parsed.mileage ? parsed.mileage.toLocaleString("zh-TW") + " km" : "需確認"],
        ["類別", parsed.category || "需確認"],
        ["費用", parsed.cost ? "NT$ " + parsed.cost.toLocaleString("zh-TW") : "未讀到"],
        ["內容", parsed.detail || "需確認"]
      ];
  grid.innerHTML = fields.map(([label, value]) =>
    `<div class="photo-result-item">${escapeHtml(label)}<strong>${escapeHtml(value)}</strong></div>`
  ).join("");
  result.style.display = "block";
  document.getElementById("photoApplyBtn").disabled = false;
}

async function recognizePhotoFile(file) {
  if (!window.Tesseract) {
    throw new Error("OCR library is not loaded");
  }
  const logger = info => {
    if (info.status === "recognizing text") {
      const pct = Math.round((info.progress || 0) * 100);
      showPhotoMessage("info", "正在辨識照片文字 " + pct + "%");
    } else if (info.status) {
      showPhotoMessage("info", "正在準備 OCR：" + info.status);
    }
  };
  try {
    return await Tesseract.recognize(file, "chi_tra+eng", { logger });
  } catch (e) {
    console.warn("繁中 OCR 失敗，改用英文數字辨識", e);
    return await Tesseract.recognize(file, "eng", { logger });
  }
}

function openPhotoSourceInput(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.value = "";
  input.click();
}

async function handlePhotoInputChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = URL.createObjectURL(file);
  const preview = document.getElementById("photoPreview");
  preview.src = photoPreviewUrl;
  preview.style.display = "block";
  document.getElementById("photoApplyBtn").disabled = true;
  document.getElementById("photoResult").style.display = "none";
  document.getElementById("photoRawText").value = "";
  clearPhotoMessage();

  try {
    showPhotoMessage("info", "正在讀取照片，第一次使用可能需要下載 OCR 模型。");
    const result = await recognizePhotoFile(file);
    const text = normalizeOcrText(result.data?.text || "");
    document.getElementById("photoRawText").value = text;
    if (!text) {
      showPhotoMessage("error", "沒有讀到文字，請換一張更清楚、光線更亮的照片。");
      return;
    }
    photoParsed = photoMode === "fuel" ? parseFuelPhotoText(text) : parseServicePhotoText(text);
    renderPhotoResult(photoParsed);
    showPhotoMessage("info", "已讀取照片，請確認辨識結果後填入表單。");
  } catch (err) {
    console.error("照片辨識失敗", err);
    showPhotoMessage("error", "照片辨識失敗。請確認網路可下載 OCR 模型，或換一張更清楚的照片。");
  }
}

function applyPhotoParsedToForm() {
  if (!photoParsed) return;
  const parsed = photoParsed;
  closePhotoModal();
  if (parsed.mode === "fuel") {
    openFuelLogModal({ skipPriceLoad: true });
    document.getElementById("fuelLogDateInput").value = parsed.date || getTodayString();
    document.getElementById("fuelLogMileageInput").value = parsed.mileage || getCurrentMileage() || "";
    document.getElementById("fuelLogLitersInput").value = parsed.liters ? parsed.liters.toFixed(2) : "";
    document.getElementById("fuelLogUnitPriceInput").value = parsed.unitPrice ? parsed.unitPrice.toFixed(1) : "";
    document.getElementById("fuelLogCostInput").value = parsed.cost || "";
    document.getElementById("fuelLogTypeInput").value = ["92", "95", "98"].includes(parsed.fuelType) ? parsed.fuelType : DEFAULT_FUEL_TYPE;
    document.getElementById("fuelLogFullTankInput").value = parsed.fullTank ? "yes" : "no";
    document.getElementById("fuelLogNoteInput").value = parsed.note || "照片辨識";
    setFuelPriceStatus("已從照片帶入資料，請確認後儲存。");
    updateFuelLogCostFromDiscount();
    if (parsed.cost) document.getElementById("fuelLogCostInput").value = parsed.cost;
    showFuelLogMessage("info", "已從照片填入加油資料；請確認里程、公升與金額後儲存。");
    return;
  }

  openAddModal();
  document.getElementById("formDate").value = parsed.date || getTodayString();
  document.getElementById("formMileage").value = parsed.mileage || "";
  document.getElementById("formCategory").value = parsed.category || "保養";
  document.getElementById("formCost").value = parsed.cost || "";
  document.getElementById("formDetail").value = parsed.detail || "照片辨識紀錄";
  document.getElementById("formNote").value = parsed.note || "照片辨識，請確認欄位";
  updateMileageHint(-1);
  showFormMessage("info", "已從照片填入紀錄；請確認日期、里程、費用與內容後儲存。");
}

function openAiModal() {
  document.getElementById("aiRecordForm").reset();
  renderAiResultNote("");
  clearAiMessage();
  document.getElementById("aiSubmitBtn").disabled = false;
  document.getElementById("aiModal").style.display = "flex";
  setTimeout(() => document.getElementById("aiRecordText").focus(), 50);
}

function closeAiModal() {
  document.getElementById("aiModal").style.display = "none";
  renderAiResultNote("");
  clearAiMessage();
}

function getAiSafeRecords() {
  return records.map(r => ({
    date: r.date || "",
    mileage: Number.isFinite(Number(r.mileage)) ? Number(r.mileage) : null,
    category: r.category || "",
    detail: r.detail || "",
    cost: asNumber(r.cost),
    note: r.note || ""
  }));
}

function buildAiRequestPayload(text) {
  return {
    action: "aiRecordAssistant",
    text,
    records: getAiSafeRecords(),
    today: getTodayString(),
    vehicle: {
      name: VEHICLE_PROFILE.name,
      fuel: VEHICLE_PROFILE.fuel,
      defaultFuelType: DEFAULT_FUEL_TYPE,
      defaultDiscount: DEFAULT_FUEL_DISCOUNT,
      currentMileage: getCurrentMileage()
    }
  };
}

async function ensureAiBackendReady() {
  if (aiBackendReady === true) return true;
  const res = await fetchWithTimeout(API_URL + "?action=aiStatus", { cache: "no-store" }, 6500);
  if (!res.ok) throw new Error("AI backend status HTTP " + res.status);
  const data = await res.json();
  aiBackendReady = !!data?.aiRecordAssistant;
  if (!aiBackendReady) {
    throw new Error("AI backend is not deployed");
  }
  if (!data.hasOpenAiKey) {
    throw new Error("OPENAI_API_KEY is not configured in Apps Script");
  }
  return true;
}

async function requestAiRecordDraft(text) {
  await ensureAiBackendReady();
  const res = await fetchWithTimeout(API_URL + "?action=aiRecordAssistant", {
    method: "POST",
    body: JSON.stringify(buildAiRequestPayload(text)),
    redirect: "follow"
  }, 24000);
  if (!res.ok) throw new Error("AI backend HTTP " + res.status);
  const data = await res.json();
  if (!data?.ok) {
    throw new Error(data?.message || "AI 解析失敗");
  }
  return data;
}

function getAiDraftNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getAiDraftInteger(value) {
  const n = getAiDraftNumber(value);
  return n === null ? null : Math.round(n);
}

function normalizeAiDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : getTodayString();
}

function normalizeAiCategory(value, sourceText) {
  const allowed = ["保養", "維修", "更換", "保險", "檢驗/稅費", "清潔美容", "改裝升級", "其他"];
  return allowed.includes(value) ? value : inferServiceCategory(sourceText);
}

function normalizeQuickText(text) {
  return String(text || "")
    .replace(/[，,]/g, "")
    .replace(/[：:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseQuickDate(text) {
  const raw = String(text || "");
  const western = raw.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (western) {
    return [
      western[1],
      String(Number(western[2])).padStart(2, "0"),
      String(Number(western[3])).padStart(2, "0")
    ].join("-");
  }
  const today = new Date();
  if (/昨天|昨日/.test(raw)) {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return formatDateYMD(d);
  }
  return getTodayString();
}

function parseQuickMileage(text) {
  const raw = String(text || "");
  const labeled =
    raw.match(/(?:里程|公里)[^\d]{0,6}([0-9]{3,6})/i) ||
    raw.match(/([0-9]{3,6})\s*(?:km|KM|公里)/);
  if (!labeled) return null;
  const mileage = parseInt(labeled[1], 10);
  return Number.isFinite(mileage) && mileage > 0 ? mileage : null;
}

function getQuickNumberTokens(text) {
  const raw = String(text || "");
  return [...raw.matchAll(/([0-9]{2,7})(?:\s*(km|KM|公里|L|l|公升|升|元))?/g)]
    .map(match => ({
      value: parseInt(match[1], 10),
      unit: match[2] || "",
      text: match[0],
      index: match.index || 0
    }))
    .filter(token => Number.isFinite(token.value));
}

function parseQuickCost(text, mileage, fuelType) {
  const tokens = getQuickNumberTokens(text);
  const money = tokens.filter(token => {
    if (/km|KM|公里/.test(token.unit)) return false;
    if (mileage && token.value === mileage) return false;
    if (fuelType && token.value === Number(fuelType)) return false;
    if (/L|l|公升|升/.test(token.unit)) return false;
    return token.value >= 50;
  });
  return money.length ? money[money.length - 1].value : 0;
}

function parseQuickLiters(text) {
  const match = String(text || "").match(/([0-9]{1,3}(?:\.[0-9]{1,2})?)\s*(?:L|l|公升|升)/);
  if (!match) return 0;
  const liters = parseFloat(match[1]);
  return Number.isFinite(liters) && liters > 0 ? liters : 0;
}

function getQuickFuelType(text) {
  const match = String(text || "").match(/\b(92|95|98)\b|(?:^|[^\d])(92|95|98)(?:無鉛|汽油|加)/);
  return match ? (match[1] || match[2]) : DEFAULT_FUEL_TYPE;
}

function getQuickFuelNote(text) {
  const station = String(text || "").match(/(全國加油站|全國|中油|台塑|台亞|山隆|福懋|統一精工|速邁樂|加油站)/);
  return station ? station[1] : "";
}

function hasQuickServiceSignal(text) {
  return /保養|維修|更換|換|輪胎|電瓶|煞車|機油|變速箱|保險|驗車|檢驗|牌照稅|燃料稅|洗車|美容|鍍膜|清潔|改裝|升級|汽油精/.test(text);
}

function buildQuickServiceDetail(text, cost, mileage) {
  let detail = normalizeQuickText(text)
    .replace(/今天|今日|昨天|昨日/g, "")
    .replace(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}/g, "")
    .trim();
  if (mileage) {
    detail = detail
      .replace(new RegExp(String(mileage) + "\\s*(?:km|KM|公里)?", "g"), "")
      .trim();
  }
  if (cost) {
    detail = detail
      .replace(new RegExp("(?:NT\\$?|費用|花費|金額)?\\s*" + String(cost) + "\\s*(?:元)?", "g"), "")
      .trim();
  }
  detail = detail.replace(/\s+/g, " ").trim();
  return detail || normalizeQuickText(text);
}

function parseLocalRecordDraft(text) {
  const raw = normalizeQuickText(text);
  if (!raw) return null;

  const isFuel = /加油|加油站|中油|台塑|全國|台亞|山隆|福懋|統一精工|速邁樂|(?:92|95|98)\s*加/.test(raw);
  const mileage = parseQuickMileage(raw);
  const fuelType = isFuel ? getQuickFuelType(raw) : "";
  const cost = parseQuickCost(raw, mileage, fuelType);
  const date = parseQuickDate(raw);

  if (isFuel) {
    if (!cost && !parseQuickLiters(raw)) return null;
    return {
      ok: true,
      mode: "fuel",
      localParser: true,
      message: "已用本機規則解析為加油紀錄，未使用 API 額度。",
      draft: {
        date,
        mileage: mileage || getCurrentMileage() || 0,
        category: "",
        detail: "",
        cost,
        fuelType,
        liters: parseQuickLiters(raw),
        unitPrice: 0,
        discount: DEFAULT_FUEL_DISCOUNT,
        fullTank: !/未加滿|沒加滿|不加滿/.test(raw),
        note: getQuickFuelNote(raw) || raw,
        confidence: 0.88,
        missingFields: mileage || getCurrentMileage() ? [] : ["里程"]
      }
    };
  }

  if (!hasQuickServiceSignal(raw)) return null;
  const category = normalizeAiCategory("", raw);
  const detail = buildQuickServiceDetail(raw, cost, mileage);
  return {
    ok: true,
    mode: "service",
    localParser: true,
    message: "已用本機規則解析為紀錄草稿，未使用 API 額度。",
    draft: {
      date,
      mileage: mileage || 0,
      category,
      detail,
      cost,
      fuelType: "",
      liters: 0,
      unitPrice: 0,
      discount: 0,
      fullTank: true,
      note: "本機快速解析",
      confidence: cost || mileage ? 0.86 : 0.7,
      missingFields: []
    }
  };
}

function summarizeAiDraft(result) {
  const draft = result.draft || {};
  const missing = Array.isArray(draft.missingFields) ? draft.missingFields.filter(Boolean) : [];
  const confidence = Number(draft.confidence);
  const confidenceText = Number.isFinite(confidence) && confidence > 0
    ? `信心 ${(Math.min(confidence, 1) * 100).toFixed(0)}%`
    : "請確認欄位";
  const missingText = missing.length ? `；需確認：${missing.join("、")}` : "";
  return `<strong>${escapeHtml(result.message || "已產生紀錄草稿")}</strong><br>${escapeHtml(confidenceText + missingText)}`;
}

function getAiReviewSuffix(result) {
  const draft = result.draft || {};
  const missing = Array.isArray(draft.missingFields) ? draft.missingFields.filter(Boolean) : [];
  const confidence = Number(draft.confidence);
  const notes = [];
  if (Number.isFinite(confidence) && confidence > 0 && confidence < 0.65) {
    notes.push("AI 信心偏低");
  }
  if (missing.length) {
    notes.push("需確認：" + missing.join("、"));
  }
  return notes.length ? "（" + notes.join("；") + "）" : "";
}

async function applyAiFuelDraft(result, sourceText) {
  const draft = result.draft || {};
  const cost = getAiDraftInteger(draft.cost);
  const fuelType = ["92", "95", "98"].includes(String(draft.fuelType)) ? String(draft.fuelType) : DEFAULT_FUEL_TYPE;
  const discount = getAiDraftNumber(draft.discount) ?? DEFAULT_FUEL_DISCOUNT;
  const mileage = getAiDraftInteger(draft.mileage) ?? getCurrentMileage();

  closeAiModal();
  openFuelLogModal({ skipPriceLoad: true });
  document.getElementById("fuelLogDateInput").value = normalizeAiDate(draft.date);
  document.getElementById("fuelLogMileageInput").value = mileage || "";
  document.getElementById("fuelLogTypeInput").value = fuelType;
  document.getElementById("fuelLogFullTankInput").value = draft.fullTank === false ? "no" : "yes";
  document.getElementById("fuelLogDiscountInput").value = discount.toFixed(1);
  document.getElementById("fuelLogCostInput").value = cost || "";
  document.getElementById("fuelLogNoteInput").value = String(draft.note || "").trim() || sourceText;

  const unitPrice = getAiDraftNumber(draft.unitPrice);
  if (unitPrice) {
    document.getElementById("fuelLogUnitPriceInput").value = unitPrice.toFixed(1);
  } else {
    await loadFuelPriceForSelectedType({ force: true });
  }

  const finalUnitPrice = parseDecimalInput(document.getElementById("fuelLogUnitPriceInput").value);
  const netPrice = Number.isFinite(finalUnitPrice) ? Math.max(finalUnitPrice - discount, 0) : 0;
  const liters = getAiDraftNumber(draft.liters) ?? (cost && netPrice > 0 ? cost / netPrice : null);
  if (liters) {
    document.getElementById("fuelLogLitersInput").value = liters.toFixed(2);
  }
  updateFuelLogCostFromDiscount();
  if (cost) document.getElementById("fuelLogCostInput").value = cost;

  const message = liters
    ? `${result.localParser ? "本機規則" : "AI"} 已填入加油草稿；請確認里程、公升、油價與金額後儲存。`
    : `${result.localParser ? "本機規則" : "AI"} 已填入加油草稿；目前缺公升數，請確認油價或手動輸入公升後儲存。`;
  const reviewSuffix = getAiReviewSuffix(result);
  showFuelLogMessage(liters ? "info" : "error", message + reviewSuffix);
}

function applyAiServiceDraft(result, sourceText) {
  const draft = result.draft || {};
  closeAiModal();
  openAddModal();
  document.getElementById("formDate").value = normalizeAiDate(draft.date);
  document.getElementById("formMileage").value = getAiDraftInteger(draft.mileage) || "";
  document.getElementById("formCategory").value = normalizeAiCategory(draft.category, sourceText);
  document.getElementById("formCost").value = getAiDraftInteger(draft.cost) || "";
  document.getElementById("formTemplate").value = "";
  document.getElementById("formDetail").value = String(draft.detail || "").trim() || sourceText;
  document.getElementById("formNote").value = String(draft.note || "").trim();
  updateMileageHint(-1);
  showFormMessage("info", `${result.localParser ? "本機規則" : "AI"} 已填入紀錄草稿；請確認日期、里程、類別、費用與內容後儲存。` + getAiReviewSuffix(result));
}

async function applyAiDraftToForm(result, sourceText) {
  renderAiResultNote(summarizeAiDraft(result));
  if (result.mode === "fuel") {
    await applyAiFuelDraft(result, sourceText);
  } else {
    applyAiServiceDraft(result, sourceText);
  }
}

async function handleAiRecordSubmit(e) {
  e.preventDefault();
  const input = document.getElementById("aiRecordText");
  const text = input.value.trim();
  if (!text) {
    showAiMessage("error", "請先輸入要新增的紀錄內容。");
    input.focus();
    return;
  }

  const btn = document.getElementById("aiSubmitBtn");
  btn.disabled = true;
  renderAiResultNote("");
  showAiMessage("info", "正在用本機規則解析紀錄...");
  try {
    const localResult = parseLocalRecordDraft(text);
    if (localResult) {
      renderAiResultNote(summarizeAiDraft(localResult));
      showAiMessage("info", "已用本機規則產生草稿，正在填入表單。");
      await applyAiDraftToForm(localResult, text);
      return;
    }

    showAiMessage("info", "本機規則無法判斷，改用 AI 解析紀錄...");
    const result = await requestAiRecordDraft(text);
    renderAiResultNote(summarizeAiDraft(result));
    showAiMessage("info", "已產生草稿，正在填入表單。");
    await applyAiDraftToForm(result, text);
  } catch (err) {
    console.error("AI 紀錄助手失敗", err);
    const message = err.message === "AI backend is not deployed"
      ? "AI 代理尚未部署到 Apps Script。請先更新 Apps Script 後再使用。"
      : err.message === "OPENAI_API_KEY is not configured in Apps Script"
        ? "Apps Script 尚未設定 OPENAI_API_KEY。請先在 Script Properties 設定後再使用。"
        : /quota|insufficient_quota/i.test(err.message || "")
          ? "OpenAI API 額度不足或 billing 尚未啟用；請到 OpenAI Platform 檢查方案與付款設定。"
          : "AI 解析失敗：" + (err.message || "請稍後再試，或先使用一般新增表單。");
    showAiMessage("error", message);
    btn.disabled = false;
  }
}

function handleMileageSubmit(e) {
  e.preventDefault();
  const input = document.getElementById("currentMileageInput");
  const mileage = parseInt(input.value);
  const currentMileage = getCurrentMileage();

  if (!Number.isFinite(mileage) || mileage <= 0) {
    showMileageMessage("error", "請輸入有效的目前里程。");
    return;
  }
  if (currentMileage > 0 && mileage < currentMileage) {
    showMileageMessage("error", "目前里程不能低於既有最高里程 " + currentMileage.toLocaleString("zh-TW") + " km。");
    return;
  }

  const today = getTodayString();
  const existingTodayIndex = records.findIndex(r =>
    r.date === today &&
    r.category === "其他" &&
    r.detail === "目前里程更新"
  );
  const rec = {
    date: today,
    mileage,
    category: "其他",
    detail: "目前里程更新",
    cost: 0,
    note: "用於儀表板里程計算"
  };

  if (existingTodayIndex >= 0) {
    records[existingTodayIndex] = rec;
  } else {
    records.push(rec);
  }

  saveRecords(records);
  closeMileageModal();
  refresh();
}

function handleFuelLogSubmit(e) {
  e.preventDefault();
  const date = document.getElementById("fuelLogDateInput").value;
  const mileage = parseInt(document.getElementById("fuelLogMileageInput").value);
  const litersInput = document.getElementById("fuelLogLitersInput");
  let liters = parseDecimalInput(litersInput.value);
  let calculatedFuelCost = getFuelLogCalculatedCost();
  const costInputValue = document.getElementById("fuelLogCostInput").value;
  const cost = costInputValue ? parseInt(costInputValue) : (calculatedFuelCost ? calculatedFuelCost.total : 0);
  const fuelType = document.getElementById("fuelLogTypeInput").value;
  const fullTank = document.getElementById("fuelLogFullTankInput").value === "yes";
  const note = document.getElementById("fuelLogNoteInput").value.trim();
  const maxMileage = fuelEditIndex >= 0 ? getMaxMileage(fuelEditIndex) : getCurrentMileage();
  const saveBtn = e.submitter || document.querySelector("#fuelLogForm button[type='submit']");

  if (!date) {
    showFuelLogMessage("error", "請選擇加油日期。");
    return;
  }
  if (!Number.isFinite(mileage) || mileage <= 0) {
    showFuelLogMessage("error", "請輸入有效的加油里程。");
    return;
  }
  if (!Number.isFinite(liters) || liters <= 0) {
    const inferred = getFuelLogInferredLiters();
    if (inferred) {
      liters = inferred.liters;
      calculatedFuelCost = inferred;
      litersInput.value = liters.toFixed(2);
    } else {
      showFuelLogMessage("error", "請輸入加油公升數；或填入油費與牌告油價，系統就能自動反推公升數。");
      return;
    }
  }
  if (cost < 0) {
    showFuelLogMessage("error", "油費不能是負數。");
    return;
  }
  if (maxMileage > 0 && mileage < maxMileage && !saveBtn.dataset.confirmedMileage) {
    showFuelLogMessage("info", "這筆里程低於目前最高里程；若是在補登舊加油紀錄，請再按一次儲存。");
    saveBtn.dataset.confirmedMileage = "true";
    return;
  }

  const record = {
    date,
    mileage,
    category: "加油",
    detail: [
      `加油｜${fuelType}`,
      `${liters.toFixed(2)} L`,
      fullTank ? "加滿" : "未加滿",
      calculatedFuelCost
        ? `牌告 ${calculatedFuelCost.unitPrice.toFixed(1)} 元/L`
        : "",
      calculatedFuelCost
        ? `優惠 ${calculatedFuelCost.discount.toFixed(1)} 元/L`
        : "",
      calculatedFuelCost
        ? `實付 ${calculatedFuelCost.netPrice.toFixed(1)} 元/L`
        : ""
    ].filter(Boolean).join("｜"),
    cost,
    note
  };
  requestRecordSave(record, {
    editIndex: fuelEditIndex,
    commit: () => {
      if (fuelEditIndex >= 0) records[fuelEditIndex] = record;
      else records.push(record);
      saveRecords(records);
      closeFuelLogModal();
      refresh();
    }
  });
}

function handleFuelSubmit(e) {
  e.preventDefault();
  const mileage = parseInt(document.getElementById("fuelMileageInput").value);
  const cost = parseInt(document.getElementById("fuelCostInput").value) || 0;
  const note = document.getElementById("fuelNoteInput").value.trim();
  const currentMileage = getCurrentMileage();

  if (!Number.isFinite(mileage) || mileage <= 0) {
    showFuelMessage("error", "請輸入有效的添加里程。");
    return;
  }
  if (currentMileage > 0 && mileage > currentMileage) {
    showFuelMessage("error", "添加里程不能高於目前里程 " + currentMileage.toLocaleString("zh-TW") + " km。");
    return;
  }
  if (cost < 0) {
    showFuelMessage("error", "費用不能是負數。");
    return;
  }

  records.push({
    date: getTodayString(),
    mileage,
    category: "其他",
    detail: "汽油精",
    cost,
    note: note || "定期添加維護"
  });

  saveRecords(records);
  closeFuelModal();
  refresh();
}

function handleFormSubmit(e) {
  e.preventDefault();
  const form = document.getElementById("recordForm");
  if (!form.checkValidity()) {
    showFormMessage("error", "請先補齊必填欄位，並確認數字欄位格式正確。");
    form.reportValidity();
    return;
  }

  const idx = parseInt(document.getElementById("editIndex").value);
  const mileageInput = document.getElementById("formMileage").value;
  const costInput = document.getElementById("formCost").value;
  const mileage = mileageInput ? parseInt(mileageInput) : null;
  const cost = costInput ? parseInt(costInput) : 0;

  if ((mileage !== null && mileage < 0) || cost < 0) {
    showFormMessage("error", "里程與費用不能是負數。");
    return;
  }

  const rec = {
    date:     document.getElementById("formDate").value,
    mileage,
    category: document.getElementById("formCategory").value,
    detail:   document.getElementById("formDetail").value.trim(),
    cost,
    note:     document.getElementById("formNote").value.trim()
  };

  if (!rec.detail) {
    showFormMessage("error", "請填寫詳細內容，例如更換項目、料號或施工內容。");
    return;
  }

  const maxMileage = getMaxMileage(idx);
  const originalMileage = idx >= 0 ? Number(records[idx]?.mileage) : null;
  const mileageChanged = idx === -1 || originalMileage !== rec.mileage;
  const saveBtn = e.submitter || document.querySelector("#recordForm button[type='submit']");
  if (rec.mileage !== null && mileageChanged && maxMileage > 0 && rec.mileage < maxMileage && !saveBtn.dataset.confirmedMileage) {
    showFormMessage("info", "這筆里程低於目前最高里程 " + maxMileage.toLocaleString("zh-TW") + " km；若是在補登舊紀錄，請再按一次儲存。");
    saveBtn.dataset.confirmedMileage = "true";
    return;
  }

  requestRecordSave(rec, {
    editIndex: idx,
    commit: () => {
      if (idx === -1) records.push(rec);
      else records[idx] = rec;
      saveRecords(records);
      closeModal();
      refresh();
    }
  });
}

// ============================================================
// 刪除 Modal
// ============================================================
function openDeleteModal(idx) {
  deleteTargetIndex = idx;
  document.getElementById("deleteModal").style.display = "flex";
}
function closeDeleteModal() {
  document.getElementById("deleteModal").style.display = "none";
  deleteTargetIndex = -1;
}
function handleDeleteConfirm() {
  if (deleteTargetIndex < 0) return;
  const index = deleteTargetIndex;
  const [record] = records.splice(index, 1);
  if (!record) return;
  deletedRecordSnapshot = { record, index };
  saveRecords(records, { announce: false });
  closeDeleteModal();
  refresh();
  showToast("已刪除紀錄", { label: "復原", onClick: restoreDeletedRecord });
}

function restoreDeletedRecord() {
  if (!deletedRecordSnapshot) return;
  const { record, index } = deletedRecordSnapshot;
  records.splice(Math.min(index, records.length), 0, record);
  deletedRecordSnapshot = null;
  saveRecords(records, { announce: false });
  refresh();
  showToast("已復原紀錄");
}

// ============================================================
// 匯出 CSV
// ============================================================
function exportCSV() {
  const sorted = [...records].sort(compareRecordsNewestFirst);
  const BOM = "\uFEFF";
  const header = ["日期", "里程(km)", "類別", "詳細內容", "費用(NT$)", "備註"];
  const rows = sorted.map(r => [
    r.date,
    r.mileage ?? "",
    r.category,
    `"${(r.detail || "").replace(/"/g, '""')}"`,
    asNumber(r.cost),
    `"${(r.note || "").replace(/"/g, '""')}"`
  ]);
  const csv = BOM + [header.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `車輛保養紀錄_${formatDateYMD(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// 加油紀錄表
// ============================================================
function renderFuelLogSection() {
  const tbody = document.getElementById("fuelLogTableBody");
  const summary = document.getElementById("fuelLogSummary");
  const empty = document.getElementById("fuelLogEmpty");
  if (!tbody || !summary || !empty) return;

  const fuelStats = getFuelStats();
  const logs = [...fuelStats.logs].sort(compareFuelLogsNewestFirst);
  const segmentMap = new Map(
    fuelStats.segments.map(segment => [`${segment.date}|${segment.mileage}`, segment])
  );
  const suspiciousFuelKeys = new Set(
    getDataQualityIssues()
      .filter(issue => issue.type === "fuel-outlier")
      .map(issue => issue.key)
  );

  if (!logs.length) {
    tbody.innerHTML = "";
    summary.textContent = "尚無加油資料";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  summary.textContent = [
    `共 ${logs.length} 筆`,
    `累計 ${formatCost(fuelStats.totalCost)}`,
    fuelStats.averageKmPerLiter
      ? `平均 ${fuelStats.averageKmPerLiter.toFixed(1)} km/L`
      : "油耗待第二次加滿後計算"
  ].join(" · ");

  tbody.innerHTML = logs.map(log => {
    const segment = segmentMap.get(`${log.date}|${log.mileage}`);
    const needsReview = segment && suspiciousFuelKeys.has(`fuel|${segment.date}|${segment.mileage}`);
    const kmPerLiter = segment
      ? `${segment.kmPerLiter.toFixed(1)} km/L`
      : (log.fullTank ? "基準" : "—");
    return `
      <tr>
        <td data-label="日期">${escapeHtml(log.date)}</td>
        <td data-label="油品">${escapeHtml(log.fuelType || "—")}</td>
        <td data-label="里程">${formatMileage(log.mileage)}</td>
        <td data-label="公升">${log.liters.toFixed(2)} L</td>
        <td data-label="牌告">${formatNumberOrDash(log.unitPrice, 1)}</td>
        <td data-label="折抵">${formatNumberOrDash(log.discount, 1)}</td>
        <td data-label="實付/L">${formatNumberOrDash(log.netPrice, 1)}</td>
        <td data-label="油費">${formatCost(log.cost)}</td>
        <td data-label="油耗"><span>${kmPerLiter}</span>${needsReview ? '<span class="data-quality-flag">待確認</span>' : ""}</td>
        <td data-label="備註">${escapeHtml(log.note || "")}</td>
      </tr>
    `;
  }).join("");
}

// ============================================================
// 全量更新
// ============================================================
function refresh() {
  updateStats();
  renderOwnerDashboard();
  renderOverviewRecentRecords();
  renderOwnershipCostPanel();
  renderDataQualityPanel();
  renderConsumableTrackers();
  renderFuelLogSection();
  populateYearFilter();
  updateFilterPills();
  buildCharts();
  renderRecords();
}

// ============================================================
// 事件綁定
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("appVersion").textContent = APP_VERSION;

  // 今日初始化 (改為從雲端載入)
  initData();

  // 快速新增與內容切換
  document.getElementById("calendarReminderCloseBtn").addEventListener("click", closeCalendarReminder);
  document.getElementById("calendarReminderCancelBtn").addEventListener("click", closeCalendarReminder);
  document.getElementById("calendarReminderConfirmBtn").addEventListener("click", downloadCalendarReminder);
  document.getElementById("calendarReminderModal").addEventListener("click", event => {
    if (event.target === document.getElementById("calendarReminderModal")) closeCalendarReminder();
  });
  document.addEventListener("keydown", event => {
    const calendarModal = document.getElementById("calendarReminderModal");
    const quickEntryModal = document.getElementById("quickEntryModal");
    if (calendarModal.style.display === "flex") {
      if (event.key === "Escape") closeCalendarReminder();
      else trapModalFocus(event, calendarModal);
    } else if (quickEntryModal.style.display === "flex") {
      if (event.key === "Escape") closeQuickEntryMenu();
      else trapModalFocus(event, quickEntryModal);
    }
  });
  document.getElementById("btnQuickEntry").addEventListener("click", openQuickEntryMenu);
  document.getElementById("quickEntryModalClose").addEventListener("click", closeQuickEntryMenu);
  document.getElementById("quickEntryModal").addEventListener("click", e => {
    if (e.target === document.getElementById("quickEntryModal")) closeQuickEntryMenu();
  });
  document.querySelectorAll(".quick-entry-btn").forEach(button => {
    button.addEventListener("click", () => runQuickEntry(button.dataset.quickEntry));
  });
  document.querySelectorAll(".app-tab").forEach(button => {
    button.addEventListener("click", () => setActiveView(button.dataset.view));
  });
  document.querySelectorAll("[data-records-subtab]").forEach(button => {
    button.addEventListener("click", () => setRecordsSubtab(button.dataset.recordsSubtab));
  });
  document.querySelectorAll("[data-overview-action='records']").forEach(button => {
    button.addEventListener("click", () => setActiveView("records"));
  });
  document.getElementById("btnUpdateMileage").addEventListener("click", openMileageModal);
  document.getElementById("btnAddFuelAdditive").addEventListener("click", openFuelModal);

  // 匯出
  document.getElementById("btnExport").addEventListener("click", exportCSV);
  document.getElementById("btnBackupExport").addEventListener("click", exportJsonBackup);
  document.getElementById("btnBackupRestore").addEventListener("click", () => document.getElementById("backupRestoreInput").click());
  document.getElementById("backupRestoreInput").addEventListener("change", async event => {
    const input = event.target;
    const file = input.files?.[0];
    try {
      if (!file) return;
      stageBackupRestore(await file.text());
    } catch (error) {
      pendingRestoreRecords = null;
      showToast("備份檔無法還原：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      input.value = "";
    }
  });
  document.getElementById("backupRestoreCancelBtn").addEventListener("click", closeBackupRestoreModal);
  document.getElementById("backupRestoreConfirmBtn").addEventListener("click", confirmBackupRestore);
  document.getElementById("backupRestoreModal").addEventListener("click", event => {
    if (event.target === document.getElementById("backupRestoreModal")) closeBackupRestoreModal();
  });

  document.getElementById("duplicateCancelBtn").addEventListener("click", closeDuplicateModal);
  document.getElementById("duplicateConfirmBtn").addEventListener("click", confirmDuplicateSave);
  document.getElementById("duplicateModal").addEventListener("click", event => {
    if (event.target === document.getElementById("duplicateModal")) closeDuplicateModal();
  });

  // 同步狀態重試
  document.getElementById("syncStatus").addEventListener("click", () => syncToCloud(records));

  // Modal 關閉
  document.getElementById("modalClose").addEventListener("click", closeModal);
  document.getElementById("btnCancel").addEventListener("click", closeModal);
  document.getElementById("modal").addEventListener("click", e => {
    if (e.target === document.getElementById("modal")) closeModal();
  });

  // 表單提交
  document.getElementById("recordForm").addEventListener("submit", handleFormSubmit);
  document.getElementById("formTemplate").addEventListener("change", e => applyRecordTemplate(e.target.value));
  ["formDate", "formMileage", "formCategory", "formCost", "formDetail", "formNote"].forEach(id => {
    document.getElementById(id).addEventListener("input", () => {
      clearFormMessage();
      if (id === "formMileage") updateMileageHint();
    });
  });

  // 目前里程更新
  document.getElementById("mileageModalClose").addEventListener("click", closeMileageModal);
  document.getElementById("mileageCancelBtn").addEventListener("click", closeMileageModal);
  document.getElementById("mileageModal").addEventListener("click", e => {
    if (e.target === document.getElementById("mileageModal")) closeMileageModal();
  });
  document.getElementById("mileageForm").addEventListener("submit", handleMileageSubmit);
  document.getElementById("currentMileageInput").addEventListener("input", clearMileageMessage);

  // 照片辨識
  document.getElementById("photoModalClose").addEventListener("click", closePhotoModal);
  document.getElementById("photoCancelBtn").addEventListener("click", closePhotoModal);
  document.getElementById("photoModal").addEventListener("click", e => {
    if (e.target === document.getElementById("photoModal")) closePhotoModal();
  });
  document.querySelectorAll(".photo-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => setPhotoMode(btn.dataset.photoMode));
  });
  document.getElementById("photoCameraBtn").addEventListener("click", () => openPhotoSourceInput("photoCameraInput"));
  document.getElementById("photoLibraryBtn").addEventListener("click", () => openPhotoSourceInput("photoLibraryInput"));
  document.getElementById("photoCameraInput").addEventListener("change", handlePhotoInputChange);
  document.getElementById("photoLibraryInput").addEventListener("change", handlePhotoInputChange);
  document.getElementById("photoApplyBtn").addEventListener("click", applyPhotoParsedToForm);

  // AI 紀錄助手
  document.getElementById("aiModalClose").addEventListener("click", closeAiModal);
  document.getElementById("aiCancelBtn").addEventListener("click", closeAiModal);
  document.getElementById("aiModal").addEventListener("click", e => {
    if (e.target === document.getElementById("aiModal")) closeAiModal();
  });
  document.getElementById("aiRecordForm").addEventListener("submit", handleAiRecordSubmit);
  document.getElementById("aiRecordText").addEventListener("input", () => {
    clearAiMessage();
    renderAiResultNote("");
    document.getElementById("aiSubmitBtn").disabled = false;
  });

  // 加油紀錄
  document.getElementById("fuelLogModalClose").addEventListener("click", closeFuelLogModal);
  document.getElementById("fuelLogCancelBtn").addEventListener("click", closeFuelLogModal);
  document.getElementById("fuelLogModal").addEventListener("click", e => {
    if (e.target === document.getElementById("fuelLogModal")) closeFuelLogModal();
  });
  document.getElementById("fuelLogForm").addEventListener("submit", handleFuelLogSubmit);
  document.getElementById("btnFetchFuelPrice").addEventListener("click", () => loadFuelPriceForSelectedType({ force: true }));
  ["fuelLogLitersInput", "fuelLogUnitPriceInput", "fuelLogDiscountInput"].forEach(id => {
    document.getElementById(id).addEventListener("input", () => {
      clearFuelLogMessage();
      updateFuelLogCostFromDiscount();
    });
  });
  document.getElementById("fuelLogTypeInput").addEventListener("change", () => {
    clearFuelLogMessage();
    loadFuelPriceForSelectedType({ force: true });
  });
  document.getElementById("fuelLogCostInput").addEventListener("input", () => {
    clearFuelLogMessage();
    updateFuelLogCostFromDiscount({ preserveCostInput: true });
  });
  document.getElementById("fuelLogCostInput").addEventListener("change", () => {
    clearFuelLogMessage();
    updateFuelLogCostFromDiscount({ preserveCostInput: true });
  });
  ["fuelLogDateInput", "fuelLogMileageInput", "fuelLogTypeInput", "fuelLogFullTankInput", "fuelLogNoteInput"].forEach(id => {
    document.getElementById(id).addEventListener("input", clearFuelLogMessage);
    document.getElementById(id).addEventListener("change", clearFuelLogMessage);
  });

  // 汽油精添加
  document.getElementById("fuelModalClose").addEventListener("click", closeFuelModal);
  document.getElementById("fuelCancelBtn").addEventListener("click", closeFuelModal);
  document.getElementById("fuelModal").addEventListener("click", e => {
    if (e.target === document.getElementById("fuelModal")) closeFuelModal();
  });
  document.getElementById("fuelForm").addEventListener("submit", handleFuelSubmit);
  ["fuelMileageInput", "fuelCostInput", "fuelNoteInput"].forEach(id => {
    document.getElementById(id).addEventListener("input", clearFuelMessage);
  });

  // 刪除 Modal
  document.getElementById("deleteCancelBtn").addEventListener("click", closeDeleteModal);
  document.getElementById("deleteConfirmBtn").addEventListener("click", handleDeleteConfirm);
  document.getElementById("deleteModal").addEventListener("click", e => {
    if (e.target === document.getElementById("deleteModal")) closeDeleteModal();
  });

  // 類別篩選 Pills
  document.getElementById("filterPills").addEventListener("click", e => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    document.querySelectorAll(".pill").forEach(p => p.classList.remove("pill-active"));
    btn.classList.add("pill-active");
    currentFilter = btn.dataset.cat;
    renderRecords();
  });

  // 年份篩選
  document.getElementById("yearFilter").addEventListener("change", e => {
    currentYear = e.target.value;
    renderRecords();
  });

  // 搜尋
  let searchTimer;
  document.getElementById("searchInput").addEventListener("input", e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentSearch = e.target.value.trim();
      renderRecords();
    }, 200);
  });
});
