# Data Quality and Sync Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct ownership-cost classification, surface suspicious mileage/fuel data, and protect full-array cloud writes with conflict checks and write-before snapshots.

**Architecture:** Keep the existing single-file frontend and six-column sheet. Add pure frontend classification/quality helpers, a small analysis-page status surface, a backward-compatible `syncState` envelope, and Apps Script validation/backup helpers around the current full-array write path.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js `node:test` + `vm`, Google Apps Script, Playwright CLI.

## Global Constraints

- Existing add/edit/delete/restore behavior and the six-column main sheet remain compatible.
- Do not modify production records during verification.
- Explicit `category` wins over keyword inference.
- Quality findings warn only; they never mutate or silently exclude records.
- Local data remains available after conflict, validation, network, or backup failure.
- Apps Script must be deployed before the frontend because the new frontend sends an envelope.

---

### Task 1: Correct cost classification and expose data-quality findings

**Files:**
- Modify: `index.html:1924-1960`
- Modify: `index.html:3127-3165`
- Modify: `index.html:4020-4106`
- Modify: `index.html:5785-5833`
- Test: `tests/index-html-ui.test.js`

**Interfaces:**
- Produces: `getOwnershipCostBucketKey(record): string`
- Produces: `getFuelSegmentQuality(segment, medianKmPerLiter): { suspicious: boolean, reason: string }`
- Produces: `getDataQualityIssues(): Array<{ type, date, title, detail, key }>`
- Produces: `renderDataQualityPanel(): void`

- [ ] **Step 1: Export the new helpers from the VM test harness and write failing classification tests**

Add `getOwnershipCostBuckets`, `getDataQualityIssues`, and `getFuelStats` to `__testApi`, then assert that an `改裝升級` record containing `外置濾網` stays in `配件改裝` and does not increase `保養維修`.

```js
test("explicit categories win over ownership keyword inference", () => {
  const { api } = createHarness();
  api.setRecords([{ date: "2026-06-18", mileage: 1250, category: "改裝升級", cost: 10000, detail: "Evo模塊、離手、外置濾網", note: "" }]);
  const buckets = Object.fromEntries(api.getOwnershipCostBuckets().map(item => [item.key, item.total]));
  assert.equal(buckets.service, 0);
  assert.equal(buckets.accessory, 10000);
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test --test-name-pattern="explicit categories" tests\index-html-ui.test.js`

Expected: FAIL because `getOwnershipCostBuckets` is not exported or service receives `10000`.

- [ ] **Step 3: Implement explicit-category-first classification**

Add a fixed category map and use keyword inference only for unknown/`其他` records.

```js
const OWNERSHIP_CATEGORY_BUCKETS = {
  保養: "service", 維修: "service", 更換: "service",
  加油: "fuel", 保險: "legal", "檢驗/稅費": "legal",
  改裝升級: "accessory"
};

function getOwnershipCostBucketKey(record) {
  const explicit = OWNERSHIP_CATEGORY_BUCKETS[record.category];
  if (explicit) return explicit;
  const text = `${record.category || ""} ${record.detail || ""} ${record.note || ""}`;
  const matched = OWNERSHIP_COST_BUCKETS.find(item => item.key !== "other" && item.terms.some(term => text.includes(term)));
  return matched ? matched.key : "other";
}
```

- [ ] **Step 4: Write failing mileage and fuel-quality tests**

Use the approved 2,000 → 1,981 km example and a nine-segment fuel set whose median is around 11 km/L with a 17.7 km/L outlier. Assert issue types, dates, values, and that normal segments are not flagged.

- [ ] **Step 5: Run the focused quality tests and confirm failure**

Run: `node --test --test-name-pattern="data quality|fuel outlier|mileage regression" tests\index-html-ui.test.js`

Expected: FAIL because quality helpers do not exist.

- [ ] **Step 6: Implement pure anomaly helpers and the analysis-page panel**

