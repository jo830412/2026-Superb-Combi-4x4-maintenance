// ============================================================
// 雲端與本地儲存管理
// ============================================================
const STORAGE_KEY = "newSuperbMaintenanceRecords_v1";
const SYNC_META_KEY = "newSuperbSyncMeta_v1";
const LEGACY_LOCAL_STASH_KEY = "newSuperbLocalBeforeSyncUpgrade_v1";
const SYNC_GET_TIMEOUT_MS = 15000;
const SYNC_POST_TIMEOUT_MS = 30000;
const SYNC_RETRY_MIN_MS = 15000;
const SYNC_RETRY_MAX_MS = 5 * 60 * 1000;
const SYNC_RECHECK_INTERVAL_MS = 5 * 60 * 1000;
// 這些視窗開著時不替換紀錄陣列（它們以索引指向正在編輯的紀錄）。
const RECORD_EDITOR_MODAL_IDS = ["modal", "fuelLogModal", "mileageModal", "fuelModal", "deleteModal", "duplicateModal", "backupRestoreModal"];
const BACKUP_FORMAT = "superb-maintenance-backup";
const BACKUP_VERSION = 1;
const APP_VERSION = "v2026.10.05.3";
const THEME_STORAGE_KEY = "newSuperbTheme_v1";
const API_URL = "https://script.google.com/macros/s/AKfycbwg3zHXptNuR1tCFs_lFYxroASHXEpkl569YBdUD4WFBQc-icvnaHI4NHL0YgCQHVZ3BA/exec";
const WARRANTY_START_DATE = "2026-05-28";
const VEHICLE_DELIVERY_DATE = WARRANTY_START_DATE;
const VEHICLE_DELIVERY_MILEAGE_KM = 0;
const WARRANTY_MONTHS = 48;
const FIRST_INSPECTION_INTERVAL_MONTHS = 60;
// 定期保養：每 7,500 km 或 12 個月，以先到者為準；剩 1,000 km 或 30 天內提醒安排。
const MAINTENANCE_INTERVAL_KM = 7500;
const MAINTENANCE_SOON_KM = 1000;
const MAINTENANCE_INTERVAL_MONTHS = 12;
const MAINTENANCE_SOON_DAYS = 30;
// 依最近 90 天的里程推估開車速度；這段期間資料不足 14 天時改用交車以來的平均。
const DRIVING_PACE_WINDOW_DAYS = 90;
const DRIVING_PACE_MIN_DAYS = 14;
const SERVICE_CATEGORIES = ["保養", "維修", "更換", "改裝升級", "其他"];
const LEGAL_CATEGORIES = ["檢驗/稅費", "其他"];
const DEFAULT_FUEL_TYPE = "98";
const DEFAULT_FUEL_DISCOUNT = 1.8;
const FUEL_PRICE_SOURCE_URL = "https://www.npcgas.com.tw/Consultant/Oil";
const FUEL_PRICE_CACHE_KEY = "newSuperbFuelPrices_v2";
const FUEL_PRICE_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const FUEL_PRICE_RECHECK_MS = 60 * 60 * 1000;
const AI_CONTEXT_RECORD_LIMIT = 20;
const RECORDS_PAGE_SIZE = 50;
const CHART_JS_URL = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js";
const CHART_JS_SRI = "sha256-Mh46P6mNpKqpV9EL5Xy7UU3gmJ7tj51ya10FkCzQGQQ=";
const TESSERACT_JS_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const TESSERACT_JS_SRI = "sha256-qOKZGNCYsrBuEBK9rv+0rsBEXF1WVHCQI+C9H0QqgOg=";
const OCR_MAX_IMAGE_SIDE = 2000;
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
    categories: LEGAL_CATEGORIES,
    month: 4,
    startDay: 1,
    endDay: 30,
    amount: 11230
  },
  {
    name: "公路養管費",
    icon: "路",
    terms: ["燃料稅", "燃料費", "汽燃費", "公路養管費"],
    categories: LEGAL_CATEGORIES,
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
let recordsVisibleLimit = RECORDS_PAGE_SIZE;
let deleteTargetIndex = -1;
let costChart = null;
let catChart = null;
let fuelTrendChart = null;
let lastSyncAt = null;
let lastCloudCheckAt = 0;
let syncMeta = null;
let syncRunning = null;
let syncRequest = null;
let syncRetryTimer = null;
let syncRetryDelayMs = SYNC_RETRY_MIN_MS;
let syncDeferredForEditor = false;
let photoMode = "fuel";
let photoParsed = null;
let photoPreviewUrl = "";
let aiBackendReady = null;
let fuelEditIndex = -1;
let activeView = "overview";
let activeRecordsSubtab = "all";
let lastUndo = null;
let toastTimer = null;
let pendingRestoreRecords = null;
let pendingDuplicateSave = null;
let backupDownloadSpy = null;
let pendingCalendarTask = null;
let renderedOwnerActions = [];

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
  brakeFluid: {
    category: "保養",
    detail: "煞車油更換",
    note: ""
  },
  haldex: {
    category: "保養",
    detail: "四驅（Haldex）油更換",
    note: ""
  },
  sparkPlugs: {
    category: "更換",
    detail: "火星塞更換（4 顆）",
    note: ""
  },
  airFilter: {
    category: "更換",
    detail: "空氣濾芯更換",
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

// 只是檢查、補充、換位等，不算更換；category 限制避免「保險桿」被當成保險。
const OIL_CHECK_PHRASES = ["檢查機油", "機油檢查", "補機油", "機油補充", "添加機油", "機油添加", "機油尺", "機油燈", "機油壓力"];
// 同時有里程與月數的項目以先到者為準。間隔依原廠與保養資料整理，見 README「Maintenance Tracking」。
const CONSUMABLE_RULES = [
  { name: "定期保養", icon: "🛢", maintenance: true },
  { name: "變速箱油", icon: "⚙", terms: ["變速箱油", "閥體油"], categories: SERVICE_CATEGORIES, ignore: ["檢查變速箱油", "變速箱油檢查"], soonKm: 40000, dueKm: 60000 },
  { name: "四驅油", icon: "驅", terms: ["四驅油", "四驅離合器油", "四輪傳動油", "Haldex", "haldex"], categories: SERVICE_CATEGORIES, ignore: ["檢查四驅油", "四驅油檢查"], soonKm: 55000, dueKm: 60000, soonMonths: 22, dueMonths: 24 },
  { name: "火星塞", icon: "⚡", terms: ["火星塞"], categories: SERVICE_CATEGORIES, ignore: ["檢查火星塞", "火星塞檢查"], soonKm: 55000, dueKm: 60000, soonMonths: 45, dueMonths: 48 },
  { name: "空氣濾芯", icon: "🌀", terms: ["空氣濾芯", "空氣濾清器", "引擎空氣濾網", "空濾"], categories: SERVICE_CATEGORIES, ignore: ["檢查空氣濾芯", "空氣濾芯檢查", "冷氣空濾"], soonKm: 25000, dueKm: 30000, soonMonths: 22, dueMonths: 24 },
  { name: "冷氣濾網", icon: "❄", terms: ["冷氣濾網", "冷氣濾心"], categories: SERVICE_CATEGORIES, ignore: ["檢查冷氣濾網", "冷氣濾網檢查"], soonKm: 10000, dueKm: 15000 },
  { name: "輪胎", icon: "輪", terms: ["輪胎"], categories: SERVICE_CATEGORIES, ignore: ["輪胎換位", "輪胎檢查", "檢查輪胎", "輪胎平衡", "輪胎打氣", "輪胎胎壓"], soonKm: 40000, dueKm: 50000 },
  // 前輪 ZL1 卡鉗的來令片沒有固定週期：約 30,000 km 檢查厚度，量過可記「來令片檢查」重新起算；後輪另計。
  { name: "ZL1 來令片", icon: "煞", terms: ["來令片", "煞車皮", "煞車片"], categories: SERVICE_CATEGORIES, ignore: ["後來令片", "後輪來令片", "後煞車皮", "後煞車片"], soonKm: 25000, dueKm: 30000, note: "依磨耗更換，剩 3 mm 以下就換；量過厚度可記一筆「來令片檢查」重新計算。" },
  // 煞車油：新車第一次 3 年，之後每 2 年。
  { name: "煞車油", icon: "制", terms: ["煞車油"], categories: SERVICE_CATEGORIES, ignore: ["檢查煞車油", "煞車油檢查"], soonMonths: 22, dueMonths: 24, firstDueFrom: VEHICLE_DELIVERY_DATE, firstDueMonths: 36, firstDueMeta: "新車第一次 3 年，之後每 2 年" },
  { name: "電瓶", icon: "🔋", terms: ["電瓶"], categories: SERVICE_CATEGORIES, ignore: ["電瓶檢查", "檢查電瓶", "電瓶測試", "測電瓶", "電瓶充電"], soonMonths: 36, dueMonths: 48 },
  { name: "保險", icon: "🛡", terms: ["保險", "強制險", "任意險", "續保", "產險"], matchCategory: "保險", categories: ["保險", "其他"], ignore: ["保險桿", "保險絲"], soonMonths: 11, dueMonths: 12 },
  {
    name: "驗車",
    icon: "📅",
    terms: ["驗車", "定檢", "定期檢驗", "車輛檢驗"],
    categories: LEGAL_CATEGORIES,
    soonMonths: 11,
    dueMonths: 12,
    firstDueFrom: VEHICLE_DELIVERY_DATE,
    firstDueMonths: FIRST_INSPECTION_INTERVAL_MONTHS,
    firstDueMeta: "自用小客車新車未滿 5 年免定檢"
  }
];
const FUEL_ADDITIVE_RULE = { terms: ["汽油精"] };
const TAX_RULE = { terms: ["牌照稅", "燃料稅", "燃料費", "汽燃費", "公路養管費"], categories: LEGAL_CATEGORIES };

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

// ------------------------------------------------------------
// 同步：本機保留「上次確認的雲端版本」(base)，所有上傳排成單一佇列。
// 雲端在這段期間被其他裝置改過時，以整筆紀錄為單位做三方合併，不丟資料。
// ------------------------------------------------------------
function canonicalizeRecord(record) {
  const toText = value => value == null ? "" : String(value);
  const mileage = record?.mileage === "" || record?.mileage == null ? null : Number(record.mileage);
  const cost = record?.cost === "" || record?.cost == null ? 0 : Number(record.cost);
  return {
    date: toText(record?.date),
    mileage: Number.isFinite(mileage) ? mileage : null,
    category: toText(record?.category),
    cost: Number.isFinite(cost) ? cost : 0,
    detail: toText(record?.detail),
    note: toText(record?.note)
  };
}

function recordKey(record) {
  const value = canonicalizeRecord(record);
  return JSON.stringify([value.date, value.mileage, value.category, value.cost, value.detail, value.note]);
}

function countRecordKeys(list) {
  const counts = new Map();
  (list || []).forEach(record => {
    const key = recordKey(record);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

function sameRecordSet(a, b) {
  if ((a || []).length !== (b || []).length) return false;
  const counts = countRecordKeys(a);
  for (const record of b || []) {
    const key = recordKey(record);
    const left = counts.get(key) || 0;
    if (!left) return false;
    counts.set(key, left - 1);
  }
  return true;
}

function mergeRecordLists(baseList, localList, cloudList) {
  const base = countRecordKeys(baseList);
  const local = countRecordKeys(localList);
  const cloud = countRecordKeys(cloudList);
  const remaining = new Map();
  let cloudChanges = 0;
  new Set([...base.keys(), ...local.keys(), ...cloud.keys()]).forEach(key => {
    const b = base.get(key) || 0;
    const l = local.get(key) || 0;
    const c = cloud.get(key) || 0;
    let count;
    if (l === b) count = c;
    else if (c === b || l === c) count = l;
    else count = Math.max(l, c);
    if (count === c && c !== b) cloudChanges += Math.abs(c - b);
    remaining.set(key, count);
  });

  const merged = [];
  const take = (list, toRecord) => (list || []).forEach(record => {
    const key = recordKey(record);
    const left = remaining.get(key) || 0;
    if (!left) return;
    merged.push(toRecord(record));
    remaining.set(key, left - 1);
  });
  take(localList, record => record);
  take(cloudList, canonicalizeRecord);
  return { records: merged, cloudChanges };
}

function emptySyncMeta() {
  return {
    version: 1,
    baseFingerprint: "",
    baseRecords: [],
    dirty: false,
    pendingRestore: false,
    lastAttempt: null
  };
}

function loadSyncMeta() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SYNC_META_KEY) || "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return {
      ...emptySyncMeta(),
      ...parsed,
      baseRecords: Array.isArray(parsed.baseRecords) ? parsed.baseRecords : []
    };
  } catch (error) {
    console.error("讀取同步狀態失敗", error);
    return null;
  }
}

function persistSyncMeta() {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(syncMeta));
  } catch (error) {
    console.error("儲存同步狀態失敗", error);
  }
}

function persistLocalRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function isRecordEditorOpen() {
  return RECORD_EDITOR_MODAL_IDS.some(id => document.getElementById(id)?.style.display === "flex");
}

function stashLegacyLocalRecords(list) {
  try {
    localStorage.setItem(LEGACY_LOCAL_STASH_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      records: list
    }));
  } catch (error) {
    console.error("另存升級前的本機資料失敗", error);
  }
  showToast("已改用雲端資料；先前本機不同的版本已另存，可在「資料管理」下載。", null, { routine: true });
  updateLegacyStashButton();
}

function getLegacyLocalStash() {
  try {
    const stash = JSON.parse(localStorage.getItem(LEGACY_LOCAL_STASH_KEY) || "null");
    return stash && Array.isArray(stash.records) ? stash : null;
  } catch (error) {
    return null;
  }
}

function updateLegacyStashButton() {
  const button = document.getElementById("btnLegacyStashDownload");
  if (button) button.hidden = !getLegacyLocalStash();
}

function downloadLegacyLocalStash() {
  const stash = getLegacyLocalStash();
  if (!stash) return;
  if (downloadJsonBackup(stash.records.map(canonicalizeRecord), "升級前本機資料")) {
    localStorage.removeItem?.(LEGACY_LOCAL_STASH_KEY);
    updateLegacyStashButton();
  } else {
    showToast("備份下載失敗，請再試一次。");
  }
}

async function fetchCloudState() {
  const res = await fetchWithTimeout(API_URL + "?action=syncState", { cache: "no-store" }, SYNC_GET_TIMEOUT_MS);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const state = parseCloudState(await res.json());
  if (!state.fingerprint) throw new Error("雲端尚未支援版本檢查，請先部署最新的 Apps Script。");
  return state;
}

