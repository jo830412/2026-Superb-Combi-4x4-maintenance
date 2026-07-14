# Data Safety and Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local JSON backup and full restore, an automatic recovery backup before restore, and non-blocking likely-duplicate warnings when saving records.

**Architecture:** Keep all logic in the current static `index.html` application and preserve the six-field record array and existing Apps Script array-sync API. Add small pure helpers for backup validation and duplicate matching, then add two confirmation dialogs that defer mutations until the owner explicitly confirms.

**Tech Stack:** Static HTML/CSS/JavaScript, browser File API and Blob downloads, `localStorage`, Apps Script sync, Node.js built-in test runner.

## Global Constraints

- Do not change Apps Script, Google Sheet columns, AI settings, OCR behavior, fuel-price lookup, or camera/library source selection.
- Keep every record in the existing `date`, `mileage`, `category`, `cost`, `detail`, and `note` schema.
- Backup files are local UTF-8 JSON envelopes with `format: "superb-maintenance-backup"` and `version: 1`.
- A restore must validate every input record before changing `records`; invalid files must leave current records untouched.
- A restore must download a recovery backup before replacing records and then use the existing `saveRecords(records)` cloud-sync path.
- Likely duplicates match normalized date, mileage, and category; warnings are dismissible and never block a deliberate save.
- While editing, exclude the original record’s array index from duplicate matching.
- Keep primary mobile controls at least 44 px tall.
- Use TDD for every behavior and run `node --test tests\\index-html-ui.test.js` plus the README inline-script parser before each commit.

---

### Task 1: Backup format, validation, and duplicate matching helpers

**Files:**
- Modify: `index.html:2110-2485` (state and pure helpers)
- Modify: `tests/index-html-ui.test.js:1-170` (VM API and helper tests)

**Interfaces:**
- Consumes: global `records`, `formatDateYMD(date)`, and `compareRecordsNewestFirst(a, b)`.
- Produces: `BACKUP_FORMAT`, `BACKUP_VERSION`, `buildBackupEnvelope(sourceRecords, exportedAt)`, `validateBackupEnvelope(candidate)`, `getBackupDateRange(sourceRecords)`, and `findLikelyDuplicates(record, { excludeIndex = -1 } = {})`.

- [ ] **Step 1: Write failing tests for the backup envelope and duplicate rules**

Extend the VM test API to expose the five helpers. Add tests that assert the exported envelope has an immutable copy of two records, the expected format/version, and the supplied ISO time. Add validation cases for an unknown format, a non-array `records` value, and a record missing `detail`; each must return `{ ok: false }`. Add duplicate cases for equal date/mileage/category, a different category, and the same record excluded by its index.

```js
test("backup helpers validate the envelope and find only likely duplicates", () => {
  const { api } = loadApp();
  const original = fuelRecord();
  const envelope = api.buildBackupEnvelope([original], "2026-07-14T00:00:00.000Z");

  assert.equal(envelope.format, "superb-maintenance-backup");
  assert.equal(envelope.version, 1);
  assert.notEqual(envelope.records[0], original);
  assert.equal(api.validateBackupEnvelope({ format: "wrong", version: 1, records: [] }).ok, false);
  assert.equal(api.validateBackupEnvelope({ format: envelope.format, version: 1, records: {} }).ok, false);

  api.setRecords([original]);
  assert.equal(api.findLikelyDuplicates({ ...original }).length, 1);
  assert.equal(api.findLikelyDuplicates({ ...original, category: "保養" }).length, 0);
  assert.equal(api.findLikelyDuplicates({ ...original }, { excludeIndex: 0 }).length, 0);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
node --test tests\index-html-ui.test.js
```

Expected: FAIL because the helper functions are not exposed or do not exist.

- [ ] **Step 3: Implement the pure helpers without mutating application state**

Near the storage constants, add immutable backup constants and record-shape helpers. Accept `mileage` as either a finite number or `null`; accept `cost` as a finite number; require non-empty strings for date, category, and detail; allow `note` to be an empty string. Return a descriptive error rather than throwing for a malformed backup. Normalize only comparison inputs, not saved records.

```js
const BACKUP_FORMAT = "superb-maintenance-backup";
const BACKUP_VERSION = 1;

function buildBackupEnvelope(sourceRecords, exportedAt = new Date().toISOString()) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    records: sourceRecords.map(record => ({ ...record }))
  };
}

function findLikelyDuplicates(record, { excludeIndex = -1 } = {}) {
  const key = [record.date, record.mileage ?? "", record.category]
    .map(value => String(value).trim())
    .join("|");
  return records.filter((candidate, index) => index !== excludeIndex && [candidate.date, candidate.mileage ?? "", candidate.category]
    .map(value => String(value).trim())
    .join("|") === key);
}
```