Insert a `dataQualityPanel` after the ownership summary. Use median-based thresholds from the spec and render text labels such as `待確認` and `未發現明顯異常`. Add a compact card style using existing semantic colors, visible text, 44px actions only if actions are introduced, and no horizontal scrolling.

- [ ] **Step 7: Mark suspicious fuel rows without changing averages**

Build an issue-key set from `getDataQualityIssues()` and render suspicious fuel values as:

```html
<span class="data-quality-value">17.7 km/L</span>
<span class="data-quality-flag">待確認</span>
```

- [ ] **Step 8: Run frontend tests**

Run: `node --test tests\index-html-ui.test.js`

Expected: all tests pass.

- [ ] **Step 9: Commit Task 1**

```powershell
git add index.html tests/index-html-ui.test.js
git commit -m "fix: surface vehicle record anomalies"
```

### Task 2: Add a backward-compatible frontend sync envelope

**Files:**
- Modify: `index.html:2410-2650`
- Modify: `index.html:2950-2970`
- Modify: `index.html:5920-5930`
- Test: `tests/index-html-ui.test.js`

**Interfaces:**
- Produces: `parseCloudState(payload): { records: Array, fingerprint: string, updatedAt: string }`
- Changes: `syncToCloud(data, options?): Promise<boolean>` where options includes `allowDestructiveReplace` and `reason`
- Consumes: Apps Script `GET ?action=syncState` and envelope `POST`

- [ ] **Step 1: Extend the harness with a queued fetch spy and write failing sync-state tests**

Assert that `initData()` accepts both the new envelope and the legacy array, records the returned fingerprint, and sends this payload on save:

```js
{
  records: expectedRecords,
  expectedFingerprint: "abc123",
  allowDestructiveReplace: false,
  reason: "save"
}
```

- [ ] **Step 2: Write a failing conflict test**

Return `{ status: "conflict", message: "..." }` from POST and assert `syncToCloud` returns false, retains `localStorage`, and sets the visible sync state to an actionable conflict message.

- [ ] **Step 3: Run focused sync tests and confirm failure**

Run: `node --test --test-name-pattern="sync state|sync conflict|destructive restore" tests\index-html-ui.test.js`

Expected: FAIL because the current frontend GETs the legacy route and POSTs a raw array.

- [ ] **Step 4: Implement cloud-state parsing and envelope POST**

Track `lastCloudFingerprint`; GET `?action=syncState`; accept a legacy array fallback; parse POST JSON even on HTTP 200; update the fingerprint only after `status === "success"`.

- [ ] **Step 5: Pass destructive-replace intent only from confirmed restore**

Change confirmed restore to call:

```js
saveRecords(records, {
  announce: false,
  allowDestructiveReplace: true,
  reason: "restore"
});
```

General saves retain `allowDestructiveReplace: false` and `reason: "save"`.

- [ ] **Step 6: Run frontend tests and commit Task 2**

Run: `node --test tests\index-html-ui.test.js`

Expected: all tests pass.

```powershell
git add index.html tests/index-html-ui.test.js
git commit -m "feat: guard cloud record synchronization"
```

### Task 3: Protect Apps Script full-array writes

**Files:**
- Modify: `apps-script/Code.js:1-100`
- Create: `tests/apps-script-sync-safety.test.js`

**Interfaces:**
- Produces: `readRecords_(sheet): Array<Record>`
- Produces: `normalizeSyncPayload_(payload): { records, expectedFingerprint, allowDestructiveReplace, reason, legacy }`
- Produces: `validateRecordPayload_(records): void`
- Produces: `computeRecordsFingerprint_(records): string`
- Produces: `validateDestructiveReplace_(current, incoming, allow): void`
- Produces: `createBackupSnapshot_(sheet, records, reason): void`

- [ ] **Step 1: Create VM-based Apps Script tests that fail against current code**

