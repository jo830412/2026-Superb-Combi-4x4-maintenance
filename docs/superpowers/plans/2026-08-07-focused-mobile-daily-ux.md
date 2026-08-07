# Focused Mobile Daily UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the long mobile dashboard and duplicated records layout with the approved focused overview, record subtabs, and compact quick-entry sheet without changing stored data.

**Architecture:** Keep the single-file application and existing render/save functions. Recompose existing DOM IDs into four overview surfaces, add one session-only `activeRecordsSubtab` state variable, and let `renderRecords()` apply the mileage-only restriction while the fuel tab continues to use `renderFuelLogSection()`.

**Tech Stack:** HTML, CSS, browser JavaScript, Node.js built-in test runner, Playwright CLI for responsive verification.

## Global Constraints

- Do not change Google Sheet columns, Apps Script endpoints, record serialization, synchronization, backup/restore, duplicate-warning, fuel-calculation, OCR, or AI behavior.
- At 375 px the overview order is: mileage/service hero, two compact metrics, next three tasks, recent records.
- Search and filters precede records content; subtabs are exactly `全部紀錄`, `加油分析`, and `里程`.
- Mobile touch targets are at least 44 by 44 px and explanatory text is at least 14 px.
- Structural controls use a consistent inline SVG icon style rather than mixed emoji.

---

### Task 1: Focused overview and recent-record preview

**Files:**
- Modify: `tests/index-html-ui.test.js`
- Modify: `index.html:1559-1674`
- Modify: `index.html:2957-3055`
- Modify: `index.html:3379-3514`
- Modify: `index.html:5288-5301`

**Interfaces:**
- Consumes: existing `getEffectiveCurrentMileage()`, `getFuelStats()`, `getMaintenanceActionState()`, `buildOwnerActions()`, and `compareRecordsNewestFirst()`.
- Produces: `renderOverviewRecentRecords(): void`; dashboard elements `dashboardHero`, `dashboardMetrics`, `dashboardTasks`, and `overviewRecentRecords`.

- [ ] **Step 1: Write failing overview structure and rendering tests**

Extend the VM test API with `renderOwnerDashboard` and `renderOverviewRecentRecords`, then add:

```js
test("the focused overview exposes four primary surfaces in order", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const ids = ["dashboardHero", "dashboardMetrics", "dashboardTasks", "overviewRecentRecords"];
  const positions = ids.map(id => html.indexOf(`id="${id}"`));
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(html, /id="moreVehicleStatus"/);
});

test("the overview recent preview renders at most three records", () => {
  const { api, element } = loadApp();
  api.setRecords([0, 1, 2, 3].map(day => ({
    date: `2026-08-0${day + 1}`,
    mileage: 1000 + day,
    category: "保養",
    cost: 100,
    detail: `紀錄 ${day}`,
    note: ""
  })));
  api.renderOverviewRecentRecords();
  assert.equal((element("overviewRecentRecords").innerHTML.match(/overview-record/g) || []).length, 3);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test --test-name-pattern="focused overview|recent preview" tests\index-html-ui.test.js`

Expected: FAIL because the four dashboard IDs and `renderOverviewRecentRecords` do not exist.

- [ ] **Step 3: Recompose the overview markup**

Keep all current statistic IDs so `updateStats()` remains compatible, but place them into this shape:

