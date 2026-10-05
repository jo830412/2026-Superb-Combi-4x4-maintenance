# 2026 Superb Combi 2.0 4x4 Maintenance

Static GitHub Pages site for tracking the 2026 Superb Combi 4x4 maintenance records.

## Project Links

- Local folder: `C:\Users\chenweihung\Projects\car-maintenance\2026-superb-combi-2.0-4x4`
- GitHub repo: https://github.com/jo830412/2026-Superb-Combi-4x4-maintenance
- GitHub Pages: https://jo830412.github.io/2026-Superb-Combi-4x4-maintenance/
- Apps Script API: `https://script.google.com/macros/s/AKfycbwg3zHXptNuR1tCFs_lFYxroASHXEpkl569YBdUD4WFBQc-icvnaHI4NHL0YgCQHVZ3BA/exec`

## Files

- `index.html`: page markup.
- `styles.css`: all styles.
- `app.js`: app logic (records, sync, trackers, forms, charts).
- `sw.js`, `manifest.webmanifest`, `icons/`: offline cache and home-screen install.
- `apps-script/Code.js`: Google Sheet sync and the fuel-price proxy used by the static site.
- `tools/dev-server.js`: local preview with a mock API (never touches the real sheet).
- `tests/`: Node tests; `tests/helpers/` holds the fake browser and fake Google Sheet.
- `.nojekyll`: keeps GitHub Pages in plain static-file mode.

## Update Flow

After editing the frontend or sync backend:

```powershell
node --test tests\index-html-ui.test.js tests\apps-script-sync-safety.test.js tests\sync-integration.test.js tests\ux-features.test.js
node --check app.js
node --check sw.js
git status
git add -A
git commit -m "Describe the change"
git push
```

Release version: when the frontend changes, bump the version in `app.js`
(`APP_VERSION`), `index.html` (the version badge and both `?v=` asset URLs) and
`sw.js` (`CACHE_NAME` and the `?v=` entries in `APP_SHELL`). The tests fail if
these drift apart, so phones always fetch the new files after a deploy.

GitHub Pages usually updates within 1-2 minutes after `git push`.

## Local Preview

```powershell
node tools\dev-server.js
```

Open http://localhost:4173/ . The page talks to a mock API that runs the real
`apps-script/Code.js` against an in-memory sheet with sample data, so nothing
reaches the production Google Sheet. Open `/__offline?on=1` to simulate losing
the connection and `/__offline?on=0` to restore it.

## Data Safety and Deployment

- 本機會記住「上次確認過的雲端版本」與待同步標記。離線或同步失敗時資料留在本機並顯示「未同步・已存本機」；連線恢復、回到 App 或點同步狀態時會自動上傳，重新開啟 App 也不會被雲端舊資料覆蓋。
- 所有上傳排成單一佇列，連續儲存（例如刪除後馬上復原）不會互相衝突。若雲端在這段期間被其他裝置修改（同步衝突），會以整筆紀錄為單位自動合併後再上傳，兩邊的新增、修改與刪除都會保留，本機資料仍保留。
- 上傳沒有收到回應時，下一次會先讀取雲端比對，確認是否其實已寫入，避免重複。
- Apps Script 只接受帶有雲端版本的寫入；舊格式（純陣列或缺少版本）會被拒絕。內容沒有變更的同步不會寫入，也不佔用備份批次。
- 寫入時先寫入新資料、再清除多出來的舊列，過程中工作表不會出現空白；類別、詳細內容、備註存成純文字，避免「3/4」被轉成日期、電話號碼掉了開頭的 0。
- 一般儲存不可清空全部紀錄，也不可一次刪除超過一半且超過 3 筆。只有使用者確認「還原備份」時，才會明確允許整批取代。
- 每次成功覆寫 Google Sheet 前，Apps Script 會先把舊資料存入 `保養紀錄備份` 工作表，保留最近 20 個備份批次。備份建立失敗時不會清除原資料。
- 第一次開啟新版時，若這台裝置的本機資料與雲端不同，會改用雲端資料，並把本機版本另存；可在「資料管理」→「下載升級前的本機資料」取回。
- 發布同步格式變更時，先部署 Apps Script，確認 `?action=syncState` 可回傳資料與版本，再推送網站檔案到 GitHub Pages。