Provide fakes for `SpreadsheetApp`, `ContentService`, `Utilities`, `PropertiesService`, and `LockService`. Cover:

- `syncState` returns records and fingerprint.
- matching fingerprint writes successfully.
- mismatched fingerprint returns `conflict` before backup/clear/write.
- empty replacement and >50%/more-than-3 deletion return `rejected` unless explicitly allowed.
- successful write records a backup event before clear.
- malformed, negative, or >5,000-record payload is rejected.

- [ ] **Step 2: Run Apps Script tests and confirm failure**

Run: `node --test tests\apps-script-sync-safety.test.js`

Expected: FAIL because safety helpers and `syncState` do not exist.

- [ ] **Step 3: Refactor GET record reading without changing the legacy response**

Extract `readRecords_(sheet)` from `doGet()`. Route `action=syncState` to an envelope while the default route remains the current array.

- [ ] **Step 4: Implement fingerprint, envelope validation, and destructive-write guards**

Use `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(records), Utilities.Charset.UTF_8)` and lowercase two-character hex bytes. Return JSON statuses instead of clearing the sheet on validation failure.

- [ ] **Step 5: Implement write-before snapshots with retention**

Write rows to `保養紀錄備份` with columns `備份時間`, `備份批次`, `原因`, plus `HEADERS`. Keep the most recent 20 unique batch IDs. If backup creation throws, propagate to the existing error response before `clearDataRows` runs.

- [ ] **Step 6: Run Apps Script and full tests**

Run:

```powershell
node --test tests\apps-script-sync-safety.test.js
node --test tests\index-html-ui.test.js tests\apps-script-sync-safety.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit Task 3**

```powershell
git add apps-script/Code.js tests/apps-script-sync-safety.test.js
git commit -m "feat: back up and validate cloud record writes"
```

### Task 4: Document, verify, deploy, and merge

**Files:**
- Modify: `README.md`
- Modify: `index.html` (`APP_VERSION` only if not already bumped)

**Interfaces:**
- Documents: sync conflict recovery, server backup sheet, destructive restore behavior, deployment order.

- [ ] **Step 1: Update README and version**

Document that sync conflicts retain local data, confirmed restore is the only destructive-replace path, the server keeps 20 write-before snapshots, and backend deployment precedes frontend release. Bump `APP_VERSION` to the delivery date version.

- [ ] **Step 2: Run complete static verification**

Run:

```powershell
node --test tests\index-html-ui.test.js tests\apps-script-sync-safety.test.js
node -e "const fs=require('fs');const html=fs.readFileSync('index.html','utf8');const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim());for(const s of scripts)new Function(s);console.log('ok scripts',scripts.length)"
node --check apps-script\Code.js
git diff --check
```

Expected: all tests pass, scripts compile, Apps Script parses, and diff check is clean.

- [ ] **Step 3: Verify the local UI at 375px**

Serve the worktree, open it with Playwright CLI, load a non-production fixture containing the known mileage/fuel anomalies, and verify the panel text, no horizontal overflow, and zero console errors/warnings.

- [ ] **Step 4: Request a focused code review and resolve findings**

Review classification semantics, anomaly thresholds, backup-before-clear ordering, conflict behavior, and restore override scope. Re-run all verification after fixes.

- [ ] **Step 5: Deploy Apps Script first without production POST testing**

Clone the known Apps Script project into a temporary directory, copy `Code.js` and `appsscript.json`, push a new version, redeploy the production deployment, verify legacy GET and `?action=syncState`, then delete temporary deployment artifacts.

- [ ] **Step 6: Push frontend and verify GitHub Pages**

Merge the branch into `main`, push `origin/main`, wait for the version string to update, and verify the official page reads records and renders the data-quality panel without console errors. Do not trigger save/edit/delete on production.

- [ ] **Step 7: Final repository check**

Run `git status --short --branch` and confirm local `main` equals `origin/main` with no deployment artifacts.