```html
<section class="dashboard-hero" id="dashboardHero">
  <div><span class="dashboard-eyebrow">目前里程</span><strong id="statCurrentMileage">—</strong><span>km</span></div>
  <div><span>下次保養</span><strong id="statNextMaintenance">—</strong></div>
  <button id="btnUpdateMileage" class="btn btn-ghost" type="button">更新里程</button>
</section>
<section class="dashboard-metrics" id="dashboardMetrics">
  <article><span>最近油耗</span><strong id="statLastFuel">—</strong><small>km/L</small></article>
  <article><span>近 12 月花費</span><strong id="statRecentCost">—</strong></article>
</section>
<section class="owner-section" id="dashboardTasks">
  <div class="owner-kicker">接下來要處理</div>
  <h2 class="owner-title" id="ownerPriorityTitle">正在整理車況</h2>
  <p class="owner-sub" id="ownerPriorityMeta">依照目前里程與期限排序。</p>
  <div class="owner-actions" id="ownerActionList"></div>
</section>
<section class="overview-recent-section">
  <div class="section-heading"><h2>最近紀錄</h2><button type="button" data-overview-action="records">查看全部</button></div>
  <div id="overviewRecentRecords"></div>
</section>
<details id="moreVehicleStatus" class="more-status">
  <summary>更多車況</summary>
  <div class="stats-grid stats-grid-secondary">
    <article><span>平均油耗</span><strong id="statAvgFuel">—</strong></article>
    <article><span>保固期限</span><strong id="statWarrantyStart">—</strong></article>
    <article><span>上次保養</span><strong id="statLastMaintenance">—</strong></article>
    <article><span>總花費</span><strong id="statTotalCost">—</strong></article>
    <article><span>每公里持有成本</span><strong id="statCostPerKm">—</strong></article>
    <article><span id="statFuelAdditiveLabel">汽油精追蹤</span><strong id="statFuelAdditive">—</strong><button id="btnAddFuelAdditive" type="button">已添加</button></article>
    <article><span>總紀錄筆數</span><strong id="statTotalRecords">—</strong></article>
  </div>
  <div class="owner-metrics" hidden aria-hidden="true">
    <span id="ownerFixedCost">—</span><span id="ownerNextLegal">—</span><span id="ownerDataHealth">—</span>
  </div>
</details>
```

Add focused mobile CSS for a two-column metrics grid, hero hierarchy, recent compact rows, 14 px helper text, and 44 px actions. Preserve desktop responsive behavior.

- [ ] **Step 4: Limit tasks and render recent records**

Change the action mapping to `buildOwnerActions().slice(0, 3)` and add:

```js
function renderOverviewRecentRecords() {
  const container = document.getElementById("overviewRecentRecords");
  if (!container) return;
  const recent = [...records].sort(compareRecordsNewestFirst).slice(0, 3);
  container.innerHTML = recent.length ? recent.map(record => `
    <button class="overview-record" type="button" data-overview-record-index="${records.indexOf(record)}">
      <span><strong>${escapeHtml(record.category || "其他")}</strong>${escapeHtml(record.detail || "")}</span>
      <span>${escapeHtml(record.date || "未填日期")}</span>
    </button>`).join("") : `<div class="empty-compact">尚無紀錄，先新增第一筆資料。</div>`;
}
```

Call it from `refresh()`, bind `data-overview-action="records"` to `setActiveView("records")`, and bind preview rows to `openEditModal(Number(button.dataset.overviewRecordIndex))`.

- [ ] **Step 5: Run focused and full tests**

Run: `node --test --test-name-pattern="focused overview|recent preview" tests\index-html-ui.test.js`

Expected: 2 tests pass.

Run: `node --test tests\index-html-ui.test.js`

Expected: all existing and new tests pass.

- [ ] **Step 6: Commit the overview**

```powershell
git add index.html tests/index-html-ui.test.js
git commit -m "feat: focus the mobile maintenance overview"
```

### Task 2: Record subtabs and secondary data management

**Files:**
- Modify: `tests/index-html-ui.test.js`
- Modify: `index.html:1716-1788`
- Modify: `index.html:2190-2210`
- Modify: `index.html:3806-3908`
- Modify: `index.html:4372-4384`
- Modify: `index.html:5306-5350`

**Interfaces:**
- Consumes: `renderRecords()`, `renderFuelLogSection()`, `isMileageUpdateRecord(record)`.
- Produces: `setRecordsSubtab(tab: "all" | "fuel" | "mileage"): void`, `activeRecordsSubtab`, panels `allRecordsPanel` and `fuelAnalysisPanel`.

- [ ] **Step 1: Write failing subtab behavior tests**

Expose `setRecordsSubtab`, `getFilteredRecords`, and `getActiveRecordsSubtab` in `__testApi`, then add:

```js
test("record subtabs keep fuel analysis out of the all-records panel", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(html.indexOf('id="searchInput"') < html.indexOf('id="recordSubtabs"'));
  assert.match(html, /data-records-subtab="all"[^>]*>全部紀錄/);
  assert.match(html, /data-records-subtab="fuel"[^>]*>加油分析/);
  assert.match(html, /data-records-subtab="mileage"[^>]*>里程/);
  assert.match(html, /id="fuelAnalysisPanel"[^>]*hidden/);
});

test("the mileage subtab filters to mileage status records without clearing search", () => {
  const { api, element } = loadApp();
  api.setRecords([fuelRecord(), {
    date: "2026-08-07", mileage: 2000, category: "其他", cost: 0,
    detail: "目前里程更新", note: "用於儀表板里程計算"
  }]);
  element("searchInput").value = "";
  api.setRecordsSubtab("mileage");
  assert.equal(api.getActiveRecordsSubtab(), "mileage");
  assert.equal(api.getFilteredRecords().length, 1);
  assert.equal(api.getFilteredRecords()[0].detail, "目前里程更新");
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test --test-name-pattern="record subtabs|mileage subtab" tests\index-html-ui.test.js`

Expected: FAIL because record subtabs and their state function are absent.

- [ ] **Step 3: Reorder records markup and add subtabs**

Move the existing filter section to the top of `recordsView`. Put JSON backup/restore and CSV export inside:

```html
<details class="data-management" id="dataManagement">
  <summary>資料管理</summary>
  <div class="data-management-actions">
    <button class="btn btn-ghost" id="btnExport" type="button">下載 CSV</button>
    <button class="btn btn-ghost" id="btnBackupExport" type="button">備份 JSON</button>
    <button class="btn btn-ghost" id="btnBackupRestore" type="button">還原備份</button>
    <input id="backupRestoreInput" type="file" accept="application/json,.json" hidden>
  </div>
</details>
<nav class="record-subtabs" id="recordSubtabs" aria-label="紀錄內容">
  <button class="record-subtab is-active" data-records-subtab="all" aria-pressed="true">全部紀錄</button>
  <button class="record-subtab" data-records-subtab="fuel" aria-pressed="false">加油分析</button>
  <button class="record-subtab" data-records-subtab="mileage" aria-pressed="false">里程</button>
</nav>
<section id="allRecordsPanel">
  <section class="records-section">
    <div id="recordsContainer"></div>
    <div id="emptyState" class="empty-state" style="display:none"><p>找不到符合條件的紀錄</p></div>
  </section>
</section>
<section id="fuelAnalysisPanel" hidden>
  <section class="fuel-log-section">
    <div class="fuel-log-panel">
      <div class="fuel-log-header"><h2 class="fuel-log-title">加油分析</h2><div id="fuelLogSummary">尚無加油資料</div></div>
      <div class="fuel-log-table-wrap">
        <table class="fuel-log-table"><thead><tr><th>日期</th><th>油品</th><th>里程</th><th>公升</th><th>牌告</th><th>折抵</th><th>實付/L</th><th>油費</th><th>油耗</th><th>備註</th></tr></thead><tbody id="fuelLogTableBody"></tbody></table>
      </div>
      <div class="fuel-log-empty" id="fuelLogEmpty">第一筆加滿會作為基準，第二次加滿後開始計算油耗。</div>
    </div>
  </section>
</section>
```

- [ ] **Step 4: Implement session-only subtab state**

Add `let activeRecordsSubtab = "all";` and:

```js
function setRecordsSubtab(tab) {
  activeRecordsSubtab = ["all", "fuel", "mileage"].includes(tab) ? tab : "all";
  document.getElementById("allRecordsPanel").hidden = activeRecordsSubtab === "fuel";
  document.getElementById("fuelAnalysisPanel").hidden = activeRecordsSubtab !== "fuel";
  document.querySelectorAll("[data-records-subtab]").forEach(button => {
    const selected = button.dataset.recordsSubtab === activeRecordsSubtab;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  renderRecords();
}
```

At the start of `getFilteredRecords()`, add:

```js
if (activeRecordsSubtab === "mileage") {
  list = list.filter(isMileageUpdateRecord);
}
```

Bind subtab clicks during `DOMContentLoaded`. Do not assign to `currentFilter`, `currentSearch`, or `currentYear` in `setRecordsSubtab()`.

- [ ] **Step 5: Run focused and full tests**

