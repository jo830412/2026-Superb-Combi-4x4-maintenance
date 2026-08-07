# 2026 Superb Combi 2.0 4x4 Maintenance

Static GitHub Pages site for tracking the 2026 Superb Combi 4x4 maintenance records.

## Project Links

- Local folder: `C:\Users\chenweihung\Projects\car-maintenance\2026-superb-combi-2.0-4x4`
- GitHub repo: https://github.com/jo830412/2026-Superb-Combi-4x4-maintenance
- GitHub Pages: https://jo830412.github.io/2026-Superb-Combi-4x4-maintenance/
- Apps Script API: `https://script.google.com/macros/s/AKfycbwg3zHXptNuR1tCFs_lFYxroASHXEpkl569YBdUD4WFBQc-icvnaHI4NHL0YgCQHVZ3BA/exec`

## Files

- `index.html`: the whole website and app logic.
- `apps-script/Code.js`: Google Sheet sync and the fuel-price proxy used by the static site.
- `apps-script/ai-record-assistant.gs`: optional AI record assistant proxy additions.
- `.nojekyll`: keeps GitHub Pages in plain static-file mode.

## Update Flow

After editing `index.html`:

```powershell
node --test tests\index-html-ui.test.js
node -e "const fs=require('fs'); const html=fs.readFileSync('index.html','utf8'); const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim()); for (const s of scripts) new Function(s); console.log('ok scripts', scripts.length);"
git status
git add index.html
git commit -m "Describe the change"
git push
```

GitHub Pages usually updates within 1-2 minutes after `git push`.

## Key UX Behavior

- JSON backups can be downloaded locally; a full restore downloads a recovery backup first, and duplicate warnings can be overridden with Save Anyway.
- 加油紀錄在編輯時會開啟完整加油表單，保留公升、油價、折扣、油費與加滿狀態的自動計算；儲存會更新原本那一筆紀錄。
- 手機版總覽依序呈現目前里程與下次保養、最近油耗與近 12 月花費、前三項待辦和最近三筆紀錄，其餘統計收在「更多車況」。
- 紀錄頁先顯示搜尋與篩選，再以「全部紀錄、加油分析、里程」切換內容；全部紀錄不會重複顯示完整加油分析表。
- 「新增」入口優先顯示加油與保養／維修，仍可進入里程、照片及文字快速新增。
- 有確定日期的待辦可下載本機 `.ics` 行事曆檔，預設在 7 天前與 1 天前提醒；iPhone 仍會顯示事件預覽並要求使用者確認加入。若 Safari 沒有立即開啟，可從下載項目開啟檔案。
- 刪除紀錄後會顯示短暫的「復原」操作；儲存與雲端同步結果也會以提示列回饋。

## Mobile Regression Check

Run `node --test tests\index-html-ui.test.js`, serve the repository from a local HTTP server, and inspect the site at a 375 px viewport. Verify there is no horizontal scrolling, dashboard actions and record subtabs have at least 44 px touch targets, search text survives subtab changes, and all five quick-entry routes still open their original forms. Repeat once at 768 px for tablet layout.

## AI Record Assistant

The website includes an AI 新增 button that calls the existing Apps Script API
as an OpenAI proxy. The OpenAI API key must stay in Apps Script Script
Properties, never in `index.html` or browser storage.

The button first uses local rule-based parsing for common entries such as
fuel, cleaning, tire, oil, maintenance, tax, and insurance records. This path
does not call OpenAI or consume API credits. The OpenAI proxy is used only when
the local parser cannot confidently classify the text.

To enable it:

1. Copy `apps-script/ai-record-assistant.gs` into the deployed Apps Script project.
2. Add the route checks shown at the top of that file to the existing `doGet(e)`
   and `doPost(e)` handlers before the existing sync logic.
3. In Apps Script, set Script Property `OPENAI_API_KEY`.
4. Optional: set Script Property `OPENAI_MODEL`; default is `gpt-5.4-mini`.
5. Deploy the Apps Script web app again.

The frontend first calls `?action=aiStatus`. If the AI proxy is not deployed or
the key is missing, the AI dialog shows an error and does not send the record
draft request, so the old array-sync POST flow is protected.

## Fuel Price Proxy

The fuel log calls `?action=fuelPrice` on the Apps Script API. Keep
`apps-script/Code.js` deployed with the web app so the static GitHub Pages site
can read the NPC 全國加油站 official price page without browser CORS failures.

## Notes

- This project must stay separate from the 2016 Superb site because it uses a separate Apps Script API and Google Sheet.
- `INITIAL_DATA` is intentionally empty so old vehicle records are not copied into this new sheet.