Implement `validateBackupEnvelope(candidate)` by checking the envelope format/version, then validating every record with `isValidStoredRecord(record)`. Return `{ ok: true, records: candidate.records.map(record => ({ ...record })) }` only after all records pass. Implement `getBackupDateRange` from valid date strings and return `"無日期資料"` for an empty backup.

- [ ] **Step 4: Run the focused test and parser to verify the helpers**

Run:

```powershell
node --test tests\index-html-ui.test.js
node -e "const fs=require('fs'); const html=fs.readFileSync('index.html','utf8'); const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim()); for (const s of scripts) new Function(s); console.log('ok scripts', scripts.length);"
```

Expected: all current tests pass and prints `ok scripts 1`.

- [ ] **Step 5: Commit the isolated helper behavior**

```powershell
git add index.html tests/index-html-ui.test.js
git commit -m "feat: add backup validation helpers"
```

### Task 2: Backup export and confirmed full restore

**Files:**
- Modify: `index.html:270-305` (data-management styles)
- Modify: `index.html:1700-1765` (Records-view controls)
- Modify: `index.html:2040-2095` (restore confirmation modal and hidden file input)
- Modify: `index.html:2310-2355, 4980-5025, 5090-5210` (backup actions and event bindings)
- Modify: `tests/index-html-ui.test.js` (restore behavior tests)

**Interfaces:**
- Consumes: Task 1 `buildBackupEnvelope`, `validateBackupEnvelope`, `getBackupDateRange`; existing `saveRecords`, `refresh`, `showToast`, and browser `Blob` download pattern from `exportCSV`.
- Produces: `downloadJsonBackup(sourceRecords, label)`, `stageBackupRestore(fileText)`, `confirmBackupRestore()`, `closeBackupRestoreModal()`, and `pendingRestoreRecords`.

- [ ] **Step 1: Write failing tests for restore staging and complete replacement**

Expose the Task 2 functions and a test-only download spy through the VM API. Test that a valid serialized envelope stages a restore without changing current data, then `confirmBackupRestore()` replaces all current records, invokes one recovery download labelled `還原前`, and updates the success toast with the imported count. Test that invalid JSON and a malformed envelope do not change `records` and show an error message.

```js
test("confirmed restore creates a recovery backup then replaces every record", () => {
  const { api, element } = loadApp();
  api.setRecords([{ ...fuelRecord(), detail: "舊資料" }]);
  const incoming = [{ ...fuelRecord(), date: "2026-07-13", detail: "還原資料" }];

  assert.equal(api.stageBackupRestore(JSON.stringify(api.buildBackupEnvelope(incoming))).ok, true);
  assert.equal(api.getRecords()[0].detail, "舊資料");
  api.confirmBackupRestore();

  assert.deepEqual(api.getRecords(), incoming);
  assert.match(api.getDownloadLabels()[0], /還原前/);
  assert.match(element("toastMessage").textContent, /已還原 1 筆紀錄/);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
node --test tests\index-html-ui.test.js
```

Expected: FAIL because restore staging and confirmation do not exist.

- [ ] **Step 3: Add the data-management controls, local file flow, and confirmation dialog**

Add a Records-view control group with `id="btnBackupExport"`, `id="btnBackupRestore"`, and an invisible `id="backupRestoreInput"` accepting `application/json,.json`. Add a `backupRestoreModal` whose body includes `backupRestoreSummary`; its footer must have `backupRestoreCancelBtn` and `backupRestoreConfirmBtn`. Use the established modal overlay and button classes; give the new action controls `min-height: 44px` in the mobile CSS.

Use one download function for both normal and automatic backup. Build a blob from `JSON.stringify(buildBackupEnvelope(sourceRecords), null, 2)`, use `URL.createObjectURL`, click an anchor, then revoke the URL. Filename format:

```js
`車輛保養備份_${label}_${formatDateYMD(new Date())}.json`
```

`stageBackupRestore(fileText)` must parse in a `try/catch`, call `validateBackupEnvelope`, store only validated cloned records in `pendingRestoreRecords`, render `筆數：N 筆／日期：${getBackupDateRange(records)}`, and open the confirmation modal. On failure, clear pending state and show `showToast("備份檔無法還原：" + error)`.

`confirmBackupRestore()` must return early if there is no staged value. Otherwise call `downloadJsonBackup(records, "還原前")`, assign `records = pendingRestoreRecords.map(record => ({ ...record }))`, clear pending state, call `saveRecords(records)`, close the modal, refresh, and call `showToast(`已還原 ${records.length} 筆紀錄`)` after the save call. The file-input `change` handler reads `file.text()` and always resets `input.value = ""` so the same file can be selected again.

