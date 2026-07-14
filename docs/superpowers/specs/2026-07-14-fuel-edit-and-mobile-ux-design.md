# Fuel Editing and Mobile UX Design

## Goal

Make daily vehicle-record entry faster on mobile, and ensure an existing fuel record is always edited with the full fuel form rather than the generic maintenance form.

## Scope

This change keeps the current single-page architecture and existing record storage format. It improves user-facing flows in `index.html` only; it does not change the Apps Script API, the Google Sheet columns, or existing record contents.

## Fuel record editing

- A record whose category is `加油` opens the existing fuel modal when the user selects Edit.
- The modal has an explicit create/edit mode and stores the original `records` array index while editing.
- Existing fuel details are parsed using the same `parseFuelLog()` format already used by the fuel dashboard. The editor pre-fills date, mileage, fuel type, liters, unit price, discount, paid price, full-tank choice, and note.
- Editing retains the current price, liters, and cost calculation helpers. Changing any related field recalculates the estimate as it does for a new fuel entry.
- Submitting an edited fuel record replaces only its original array item. Creating a fuel record still appends a new item.
- Existing records that lack optional fuel-price metadata remain editable. Known values pre-fill; unknown values remain blank for the user to confirm.

## Navigation and quick entry

- The header exposes one primary `＋ 新增` action instead of a horizontally overflowing list of primary actions on mobile.
- Activating it opens a quick-entry sheet with five choices: fuel, maintenance/service, mileage update, photo import, and text quick entry.
- The existing specialized forms remain the source of truth. The sheet only routes the user to the appropriate existing flow.
- On desktop, the single primary action remains available and secondary tools move into the same quick-entry menu for consistent terminology.

## Homepage organization

- The page receives three content views: `總覽`, `紀錄`, and `分析`.
- `總覽` shows the key vehicle status, owner actions, and a small recent-record list.
- `紀錄` contains the fuel history, search/filter controls, and complete record list.
- `分析` contains ownership costs, consumable trackers, and charts.
- Switching views does not reload or discard records, filter text, or form state.

## Actionable owner tasks

- Owner-task cards expose a visible action when the application can act on it directly.
- Missing mileage routes to mileage update; missing fuel history routes to fuel entry; maintenance, insurance, tax, and other recordable reminders route to the generic form with a suitable category/template where available.
- Informational statuses without a safe direct action remain read-only.

## Feedback and recovery

- Saving any record shows a brief toast that distinguishes `已儲存到本機` from `已同步雲端` or `同步失敗，可重試`.
- The existing header sync indicator remains a secondary status display.
- Deleting a record gives a short Undo action that restores the exact removed record in its original position before the timeout expires.
- Closing a form with unsaved user changes asks for confirmation; untouched forms still close immediately.

## Accessibility and mobile constraints

- Primary controls and record edit/delete controls have a minimum 44 px touch target on mobile.
- View switches and quick-entry choices use text labels in addition to icons.
- The selected view is communicated with a visible active state and semantic button state.
- Existing camera and photo-library choice remains separate.

## Acceptance criteria

1. Editing a `加油` record never displays the generic category selector.
2. Saving an edited fuel record preserves its array position and updates calculated fuel statistics.
3. A user can reach all five creation flows from one visible mobile action without horizontally scrolling the header.
4. A user can reach recent/full records without scrolling through charts first.
5. A save, cloud-sync failure, delete, and undo each provide understandable feedback.
6. Existing generic maintenance and photo/AI entry flows continue to work without changing Apps Script data columns.

## Out of scope

- Changing the cloud synchronization protocol or Google Sheet schema.
- Changing AI model selection, API key configuration, or OCR engine behavior.
- Adding accounts, authentication, dark mode, or a new deployment platform.
