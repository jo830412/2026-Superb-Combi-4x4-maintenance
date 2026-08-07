# Focused Mobile Daily UX Design

## Goal

Make the car-maintenance site faster to scan and operate on an iPhone by keeping the dashboard focused on the next useful decision, placing record tools before record content, and removing duplicated fuel presentation.

This is a presentation and navigation change. It preserves the current record schema, local/cloud synchronization, backup and restore, duplicate warnings, fuel calculations, OCR, AI entry, and all existing saved records.

## Dashboard information hierarchy

The `總覽` view contains four primary surfaces, in this order:

1. A mileage and next-service hero showing current mileage, remaining distance, and the next known due date.
2. Two compact metrics: recent fuel economy and rolling 12-month ownership cost.
3. The next three actionable owner tasks, ordered by urgency.
4. A short recent-record preview with a direct path to the complete records view.

Secondary vehicle statistics move behind a visible `更多車況` disclosure. Opening or closing it does not alter records or other view state.

### Task behavior

- Each task presents one clear status and, where the app has a safe action, one visible action.
- A dated task eligible for calendar export offers `加入行事曆` and uses the calendar-reminder flow defined in the companion specification.
- A missing-mileage task routes to mileage update.
- A maintenance or recordable task routes to its existing specialized or prefilled entry form.
- Informational statuses without a reliable action remain read-only.

## Records view

Search and filters appear immediately below the `紀錄` heading, before any history cards or analytics.

Three subtabs separate distinct jobs:

- `全部紀錄`: the single mixed chronological record list, including fuel records exactly once.
- `加油分析`: fuel-specific totals, trends, and full fuel detail presentation.
- `里程`: mileage history and mileage-specific presentation.

The existing standalone fuel-card stack is removed from `全部紀錄`. Switching subtabs preserves the active search query, filters, and current main view for the browser session. Search and category filters apply consistently to the currently visible record list and do not reset merely because the user visits another subtab.

Backup, restore, export, import, and other infrequent controls move behind a clearly labelled `資料管理` disclosure in the records view. Existing confirmation, recovery-backup, and advisory duplicate behavior remain unchanged.

## Quick entry

The `＋ 新增` action opens a compact bottom sheet rather than a tall list of equal-weight choices.

- Primary choices: `加油` and `保養／維修`.
- Secondary choices: `更新里程`, `照片辨識`, and `文字快速輸入`.
- Each choice continues to route to the existing specialized form; the quick-entry sheet does not duplicate validation or save logic.
- The full fuel form remains the only editor for new or existing fuel records, including its price/liter calculations.

## Visual and interaction rules

- Use one consistent inline SVG icon family for structural controls; do not mix emoji with unrelated icon styles.
- Normal explanatory text is at least 14 px on mobile. Metadata may be smaller but remains legible and sufficiently contrasted.
- Interactive controls have a minimum 44 by 44 px touch target.
- Bottom sheets respect the iPhone safe area, support keyboard use, trap focus while open, close with Escape where a hardware keyboard is present, and return focus to the invoking control.
- Active main view and subtab buttons expose their selected state semantically as well as visually.
- Existing visible focus styles and reduced-motion preferences remain supported.
- The focused layout targets a 375 px viewport first, then adapts without hiding functionality at tablet and desktop widths.

## State and data boundaries

- No Google Sheet columns, Apps Script endpoints, or record serialization formats change.
- No existing record is migrated or rewritten merely by viewing the redesigned pages.
- Main-view, subtab, filter, and search state live only for the active browser session unless an existing persistence mechanism already covers them.
- Loading, local-save, cloud-sync, error, delete Undo, duplicate-warning, and restore-recovery feedback retain their current safety behavior.

## Acceptance criteria

1. At 375 px, the overview presents the four primary surfaces in the specified order without requiring the user to pass eleven statistic cards first.
2. `全部紀錄` places search and filters before the record list and shows each fuel record only once.
3. Fuel-specific detail and analytics are reachable through `加油分析` without duplicating the same full cards in `全部紀錄`.
4. Switching main views or record subtabs does not clear search or filter state.
5. All existing creation paths remain reachable from the compact quick-entry sheet, with fuel and service visually prioritized.
6. Existing backup, restore, duplicate-warning, fuel-edit, OCR, AI, synchronization, and Undo behavior continues to pass its current tests.
7. Primary mobile controls meet the 44 px touch-target requirement and all modal/sheet flows remain keyboard accessible.

## Verification

- Add DOM tests for the four dashboard groups and their order.
- Add a regression test proving `全部紀錄` does not render a second fuel-detail surface.
- Test search/filter placement and state preservation across subtab changes.
- Test all five quick-entry routes and the primary/secondary grouping.
- Add static or computed-style checks for critical mobile touch targets.
- Manually inspect and operate the flows at 375 px and 768 px, including long Chinese labels and the iPhone safe area.

## Out of scope

- Changing the data model, sync protocol, AI/OCR implementation, or fuel-price source.
- Adding user accounts, a native iOS app, push notifications, or a new backend.
- Replacing the current three-view site architecture.