- [ ] **Step 4: Run the focused test, full regression suite, and parser**

Run:

```powershell
node --test tests\index-html-ui.test.js
node -e "const fs=require('fs'); const html=fs.readFileSync('index.html','utf8'); const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim()); for (const s of scripts) new Function(s); console.log('ok scripts', scripts.length);"
git diff --check
```

Expected: all tests pass, script parser prints `ok scripts 1`, and whitespace check has no output.

- [ ] **Step 5: Commit the restore workflow**

```powershell
git add index.html tests/index-html-ui.test.js
git commit -m "feat: add local backup and full restore"
```

### Task 3: Non-blocking duplicate confirmation and handoff documentation

**Files:**
- Modify: `index.html:2040-2095` (duplicate dialog)
- Modify: `index.html:4782-4965` (fuel and generic record commit paths)
- Modify: `index.html:5090-5210` (duplicate dialog bindings)
- Modify: `README.md:20-45` (backup and duplicate behavior)
- Modify: `tests/index-html-ui.test.js` (generic/fuel duplicate-warning tests and README assertion)

**Interfaces:**
- Consumes: Task 1 `findLikelyDuplicates`; existing `handleFormSubmit`, `handleFuelLogSubmit`, `openFuelLogModal`, `closeModal`, `closeFuelLogModal`, `saveRecords`, and `refresh`.
- Produces: `requestRecordSave(record, { editIndex, commit })`, `confirmDuplicateSave()`, `closeDuplicateModal()`, and `pendingDuplicateSave`.

- [ ] **Step 1: Write failing tests for warning, Save Anyway, and edit exclusion**

Expose the duplicate-save functions in the VM API. Add one test that submits a new generic record matching an existing date/mileage/category: it must leave the array length unchanged and open `duplicateModal`. Invoke `confirmDuplicateSave()` and assert the length increases. Add a fuel-edit test whose unchanged record is the only match: it must save immediately because `fuelEditIndex` is excluded.

```js
test("a likely duplicate waits for Save Anyway but an edited record excludes itself", () => {
  const { api, element } = loadApp();
  const original = fuelRecord();
  api.setRecords([original]);

  const duplicate = { ...original };
  api.requestRecordSave(duplicate, { editIndex: -1, commit: () => api.setRecords([...api.getRecords(), duplicate]) });
  assert.equal(element("duplicateModal").style.display, "flex");
  assert.equal(api.getRecords().length, 1);
  api.confirmDuplicateSave();
  assert.equal(api.getRecords().length, 2);

  assert.equal(api.findLikelyDuplicates(original, { excludeIndex: 0 }).length, 0);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
node --test tests\index-html-ui.test.js
```

Expected: FAIL because no duplicate confirmation state exists.

- [ ] **Step 3: Add one shared confirmation dialog and defer only the final mutation**

Add `duplicateModal` with `duplicateList`, `duplicateCancelBtn`, and `duplicateConfirmBtn`; use text that says the record is only *possibly* duplicated and that Save Anyway remains available. Define `let pendingDuplicateSave = null` with other UI state.

Implement `requestRecordSave(record, { editIndex = -1, commit })` to call `findLikelyDuplicates(record, { excludeIndex: editIndex })`. When there are no candidates, call `commit()` immediately. Otherwise assign `pendingDuplicateSave = commit`, render candidate fields using `escapeHtml`, and display the dialog without changing records. `confirmDuplicateSave()` must copy the pending callback, clear pending state, close the dialog, then invoke the callback. `closeDuplicateModal()` must clear the pending callback and hide the dialog.

Refactor only the final record mutation in both handlers into named local commit functions. Keep every existing form validation, old-mileage second-confirmation behavior, calculation, modal close, `saveRecords`, and `refresh` call intact. In the fuel handler pass `{ editIndex: fuelEditIndex }`; in the generic handler pass `{ editIndex: idx }`.

```js
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
```

- [ ] **Step 4: Document and verify the complete user-facing behavior**

Add a README Key UX Behavior bullet explaining JSON backup, automatic recovery backup before full restore, and duplicate warnings that can be overridden. Run:

```powershell
node --test tests\index-html-ui.test.js
node -e "const fs=require('fs'); const html=fs.readFileSync('index.html','utf8'); const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim()); for (const s of scripts) new Function(s); console.log('ok scripts', scripts.length);"
git diff --check
git status --short
```

Expected: all tests pass, parser prints `ok scripts 1`, whitespace check is clean, and only `index.html`, `README.md`, and `tests/index-html-ui.test.js` are modified.

- [ ] **Step 5: Commit the safety UX and documentation**

```powershell
git add index.html README.md tests/index-html-ui.test.js
git commit -m "feat: warn about duplicate maintenance records"
```