async function postRecordsToCloud(snapshot, { expectedFingerprint, allowDestructiveReplace }) {
  const res = await fetchWithTimeout(API_URL, {
    method: "POST",
    body: JSON.stringify({
      records: snapshot,
      expectedFingerprint,
      allowDestructiveReplace,
      reason: allowDestructiveReplace ? "restore" : "save"
    }),
    redirect: "follow"
  }, SYNC_POST_TIMEOUT_MS);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const result = await res.json();
  if (!result || typeof result !== "object") throw new Error("雲端回應格式不正確");
  return result;
}

// 回傳 { changed, cloudChanges }：changed 代表畫面上的紀錄被雲端內容更新。
function applyCloudState(cloud) {
  const cloudRecords = cloud.records.map(canonicalizeRecord);
  const meta = syncMeta;

  if (meta.lastAttempt) {
    // 上次上傳沒有收到回應：雲端若等於當時送出的內容，代表其實已寫入。
    if (sameRecordSet(cloudRecords, meta.lastAttempt.records)) {
      meta.baseRecords = meta.lastAttempt.records;
      meta.baseFingerprint = cloud.fingerprint;
      meta.pendingRestore = false;
    }
    meta.lastAttempt = null;
  }

  if (meta.legacyLocal) {
    meta.legacyLocal = false;
    if (meta.baseRecords.length && !sameRecordSet(meta.baseRecords, cloudRecords)) {
      if (!cloudRecords.length) {
        meta.baseRecords = [];
        meta.baseFingerprint = cloud.fingerprint;
        meta.dirty = true;
        persistSyncMeta();
        return { changed: false, cloudChanges: 0 };
      }
      stashLegacyLocalRecords(meta.baseRecords);
    }
  }

  if (!meta.dirty) {
    const changed = !sameRecordSet(records, cloudRecords);
    records = cloudRecords.map(record => ({ ...record }));
    meta.baseRecords = cloudRecords;
    meta.baseFingerprint = cloud.fingerprint;
    persistLocalRecords();
    persistSyncMeta();
    return { changed, cloudChanges: 0 };
  }

  if (sameRecordSet(records, cloudRecords)) {
    meta.baseRecords = cloudRecords;
    meta.baseFingerprint = cloud.fingerprint;
    meta.dirty = false;
    meta.pendingRestore = false;
    persistSyncMeta();
    return { changed: false, cloudChanges: 0 };
  }

  if (meta.pendingRestore || cloud.fingerprint === meta.baseFingerprint || sameRecordSet(cloudRecords, meta.baseRecords)) {
    // 雲端在這段期間沒有其他變更（或使用者確認要整批還原）：直接上傳本機版本。
    meta.baseRecords = cloudRecords;
    meta.baseFingerprint = cloud.fingerprint;
    persistSyncMeta();
    return { changed: false, cloudChanges: 0 };
  }

  const merged = mergeRecordLists(meta.baseRecords, records, cloudRecords);
  records = merged.records;
  meta.baseRecords = cloudRecords;
  meta.baseFingerprint = cloud.fingerprint;
  meta.dirty = !sameRecordSet(records, cloudRecords);
  persistLocalRecords();
  persistSyncMeta();
  return { changed: true, cloudChanges: merged.cloudChanges };
}

async function reconcileWithCloud() {
  setSyncStatus("syncing", "同步中");
  let cloud;
  try {
    cloud = await fetchCloudState();
  } catch (error) {
    console.error("讀取雲端失敗，使用本機資料", error);
    markSyncUnreachable();
    return false;
  }
  lastCloudCheckAt = Date.now();
  if (isRecordEditorOpen()) {
    // 表單開著時不替換紀錄，避免編輯中的索引對到別筆；關閉後再同步。
    syncDeferredForEditor = true;
    return false;
  }
  const result = applyCloudState(cloud);
  if (!syncMeta.dirty) lastSyncAt = new Date();
  if (result.changed) {
    refresh();
    if (result.cloudChanges) {
      showToast(`已合併其他裝置的 ${result.cloudChanges} 項變更`, null, { routine: true });
    }
  }
  return true;
}

async function pushLocalChanges() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = records.map(canonicalizeRecord);
    const restore = Boolean(syncMeta.pendingRestore);
    syncMeta.lastAttempt = { fingerprint: syncMeta.baseFingerprint, records: snapshot };
    persistSyncMeta();
    setSyncStatus("syncing", "同步中");

    let result;
    try {
      result = await postRecordsToCloud(snapshot, {
        expectedFingerprint: syncMeta.baseFingerprint,
        allowDestructiveReplace: restore
      });
    } catch (error) {
      // 不確定雲端是否已寫入：保留 lastAttempt，下次先讀雲端比對。
      console.error("同步至雲端失敗", error);
      markSyncUnreachable();
      return false;
    }

    if (result.status === "success" && typeof result.fingerprint === "string" && result.fingerprint) {
      syncMeta.baseRecords = snapshot;
      syncMeta.baseFingerprint = result.fingerprint;
      syncMeta.lastAttempt = null;
      if (restore) syncMeta.pendingRestore = false;
      syncMeta.dirty = !sameRecordSet(records, snapshot);
      persistSyncMeta();
      lastSyncAt = new Date();
      lastCloudCheckAt = Date.now();
      syncRetryDelayMs = SYNC_RETRY_MIN_MS;
      if (syncMeta.dirty) syncRequest = syncRequest || { reconcile: false };
      updateSyncStatusFromMeta();
      return true;
    }

    if (result.status === "conflict") {
      syncMeta.lastAttempt = null;
      persistSyncMeta();
      if (!await reconcileWithCloud()) return false;
      if (!syncMeta.dirty) {
        updateSyncStatusFromMeta();
        return true;
      }
      continue;
    }

    if (result.status === "rejected") {
      syncMeta.lastAttempt = null;
      persistSyncMeta();
      setSyncStatus("error", "同步失敗", (result.message || "雲端拒絕這次同步") + " 本機資料仍保留。");
      return false;
    }

    setSyncStatus("error", "同步失敗", (result.message || "雲端同步失敗") + " 本機資料仍保留，稍後會自動重試。");
    scheduleSyncRetry();
    return false;
  }
  setSyncStatus("error", "同步失敗", "雲端資料持續變動，稍後會自動重試。本機資料仍保留。");
  scheduleSyncRetry();
  return false;
}

async function syncOnce({ reconcile = false } = {}) {
  if (!syncMeta) syncMeta = emptySyncMeta();
  if (reconcile || !syncMeta.baseFingerprint || syncMeta.lastAttempt) {
    if (!await reconcileWithCloud()) return;
  }
  if (!syncMeta.dirty) {
    updateSyncStatusFromMeta();
    return;
  }
  await pushLocalChanges();
}

function requestSync({ reconcile = false } = {}) {
  if (syncRunning) {
    syncRequest = { reconcile: reconcile || Boolean(syncRequest?.reconcile) };
    return syncRunning;
  }
  syncRunning = (async () => {
    let next = { reconcile };
    while (next) {
      syncRequest = null;
      await syncOnce(next);
      next = syncRequest;
    }
  })().finally(() => {
    syncRunning = null;
    if (syncRequest) {
      const pending = syncRequest;
      syncRequest = null;
      requestSync(pending);
    }
  });
  return syncRunning;
}

function scheduleSyncRetry() {
  if (syncRetryTimer) return;
  const delay = syncRetryDelayMs;
  syncRetryDelayMs = Math.min(syncRetryDelayMs * 2, SYNC_RETRY_MAX_MS);
  syncRetryTimer = setTimeout(() => {
    syncRetryTimer = null;
    if (syncMeta?.dirty || syncMeta?.lastAttempt) requestSync({ reconcile: true });
  }, delay);
}

function resumeDeferredSync() {
  if (!syncDeferredForEditor || isRecordEditorOpen()) return;
  syncDeferredForEditor = false;
  requestSync({ reconcile: true });
}

function markSyncUnreachable() {
  if (syncMeta?.dirty || syncMeta?.lastAttempt) {
    setSyncStatus("warn", "未同步", "已存本機，連線後會自動上傳");
    scheduleSyncRetry();
  } else {
    setSyncStatus("warn", "離線", "目前顯示本機資料");
  }
}

function updateSyncStatusFromMeta() {
  if (syncMeta?.dirty) {
    setSyncStatus("syncing", "同步中");
  } else {
    setSyncStatus("ok", "已同步", lastSyncAt ? formatTime(lastSyncAt) : "");
  }
}

async function initData() {
  const storedMeta = loadSyncMeta();
  records = loadLocalRecords().map(canonicalizeRecord);
  syncMeta = storedMeta || { ...emptySyncMeta(), legacyLocal: true, baseRecords: records.map(canonicalizeRecord) };
  updateLegacyStashButton();

  if (records.length) {
    refresh();
  } else {
    document.getElementById("recordsContainer").innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>正在從雲端同步資料...</p></div>';
  }
  setSyncStatus("syncing", "同步中");
  await requestSync({ reconcile: true });
  if (!records.length) refresh();
}

function saveRecords(data = records, { announce = true, allowDestructiveReplace = false } = {}) {
  records = data;
  persistLocalRecords();
  if (!syncMeta) syncMeta = emptySyncMeta();
  syncMeta.dirty = true;
  if (allowDestructiveReplace) syncMeta.pendingRestore = true;
  persistSyncMeta();
  setSyncStatus("syncing", "同步中");
  if (announce) showToast("已儲存，正在同步", null, { routine: true });
  return requestSync();
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

// 狀態列只放簡短狀態（手機寬度有限）；詳細說明放在 data-detail，桌面版顯示在旁邊，手機點一下會跳出。
function setSyncStatus(state, label, detail = "") {
  const el = document.getElementById("syncStatus");
  if (!el) return;
  el.className = "sync-status sync-" + state;
  el.textContent = label;
  el.dataset.detail = detail;
  const message = detail ? `${label}：${detail}` : label;
  el.title = state === "error" || state === "warn" ? message + "（點擊可重試同步）" : message;
  el.setAttribute("aria-label", el.title);
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

// 只檢查結構；內容可以空白（例如試算表手動補的列），才不會出現匯得出、還原不了的備份。
function getStoredRecordValidationError(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return "紀錄格式不正確";
  }
  for (const field of ["date", "category", "detail", "note"]) {
    if (typeof record[field] !== "string") {
      return `紀錄的 ${field} 必須是文字`;
    }
  }
  if (record.mileage !== null && !Number.isFinite(record.mileage)) {
    return "紀錄的里程必須是數字或空白";
  }
  if (!Number.isFinite(record.cost)) {
    return "紀錄的費用必須是數字";
  }
  if (!record.date.trim() && !record.category.trim() && !record.detail.trim()) {
    return "紀錄沒有日期、類別與內容";
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
    records: sourceRecords.map(canonicalizeRecord)
  };
}

function validateBackupEnvelope(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, error: "備份內容不是有效的備份檔" };
  }
  if (candidate.format !== BACKUP_FORMAT) {
    return { ok: false, error: "不是這個 App 匯出的備份檔" };
  }
  if (candidate.version !== BACKUP_VERSION) {
    return { ok: false, error: "備份檔版本不支援" };
  }
  if (!Array.isArray(candidate.records)) {
    return { ok: false, error: "備份檔缺少紀錄清單" };
  }

  for (const [index, record] of candidate.records.entries()) {
    const error = getStoredRecordValidationError(record);
    if (error) return { ok: false, error: `第 ${index + 1} 筆${error}` };
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
    openDialog("backupRestoreModal", { focusId: "backupRestoreCancelBtn" });
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
  closeDialog("backupRestoreModal");
}

function confirmBackupRestore() {
  if (!pendingRestoreRecords) return;

  if (!downloadJsonBackup(records, "還原前")) {
    showToast("還原前備份下載失敗，尚未還原資料，請再試一次。");
    return;
  }
  records = pendingRestoreRecords.map(record => ({ ...record }));
  pendingRestoreRecords = null;
  saveRecords(records, { announce: false, allowDestructiveReplace: true });
  closeBackupRestoreModal();
  refresh();
  showToast(`已還原 ${records.length} 筆紀錄`);
}

function getDuplicateKey(value) {
  return [value.date, value.mileage ?? "", value.category]
    .map(part => String(part).trim())
    .join("|");
}

function findLikelyDuplicates(record, { excludeIndex = -1 } = {}) {
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
  openDialog("duplicateModal", { focusId: "duplicateCancelBtn" });
}

