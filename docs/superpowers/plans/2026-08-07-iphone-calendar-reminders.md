# iPhone Calendar Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit iPhone-friendly `.ics` export flow for dated vehicle tasks with seven-day and one-day reminders.

**Architecture:** Implement ICS formatting as pure frontend helper functions so Node tests can validate exact calendar output without browser mocks. Attach a normalized `calendar` payload only to owner tasks with reliable dates, show one confirmation sheet, and perform a local Blob download without changing records or sync state.

**Tech Stack:** Browser JavaScript `Blob` and object URLs, RFC 5545 iCalendar text, HTML/CSS bottom sheet, Node.js built-in test runner.

## Global Constraints

- No silent calendar insertion, calendar authentication, backend endpoint, push notification, record mutation, or sync-state mutation.
- Export only tasks with a reliable date; distance-only tasks without an explicit or calculated date remain in-app only.
- Every event is all-day and includes `TRIGGER:-P7D` plus `TRIGGER:-P1D` display alarms.
- Output MIME is `text/calendar;charset=utf-8`, content uses CRLF, long lines are folded, and calendar text is escaped.
- The success message is exactly `已建立行事曆檔；若未自動開啟，請從下載項目開啟`.

---

### Task 1: Pure ICS formatter

**Files:**
- Modify: `tests/index-html-ui.test.js`
- Modify: `index.html:2400-2600`

**Interfaces:**
- Consumes: `formatDateYMD(date)` and standard `Date`.
- Produces: `escapeIcsText(value): string`, `foldIcsLine(line): string`, `buildCalendarUid(task): string`, `buildCalendarFile(task, now?): string` where task is `{ title: string, date: string, description?: string, type?: string }`.

- [ ] **Step 1: Expose the desired pure functions and write failing tests**

Add the four function names to `__testApi`, then add:

```js
test("calendar files contain an all-day event and two alarms", () => {
  const { api } = loadApp();
  const ics = api.buildCalendarFile({
    title: "Superb 定期保養",
    date: "2027-05-28",
    type: "maintenance",
    description: "10,000 公里或日期，以先到者為準"
  }, new Date("2026-08-07T00:00:00Z"));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20270528\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20270529\r\n/);
  assert.match(ics, /TRIGGER:-P7D\r\n/);
  assert.match(ics, /TRIGGER:-P1D\r\n/);
  assert.match(ics, /DTSTAMP:20260807T000000Z\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test("calendar text is escaped folded and has a stable uid", () => {
  const { api } = loadApp();
  const task = { title: "保養,檢查;輪胎", date: "2027-05-28", type: "maintenance", description: "第一行\\測試\n第二行" };
  const first = api.buildCalendarFile(task, new Date("2026-08-07T00:00:00Z"));
  const second = api.buildCalendarFile(task, new Date("2026-08-08T00:00:00Z"));
  assert.match(first, /SUMMARY:保養\\,檢查\\;輪胎/);
  assert.match(first, /DESCRIPTION:第一行\\\\測試\\n第二行/);
  assert.equal(first.match(/UID:(.+)\r\n/)[1], second.match(/UID:(.+)\r\n/)[1]);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test --test-name-pattern="calendar files|calendar text" tests\index-html-ui.test.js`

Expected: FAIL because the ICS helpers do not exist.

- [ ] **Step 3: Implement minimal RFC 5545 helpers**

Add:

```js
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
  for (const char of source) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${(hash >>> 0).toString(16)}-${task.date.replace(/-/g, "")}@superb-maintenance.local`;
}

