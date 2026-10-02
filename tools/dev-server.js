// 本機預覽：提供網站檔案，並用真正的 apps-script/Code.js（假試算表）回應 API，
// 不會讀寫正式的 Google Sheet。
//
//   node tools/dev-server.js [port]
//
// 開啟 http://localhost:4173/ ；模擬斷線：/__offline?on=1，恢復：/__offline?on=0
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { loadAppsScript } = require("../tests/helpers/apps-script-harness");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.argv[2] || process.env.PORT || 4173);
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};
const SAMPLE_FUEL_PAGE = [
  "<p>零售參考價 115年9月29日零時 實行</p>",
  "<p>92無鉛汽油 27.3 元</p>",
  "<p>95+無鉛汽油 28.8 元</p>",
  "<p>98無鉛汽油 30.8 元</p>"
].join("");

function fuel(date, mileage, liters, unitPrice) {
  const discount = 1.8;
  const net = unitPrice - discount;
  return {
    date,
    mileage,
    category: "加油",
    cost: Math.round(liters * net),
    detail: `加油｜98｜${liters.toFixed(2)} L｜加滿｜牌告 ${unitPrice.toFixed(1)} 元/L｜優惠 ${discount.toFixed(1)} 元/L｜實付 ${net.toFixed(1)} 元/L`,
    note: "全國加油站自助"
  };
}

function sampleRecords() {
  return [
    fuel("2026-06-02", 420, 50.2, 31.4),
    fuel("2026-06-12", 1150, 52.1, 31.4),
    { date: "2026-06-18", mileage: 1250, category: "改裝升級", cost: 12000, detail: "隔熱紙", note: "" },
    fuel("2026-06-25", 1900, 51.3, 31.0),
    { date: "2026-07-01", mileage: null, category: "檢驗/稅費", cost: 6180, detail: "公路養管費", note: "年度稅費" },
    fuel("2026-07-05", 2620, 49.8, 31.0),
    fuel("2026-07-14", 3300, 47.9, 30.6),
    fuel("2026-07-26", 4050, 52.4, 30.6),
    { date: "2026-08-07", mileage: 4400, category: "其他", cost: 0, detail: "目前里程更新", note: "用於儀表板里程計算" },
    fuel("2026-08-09", 4780, 50.6, 30.9),
    { date: "2026-08-22", mileage: 5100, category: "保養", cost: 4200, detail: "機油、機油芯", note: "例行機油保養" },
    fuel("2026-08-30", 5520, 49.1, 30.9),
    fuel("2026-09-08", 6260, 51.0, 30.8),
    { date: "2026-09-15", mileage: 6500, category: "清潔美容", cost: 500, detail: "洗車", note: "" },
    { date: "2026-09-15", mileage: 6500, category: "清潔美容", cost: 500, detail: "洗車", note: "重複登錄" },
    fuel("2026-09-19", 6980, 50.4, 30.8),
    { date: "2026-09-20", mileage: 7000, category: "維修", cost: 4500, detail: "前保險桿刮傷烤漆", note: "" },
    fuel("2026-09-28", 7700, 52.2, 30.8),
    { date: "2026-10-01", mileage: 7850, category: "其他", cost: 0, detail: "目前里程更新", note: "用於儀表板里程計算" }
  ];
}

const backend = loadAppsScript(sampleRecords(), { fetchFuelPage: () => SAMPLE_FUEL_PAGE });
let offline = false;

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-cache" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleApi(req, res, url) {
  if (offline) return send(res, 503, "offline (simulated)");
  const parameter = Object.fromEntries(url.searchParams);
  const output = req.method === "POST"
    ? backend.api.doPost({ parameter, postData: { contents: await readBody(req) } })
    : backend.api.doGet({ parameter });
  send(res, 200, output.getContent(), "application/json; charset=utf-8");
}

function serveStatic(url, res) {
  const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = path.join(ROOT, relative);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, "not found");
  }
  let body = fs.readFileSync(file);
  if (relative === "/app.js") {
    // 指向本機假 API，絕不連到正式 Apps Script。
    body = body.toString("utf8").replace(/const API_URL = "[^"]+";/, 'const API_URL = "/api";');
  }
  send(res, 200, body, CONTENT_TYPES[path.extname(file)] || "application/octet-stream");
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/__offline") {
    offline = url.searchParams.get("on") === "1";
    return send(res, 200, `offline=${offline}`);
  }
  if (url.pathname === "/api") {
    handleApi(req, res, url).catch(error => send(res, 500, String(error)));
    return;
  }
  serveStatic(url, res);
}).listen(PORT, () => {
  console.log(`Superb maintenance preview: http://localhost:${PORT}/ (mock API, sample data)`);
});