function closeDuplicateModal() {
  pendingDuplicateSave = null;
  closeDialog("duplicateModal");
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
function compareRecordValuesNewestFirst(a, b) {
  const dateCompare = String(b.date || "").localeCompare(String(a.date || ""));
  if (dateCompare) return dateCompare;

  const mileageA = Number(a.mileage);
  const mileageB = Number(b.mileage);
  const hasMileageA = Number.isFinite(mileageA);
  const hasMileageB = Number.isFinite(mileageB);
  if (hasMileageA && hasMileageB && mileageA !== mileageB) return mileageB - mileageA;
  if (hasMileageA !== hasMileageB) return hasMileageB ? 1 : -1;
  return 0;
}
function compareRecordsNewestFirst(a, b) {
  return compareRecordValuesNewestFirst(a, b) || records.indexOf(b) - records.indexOf(a);
}
// refresh() 期間相同的衍生資料只計算一次。
let renderCache = null;
function cachedForRender(key, compute) {
  if (!renderCache) return compute();
  if (!renderCache.has(key)) renderCache.set(key, compute());
  return renderCache.get(key);
}
function getRecordsNewestFirst() {
  return cachedForRender("recordsNewestFirst", () => records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => compareRecordValuesNewestFirst(a.record, b.record) || b.index - a.index)
    .map(entry => entry.record));
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
function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
function diffMonths(from, to = now()) {
  if (!from) return 0;
  return Math.max(0, (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth());
}
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function diffDays(from, to = now()) {
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
  return cachedForRender("fuelStats", computeFuelStats);
}
function computeFuelStats() {
  const logs = getFuelLogs();
  const totalCost = logs.reduce((sum, log) => sum + log.cost, 0);
  let anchor = null;
  let litersSinceAnchor = 0;
  let costSinceAnchor = 0;
  const segments = [];

  logs.forEach(log => {
    if (!anchor) {
      if (log.fullTank) anchor = log;
      return;
    }

    litersSinceAnchor += log.liters;
    costSinceAnchor += log.cost;
    if (log.fullTank) {
      const distance = log.mileage - anchor.mileage;
      if (distance > 0 && litersSinceAnchor > 0) {
        segments.push({
          date: log.date,
          mileage: log.mileage,
          sourceIndex: log.sourceIndex,
          distance,
          liters: litersSinceAnchor,
          cost: costSinceAnchor,
          kmPerLiter: distance / litersSinceAnchor,
          costPerKm: costSinceAnchor > 0 ? costSinceAnchor / distance : null
        });
      }
      anchor = log;
      litersSinceAnchor = 0;
      costSinceAnchor = 0;
    }
  });

  const totalDistance = segments.reduce((sum, segment) => sum + segment.distance, 0);
  const totalLiters = segments.reduce((sum, segment) => sum + segment.liters, 0);
  const pricedSegments = segments.filter(segment => segment.costPerKm != null);
  const pricedDistance = pricedSegments.reduce((sum, segment) => sum + segment.distance, 0);
  const pricedCost = pricedSegments.reduce((sum, segment) => sum + segment.cost, 0);
  return {
    logs,
    segments,
    totalCost,
    averageKmPerLiter: totalDistance > 0 && totalLiters > 0 ? totalDistance / totalLiters : null,
    latestKmPerLiter: segments.length ? segments[segments.length - 1].kmPerLiter : null,
    averageCostPerKm: pricedDistance > 0 ? pricedCost / pricedDistance : null
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
            key: `mileage|${date}|${mileage}`,
            recordIndex: records.findIndex(record => record?.date === date && Number(record?.mileage) === mileage)
          }]
        : [];
      priorMax = priorMax == null ? mileage : Math.max(priorMax, mileage);
      return issue;
    });
}
function getDuplicateRecordIssues() {
  const groups = new Map();
  records.forEach((record, index) => {
    if (isMileageUpdateRecord(record)) return;
    const key = getDuplicateKey(record);
    groups.set(key, [...(groups.get(key) || []), index]);
  });
  return [...groups.entries()]
    .filter(([, indexes]) => indexes.length > 1)
    .map(([key, indexes]) => {
      const record = records[indexes[0]];
      return {
        type: "duplicate",
        date: record.date || "",
        title: "可能重複的紀錄",
        detail: `${record.date || "未填日期"} · ${Number.isFinite(Number(record.mileage)) && record.mileage != null ? Number(record.mileage).toLocaleString("zh-TW") : "—"} km · ${record.category || "其他"} 有 ${indexes.length} 筆，請確認是否重複登錄。`,
        key: "duplicate|" + key,
        recordIndex: indexes[indexes.length - 1]
      };
    });
}
function getDataQualityIssues() {
  return cachedForRender("dataQualityIssues", computeDataQualityIssues);
}
function computeDataQualityIssues() {
  const issues = [...getMileageRegressionIssues(), ...getDuplicateRecordIssues()];
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
      key: `fuel|${segment.date}|${segment.mileage}`,
      recordIndex: segment.sourceIndex
    });
  });
  return issues;
}
function stripPhrases(text, phrases = []) {
  return phrases.reduce((result, phrase) => result.split(phrase).join(" "), String(text || ""));
}
function recordMatchesRule(record, rule) {
  if (!record || isMileageUpdateRecord(record)) return false;
  if (rule.matchCategory && record.category === rule.matchCategory) return true;
  if (rule.categories && !rule.categories.includes(record.category)) return false;
  const text = stripPhrases(`${record.detail || ""} ${record.note || ""}`, rule.ignore);
  return rule.terms.some(term => text.includes(term));
}
// 測試可固定「今天」，讓到期判斷不隨執行日期改變。
let nowOverride = null;
function now() {
  return nowOverride ? new Date(nowOverride) : new Date();
}
function getTodayString() {
  const d = now();
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
  const source = String(text || "");
  if (/保險|強制險|任意險|保單/.test(stripPhrases(source, ["保險桿", "保險絲"]))) return "保險";
  if (/驗車|檢驗|牌照稅|燃料稅|稅/.test(source)) return "檢驗/稅費";
  if (/保險桿|烤漆|鈑金|板金|刮傷|凹陷|擦撞/.test(source)) return "維修";
  if (/輪胎換位|四輪定位/.test(source)) return "保養";
  if (/輪胎|電瓶|更換/.test(source)) return "更換";
  if (/故障|維修|檢修|漏|異音/.test(source)) return "維修";
  if (/洗車|美容|鍍膜|清潔/.test(source)) return "清潔美容";
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
  const serviceRecords = getServiceRecords();
  const today = now();
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

  const lastMaint = getLastMaintenanceRecord();
  document.getElementById("statLastMaintenance").textContent =
    lastMaint?.date ? lastMaint.date.substring(0, 7) : "—";

  // 總覽只看用車成本（油、保養維修、保險稅費），改裝美容另外列在「更多車況」。
  const recentSplit = getCostSplit(oneYearAgo);
  const recentKm = getMileageDrivenSince(oneYearAgo);
  document.getElementById("statRecentCost").textContent = recentSplit.running > 0
    ? formatCompactCost(recentSplit.running)
    : "0";
  document.getElementById("statRecentCostMeta").textContent = recentSplit.running > 0 && recentKm > 0
    ? `每公里 ${(recentSplit.running / recentKm).toFixed(1)} 元\n其中油錢 ${(recentSplit.fuel / recentKm).toFixed(1)} 元`
    : "油、保養維修、保險稅費";

  const totalSplit = getCostSplit();
  document.getElementById("statUpgradeCost").textContent = totalSplit.upgrades > 0
    ? formatCompactCost(totalSplit.upgrades)
    : "0";
  document.getElementById("statUpgradeLabel").textContent = totalSplit.upgradeCount
    ? `改裝美容 NT$・${totalSplit.upgradeCount} 項`
    : "改裝美容 NT$";
  document.getElementById("btnUpgradeList").hidden = totalSplit.upgradeCount === 0;

  const fuelStats = getFuelStats();
  document.getElementById("statAvgFuel").textContent = fuelStats.averageKmPerLiter
    ? fuelStats.averageKmPerLiter.toFixed(1)
    : fuelStats.logs.length ? "待計算" : "—";
  document.getElementById("statLastFuel").textContent = fuelStats.latestKmPerLiter
    ? fuelStats.latestKmPerLiter.toFixed(1)
    : fuelStats.logs.length ? "待計算" : "—";
  document.getElementById("statLastFuelMeta").textContent = fuelStats.averageKmPerLiter
    ? `平均 ${fuelStats.averageKmPerLiter.toFixed(1)} km/L`
    : "";
  const warrantyStart = parseDate(WARRANTY_START_DATE);
  document.getElementById("statWarrantyStart").textContent = warrantyStart
    ? formatDateYMD(addMonths(warrantyStart, WARRANTY_MONTHS))
    : "—";

  renderMaintenanceHero(getMaintenanceSchedule(today));

  const fuelAdditiveEl = document.getElementById("statFuelAdditive");
  const fuelAdditiveLabel = document.getElementById("statFuelAdditiveLabel");
  const lastFuelAdditive = getRecordsNewestFirst().find(r => recordMatchesRule(r, FUEL_ADDITIVE_RULE));
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

function renderMaintenanceHero(schedule) {
  const valueEl = document.getElementById("statNextMaintenance");
  const metaEl = document.getElementById("statNextMaintenanceMeta");
  const progressEl = document.getElementById("maintenanceProgress");
  const barEl = document.getElementById("maintenanceProgressBar");
  const container = document.getElementById("dashboardNextService");
  if (container?.dataset) container.dataset.status = schedule.status;
  valueEl.textContent = schedule.status === "due" && schedule.remainingKm == null
    ? "該保養"
    : describeMaintenanceRemaining(schedule);
  if (metaEl) metaEl.textContent = describeMaintenanceDates(schedule);
  const logButton = document.getElementById("btnLogMaintenance");
  if (logButton) logButton.hidden = schedule.status !== "soon" && schedule.status !== "due";
  if (progressEl && barEl) {
    progressEl.hidden = schedule.progress == null;
    progressEl.className = "maintenance-progress maintenance-progress-" + schedule.status;
    progressEl.setAttribute("aria-valuenow", String(schedule.usedKm ?? 0));
    progressEl.setAttribute("aria-valuetext", valueEl.textContent);
    barEl.style.width = Math.round((schedule.progress ?? 0) * 100) + "%";
  }
}

function getLatestMatchingRecord(rule) {
  return getRecordsNewestFirst().find(r => recordMatchesRule(r, rule));
}

function formatTimeRemaining(days) {
  return days > 60 ? `剩 ${Math.floor(days / 30.44)} 個月` : `剩 ${days} 天`;
}

function buildDateTrackerState({ dueDate, soonDate, today, meta, next }) {
  const daysLeft = diffDays(dueDate, today);
  if (daysLeft <= 0) return { status: "due", value: "該處理", meta, next, dueDate };
  return { status: today >= soonDate ? "soon" : "ok", value: formatTimeRemaining(daysLeft), meta, next, dueDate };
}

function buildTrackerState(rule, today = now()) {
  if (rule.maintenance) return buildMaintenanceTrackerState(getMaintenanceSchedule(today));
  const latest = getLatestMatchingRecord(rule);
  const hasMonthLimit = rule.dueMonths || (!latest && rule.firstDueMonths);
  if (!rule.dueKm) return buildMonthTrackerState(rule, latest, today);
  if (!hasMonthLimit) return buildKmTrackerState(rule, latest);
  return combineTrackerStates(buildKmTrackerState(rule, latest), buildMonthTrackerState(rule, latest, today));
}

const TRACKER_STATUS_RANK = { missing: 0, ok: 1, soon: 2, due: 3 };

// 里程或月數先到者為準：顯示比較急的那一項；一樣急時顯示會先到的那一項，另一項放在補充說明。
function combineTrackerStates(kmState, monthState) {
  if (kmState.status === "missing") {
    return { ...monthState, next: [monthState.next, "最近紀錄缺少里程，先只看時間。"].filter(Boolean).join("；") };
  }
  if (monthState.status === "missing") return kmState;
  const projectedDate = projectMileageDate(kmState.dueMileage);
  const dueDate = [projectedDate, monthState.dueDate].filter(Boolean).sort((a, b) => a - b)[0];
  const kmRank = TRACKER_STATUS_RANK[kmState.status];
  const monthRank = TRACKER_STATUS_RANK[monthState.status];
  const kmFirst = kmRank === monthRank ? !projectedDate || projectedDate <= monthState.dueDate : kmRank > monthRank;
  if (kmFirst) {
    return {
      ...kmState,
      next: [`最晚 ${formatDateYMD(monthState.dueDate)}，以先到者為準。`, kmState.next].filter(Boolean).join(""),
      dueDate,
      dueMileage: kmState.dueMileage
    };
  }
  return {
    ...monthState,
    meta: `${monthState.meta} 或達 ${kmState.dueMileage.toLocaleString("zh-TW")} km`,
    dueDate,
    dueMileage: kmState.dueMileage
  };
}

// 依里程：從上次紀錄的里程算起，沒有紀錄時從交車里程算起。
function buildKmTrackerState(rule, latest) {
  const baseMileage = latest ? Number(latest.mileage) : getVehicleBaselineMileage();
  if (latest && (!Number.isFinite(baseMileage) || baseMileage <= 0)) {
    return {
      status: "missing",
      value: "缺里程",
      meta: latest.date ? `最近 ${latest.date}` : "最近紀錄缺少里程"
    };
  }
  const usedKm = Math.max(getEffectiveCurrentMileage() - baseMileage, 0);
  const meta = latest
    ? `上次 ${baseMileage.toLocaleString("zh-TW")} km / 已跑 ${usedKm.toLocaleString("zh-TW")} km`
    : `${getBaselineMetaPrefix()} / 已跑 ${usedKm.toLocaleString("zh-TW")} km`;
  const next = [latest ? "" : "尚無更換紀錄，先以新車交車基準推估。", rule.note].filter(Boolean).join("");
  const dueMileage = baseMileage + rule.dueKm;
  if (usedKm >= rule.dueKm) return { status: "due", value: "該處理", meta, next, dueMileage };
  return {
    status: usedKm >= rule.soonKm ? "soon" : "ok",
    value: `剩 ${(rule.dueKm - usedKm).toLocaleString("zh-TW")} km`,
    meta,
    next,
    dueMileage
  };
}

// 依月數：從上次紀錄的日期算起；沒有紀錄時用第一次的期限（驗車、煞車油）或交車日。
function buildMonthTrackerState(rule, latest, today) {
  if (!latest && rule.firstDueMonths) {
    const startDate = parseDate(rule.firstDueFrom);
    if (!startDate) {
      return { status: "missing", value: "缺日期", meta: "缺少新車起算日" };
    }
    const dueDate = addMonths(startDate, rule.firstDueMonths);
    const leadMonths = rule.dueMonths && rule.soonMonths ? rule.dueMonths - rule.soonMonths : 1;
    return buildDateTrackerState({
      dueDate,
      soonDate: addMonths(dueDate, -leadMonths),
      today,
      meta: `下一次約 ${formatDateYMD(dueDate)}`,
      next: rule.firstDueMeta || ""
    });
  }

  const baseDate = latest ? parseDate(latest.date) : getVehicleBaselineDate();
  if (!baseDate) {
    return { status: "missing", value: "缺日期", meta: latest ? "最近紀錄缺少日期" : "缺少交車日" };
  }
  const dueDate = addMonths(baseDate, rule.dueMonths);
  const elapsedMonths = diffMonths(baseDate, today);
  return buildDateTrackerState({
    dueDate,
    soonDate: addMonths(baseDate, rule.soonMonths),
    today,
    meta: `下一次約 ${formatDateYMD(dueDate)}`,
    next: latest
      ? `上次 ${latest.date.substring(0, 7)} / 已過 ${elapsedMonths} 個月`
      : `交車 ${formatDateYM(baseDate)} / 已過 ${elapsedMonths} 個月 / 尚無紀錄，先以交車日推估。`
  });
}

// 定期保養：保養類別（排除換位、定位、變速箱等專項），或提到換機油的保養／更換／維修紀錄。
const ROUTINE_SERVICE_PATTERN = /定期保養|機油|小保養|大保養|[0-9][0-9,]*\s*(?:公里|km|k)\s*保養/i;
const SPECIFIC_SERVICE_PATTERN = /輪胎|換位|定位|變速箱|DSG|冷氣|空調|電瓶|煞車|來令片|雨刷|燈泡|水箱|火星塞|空氣濾芯|空濾|四驅|Haldex/i;

function isRoutineMaintenanceRecord(record) {
  if (!record || isMileageUpdateRecord(record)) return false;
  const text = `${record.detail || ""} ${record.note || ""}`;
  const mentionsRoutine = ROUTINE_SERVICE_PATTERN.test(stripPhrases(text, OIL_CHECK_PHRASES));
  if (record.category === "保養") return mentionsRoutine || !SPECIFIC_SERVICE_PATTERN.test(text);
  if (record.category === "更換" || record.category === "維修") return mentionsRoutine;
  return false;
}

function getLastMaintenanceRecord() {
  return getRecordsNewestFirst().find(isRoutineMaintenanceRecord);
}

// 依里程追蹤的項目（定期保養、變速箱油、輪胎、冷氣濾網、汽油精）少了里程就算不出下一次。
function getMileageTrackedName(record) {
  if (isRoutineMaintenanceRecord(record)) return "定期保養";
  const rule = CONSUMABLE_RULES.find(item => item.dueKm && recordMatchesRule(record, item));
  if (rule) return rule.name;
  return recordMatchesRule(record, FUEL_ADDITIVE_RULE) ? "汽油精" : "";
}

// 每天最高里程的時間序列（含交車基準），用來推估開車速度。
function getMileagePoints() {
  return cachedForRender("mileagePoints", () => {
    const byDate = new Map();
    const baselineDate = getVehicleBaselineDate();
    if (baselineDate) byDate.set(formatDateYMD(baselineDate), getVehicleBaselineMileage());
    records.forEach(record => {
      const date = parseDate(record?.date);
      const mileage = Number(record?.mileage);
      if (!date || !Number.isFinite(mileage) || mileage <= 0) return;
      const key = formatDateYMD(date);
      byDate.set(key, Math.max(byDate.get(key) ?? 0, mileage));
    });
    return [...byDate.entries()]
      .map(([date, mileage]) => ({ date: parseDate(date), mileage }))
      .sort((a, b) => a.date - b.date);
  });
}

function getDrivingPace() {
  return cachedForRender("drivingPace", () => {
    const points = getMileagePoints();
    if (points.length < 2) return null;
    const maxMileage = Math.max(...points.map(point => point.mileage));
    const latest = points.filter(point => point.mileage === maxMileage).pop();
    const windowStart = addDays(latest.date, -DRIVING_PACE_WINDOW_DAYS);
    let anchor = points.find(point => point.date >= windowStart && point.date < latest.date);
    if (!anchor || (latest.date - anchor.date) / 86400000 < DRIVING_PACE_MIN_DAYS) {
      anchor = points.find(point => point.date < latest.date);
    }
    if (!anchor) return null;
    const days = (latest.date - anchor.date) / 86400000;
    const distance = latest.mileage - anchor.mileage;
    if (days < 7 || distance <= 0) return null;
    return {
      kmPerDay: distance / days,
      days: Math.round(days),
      latestDate: latest.date,
      latestMileage: latest.mileage
    };
  });
}

function projectMileageDate(targetMileage) {
  const pace = getDrivingPace();
  if (!pace || !Number.isFinite(targetMileage) || targetMileage <= pace.latestMileage) return null;
  return addDays(pace.latestDate, Math.ceil((targetMileage - pace.latestMileage) / pace.kmPerDay));
}

function getMaintenanceSchedule(today = now()) {
  return cachedForRender("maintenanceSchedule:" + formatDateYMD(today), () => {
    const latest = getLastMaintenanceRecord();
    const latestMileage = Number(latest?.mileage);
    const baseMileage = latest
      ? (Number.isFinite(latestMileage) && latestMileage > 0 ? latestMileage : null)
      : getVehicleBaselineMileage();
    const baseDate = latest ? parseDate(latest.date) : getVehicleBaselineDate();
    const currentMileage = getEffectiveCurrentMileage();
    const dueMileage = baseMileage == null ? null : baseMileage + MAINTENANCE_INTERVAL_KM;
    const remainingKm = dueMileage == null ? null : dueMileage - currentMileage;
    const usedKm = baseMileage == null ? null : Math.max(currentMileage - baseMileage, 0);
    const timeDueDate = baseDate ? addMonths(baseDate, MAINTENANCE_INTERVAL_MONTHS) : null;
    const projectedDate = remainingKm != null && remainingKm > 0 ? projectMileageDate(dueMileage) : null;
    const dueDate = [projectedDate, timeDueDate].filter(Boolean).sort((a, b) => a - b)[0] || null;
    const daysToTimeDue = timeDueDate ? diffDays(timeDueDate, today) : null;
    const daysToProjected = projectedDate ? diffDays(projectedDate, today) : null;

    let status = "ok";
    if ((remainingKm != null && remainingKm <= 0) || (daysToTimeDue != null && daysToTimeDue <= 0)) {
      status = "due";
    } else if (
      (remainingKm != null && remainingKm <= MAINTENANCE_SOON_KM) ||
      (daysToTimeDue != null && daysToTimeDue <= MAINTENANCE_SOON_DAYS) ||
      (daysToProjected != null && daysToProjected <= 14)
    ) {
      status = "soon";
    }

    return {
      latest,
      baseDate,
      baseMileage,
      dueMileage,
      remainingKm,
      usedKm,
      timeDueDate,
      timeDuePassed: daysToTimeDue != null && daysToTimeDue <= 0,
      projectedDate,
      projectedPassed: daysToProjected != null && daysToProjected <= 0,
      dueDate,
      pace: getDrivingPace(),
      status,
      progress: usedKm == null ? null : Math.min(usedKm / MAINTENANCE_INTERVAL_KM, 1)
    };
  });
}

function describeMaintenanceRemaining(schedule) {
  if (schedule.remainingKm == null) {
    return schedule.timeDueDate ? formatDateYMD(schedule.timeDueDate) : "—";
  }
  if (schedule.remainingKm > 0) return `剩 ${schedule.remainingKm.toLocaleString("zh-TW")} km`;
  if (schedule.remainingKm === 0) return "已達保養里程";
  return `超過 ${Math.abs(schedule.remainingKm).toLocaleString("zh-TW")} km`;
}

function describeMaintenanceDates(schedule) {
  if (schedule.remainingKm != null && schedule.remainingKm <= 0) return "已達保養里程，建議盡快安排";
  if (schedule.timeDuePassed) return `已滿 ${MAINTENANCE_INTERVAL_MONTHS} 個月，建議盡快安排`;
  const parts = [];
  if (schedule.projectedDate) {
    parts.push(schedule.projectedPassed
      ? `預估 ${formatDateYMD(schedule.projectedDate)} 已到，請更新里程`
      : `預估 ${formatDateYMD(schedule.projectedDate)}`);
  }
  if (schedule.timeDueDate) parts.push(`最晚 ${formatDateYMD(schedule.timeDueDate)}`);
  return parts.join(" · ") || "依目前保養紀錄推估";
}

function buildMaintenanceCalendarDescription(schedule) {
  const parts = [];
  if (schedule.projectedDate && schedule.pace) {
    parts.push(`預估 ${formatDateYMD(schedule.projectedDate)} 達 ${schedule.dueMileage.toLocaleString("zh-TW")} 公里（近 ${schedule.pace.days} 天平均每日約 ${Math.round(schedule.pace.kmPerDay)} 公里）`);
  } else if (schedule.dueMileage != null) {
    parts.push(`${schedule.dueMileage.toLocaleString("zh-TW")} 公里`);
  }
  if (schedule.timeDueDate) parts.push(`最晚 ${formatDateYMD(schedule.timeDueDate)}`);
  return parts.join("，") + "，以先到者為準";
}

function buildMaintenanceTrackerState(schedule) {
  const usedText = schedule.usedKm != null ? ` / 已跑 ${schedule.usedKm.toLocaleString("zh-TW")} km` : "";
  const meta = schedule.latest
    ? `上次 ${schedule.baseMileage != null ? schedule.baseMileage.toLocaleString("zh-TW") + " km" : schedule.latest.date}${usedText}`
    : `${getBaselineMetaPrefix()}${usedText}`;
  return {
    status: schedule.status,
    value: schedule.status === "due" ? "該保養" : describeMaintenanceRemaining(schedule),
    meta,
    next: describeMaintenanceDates(schedule)
  };
}

function getMaintenanceActionState(today = now()) {
  const schedule = getMaintenanceSchedule(today);
  const label = schedule.latest ? "定期保養" : "首保/定期保養";
  const metaParts = [];
  if (!schedule.latest) metaParts.push("新車交車基準");
  if (schedule.dueMileage != null) metaParts.push(`${schedule.dueMileage.toLocaleString("zh-TW")} km`);
  if (schedule.projectedDate) metaParts.push(`預估 ${formatDateYMD(schedule.projectedDate)}`);
  if (schedule.timeDueDate) metaParts.push(`最晚 ${formatDateYMD(schedule.timeDueDate)}`);
  if (schedule.usedKm != null) metaParts.push(`已跑 ${schedule.usedKm.toLocaleString("zh-TW")} km`);
  return {
    status: schedule.status,
    name: schedule.status === "ok" ? label : "安排" + label,
    statusText: schedule.status === "due" ? "該保養" : describeMaintenanceRemaining(schedule),
    meta: metaParts.join(" / "),
    dueDate: schedule.dueDate,
    dueMileage: schedule.dueMileage,
    calendarType: "maintenance",
    calendarDescription: buildMaintenanceCalendarDescription(schedule)
  };
}

function hasMatchingRecordInYear(rule, year) {
  return records.some(r => getYear(r.date) === String(year) && recordMatchesRule(r, rule));
}

function getFixedCostState(item, today = now()) {
  const year = today.getFullYear();
  const paidThisYear = hasMatchingRecordInYear(item, year);
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
  const today = now();
  const states = FIXED_OWNER_COSTS.map(item => getFixedCostState(item, today));
  const actionable = states.find(state => state.status === "due" || state.status === "soon");
  if (actionable) return actionable;
  return [...states].sort((a, b) => a.dueDate - b.dueDate)[0] || null;
}

function getWarrantyState(today = now()) {
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

// 依里程追蹤的項目：用開車速度推估日期，才能加入行事曆。
function getTrackerCalendarSchedule(rule, state = buildTrackerState(rule)) {
  if (rule.maintenance) return {};
  if (state.dueDate) {
    return Number.isFinite(state.dueMileage)
      ? { dueDate: state.dueDate, dueMileage: state.dueMileage, calendarType: "vehicle-reminder" }
      : { dueDate: state.dueDate, calendarType: "vehicle-reminder" };
  }
  if (!rule.dueKm) return {};
  const latest = getLatestMatchingRecord(rule);
  const baseMileage = latest ? Number(latest.mileage) : getVehicleBaselineMileage();
  const targetMileage = baseMileage + rule.dueKm;
  const dueDate = Number.isFinite(baseMileage) ? projectMileageDate(targetMileage) : null;
  if (!dueDate) return {};
  return {
    dueDate,
    calendarType: "vehicle-reminder",
    calendarDescription: `預估 ${formatDateYMD(dueDate)} 達 ${targetMileage.toLocaleString("zh-TW")} 公里，請依實際里程安排`
  };
}

function getCalendarTask(action) {
  const dueDate = action?.dueDate instanceof Date ? action.dueDate : parseDate(action?.dueDate);
  if (!dueDate) return null;

  const date = formatDateYMD(dueDate);
  const description = action.calendarDescription || (Number.isFinite(action.dueMileage)
    ? `預計 ${date} 或 ${Number(action.dueMileage).toLocaleString("zh-TW")} 公里，以先到者為準`
    : action.meta || `預計日期 ${date}`);
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
  document.getElementById("calendarReminderTitle").textContent = task.title;
  document.getElementById("calendarReminderDate").textContent = task.date;
  document.getElementById("calendarReminderCondition").textContent = task.description || "";
  document.getElementById("calendarReminderAlarms").textContent = "提醒：7 天前、1 天前";
  openDialog("calendarReminderModal", { invoker, focusId: "calendarReminderConfirmBtn" });
}

// ============================================================
// 外觀：深色（預設）／淺色
// ============================================================
function getTheme() {
  return document.documentElement?.dataset?.theme === "light" ? "light" : "dark";
}

function setTheme(theme) {
  const root = document.documentElement;
  if (root?.dataset) root.dataset.theme = theme === "light" ? "light" : "dark";
  try {
    localStorage.setItem(THEME_STORAGE_KEY, getTheme());
  } catch (error) {
    // 無痕模式等情況存不了偏好，只影響下次開啟。
  }
  updateThemeToggle();
  buildCharts();
}

function updateThemeToggle() {
  const button = document.getElementById("btnThemeToggle");
  if (button) button.setAttribute("aria-pressed", String(getTheme() === "light"));
}

// 圖表顏色跟著 styles.css 的主題變數走（Canvas 無法直接使用 CSS 變數）。
function getChartTheme() {
  const root = document.documentElement;
  const styles = typeof getComputedStyle === "function" && root ? getComputedStyle(root) : null;
  const read = (name, fallback) => styles?.getPropertyValue(name).trim() || fallback;
  return {
    grid: read("--chart-grid", "rgba(48,54,61,0.5)"),
    tick: read("--chart-tick", "#8b949e"),
    tooltipBg: read("--chart-tooltip-bg", "#1c2333"),
    tooltipBorder: read("--chart-tooltip-border", "#30363d"),
    tooltipTitle: read("--chart-tooltip-title", "#e6edf3"),
    tooltipBody: read("--chart-tooltip-body", "#c9d1d9"),
    surface: read("--bg-card", "#161b22"),
    series: read("--chart-series", "#388bfd"),
    warning: read("--chart-warning", "#db6d28"),
    reference: read("--chart-reference", "rgba(139,148,158,0.85)"),
    bar: read("--chart-bar", "rgba(88,166,255,0.65)"),
    barBorder: read("--chart-bar-border", "#58a6ff"),
    barHover: read("--chart-bar-hover", "rgba(121,184,255,0.85)"),
    barMuted: read("--chart-bar-muted", "#6e7681"),
    barMutedHover: read("--chart-bar-muted-hover", "#8b949e"),
    font: read("--font-sans", "sans-serif")
  };
}

function chartTooltipColors(theme) {
  return {
    backgroundColor: theme.tooltipBg,
    borderColor: theme.tooltipBorder,
    borderWidth: 1,
    titleColor: theme.tooltipTitle,
    bodyColor: theme.tooltipBody
  };
}

// ============================================================
// 對話框：統一開關、Esc、焦點循環與防手滑
// ============================================================
const DIALOG_CLOSERS = {
  modal: () => closeModal(),
  mileageModal: () => closeMileageModal(),
  photoModal: () => closePhotoModal(),
  aiModal: () => closeAiModal(),
  fuelLogModal: () => closeFuelLogModal(),
  fuelModal: () => closeFuelModal(),
  deleteModal: () => closeDeleteModal(),
  backupRestoreModal: () => closeBackupRestoreModal(),
  duplicateModal: () => closeDuplicateModal(),
  calendarReminderModal: () => closeCalendarReminder(),
  quickEntryModal: () => closeQuickEntryMenu()
};
const dialogStack = [];

function openDialog(id, { invoker = null, focusId = "" } = {}) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  const opener = invoker?.focus ? invoker : document.activeElement;
  const existing = dialogStack.findIndex(entry => entry.id === id);
  if (existing >= 0) dialogStack.splice(existing, 1);
  dialogStack.push({ id, invoker: opener?.focus ? opener : null });
  overlay.style.display = "flex";
  setDialogFormDirty(id, false);
  const target = focusId ? document.getElementById(focusId) : null;
  if (target?.focus) target.focus();
}

function closeDialog(id, { restoreFocus = true } = {}) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.style.display = "none";
  setDialogFormDirty(id, false);
  const index = dialogStack.findIndex(entry => entry.id === id);
  const [entry] = index >= 0 ? dialogStack.splice(index, 1) : [];
  if (restoreFocus && entry?.invoker?.focus) entry.invoker.focus();
  resumeDeferredSync();
}