Run: `node --test --test-name-pattern="record subtabs|mileage subtab" tests\index-html-ui.test.js`

Expected: 2 tests pass.

Run: `node --test tests\index-html-ui.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit record navigation**

```powershell
git add index.html tests/index-html-ui.test.js
git commit -m "feat: separate records into focused subtabs"
```

### Task 3: Compact quick entry and mobile accessibility

**Files:**
- Modify: `tests/index-html-ui.test.js`
- Modify: `index.html:262-276`
- Modify: `index.html:1232-1260`
- Modify: `index.html:2100-2140`

**Interfaces:**
- Consumes: existing `runQuickEntry(action)` routes.
- Produces: `.quick-entry-primary`, `.quick-entry-secondary`, reusable inline SVG markup, bottom-sheet accessibility attributes.

- [ ] **Step 1: Write a failing hierarchy and accessibility test**

```js
test("quick entry prioritizes fuel and service with accessible mobile controls", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /class="quick-entry-primary"[\s\S]*data-quick-entry="fuel"[\s\S]*data-quick-entry="service"/);
  assert.match(html, /class="quick-entry-secondary"[\s\S]*data-quick-entry="mileage"[\s\S]*data-quick-entry="photo"[\s\S]*data-quick-entry="text"/);
  assert.match(html, /quick-entry-btn[\s\S]*min-height:\s*44px/);
  assert.match(html, /role="dialog"[^>]*aria-modal="true"/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test --test-name-pattern="quick entry prioritizes" tests\index-html-ui.test.js`

Expected: FAIL because the grouped markup and dialog semantics are absent.

- [ ] **Step 3: Implement the compact bottom sheet**

Wrap fuel/service in `.quick-entry-primary`, the other three routes in `.quick-entry-secondary`, and replace their emoji with matching 20 px inline SVG icons using `stroke="currentColor"`, `fill="none"`, `stroke-width="1.8"`, and `aria-hidden="true"`.

Set the overlay to `role="dialog" aria-modal="true" aria-labelledby="quickEntryTitle"`, give the heading `id="quickEntryTitle"`, and add:

```css
.quick-entry-primary { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.quick-entry-secondary { display:grid; gap:4px; margin-top:12px; }
.quick-entry-btn { min-height:44px; justify-content:flex-start; gap:10px; }
@media (max-width:600px) {
  #quickEntryModal { align-items:flex-end; }
  #quickEntryModal .modal { width:100%; border-radius:20px 20px 0 0; padding-bottom:env(safe-area-inset-bottom); }
}
```

Keep all five `data-quick-entry` values unchanged.

- [ ] **Step 4: Run all tests**

Run: `node --test tests\index-html-ui.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit quick entry**

```powershell
git add index.html tests/index-html-ui.test.js
git commit -m "feat: streamline mobile quick entry"
```

### Task 4: Responsive browser regression

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: completed overview, records, and quick-entry UI.
- Produces: documented regression command and verified responsive behavior.

- [ ] **Step 1: Add a failing README assertion**

```js
test("the README documents focused mobile UI verification", () => {
  const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
  assert.match(readme, /375 px/);
  assert.match(readme, /全部紀錄.*加油分析.*里程/);
});
```

- [ ] **Step 2: Run the README test and verify RED**

Run: `node --test --test-name-pattern="focused mobile UI verification" tests\index-html-ui.test.js`

Expected: FAIL because the workflow is not documented.

- [ ] **Step 3: Document the responsive check**

Add a README section explaining the three record subtabs, the focused four-surface overview, and that the mobile regression is checked at 375 px using the existing Node test command plus a local static server.

- [ ] **Step 4: Run automated and manual checks**

Run: `node --test tests\index-html-ui.test.js`

Expected: all tests pass.

Serve the repository locally, inspect at 375 by 812 and 768 by 1024, and verify: no horizontal overflow, controls at least 44 px, dashboard order, `更多車況`, search state across subtabs, one fuel presentation in `全部紀錄`, all five quick-entry routes, focus return, and reduced motion.

- [ ] **Step 5: Commit documentation**

```powershell
git add README.md tests/index-html-ui.test.js
git commit -m "docs: describe focused mobile workflows"
```