function buildCalendarFile(task, now = new Date()) {
  const start = parseDate(task.date);
  if (!start) throw new Error("提醒日期無效");
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const compact = date => formatDateYMD(date).replace(/-/g, "");
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const description = task.description || "請開啟 Superb 保養紀錄確認詳細內容。";
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0",
    "PRODID:-//Superb Maintenance//Vehicle Reminder//ZH-TW", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT", `UID:${buildCalendarUid(task)}`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(start)}`, `DTEND;VALUE=DATE:${compact(end)}`,
    `SUMMARY:${escapeIcsText(task.title)}`, `DESCRIPTION:${escapeIcsText(description)}`,
    "BEGIN:VALARM", "TRIGGER:-P7D", "ACTION:DISPLAY", `DESCRIPTION:${escapeIcsText(task.title)}`, "END:VALARM",
    "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", `DESCRIPTION:${escapeIcsText(task.title)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"
  ].map(foldIcsLine).join("\r\n") + "\r\n";
}
```

If `TextEncoder` is missing from the VM context, expose the platform `TextEncoder` in `loadApp()`; do not add a production polyfill.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test --test-name-pattern="calendar files|calendar text" tests\index-html-ui.test.js`

Expected: 2 tests pass.

Run: `node --test tests\index-html-ui.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit the formatter**

```powershell
git add index.html tests/index-html-ui.test.js
git commit -m "feat: generate iPhone calendar reminder files"
```

### Task 2: Eligible owner-task mapping and confirmation sheet

**Files:**
- Modify: `tests/index-html-ui.test.js`
- Modify: `index.html:1650-1675`
- Modify: `index.html:2080-2140`
- Modify: `index.html:3180-3514`
- Modify: `index.html:5306-5360`

**Interfaces:**
- Consumes: `buildOwnerActions()`, `getFixedCostState()`, `getWarrantyState()`, tracker due dates.
- Produces: `getCalendarTask(action): object | null`, `openCalendarReminder(task): void`, `closeCalendarReminder(): void`, `pendingCalendarTask`.

- [ ] **Step 1: Write failing eligibility and sheet tests**

Expose `getCalendarTask`, `openCalendarReminder`, and `getPendingCalendarTask`, then add:

```js
test("calendar eligibility requires a reliable date", () => {
  const { api } = loadApp();
  assert.equal(api.getCalendarTask({ name: "輪胎", dueMileage: 10000 }), null);
  assert.deepEqual(JSON.parse(JSON.stringify(api.getCalendarTask({
    name: "定期保養", dueDate: new Date("2027-05-28T00:00:00"), dueMileage: 10000
  }))), {
    title: "Superb 定期保養",
    date: "2027-05-28",
    type: "vehicle-reminder",
    description: "預計 2027-05-28 或 10,000 公里，以先到者為準"
  });
});

test("opening a calendar reminder shows the task and default alarms", () => {
  const { api, element } = loadApp();
  const task = { title: "Superb 使用牌照稅", date: "2027-04-01", type: "legal", description: "4 月繳納" };
  api.openCalendarReminder(task);
  assert.equal(element("calendarReminderModal").style.display, "flex");
  assert.equal(element("calendarReminderTitle").textContent, task.title);
  assert.equal(element("calendarReminderDate").textContent, "2027-04-01");
  assert.match(element("calendarReminderAlarms").textContent, /7 天前.*1 天前/);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test --test-name-pattern="calendar eligibility|opening a calendar" tests\index-html-ui.test.js`

Expected: FAIL because calendar task mapping and confirmation sheet do not exist.

- [ ] **Step 3: Normalize eligible task dates**

Add:

```js
function getCalendarTask(action) {
  const dueDate = action?.dueDate instanceof Date ? action.dueDate : parseDate(action?.dueDate);
  if (!dueDate) return null;
  const date = formatDateYMD(dueDate);
  const condition = Number.isFinite(action.dueMileage)
    ? `預計 ${date} 或 ${Number(action.dueMileage).toLocaleString("zh-TW")} 公里，以先到者為準`
    : action.meta || `預計日期 ${date}`;
  return { title: `Superb ${action.name}`, date, type: action.calendarType || "vehicle-reminder", description: condition };
}
```

Make fixed costs include their existing `dueDate` and `calendarType: "legal"`; make warranty include `dueDate: endDate` and `calendarType: "warranty"`; add a maintenance `dueDate` only when a date estimate already exists. Do not add a date to distance-only consumables.

- [ ] **Step 4: Add the confirmation sheet and task actions**

Add an accessible `calendarReminderModal` with labelled title, date, condition, default-reminder text, `calendarReminderCancelBtn`, and `calendarReminderConfirmBtn` labelled `下載並開啟行事曆`.

In `renderOwnerDashboard()`, compute `const calendarTask = getCalendarTask(action)` and render:

```html
<button class="btn btn-ghost btn-sm" type="button" data-calendar-task="INDEX">加入行事曆</button>
```

Store the rendered three action objects in `renderedOwnerActions` so the click handler can safely call `openCalendarReminder(getCalendarTask(renderedOwnerActions[index]))` without embedding private details in HTML attributes.

Add:

```js
function openCalendarReminder(task) {
  if (!task) return;
  pendingCalendarTask = { ...task };
  document.getElementById("calendarReminderTitle").textContent = task.title;
  document.getElementById("calendarReminderDate").textContent = task.date;
  document.getElementById("calendarReminderCondition").textContent = task.description || "";
  document.getElementById("calendarReminderAlarms").textContent = "提醒：7 天前、1 天前";
  document.getElementById("calendarReminderModal").style.display = "flex";
}
```

- [ ] **Step 5: Run focused and full tests**

Run: `node --test --test-name-pattern="calendar eligibility|opening a calendar" tests\index-html-ui.test.js`

Expected: 2 tests pass.

Run: `node --test tests\index-html-ui.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit eligible reminder UI**

```powershell
git add index.html tests/index-html-ui.test.js
git commit -m "feat: add dated task calendar actions"
```

### Task 3: Local download, failure recovery, and user copy

**Files:**
- Modify: `tests/index-html-ui.test.js`
- Modify: `index.html:2450-2600`
- Modify: `index.html:5306-5365`
- Modify: `README.md`

**Interfaces:**
- Consumes: `pendingCalendarTask`, `buildCalendarFile(task)`, `showToast(message)`.
- Produces: `downloadCalendarReminder(): boolean`, `getCalendarFilename(task): string`.

- [ ] **Step 1: Upgrade the DOM test helper and write failing download tests**

Allow `loadApp()` to accept `createElementImpl`, capture created anchors, and expose `downloadCalendarReminder`. Add:

```js
test("calendar download uses UTF-8 calendar MIME and success guidance", () => {
  const created = [];
  const { api, element } = loadApp({ createElementImpl(tag) {
    const node = createElement(); node.tagName = tag; node.click = () => { node.clicked = true; }; created.push(node); return node;
  }});
  api.openCalendarReminder({ title: "Superb 保養", date: "2027-05-28", type: "maintenance", description: "定期保養" });
  assert.equal(api.downloadCalendarReminder(), true);
  const anchor = created.find(node => node.tagName === "a");
  assert.equal(anchor.clicked, true);
  assert.match(anchor.download, /2027-05-28.*\.ics$/);
  assert.match(element("toastMessage").textContent, /已建立行事曆檔/);
});

test("calendar download failure keeps the reminder open and records unchanged", () => {
  const { api, element } = loadApp({ urlApi: { createObjectURL() { throw new Error("blocked"); }, revokeObjectURL() {} } });
  const original = [fuelRecord()];
  api.setRecords(original);
  api.openCalendarReminder({ title: "Superb 保養", date: "2027-05-28", type: "maintenance", description: "定期保養" });
  assert.equal(api.downloadCalendarReminder(), false);
  assert.deepEqual(api.getRecords(), original);
  assert.equal(element("calendarReminderModal").style.display, "flex");
  assert.match(element("toastMessage").textContent, /行事曆檔建立失敗/);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test --test-name-pattern="calendar download" tests\index-html-ui.test.js`

Expected: FAIL because the download function is absent.

- [ ] **Step 3: Implement safe local download**

Add:

```js
function getCalendarFilename(task) {
  const safeTitle = task.title.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-");
  return `${task.date}-${safeTitle}.ics`;
}

function downloadCalendarReminder() {
  if (!pendingCalendarTask) return false;
  let url = "";
  try {
    const blob = new Blob([buildCalendarFile(pendingCalendarTask)], { type: "text/calendar;charset=utf-8" });
    url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = getCalendarFilename(pendingCalendarTask);
    anchor.click();
    closeCalendarReminder();
    showToast("已建立行事曆檔；若未自動開啟，請從下載項目開啟");
    return true;
  } catch (error) {
    showToast("行事曆檔建立失敗，請稍後重試");
    return false;
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
```

Bind confirm, cancel, overlay-click, and Escape behavior. On open, save the invoking element; on close, restore focus. Do not call `saveRecords()` or `syncToCloud()`.

- [ ] **Step 4: Document the iPhone confirmation boundary**

Add to README: selecting `加入行事曆` creates a local `.ics`; iPhone/Safari may open it immediately or leave it in Downloads; the user must confirm adding the event in iOS; default alerts are seven and one day before.

- [ ] **Step 5: Run all tests and inspect output**

Run: `node --test tests\index-html-ui.test.js`

Expected: all tests pass with zero failures.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 6: Commit download behavior**

```powershell
git add index.html tests/index-html-ui.test.js README.md
git commit -m "feat: download iPhone calendar reminders"
```

### Task 4: Browser and iPhone verification

**Files:**
- No production changes unless a new failing regression test first reproduces an issue.

**Interfaces:**
- Consumes: completed calendar helper, sheet, and download flow.
- Produces: verification evidence only.

- [ ] **Step 1: Run the complete suite**

Run: `node --test tests\index-html-ui.test.js`

Expected: all tests pass.

- [ ] **Step 2: Validate a generated fixture**

Use the tested `buildCalendarFile()` path to generate one event containing Chinese punctuation and verify: CRLF lines, non-inclusive next-day `DTEND`, two alarms, stable UID, escaped commas/semicolons/backslashes/newlines, and line folding without splitting a UTF-8 character.

- [ ] **Step 3: Exercise the responsive browser flow**

At 375 by 812 and 768 by 1024, open an eligible task, cancel once, reopen, trigger the download, confirm the guidance toast, and verify no record count or sync status changes.

- [ ] **Step 4: Exercise iPhone Safari**

On the user's iPhone, open the served/deployed site, select `加入行事曆`, choose `下載並開啟行事曆`, and verify either the immediate event preview or the file in Safari Downloads can be opened and imported. Confirm the event shows the date, condition, and two alerts before adding it.

- [ ] **Step 5: Final repository verification**

Run: `git status --short`, `git log --oneline -6`, and `git diff origin/main...HEAD --check`.

Expected: only intentional commits, no uncommitted product changes, and no whitespace errors.