function getTopDialogId() {
  for (let index = dialogStack.length - 1; index >= 0; index -= 1) {
    const { id } = dialogStack[index];
    if (document.getElementById(id)?.style.display === "flex") return id;
  }
  return "";
}

function getDialogForm(id) {
  return document.getElementById(id)?.querySelector?.("form") || null;
}

function setDialogFormDirty(id, dirty) {
  const form = getDialogForm(id);
  if (!form?.dataset) return;
  if (dirty) form.dataset.dirty = "true";
  else delete form.dataset.dirty;
}

// 點背景或按 Esc：表單有未儲存的內容時不關閉，避免手滑丟掉輸入。
function requestDialogDismiss(id) {
  if (getDialogForm(id)?.dataset?.dirty === "true") {
    showToast("尚未儲存；要放棄請按「取消」。");
    return false;
  }
  DIALOG_CLOSERS[id]?.();
  return true;
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
  closeDialog("calendarReminderModal");
  pendingCalendarTask = null;
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
    !!getLatestMatchingRecord(CONSUMABLE_RULES.find(rule => rule.name === "保險")),
    !!getLatestMatchingRecord(TAX_RULE)
  ];
  const done = checks.filter(Boolean).length;
  return `${done}/${checks.length} 項`;
}

function buildOwnerActions() {
  const actions = [];
  const currentMileage = getCurrentMileage();
  const maintenance = getMaintenanceActionState();
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

  // 定期保養已由上面的保養項目追蹤，不重複列出。
  CONSUMABLE_RULES
    .filter(rule => !rule.maintenance)
    .map(rule => ({ rule, state: buildTrackerState(rule) }))
    .filter(({ state }) => state.status === "due" || state.status === "soon" || state.status === "missing")
    .forEach(({ rule, state }) => {
      actions.push({
        status: state.status,
        name: rule.name,
        statusText: state.value,
        meta: [state.meta, state.next].filter(Boolean).join(" / "),
        ...getTrackerCalendarSchedule(rule, state)
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
  改裝升級: "accessory",
  清潔美容: "other"
});

const OWNERSHIP_COST_BUCKETS = Object.freeze([
  { key: "service", name: "保養維修", terms: ["保養", "維修", "更換", "機油", "輪胎", "電瓶", "煞車", "變速箱", "濾網"] },
  { key: "fuel", name: "燃料加油", terms: ["加油", "油費", "汽油"] },
  { key: "legal", name: "保險稅費", terms: ["保險", "強制險", "任意險", "牌照稅", "燃料稅", "燃料費", "汽燃費", "公路養管費", "驗車", "檢驗"] },
  { key: "accessory", name: "配件改裝", terms: ["改裝", "升級", "隔熱紙", "行車記錄器", "車標", "配件"] },
  { key: "other", name: "美容與其他", terms: [] }
]);

// 用車成本只算油、保養維修與保險稅費；改裝、配件、美容等一次性花費另計為「改裝美容」。
const RUNNING_COST_BUCKET_KEYS = ["service", "fuel", "legal"];
const COST_GROUPS = [
  { key: "running", name: "用車", bucketKeys: RUNNING_COST_BUCKET_KEYS },
  { key: "upgrades", name: "改裝美容", bucketKeys: ["accessory", "other"] }
];

function getOwnershipCostBucketKey(record) {
  const explicitKey = OWNERSHIP_CATEGORY_BUCKETS[record.category];
  if (explicitKey) return explicitKey;

  const text = stripPhrases(`${record.category || ""} ${record.detail || ""} ${record.note || ""}`, ["保險桿", "保險絲"]);
  const inferred = OWNERSHIP_COST_BUCKETS.find(item =>
    item.key !== "other" && item.terms.some(term => text.includes(term))
  );
  return inferred ? inferred.key : "other";
}

function getOwnershipCostBuckets() {
  const buckets = OWNERSHIP_COST_BUCKETS.map(bucket => ({ ...bucket, total: 0 }));

  getCostRecords().forEach(record => {
    const bucketKey = getOwnershipCostBucketKey(record);
    const bucket = buckets.find(item => item.key === bucketKey) || buckets[buckets.length - 1];
    bucket.total += asNumber(record.cost);
  });

  return buckets;
}

function isRunningCostRecord(record) {
  return RUNNING_COST_BUCKET_KEYS.includes(getOwnershipCostBucketKey(record));
}

// 用車與改裝美容各自的花費；指定 since 時只算那天（含）之後的紀錄。
function getCostSplit(since = null) {
  const split = { running: 0, fuel: 0, upgrades: 0, upgradeCount: 0 };
  getCostRecords().forEach(record => {
    if (since) {
      const date = parseDate(record.date);
      if (!date || date < since) return;
    }
    const cost = asNumber(record.cost);
    const bucketKey = getOwnershipCostBucketKey(record);
    if (RUNNING_COST_BUCKET_KEYS.includes(bucketKey)) {
      split.running += cost;
      if (bucketKey === "fuel") split.fuel += cost;
    } else {
      split.upgrades += cost;
      split.upgradeCount += 1;
    }
  });
  return split;
}

// 某天之後開了多少公里：從那天（含）以前最後一筆里程算起；車齡比區間短時從交車里程算起，
// 與持有成本摘要的每公里成本一致（交車當天補登的里程不算起點）。
function getMileageDrivenSince(since) {
  const start = [...getMileagePoints()].reverse().find(point => point.date <= since);
  const startMileage = start ? start.mileage : getVehicleBaselineMileage();
  return Math.max(getEffectiveCurrentMileage() - startMileage, 0);
}

function getUpgradeCostEntries() {
  return records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => !isMileageUpdateRecord(record) && asNumber(record.cost) > 0 && !isRunningCostRecord(record))
    .sort((a, b) => compareRecordValuesNewestFirst(a.record, b.record) || b.index - a.index);
}

// 年度費用圖：每年的用車與改裝美容花費。
function getYearlyCostSplit() {
  const years = new Map();
  getCostRecords().forEach(record => {
    const year = getYear(record.date);
    if (!year) return;
    const entry = years.get(year) || { year, running: 0, upgrades: 0 };
    entry[isRunningCostRecord(record) ? "running" : "upgrades"] += asNumber(record.cost);
    years.set(year, entry);
  });
  return [...years.values()].sort((a, b) => a.year.localeCompare(b.year));
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
  const split = getCostSplit();
  const currentMileage = getCurrentMileage();
  const monthlyAverage = split.running / getOwnershipMonths();
  const costPerKm = currentMileage > 0 && split.running > 0 ? split.running / currentMileage : null;

  renderUpgradeCostList();
  if (!total) {
    summary.textContent = "尚無費用資料";
    grid.innerHTML = "";
    return;
  }

  summary.textContent = [
    getOwnershipPeriodLabel(),
    `用車 ${formatCost(split.running)}`,
    `月均 ${formatCompactCurrency(Math.round(monthlyAverage))}`,
    costPerKm ? `${currentMileage < 1000 ? "每公里暫估" : "每公里"} NT$ ${costPerKm.toFixed(1)}` : "每公里待里程",
    `改裝美容 ${formatCost(split.upgrades)}`
  ].join(" · ");

  const share = value => `${total ? Math.round((value / total) * 100) : 0}%`;
  grid.innerHTML = COST_GROUPS.map(group => {
    const groupBuckets = buckets.filter(bucket => group.bucketKeys.includes(bucket.key));
    const groupTotal = groupBuckets.reduce((sum, bucket) => sum + bucket.total, 0);
    return `
      <div class="ownership-group">
        <div class="ownership-group-head">
          <span>${escapeHtml(group.name)}</span>
          <strong>${formatCompactCurrency(groupTotal)}</strong>
          <small>${share(groupTotal)}</small>
        </div>
        <div class="ownership-group-items">
          ${groupBuckets.map(bucket => `
            <div class="ownership-item">
              <div class="ownership-item-name">${escapeHtml(bucket.name)}</div>
              <div class="ownership-item-value">${formatCompactCurrency(bucket.total)}</div>
              <div class="ownership-item-share">${share(bucket.total)}</div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function renderUpgradeCostList() {
  const list = document.getElementById("upgradeCostList");
  const summary = document.getElementById("upgradeCostSummary");
  const items = document.getElementById("upgradeCostItems");
  if (!list || !summary || !items) return;

  const entries = getUpgradeCostEntries();
  list.hidden = entries.length === 0;
  const total = entries.reduce((sum, { record }) => sum + asNumber(record.cost), 0);
  summary.textContent = `改裝美容清單 · ${entries.length} 項 · ${formatCost(total)}`;
  items.innerHTML = entries.map(({ record, index }) => `
    <button class="overview-record upgrade-record" type="button" data-upgrade-record="${index}">
      <span>
        <strong>${escapeHtml(String(record.detail || "未填詳細內容").split(/\r?\n/)[0])}</strong>
        <small>${escapeHtml(record.date || "未填日期")} · ${escapeHtml(record.category || "其他")}</small>
      </span>
      <span>${escapeHtml(formatCost(asNumber(record.cost)))}</span>
    </button>
  `).join("");
}

// 總覽「改裝美容」的清單按鈕：切到分析頁並展開清單。
function showUpgradeCostList() {
  setActiveView("analysis");
  const list = document.getElementById("upgradeCostList");
  if (!list || list.hidden) return;
  list.open = true;
  list.scrollIntoView?.({ block: "start" });
}

function renderDataQualityPanel() {
  const panel = document.getElementById("dataQualityPanel");
  if (!panel) return;
  const issues = [...getDataQualityIssues()].sort((a, b) => b.date.localeCompare(a.date));
  const summary = issues.length ? `${issues.length} 項待確認` : "未發現明顯異常";
  const content = issues.length
    ? `<div class="data-quality-list">${issues.map(issue => `
        <div class="data-quality-item">
          <strong>${escapeHtml(issue.title)}</strong>
          <span>${escapeHtml(issue.detail)}</span>
          ${Number.isInteger(issue.recordIndex) && issue.recordIndex >= 0
            ? `<button class="btn btn-ghost btn-sm data-quality-open" type="button" data-quality-record="${issue.recordIndex}">開啟紀錄</button>`
            : ""}
        </div>
      `).join("")}</div>`
    : `<div class="data-quality-empty">目前的日期、里程、重複紀錄與加滿油耗區間沒有明顯異常。</div>`;

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
// 圖表與 OCR 函式庫只在用到時才下載，首次開啟不必等 CDN。
const scriptLoads = new Map();

function loadScriptOnce(src, integrity = "") {
  if (!scriptLoads.has(src)) {
    scriptLoads.set(src, new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      if (integrity) {
        script.integrity = integrity;
        script.crossOrigin = "anonymous";
      }
      script.onload = () => resolve();
      script.onerror = () => {
        scriptLoads.delete(src);
        reject(new Error("無法載入 " + src));
      };
      document.head.appendChild(script);
    }));
  }
  return scriptLoads.get(src);
}

async function ensureChartLibrary() {
  if (typeof Chart !== "undefined") return true;
  try {
    await loadScriptOnce(CHART_JS_URL, CHART_JS_SRI);
    if (typeof Chart === "undefined") return false;
    Chart.defaults.font.family = getChartTheme().font;
    return true;
  } catch (error) {
    console.error("圖表元件載入失敗", error);
    return false;
  }
}

// 只畫目前看得到的圖；切換分頁時再補畫。
let chartBuildToken = 0;
function buildCharts() {
  const showAnalysis = activeView === "analysis";
  const showFuelTrend = activeView === "records" && activeRecordsSubtab === "fuel";
  if (!showAnalysis && !showFuelTrend) return;
  const token = ++chartBuildToken;
  ensureChartLibrary().then(ready => {
    if (!ready || token !== chartBuildToken) return;
    if (activeView === "analysis") {
      buildCostChart();
      buildCategoryChart();
    } else if (activeView === "records" && activeRecordsSubtab === "fuel") {
      buildFuelTrendChart();
    }
  });
}

// 平均線是參考線而非資料系列：直接在線尾標示數值，不另設圖例。
const fuelAverageLinePlugin = {
  id: "fuelAverageLine",
  afterDatasetsDraw(chart, _args, options) {
    const value = options?.value;
    const yScale = chart.scales.y;
    if (!Number.isFinite(value) || !yScale) return;
    const y = yScale.getPixelForValue(value);
    const { left, right } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = options.lineColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = options.textColor;
    ctx.font = `11px ${options.font}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(`平均 ${value.toFixed(1)}`, right, y - 3);
    ctx.restore();
  }
};

function chartAxis(theme, ticks = {}) {
  return {
    grid: { color: theme.grid },
    ticks: { color: theme.tick, font: { size: 11 }, ...ticks }
  };
}

function buildFuelTrendChart() {
  const canvas = document.getElementById("fuelTrendChart");
  if (fuelTrendChart) {
    fuelTrendChart.destroy();
    fuelTrendChart = null;
  }
  const fuelStats = getFuelStats();
  const segments = fuelStats.segments;
  if (!canvas || segments.length < 2) return;

  const theme = getChartTheme();
  const suspiciousKeys = new Set(
    getDataQualityIssues().filter(issue => issue.type === "fuel-outlier").map(issue => issue.key)
  );
  const isSuspicious = segment => suspiciousKeys.has(`fuel|${segment.date}|${segment.mileage}`);
  const pointColors = segments.map(segment => isSuspicious(segment) ? theme.warning : theme.series);

  fuelTrendChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: segments.map(segment => segment.date.slice(2).replace(/-/g, "/")),
      datasets: [{
        label: "油耗 km/L",
        data: segments.map(segment => Number(segment.kmPerLiter.toFixed(2))),
        borderColor: theme.series,
        borderWidth: 2,
        borderJoinStyle: "round",
        borderCapStyle: "round",
        // 縱軸不從 0 開始，所以不填色、不平滑，避免誇大起伏。
        fill: false,
        tension: 0,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBorderWidth: 2,
        pointBorderColor: theme.surface,
        pointBackgroundColor: pointColors,
        pointStyle: segments.map(segment => isSuspicious(segment) ? "triangle" : "circle")
      }]
    },
    plugins: [fuelAverageLinePlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        fuelAverageLine: {
          value: fuelStats.averageKmPerLiter,
          lineColor: theme.reference,
          textColor: theme.tick,
          font: theme.font
        },
        tooltip: {
          ...chartTooltipColors(theme),
          callbacks: {
            title: items => segments[items[0].dataIndex].date,
            label: context => {
              const segment = segments[context.dataIndex];
              return [
                ` ${segment.kmPerLiter.toFixed(1)} km/L${isSuspicious(segment) ? "（待確認）" : ""}`,
                ` ${segment.distance.toLocaleString("zh-TW")} km · ${segment.liters.toFixed(1)} L`,
                segment.costPerKm != null ? ` 每公里 NT$ ${segment.costPerKm.toFixed(2)}` : ""
              ].filter(Boolean);
            }
          }
        }
      },
      scales: {
        x: chartAxis(theme, { maxRotation: 0, autoSkip: true, autoSkipPadding: 12 }),
        y: { grace: "15%", ...chartAxis(theme, { maxTicksLimit: 6, callback: value => Number(value).toFixed(1) }) }
      }
    }
  });
}

function renderCostLegend() {
  const legend = document.getElementById("costLegend");
  if (!legend) return;
  legend.innerHTML = COST_GROUPS
    .map(group => `<span class="chart-legend-item chart-legend-${group.key}"><i aria-hidden="true"></i>${escapeHtml(group.name)}</span>`)
    .join("");
}

// 每年一根長條：下段用車、上段改裝美容，中間以卡片底色隔開。
function buildCostChart() {
  const rows = getYearlyCostSplit();
  const canvas = document.getElementById("costChart");
  if (costChart) { costChart.destroy(); costChart = null; }
  const theme = getChartTheme();
  renderCostLegend();

  const segment = { stack: "cost", borderSkipped: false, maxBarThickness: 24 };
  const topCorners = { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 };
  costChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: rows.map(row => row.year),
      datasets: [{
        ...segment,
        label: "用車",
        data: rows.map(row => row.running),
        backgroundColor: theme.bar,
        hoverBackgroundColor: theme.barHover,
        borderWidth: 0,
        borderRadius: ctx => rows[ctx.dataIndex]?.upgrades > 0 ? 0 : topCorners
      }, {
        ...segment,
        label: "改裝美容",
        data: rows.map(row => row.upgrades),
        backgroundColor: theme.barMuted,
        hoverBackgroundColor: theme.barMutedHover,
        borderColor: theme.surface,
        borderWidth: ctx => ({ top: 0, right: 0, bottom: rows[ctx.dataIndex]?.running > 0 ? 2 : 0, left: 0 }),
        borderRadius: topCorners
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: "easeOutQuart" },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartTooltipColors(theme),
          callbacks: {
            label: ctx => `  ${ctx.dataset.label} NT$ ${ctx.raw.toLocaleString("zh-TW")}`,
            footer: items => "  合計 NT$ " + items.reduce((sum, item) => sum + item.raw, 0).toLocaleString("zh-TW")
          }
        }
      },
      scales: {
        x: { stacked: true, ...chartAxis(theme) },
        y: {
          stacked: true,
          beginAtZero: true,
          ...chartAxis(theme, {
            maxTicksLimit: 6,
            // 4.5 萬不能四捨五入成「5萬」，否則刻度會重複。
            callback: v => {
              if (v >= 10000) return (v / 10000).toFixed(v % 10000 ? 1 : 0) + "萬";
              return v.toLocaleString();
            }
          })
        }
      }
    }
  });
}

// 類別色：dataviz 驗證過的 8 色固定順序（深／淺各一組），依標籤色相對應；「其他」用中性灰。
// 扇區依此順序排列，相鄰顏色在色弱下也分得開；圖例直接列出金額。
const CATEGORY_CHART_ORDER = ["更換", "加油", "保險", "檢驗/稅費", "清潔美容", "保養", "改裝升級", "維修", "其他"];
const CATEGORY_CHART_COLORS = {
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767", "#6e7681"],
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948", "#8c959f"]
};

function buildCategoryChart() {
  const catMap = {};
  getServiceRecords().forEach(r => {
    const cost = asNumber(r.cost);
    if (!cost) return;
    const category = CATEGORY_CHART_ORDER.includes(r.category) ? r.category : "其他";
    catMap[category] = (catMap[category] || 0) + cost;
  });
  const cats = CATEGORY_CHART_ORDER.filter(category => catMap[category]);
  const vals = cats.map(c => catMap[c]);
  const palette = CATEGORY_CHART_COLORS[getTheme()];
  const colors = cats.map(c => palette[CATEGORY_CHART_ORDER.indexOf(c)]);
  const theme = getChartTheme();
  const total = vals.reduce((sum, value) => sum + value, 0);

  const ctx = document.getElementById("categoryChart").getContext("2d");
  if (catChart) catChart.destroy();
  const legendLabels = { color: theme.tick, font: { size: 11 }, padding: 12 };
  const defaultLegendLabels = Chart.overrides?.doughnut?.plugins?.legend?.labels?.generateLabels;
  if (defaultLegendLabels) {
    legendLabels.generateLabels = chart => defaultLegendLabels(chart).map(item => ({
      ...item,
      text: `${item.text} ${formatCompactCurrency(vals[item.index])}`
    }));
  }

  catChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: cats,
      datasets: [{
        data: vals,
        backgroundColor: colors,
        borderColor: theme.surface,
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
          labels: legendLabels
        },
        tooltip: {
          ...chartTooltipColors(theme),
          callbacks: {
            label: ctx => {
              const pct = ((ctx.raw / total) * 100).toFixed(1);
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

  const indexByRecord = new Map(records.map((record, index) => [record, index]));
  filtered.slice(0, recordsVisibleLimit).forEach(r => {
    const origIdx = indexByRecord.get(r);
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

  const remaining = filtered.length - recordsVisibleLimit;
  if (remaining > 0) {
    html += `<button class="btn btn-ghost records-more" type="button" data-records-more>顯示更多（還有 ${remaining} 筆）</button>`;
  }
  container.innerHTML = html;
}

function resetRecordsPaging() {
  recordsVisibleLimit = RECORDS_PAGE_SIZE;
}

// ============================================================
// 新增/編輯 Modal
// ============================================================
function showMessage(id, type, text) {
  const el = document.getElementById(id);
  el.className = "form-message form-message-" + type;
  el.textContent = text;
}

// 清除訊息時一併重設「再按一次儲存」的里程確認。
function clearMessage(id, formId = "") {
  const el = document.getElementById(id);
  el.className = "form-message";
  el.textContent = "";
  const saveBtn = formId ? document.querySelector(`#${formId} button[type='submit']`) : null;
  if (saveBtn) delete saveBtn.dataset.confirmedMileage;
}

function showFormMessage(type, text) { showMessage("formMessage", type, text); }
function clearFormMessage() { clearMessage("formMessage", "recordForm"); }
function showMileageMessage(type, text) { showMessage("mileageMessage", type, text); }
function clearMileageMessage() { clearMessage("mileageMessage", "mileageForm"); }
function showFuelMessage(type, text) { showMessage("fuelMessage", type, text); }
function clearFuelMessage() { clearMessage("fuelMessage"); }
function showFuelLogMessage(type, text) { showMessage("fuelLogMessage", type, text); }
function clearFuelLogMessage() { clearMessage("fuelLogMessage", "fuelLogForm"); }
function showPhotoMessage(type, text) { showMessage("photoMessage", type, text); }
function clearPhotoMessage() { clearMessage("photoMessage"); }
function showAiMessage(type, text) { showMessage("aiMessage", type, text); }
function clearAiMessage() { clearMessage("aiMessage"); }

function updateMileageHint(idx = parseInt(document.getElementById("editIndex").value)) {
  const maxMileage = getMaxMileage(idx);
  const el = document.getElementById("mileageHint");
  if (maxMileage <= 0) {
    el.textContent = "";
    return;
  }
  const mileage = parseInt(document.getElementById("formMileage").value, 10);
  const warning = getMileageJumpWarning(mileage, document.getElementById("formDate").value, { excludeIndex: idx });
  const delta = Number.isFinite(mileage) && mileage > maxMileage
    ? "本次 +" + (mileage - maxMileage).toLocaleString("zh-TW") + " km"
    : "補登舊資料可低於此數值";
  el.textContent = "目前最高里程 " + maxMileage.toLocaleString("zh-TW") + " km；" + delta + "。" + (warning ? warning + "。" : "");
  el.classList.toggle("form-help-warn", Boolean(warning));
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

// 新增當天的紀錄先帶入目前里程；日期改成別天就清空。使用者自己輸入過里程後不再更動。
function syncAutoMileage() {
  const input = document.getElementById("formMileage");
  if (input.dataset.autoMileage !== "true") return;
  const currentMileage = getCurrentMileage();
  const isToday = document.getElementById("formDate").value === getTodayString();
  input.value = isToday && currentMileage > 0 ? String(currentMileage) : "";
}

// 照片、AI 草稿有里程就用草稿的；沒有時依日期決定要不要帶入目前里程。
function setFormMileage(value) {
  const input = document.getElementById("formMileage");
  if (value) {
    input.value = value;
    delete input.dataset.autoMileage;
  } else {
    syncAutoMileage();
  }
}

function handleRecordFormInput(id) {
  clearFormMessage();
  if (id === "formMileage") delete document.getElementById("formMileage").dataset.autoMileage;
  if (id === "formDate") syncAutoMileage();
  if (id === "formMileage" || id === "formDate") updateMileageHint();
}

function openAddModal() {
  document.getElementById("modalTitle").textContent = "新增保養/維修紀錄";
  document.getElementById("editIndex").value = "-1";
  document.getElementById("recordForm").reset();
  document.getElementById("formDate").value = getTodayString();
  document.getElementById("formMileage").dataset.autoMileage = "true";
  syncAutoMileage();
  clearFormMessage();
  updateMileageHint(-1);
  openDialog("modal");
}

// 「下次保養」卡片的「記錄保養」：帶入今天、目前里程與定期保養內容，里程再對照保養單修正。
function openMaintenanceRecordModal() {
  const { dueMileage } = getMaintenanceSchedule(now());
  openAddModal();
  document.getElementById("formCategory").value = "保養";
  document.getElementById("formDetail").value =
    (dueMileage ? `${dueMileage.toLocaleString("zh-TW")} km ` : "") + "定期保養：機油、機油芯、基本檢查";
  showFormMessage("info", `請對照保養單確認里程；下次 ${MAINTENANCE_INTERVAL_KM.toLocaleString("zh-TW")} km 會從這筆的里程起算。`);
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
  delete document.getElementById("formMileage").dataset.autoMileage;
  document.getElementById("formMileage").value = r.mileage || "";
  document.getElementById("formCategory").value = r.category || "";
  document.getElementById("formCost").value = r.cost || "";
  document.getElementById("formTemplate").value = "";
  document.getElementById("formDetail").value = r.detail || "";
  document.getElementById("formNote").value = r.note || "";
  clearFormMessage();
  updateMileageHint(idx);
  openDialog("modal");
}

function closeModal() {
  closeDialog("modal");
  clearFormMessage();
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

// 牌價每週一 00:00（台灣時間）調整：快取只在同一週內、12 小時內有效。
function getLastFuelPriceChange(nowMs = Date.now()) {
  const taipeiOffsetMs = 8 * 60 * 60 * 1000;
  const taipei = new Date(nowMs + taipeiOffsetMs);
  const daysSinceMonday = (taipei.getUTCDay() + 6) % 7;
  return Date.UTC(taipei.getUTCFullYear(), taipei.getUTCMonth(), taipei.getUTCDate() - daysSinceMonday) - taipeiOffsetMs;
}

function getFuelPriceCache({ allowStale = false } = {}) {
  try {
    const cached = JSON.parse(localStorage.getItem(FUEL_PRICE_CACHE_KEY) || "null");
    const data = normalizeFuelPriceData(cached);
    if (!data) return null;
    const cachedAt = Date.parse(cached.cachedAt || "");
    const isFresh = Number.isFinite(cachedAt) &&
      (Date.now() - cachedAt) <= FUEL_PRICE_CACHE_MAX_AGE_MS &&
      cachedAt >= getLastFuelPriceChange();
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

function applyFuelPrice(data, fuelType, { preserveCostInput = false } = {}) {
  const price = data.prices[fuelType];
  document.getElementById("fuelLogUnitPriceInput").value = price.toFixed(1);
  setFuelPriceStatus(`已帶入 ${data.source} ${fuelType} 牌價 ${price.toFixed(1)} 元/L${data.effectiveAt ? "，" + data.effectiveAt + " 實行" : ""}。`);
  updateFuelLogCostFromDiscount({ preserveCostInput });
}

// 背景確認牌價是否有調整；使用者已手動改過油價或油品就不覆蓋。
function refreshFuelPriceInBackground(fuelType, appliedPrice) {
  fetchCurrentFuelPrices().then(data => {
    const price = data.prices[fuelType];
    const priceInput = document.getElementById("fuelLogUnitPriceInput");
    if (!Number.isFinite(price) || document.getElementById("fuelLogTypeInput").value !== fuelType) return;
    if (parseDecimalInput(priceInput.value) !== Number(appliedPrice.toFixed(1))) return;
    if (Math.abs(price - appliedPrice) < 0.05) return;
    applyFuelPrice(data, fuelType, { preserveCostInput: Boolean(document.getElementById("fuelLogCostInput").value) });
  }).catch(() => {});
}

async function loadFuelPriceForSelectedType({ force = false, preferCache = true } = {}) {
  const typeInput = document.getElementById("fuelLogTypeInput");
  const priceInput = document.getElementById("fuelLogUnitPriceInput");
  if (!typeInput || !priceInput) return;

  const fuelType = typeInput.value;
  if (fuelType === "其他") {
    setFuelPriceStatus("其他油品請手動輸入牌告油價。");
    return;
  }
  if (priceInput.value && !force) return;

  // 本週已抓過的牌價立即填入，表單不必等網路；超過一小時再於背景確認。
  const cached = preferCache ? getFuelPriceCache() : null;
  const cachedPrice = cached?.prices?.[fuelType];
  if (Number.isFinite(cachedPrice)) {
    applyFuelPrice(cached, fuelType);
    if (Date.now() - Date.parse(cached.cachedAt) > FUEL_PRICE_RECHECK_MS) {
      refreshFuelPriceInBackground(fuelType, cachedPrice);
    }
    return;
  }

  setFuelPriceStatus(`正在抓取全國加油站 ${fuelType} 今日牌價...`);
  let staleCached = null;
  try {
    const data = await fetchCurrentFuelPrices();
    if (Number.isFinite(data.prices[fuelType])) {
      applyFuelPrice(data, fuelType);
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
  updateCurrentMileageHint();
  clearMileageMessage();
  openDialog("mileageModal");
}

function closeMileageModal() {
  closeDialog("mileageModal");
  clearMileageMessage();
}

// 一箱油約可跑 900 km；距上次加油超過 1,500 km 多半是多打一位或漏登加油。
const FUEL_GAP_WARNING_KM = 1500;
const MILEAGE_JUMP_MIN_KM = 3000;

function getPreviousFuelLog({ excludeIndex = -1, onOrBefore = "" } = {}) {
  const logs = getFuelLogs().filter(log =>
    log.sourceIndex !== excludeIndex && (!onOrBefore || log.date <= onOrBefore)
  );
  return logs.length ? logs[logs.length - 1] : null;
}

function getDefaultFuelNote(log) {
  const note = String(log?.note || "");
  const station = note.match(/全國加油站|全國|中油|台塑|台亞|山隆|福懋|統一精工|速邁樂/)?.[0];
  if (!station) return "全國加油站自助";
  const name = station === "全國" ? "全國加油站" : station;
  return note.includes("自助") ? name + "自助" : name;
}

// 里程比目前最高值多出很多（超過 3,000 km，且超過依開車速度推估的 3 倍）時提醒確認。
function getMileageJumpWarning(mileage, dateText = getTodayString(), { excludeIndex = -1 } = {}) {
  const maxMileage = getMaxMileage(excludeIndex);
  if (!Number.isFinite(mileage) || maxMileage <= 0 || mileage <= maxMileage) return "";
  const jump = mileage - maxMileage;
  const pace = getDrivingPace();
  const date = parseDate(dateText) || now();
  const expected = pace ? pace.kmPerDay * Math.max(1, diffDays(date, pace.latestDate)) : 0;
  if (jump <= Math.max(MILEAGE_JUMP_MIN_KM, expected * 3)) return "";
  return `比目前最高里程多 ${jump.toLocaleString("zh-TW")} km，請確認沒有多打一位`;
}

function getFuelGapWarning(mileage, previous) {
  if (!previous || !Number.isFinite(mileage)) return "";
  const gap = mileage - previous.mileage;
  return gap > FUEL_GAP_WARNING_KM
    ? `距上次加油 +${gap.toLocaleString("zh-TW")} km，請確認里程或是否漏登加油`
    : "";
}

function getFuelLogMileageWarning(mileage, date) {
  const previous = getPreviousFuelLog({ excludeIndex: fuelEditIndex, onOrBefore: date });
  return getFuelGapWarning(mileage, previous) || getMileageJumpWarning(mileage, date, { excludeIndex: fuelEditIndex });
}

function updateFuelLogMileageHint() {
  const el = document.getElementById("fuelLogMileageHint");
  if (!el) return;
  const mileage = parseInt(document.getElementById("fuelLogMileageInput").value, 10);
  const date = document.getElementById("fuelLogDateInput").value;
  const previous = getPreviousFuelLog({ excludeIndex: fuelEditIndex, onOrBefore: date });
  const parts = [];
  if (previous) {
    parts.push(`上次加油 ${previous.mileage.toLocaleString("zh-TW")} km（${previous.date}）`);
    if (Number.isFinite(mileage)) {
      const gap = mileage - previous.mileage;
      parts.push(gap >= 0
        ? `本次 +${gap.toLocaleString("zh-TW")} km`
        : `比上次少 ${Math.abs(gap).toLocaleString("zh-TW")} km`);
    }
  }
  const warning = getFuelLogMileageWarning(mileage, date);
  el.textContent = [parts.join("，"), warning].filter(Boolean).join("。");
  el.classList.toggle("form-help-warn", Boolean(warning) || Boolean(previous && mileage < previous.mileage));
}

function updateCurrentMileageHint() {
  const el = document.getElementById("currentMileageHint");
  if (!el) return;
  const currentMileage = getCurrentMileage();
  const mileage = parseInt(document.getElementById("currentMileageInput").value, 10);
  if (currentMileage <= 0) {
    el.textContent = "";
    return;
  }
  const parts = ["目前紀錄最高里程是 " + currentMileage.toLocaleString("zh-TW") + " km"];
  if (Number.isFinite(mileage) && mileage > currentMileage) {
    parts.push("本次 +" + (mileage - currentMileage).toLocaleString("zh-TW") + " km");
  }
  const warning = getMileageJumpWarning(mileage);
  el.textContent = parts.join("，") + "。" + (warning ? warning + "。" : "");
  el.classList.toggle("form-help-warn", Boolean(warning));
}

function openFuelLogModal({ skipPriceLoad = false, editIndex = -1 } = {}) {
  const editing = Number.isInteger(editIndex) && editIndex >= 0 && isFuelLogRecord(records[editIndex]);
  const record = editing ? records[editIndex] : null;
  const parsed = editing ? parseFuelLog(record, editIndex) : null;
  const currentMileage = getCurrentMileage();
  const lastFuel = editing ? null : getPreviousFuelLog();
  const defaultFuelType = ["92", "95", "98", "其他"].includes(lastFuel?.fuelType) ? lastFuel.fuelType : DEFAULT_FUEL_TYPE;
  const defaultDiscount = Number.isFinite(lastFuel?.discount) ? lastFuel.discount : DEFAULT_FUEL_DISCOUNT;
  fuelEditIndex = editing ? editIndex : -1;
  document.getElementById("fuelLogModalTitle").textContent = editing ? "編輯加油紀錄" : "新增加油紀錄";
  document.getElementById("fuelLogSaveBtn").textContent = editing ? "💾 儲存變更" : "💾 儲存加油";
  document.getElementById("fuelLogDateInput").value = editing ? (record.date || getTodayString()) : getTodayString();
  document.getElementById("fuelLogMileageInput").value = editing ? (record.mileage || "") : (currentMileage || "");
  document.getElementById("fuelLogLitersInput").value = parsed ? parsed.liters.toFixed(2) : "";
  document.getElementById("fuelLogUnitPriceInput").value = Number.isFinite(parsed?.unitPrice) ? parsed.unitPrice.toFixed(1) : "";
  document.getElementById("fuelLogDiscountInput").value = Number.isFinite(parsed?.discount)
    ? parsed.discount.toFixed(1)
    : (editing ? String(DEFAULT_FUEL_DISCOUNT) : defaultDiscount.toFixed(1));
  document.getElementById("fuelLogCostInput").value = editing ? (record.cost || "") : "";
  document.getElementById("fuelLogNetPriceHint").textContent = "輸入加油量與油價後會自動試算，實際付款金額可直接修改。";
  document.getElementById("fuelLogTypeInput").value = ["92", "95", "98", "其他"].includes(parsed?.fuelType)
    ? parsed.fuelType
    : (editing ? DEFAULT_FUEL_TYPE : defaultFuelType);
  document.getElementById("fuelLogFullTankInput").value = parsed?.fullTank === false ? "no" : "yes";
  document.getElementById("fuelLogNoteInput").value = editing ? (record.note || "") : getDefaultFuelNote(lastFuel);
  setFuelPriceStatus(editing ? "已帶入原加油資料；修改後會重新試算金額。" : `預設 ${defaultFuelType}，會嘗試抓取全國加油站今日牌價。`);
  clearFuelLogMessage();
  const saveBtn = document.querySelector("#fuelLogForm button[type='submit']");
  if (saveBtn) delete saveBtn.dataset.confirmedMileage;
  openDialog("fuelLogModal");
  updateFuelLogMileageHint();
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
  buildCharts();
}

function setRecordsSubtab(tab) {
  activeRecordsSubtab = ["all", "fuel", "mileage"].includes(tab) ? tab : "all";
  resetRecordsPaging();
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
  buildCharts();
}

function openQuickEntryMenu(invoker = null) {
  const modal = document.getElementById("quickEntryModal");
  openDialog("quickEntryModal", { invoker });
  const focusable = getModalFocusableElements(modal);
  const primaryAction = focusable.find(element => element.dataset?.quickEntry === "fuel");
  (primaryAction || focusable[0])?.focus();
}

function closeQuickEntryMenu({ restoreFocus = true } = {}) {
  closeDialog("quickEntryModal", { restoreFocus });
}

function runQuickEntry(action) {
  closeQuickEntryMenu();
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
  closeDialog("fuelLogModal");
  fuelEditIndex = -1;
  clearFuelLogMessage();
}

function openFuelModal() {
  const currentMileage = getCurrentMileage();
  document.getElementById("fuelMileageInput").value = currentMileage || "";
  document.getElementById("fuelCostInput").value = "";
  document.getElementById("fuelNoteInput").value = "";
  clearFuelMessage();
  openDialog("fuelModal");
}

function closeFuelModal() {
  closeDialog("fuelModal");
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
  openDialog("photoModal");
}

function closePhotoModal() {
  closeDialog("photoModal");
  clearPhotoMessage();
  releaseOcrWorker();
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

// OCR worker 在照片視窗開著時重複使用（連拍多張不必重新載入模型），關閉視窗即釋放記憶體。
let ocrWorkerPromise = null;
let ocrProgressHandler = null;

function getOcrWorker() {
  if (!ocrWorkerPromise) {
    const logger = info => ocrProgressHandler?.(info);
    ocrWorkerPromise = loadScriptOnce(TESSERACT_JS_URL, TESSERACT_JS_SRI)
      .then(() => Tesseract.createWorker("chi_tra+eng", 1, { logger }))
      .catch(error => {
        console.warn("繁中 OCR 模型載入失敗，改用英文數字辨識", error);
        return loadScriptOnce(TESSERACT_JS_URL, TESSERACT_JS_SRI)
          .then(() => Tesseract.createWorker("eng", 1, { logger }));
      })
      .catch(error => {
        ocrWorkerPromise = null;
        throw error;
      });
  }
  return ocrWorkerPromise;
}

function releaseOcrWorker() {
  const pending = ocrWorkerPromise;
  ocrWorkerPromise = null;
  pending?.then(worker => worker.terminate()).catch(() => {});
}

// 手機照片常超過 4,000 px；縮到長邊 2,000 px 辨識快很多，收據文字仍清楚。
async function prepareImageForOcr(file) {
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, OCR_MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) {
      bitmap.close?.();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas;
  } catch (error) {
    return file;
  }
}

async function recognizePhotoFile(file) {
  ocrProgressHandler = info => {
    if (info.status === "recognizing text") {
      const pct = Math.round((info.progress || 0) * 100);
      showPhotoMessage("info", "正在辨識照片文字 " + pct + "%");
    } else if (info.status) {
      showPhotoMessage("info", "正在準備 OCR：" + info.status);
    }
  };
  try {
    const [worker, image] = await Promise.all([getOcrWorker(), prepareImageForOcr(file)]);
    return await worker.recognize(image);
  } finally {
    ocrProgressHandler = null;
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
    setDialogFormDirty("fuelLogModal", true);
    return;
  }

  openAddModal();
  document.getElementById("formDate").value = parsed.date || getTodayString();
  setFormMileage(parsed.mileage);
  document.getElementById("formCategory").value = parsed.category || "保養";
  document.getElementById("formCost").value = parsed.cost || "";
  document.getElementById("formDetail").value = parsed.detail || "照片辨識紀錄";
  document.getElementById("formNote").value = parsed.note || "照片辨識，請確認欄位";
  updateMileageHint(-1);
  showFormMessage("info", "已從照片填入紀錄；請確認日期、里程、費用與內容後儲存。");
  setDialogFormDirty("modal", true);
}

function openAiModal() {
  document.getElementById("aiRecordForm").reset();
  renderAiResultNote("");
  clearAiMessage();
  document.getElementById("aiSubmitBtn").disabled = false;
  openDialog("aiModal");
  setTimeout(() => document.getElementById("aiRecordText").focus(), 50);
}

function closeAiModal() {
  closeDialog("aiModal");
  renderAiResultNote("");
  clearAiMessage();
}

// 只送最近的紀錄給 AI 當參考：夠判斷里程與用語，又不會隨紀錄變多而變慢、變貴。
function getAiSafeRecords() {
  return getRecordsNewestFirst().slice(0, AI_CONTEXT_RECORD_LIMIT).map(r => ({
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
  return /保養|維修|更換|換|輪胎|電瓶|煞車|機油|變速箱|保險|驗車|檢驗|牌照稅|燃料稅|洗車|美容|鍍膜|清潔|改裝|升級|汽油精|烤漆|鈑金|板金|刮傷/.test(text);
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
  setDialogFormDirty("fuelLogModal", true);
}

function applyAiServiceDraft(result, sourceText) {
  const draft = result.draft || {};
  closeAiModal();
  openAddModal();
  document.getElementById("formDate").value = normalizeAiDate(draft.date);
  setFormMileage(getAiDraftInteger(draft.mileage));
  document.getElementById("formCategory").value = normalizeAiCategory(draft.category, sourceText);
  document.getElementById("formCost").value = getAiDraftInteger(draft.cost) || "";
  document.getElementById("formTemplate").value = "";
  document.getElementById("formDetail").value = String(draft.detail || "").trim() || sourceText;
  document.getElementById("formNote").value = String(draft.note || "").trim();
  updateMileageHint(-1);
  showFormMessage("info", `${result.localParser ? "本機規則" : "AI"} 已填入紀錄草稿；請確認日期、里程、類別、費用與內容後儲存。` + getAiReviewSuffix(result));
  setDialogFormDirty("modal", true);
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
  const saveBtn = e.submitter || document.querySelector("#mileageForm button[type='submit']");
  const jumpWarning = getMileageJumpWarning(mileage);
  if (jumpWarning && saveBtn && !saveBtn.dataset.confirmedMileage) {
    showMileageMessage("info", jumpWarning + "；確認無誤請再按一次更新。");
    saveBtn.dataset.confirmedMileage = "true";
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

  commitRecordChange(
    existingTodayIndex >= 0
      ? { type: "edit", index: existingTodayIndex, before: records[existingTodayIndex], after: rec }
      : { type: "add", after: rec },
    { message: "已更新目前里程", close: closeMileageModal }
  );
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
  const mileageWarning = getFuelLogMileageWarning(mileage, date);
  if (mileageWarning && !saveBtn.dataset.confirmedMileage) {
    showFuelLogMessage("info", mileageWarning + "；確認無誤請再按一次儲存。");
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
      const editing = fuelEditIndex >= 0;
      commitRecordChange(
        editing
          ? { type: "edit", index: fuelEditIndex, before: records[fuelEditIndex], after: record }
          : { type: "add", after: record },
        { message: editing ? "已更新加油紀錄" : "已新增加油紀錄", close: closeFuelLogModal }
      );
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

  commitRecordChange({
    type: "add",
    after: {
      date: getTodayString(),
      mileage,
      category: "其他",
      detail: "汽油精",
      cost,
      note: note || "定期添加維護"
    }
  }, { message: "已記錄汽油精", close: closeFuelModal });
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
  const trackedName = rec.mileage === null ? getMileageTrackedName(rec) : "";
  if (trackedName && !saveBtn.dataset.confirmedMileage) {
    const nextText = trackedName === "定期保養" ? `下次 ${MAINTENANCE_INTERVAL_KM.toLocaleString("zh-TW")} km 保養` : "下一次的時間";
    showFormMessage("info", `${trackedName}沒有填里程，就算不出${nextText}；請填上當時的里程。確定不填，請再按一次儲存。`);
    saveBtn.dataset.confirmedMileage = "true";
    return;
  }
  if (rec.mileage !== null && mileageChanged && maxMileage > 0 && rec.mileage < maxMileage && !saveBtn.dataset.confirmedMileage) {
    showFormMessage("info", "這筆里程低於目前最高里程 " + maxMileage.toLocaleString("zh-TW") + " km；若是在補登舊紀錄，請再按一次儲存。");
    saveBtn.dataset.confirmedMileage = "true";
    return;
  }
  const jumpWarning = rec.mileage !== null && mileageChanged
    ? getMileageJumpWarning(rec.mileage, rec.date, { excludeIndex: idx })
    : "";
  if (jumpWarning && !saveBtn.dataset.confirmedMileage) {
    showFormMessage("info", jumpWarning + "；確認無誤請再按一次儲存。");
    saveBtn.dataset.confirmedMileage = "true";
    return;
  }

  requestRecordSave(rec, {
    editIndex: idx,
    commit: () => {
      commitRecordChange(
        idx === -1 ? { type: "add", after: rec } : { type: "edit", index: idx, before: records[idx], after: rec },
        { message: idx === -1 ? `已新增${rec.category}紀錄` : "已更新紀錄", close: closeModal }
      );
    }
  });
}

// ============================================================
// 刪除 Modal
// ============================================================
function openDeleteModal(idx) {
  deleteTargetIndex = idx;
  openDialog("deleteModal", { focusId: "deleteCancelBtn" });
}
function closeDeleteModal() {
  closeDialog("deleteModal");
  deleteTargetIndex = -1;
}
function handleDeleteConfirm() {
  if (deleteTargetIndex < 0) return;
  const index = deleteTargetIndex;
  const record = records[index];
  if (!record) return;
  commitRecordChange({ type: "delete", index, before: record }, { message: "已刪除紀錄", close: closeDeleteModal });
}

// ============================================================
// 新增、編輯、刪除都可以「復原」
// ============================================================
function findRecordIndexFor(target) {
  if (!target) return -1;
  const direct = records.indexOf(target);
  if (direct >= 0) return direct;
  const key = recordKey(target);
  return records.findIndex(record => recordKey(record) === key);
}

// change: { type: "add" | "edit" | "delete", index, before, after }
function commitRecordChange(change, { message, close } = {}) {
  if (change.type === "add") records.push(change.after);
  else if (change.type === "edit") records[change.index] = change.after;
  else if (change.type === "delete") records.splice(change.index, 1);
  lastUndo = change;
  saveRecords(records, { announce: false });
  if (close) close();
  refresh();
  showToast(message, { label: "復原", onClick: undoLastChange });
}

// 以內容找回紀錄：期間若與雲端合併過，索引可能已改變。
function undoLastChange() {
  const change = lastUndo;
  lastUndo = null;
  if (!change) return false;
  if (change.type === "delete") {
    records.splice(Math.min(change.index, records.length), 0, change.before);
  } else {
    const index = findRecordIndexFor(change.after);
    if (index < 0) {
      showToast("無法復原：這筆紀錄已被其他變更取代。");
      return false;
    }
    if (change.type === "add") records.splice(index, 1);
    else records[index] = change.before;
  }
  saveRecords(records, { announce: false });
  refresh();
  showToast("已復原");
  return true;
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
  const trend = document.getElementById("fuelTrend");
  const trendSummary = document.getElementById("fuelTrendSummary");
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
  if (trend) trend.hidden = fuelStats.segments.length < 2;
  if (trendSummary) {
    trendSummary.textContent = [
      fuelStats.averageKmPerLiter ? `平均 ${fuelStats.averageKmPerLiter.toFixed(1)} km/L` : "",
      fuelStats.averageCostPerKm ? `每公里 NT$ ${fuelStats.averageCostPerKm.toFixed(2)}` : ""
    ].filter(Boolean).join(" · ");
  }

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
      : "油耗待第二次加滿後計算",
    fuelStats.averageCostPerKm ? `每公里 NT$ ${fuelStats.averageCostPerKm.toFixed(2)}` : ""
  ].filter(Boolean).join(" · ");

  tbody.innerHTML = logs.map(log => {
    const segment = segmentMap.get(`${log.date}|${log.mileage}`);
    const needsReview = segment && suspiciousFuelKeys.has(`fuel|${segment.date}|${segment.mileage}`);
    const kmPerLiter = segment
      ? `${segment.kmPerLiter.toFixed(1)} km/L`
      : (log.fullTank ? "基準" : "—");
    const costPerKm = segment?.costPerKm != null ? `NT$ ${segment.costPerKm.toFixed(2)}` : "—";
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
        <td data-label="每公里">${costPerKm}</td>
        <td data-label="備註">${escapeHtml(log.note || "")}</td>
      </tr>
    `;
  }).join("");
}

// ============================================================
// 全量更新
// ============================================================
function refresh() {
  renderCache = new Map();
  try {
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
  } finally {
    renderCache = null;
  }
}

// ============================================================
// 事件綁定
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("appVersion").textContent = APP_VERSION;
  document.getElementById("appVersionDetail").textContent = APP_VERSION;
  updateThemeToggle();

  // 先顯示本機資料，再於背景與雲端同步
  initData();

  // 離線也能開啟 App（加到主畫面後尤其需要）
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("sw.js").catch(error => console.warn("離線快取註冊失敗", error));
  }

  // 對話框：點背景或 Esc 關閉（表單有未儲存內容時不關閉），Tab 在視窗內循環
  Object.keys(DIALOG_CLOSERS).forEach(id => {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.addEventListener("click", event => {
      if (event.target === overlay) requestDialogDismiss(id);
    });
    const form = getDialogForm(id);
    if (!form) return;
    // 只有輸入事件才算未儲存；程式自動帶入的值不會觸發 input 事件。
    const markDirty = () => {
      form.dataset.dirty = "true";
    };
    form.addEventListener("input", markDirty);
    form.addEventListener("change", markDirty);
  });
  document.addEventListener("keydown", event => {
    const id = getTopDialogId();
    if (!id) return;
    if (event.key === "Escape") {
      event.preventDefault();
      requestDialogDismiss(id);
    } else {
      trapModalFocus(event, document.getElementById(id));
    }
  });

  // 同步：點狀態立即重試；連線恢復或回到 App 時自動同步
  document.getElementById("syncStatus").addEventListener("click", event => {
    const status = event.currentTarget;
    if (/sync-(?:error|warn)/.test(status.className) && status.dataset.detail) {
      showToast(`${status.textContent}：${status.dataset.detail}`);
    }
    requestSync({ reconcile: true });
  });
  document.getElementById("btnThemeToggle").addEventListener("click", () => {
    setTheme(getTheme() === "light" ? "dark" : "light");
  });
  document.getElementById("btnHeroFuel").addEventListener("click", () => openFuelLogModal());
  document.getElementById("btnLogMaintenance").addEventListener("click", () => openMaintenanceRecordModal());
  document.getElementById("btnUpgradeList").addEventListener("click", showUpgradeCostList);
  document.getElementById("upgradeCostList").addEventListener("click", event => {
    const button = event.target.closest("[data-upgrade-record]");
    if (button) openEditModal(Number(button.dataset.upgradeRecord));
  });
  window.addEventListener("online", () => requestSync({ reconcile: true }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const stale = Date.now() - lastCloudCheckAt > SYNC_RECHECK_INTERVAL_MS;
    if (stale || syncMeta?.dirty || syncMeta?.lastAttempt) {
      requestSync({ reconcile: stale || Boolean(syncMeta?.lastAttempt) });
    }
  });

  // 快速新增與內容切換
  document.getElementById("calendarReminderCloseBtn").addEventListener("click", closeCalendarReminder);
  document.getElementById("calendarReminderCancelBtn").addEventListener("click", closeCalendarReminder);
  document.getElementById("calendarReminderConfirmBtn").addEventListener("click", downloadCalendarReminder);
  document.getElementById("btnQuickEntry").addEventListener("click", openQuickEntryMenu);
  document.getElementById("quickEntryModalClose").addEventListener("click", closeQuickEntryMenu);
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
  document.getElementById("btnLegacyStashDownload").addEventListener("click", downloadLegacyLocalStash);

  document.getElementById("duplicateCancelBtn").addEventListener("click", closeDuplicateModal);
  document.getElementById("duplicateConfirmBtn").addEventListener("click", confirmDuplicateSave);

  // Modal 關閉
  document.getElementById("modalClose").addEventListener("click", closeModal);
  document.getElementById("btnCancel").addEventListener("click", closeModal);

  // 表單提交
  document.getElementById("recordForm").addEventListener("submit", handleFormSubmit);
  document.getElementById("formTemplate").addEventListener("change", e => applyRecordTemplate(e.target.value));
  ["formDate", "formMileage", "formCategory", "formCost", "formDetail", "formNote"].forEach(id => {
    document.getElementById(id).addEventListener("input", () => handleRecordFormInput(id));
  });

  // 目前里程更新
  document.getElementById("mileageModalClose").addEventListener("click", closeMileageModal);
  document.getElementById("mileageCancelBtn").addEventListener("click", closeMileageModal);
  document.getElementById("mileageForm").addEventListener("submit", handleMileageSubmit);
  document.getElementById("currentMileageInput").addEventListener("input", () => {
    clearMileageMessage();
    updateCurrentMileageHint();
  });

  // 照片辨識
  document.getElementById("photoModalClose").addEventListener("click", closePhotoModal);
  document.getElementById("photoCancelBtn").addEventListener("click", closePhotoModal);
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
  document.getElementById("aiRecordForm").addEventListener("submit", handleAiRecordSubmit);
  document.getElementById("aiRecordText").addEventListener("input", () => {
    clearAiMessage();
    renderAiResultNote("");
    document.getElementById("aiSubmitBtn").disabled = false;
  });

  // 加油紀錄
  document.getElementById("fuelLogModalClose").addEventListener("click", closeFuelLogModal);
  document.getElementById("fuelLogCancelBtn").addEventListener("click", closeFuelLogModal);
  document.getElementById("fuelLogForm").addEventListener("submit", handleFuelLogSubmit);
  document.getElementById("btnFetchFuelPrice").addEventListener("click", () => loadFuelPriceForSelectedType({ force: true, preferCache: false }));
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
  ["fuelLogDateInput", "fuelLogMileageInput"].forEach(id => {
    document.getElementById(id).addEventListener("input", updateFuelLogMileageHint);
  });

  // 汽油精添加
  document.getElementById("fuelModalClose").addEventListener("click", closeFuelModal);
  document.getElementById("fuelCancelBtn").addEventListener("click", closeFuelModal);
  document.getElementById("fuelForm").addEventListener("submit", handleFuelSubmit);
  ["fuelMileageInput", "fuelCostInput", "fuelNoteInput"].forEach(id => {
    document.getElementById(id).addEventListener("input", clearFuelMessage);
  });

  // 刪除 Modal
  document.getElementById("deleteCancelBtn").addEventListener("click", closeDeleteModal);
  document.getElementById("deleteConfirmBtn").addEventListener("click", handleDeleteConfirm);

  // 紀錄列表：編輯、刪除、顯示更多
  document.getElementById("recordsContainer").addEventListener("click", event => {
    if (event.target.closest("[data-records-more]")) {
      recordsVisibleLimit += RECORDS_PAGE_SIZE;
      renderRecords();
      return;
    }
    const editButton = event.target.closest(".edit-btn");
    if (editButton) {
      openEditModal(Number(editButton.dataset.idx));
      return;
    }
    const deleteButton = event.target.closest(".delete-btn");
    if (deleteButton) openDeleteModal(Number(deleteButton.dataset.idx));
  });

  // 資料檢查：直接開啟有問題的那筆紀錄
  document.getElementById("dataQualityPanel").addEventListener("click", event => {
    const button = event.target.closest("[data-quality-record]");
    if (button) openEditModal(Number(button.dataset.qualityRecord));
  });

  // 類別篩選 Pills
  document.getElementById("filterPills").addEventListener("click", e => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    document.querySelectorAll(".pill").forEach(p => p.classList.remove("pill-active"));
    btn.classList.add("pill-active");
    currentFilter = btn.dataset.cat;
    resetRecordsPaging();
    renderRecords();
  });

  // 年份篩選
  document.getElementById("yearFilter").addEventListener("change", e => {
    currentYear = e.target.value;
    resetRecordsPaging();
    renderRecords();
  });

  // 搜尋
  let searchTimer;
  document.getElementById("searchInput").addEventListener("input", e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentSearch = e.target.value.trim();
      resetRecordsPaging();
      renderRecords();
    }, 200);
  });
});
