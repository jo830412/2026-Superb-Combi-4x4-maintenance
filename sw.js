// 讓 App 在沒有訊號時也能開啟。
// 同源檔案先走網路，3 秒內沒回應就先用快取（之後仍會更新快取）；圖表與 OCR 函式庫優先用快取。
// Apps Script API 與字型不經過快取。
const CACHE_NAME = "superb-maintenance-v2026.10.05.1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=2026.10.05.1",
  "./app.js?v=2026.10.05.1",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/apple-touch-icon.png"
];
const CDN_LIBRARIES = [
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js",
  "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"
];
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith("superb-maintenance-") && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// 只快取網站本身的檔案；資料 API 一律走網路，避免離線時拿到過期的雲端狀態。
const STATIC_FILE_PATTERN = /\.(?:html|css|js|png|svg|webmanifest)$/;

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (request.mode === "navigate" || STATIC_FILE_PATTERN.test(url.pathname)) {
      event.respondWith(networkFirst(request));
    }
  } else if (CDN_LIBRARIES.includes(request.url)) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const isNavigation = request.mode === "navigate";
  const cacheKey = isNavigation ? "./index.html" : request;
  const network = fetch(isNavigation ? new Request(request.url, { cache: "no-cache", credentials: "same-origin" }) : request)
    .then(response => {
      if (response.ok && !response.redirected) cache.put(cacheKey, response.clone()).catch(() => {});
      return response;
    });
  const cached = await cache.match(cacheKey);
  if (!cached) return network;
  const timeout = new Promise(resolve => setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS));
  return Promise.race([network.catch(() => cached), timeout]);
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone()).catch(() => {});
  return response;
}