### Deploying Apps Script

```bash
cd apps-script
clasp push --force
clasp create-version "<版本說明>"
clasp update-deployment AKfycbwg3zHXptNuR1tCFs_lFYxroASHXEpkl569YBdUD4WFBQc-icvnaHI4NHL0YgCQHVZ3BA -V <新版本號>
```

- 一定要更新現有的部署（`update-deployment`），不要新建部署：新部署的網址不同，網站會連不到後端。
- `clasp push` 不加 `--force` 會先詢問是否覆寫 `appsscript.json`；在非互動的終端機裡會直接顯示 "Skipping push." 而沒有上傳，這時建立的版本仍是舊程式。
- 要退回上一版：`clasp list-versions` 找版本號，再對同一個部署 ID 執行 `clasp update-deployment … -V <舊版本號>`。

## Maintenance Tracking

- 定期保養每 7,500 km 或 12 個月，以先到者為準；剩 1,000 km 或 30 天內顯示「可安排」，到達即「該保養」。總覽顯示剩餘里程與進度條。
- 依最近 90 天的里程推估開車速度，預估哪一天會到 7,500 km；「加入行事曆」使用預估日與 12 個月期限中較早的日期。
- 算作定期保養的紀錄：類別「保養」（輪胎換位、四輪定位、變速箱、冷氣等專項除外），或「更換／維修」中提到換機油的紀錄。
- 耗材與保險追蹤只看相關類別，並排除檢查、補充、換位等字眼：「前保險桿烤漆」不會被當成保險續保，「輪胎換位」不會讓換胎追蹤歸零。保險與驗車在到期前一個月提醒。
- 進入「可安排」或「該保養」後，下次保養卡片會出現「記錄保養」，帶入今天、目前里程與定期保養內容（例如「7,500 km 定期保養：機油、機油芯、基本檢查」）；里程請對照保養單修正，下次 7,500 km 從這筆起算。
- 定期保養、變速箱油、輪胎、冷氣濾網、汽油精依里程追蹤：這類紀錄沒填里程時會先提醒，確定不填再按一次儲存。
- 耗材間隔（同時有里程與時間的以先到者為準，行事曆用較早的日期）：
  - 四驅（Haldex）油：每 2 年或 60,000 km。原廠過去是 3 年或 60,000 km，2024 年起有車主回報改為 2 年，這裡先採 2 年。
  - 火星塞：60,000 km 或 4 年。空氣濾芯：30,000 km 或 2 年（台灣原廠在 30,000 km 保養時更換）。
  - 煞車油：新車第一次 3 年，之後每 2 年（車主手冊）。
  - ZL1 來令片：沒有固定週期，約 30,000 km 檢查厚度，剩 3 mm 以下更換；量過可記一筆「來令片檢查」重新起算，後輪來令片不影響這一項。
  - 變速箱油 60,000 km、輪胎 50,000 km、冷氣濾網 15,000 km、電瓶 4 年。
  - 間隔整理自原廠與保養資料，第一次進廠時可請服務廠確認，再調整 `app.js` 的 `CONSUMABLE_RULES`。

## Key UX Behavior

- JSON backups can be downloaded locally; a full restore downloads a recovery backup first, and duplicate warnings can be overridden with Save Anyway.
- 加油紀錄在編輯時會開啟完整加油表單，保留公升、油價、折扣、油費與加滿狀態的自動計算；儲存會更新原本那一筆紀錄。
- 新增加油時沿用上次的油品、折抵與加油站；本週抓過的牌價會直接帶入。里程、金額使用數字鍵盤，輸入里程時顯示「距上次加油 +xxx km」；看起來多打一位或漏登時需再按一次儲存。
- 新增日期是今天的紀錄時，里程先帶入目前里程（可修改）；日期改成其他天就清空，自己輸入過的里程不會被改掉。文字快速新增的草稿有里程時以草稿為準。
- 新增、編輯、刪除後都會顯示「復原」。表單有尚未儲存的內容時，點背景或按 Esc 不會關閉。
- 手機版頂部只有一列：簡短標題、同步狀態、淺色模式開關與「新增」，下面是分頁。同步狀態只顯示「已同步／同步中／未同步／離線」，點一下可看完整說明並立即重試；桌面版會在旁邊直接顯示細節。
- 淺色模式（頂部的太陽按鈕）適合戶外陽光下使用，每台裝置各自記住；頂部列在淺色模式下仍維持深色，iPhone 主畫面模式的狀態列文字才看得清楚。文字對比皆達 4.5:1 以上。
- 手機版總覽依序呈現目前里程與下次保養、最近油耗與近 12 月用車成本、前三項待辦和最近三筆紀錄，其餘統計收在「更多車況」；目前里程下方有「記錄加油」可直接開啟加油表單。
- 花費分成「用車」（油、保養維修、保險稅費）與「改裝美容」（改裝、配件、美容與其他）。總覽顯示近 12 月用車成本與每公里成本（含其中的油錢）；「更多車況」的改裝美容卡片可開啟分析頁的改裝美容清單；持有成本摘要與年度費用圖也分成這兩組。
- 字型使用裝置內建字型（iPhone 為蘋方），不必下載網路字型。
- 紀錄頁先顯示搜尋與篩選，再以「全部紀錄、加油分析」切換內容（「目前里程更新」也列在全部紀錄裡）；全部紀錄不會重複顯示完整加油分析表，紀錄多時每次顯示 50 筆。
- 加油分析有每次加滿的油耗走勢圖與每公里油費；異常的區間以三角形與「待確認」標示。
- 資料檢查會列出里程倒退、油耗異常與可能重複的紀錄，並可直接開啟該筆紀錄。
- 「新增」入口優先顯示加油與保養／維修，另有更新目前里程與文字快速新增。
- 有確定日期的待辦可下載本機 `.ics` 行事曆檔，預設在 7 天前與 1 天前提醒；iPhone 仍會顯示事件預覽並要求使用者確認加入。若 Safari 沒有立即開啟，可從下載項目開啟檔案。
- 圖表函式庫只在用到時才下載（固定版本並以 SRI 驗證）。
- 在 iPhone Safari 選「分享 → 加入主畫面」即可像 App 一樣開啟，沒有訊號時也能開啟並記錄。主畫面版本的本機儲存與 Safari 分開，第一次開啟會從雲端載入。

## Mobile Regression Check

Run the tests, start `node tools\dev-server.js`, and inspect the site at a 375 px viewport. Verify there is no horizontal scrolling, dashboard actions and record subtabs have at least 44 px touch targets, search text survives subtab changes, and all four quick-entry routes still open their original forms. Repeat once at 768 px for tablet layout.

## Text Quick Entry

「文字快速新增」只用本機規則解析加油、洗車美容、輪胎、機油、保養、稅費與保險等常見寫法，
不連網也不花費任何 API 額度；判斷不出來時會把文字帶進一般表單，類別留空讓使用者選。
原本的 OpenAI 代理已在 v2026.10.05.4 移除（網站與 Apps Script 都不再呼叫 OpenAI）。

## Fuel Price Proxy

The fuel log calls `?action=fuelPrice` on the Apps Script API. Keep
`apps-script/Code.js` deployed with the web app so the static GitHub Pages site
can read the NPC 全國加油站 official price page without browser CORS failures.
Apps Script caches the prices for up to 3 hours and never across the Monday
price changes (Taipei time: NPC prices take effect at 01:00, CPC at 00:00).

## Notes

- This project must stay separate from the 2016 Superb site because it uses a separate Apps Script API and Google Sheet.
