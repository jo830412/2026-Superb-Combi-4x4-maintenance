# Data Safety and Backup Design

## Goal

Prevent accidental duplicate records and let the owner recover the complete record set from a local backup without changing the existing Google Sheet or Apps Script contract.

## Scope

- Export all current records to a JSON file.
- Restore a selected JSON backup by completely replacing the current record set.
- Create a local downloadable recovery backup immediately before a confirmed restore.
- Warn, without blocking, when saving a likely duplicate record.
- Keep the existing six-field record schema: `date`, `mileage`, `category`, `cost`, `detail`, and `note`.

## Out of Scope

- Server-side version history, scheduled backups, and Google Sheet schema changes.
- Automatic deletion or merging of duplicate records.
- Changes to AI, OCR, fuel-price, or camera/library behavior.

## Export and Restore

The Records view gains a compact Data Management area with Export Backup and Restore Backup actions. Export downloads a UTF-8 JSON file with this envelope:

```json
{
  "format": "superb-maintenance-backup",
  "version": 1,
  "exportedAt": "2026-07-14T12:00:00.000Z",
  "records": []
}
```

Restore opens a file picker and parses the selected file locally. The app accepts only the envelope above, validates that `records` is an array, and validates every record against the existing six-field schema. Invalid or malformed files leave the current data unchanged and show a clear error.

For a valid backup, the app shows a confirmation dialog with the incoming record count, date range, and a clear statement that the current records will be replaced. Confirmation first downloads an automatic recovery backup of the current records, then replaces the in-memory array, saves locally, refreshes the UI, and starts the existing cloud sync. The success toast states the imported record count.

## Duplicate Warning

Before a generic or fuel form is saved, the app compares its proposed record against existing records. A likely duplicate has the same normalized date, mileage, and category. While editing, the record being edited is excluded from comparison.

If candidates exist, a confirmation dialog lists their date, mileage, category, detail, and cost. The owner can return to the form or choose Save Anyway. Save Anyway runs the existing save path unchanged. No record is blocked, merged, or deleted automatically.

## UI and Error Handling

- Data-management controls use the same Records-view button styling and preserve 44 px minimum mobile touch targets.
- File contents never leave the browser except through the existing array-sync request after the user confirms restore.
- Backup download failures, file read errors, schema failures, and cloud sync failures leave visible status feedback. A cloud sync failure does not undo the local restore; the sync-status control remains retryable.
- The existing delete Undo toast continues to take priority over routine sync messages.

## Tests

Node tests will cover backup-envelope creation, rejected malformed backup data, full-record replacement after confirmation, automatic recovery-backup invocation, duplicate detection, and exclusion of the current record during edit. Existing fuel-edit, mobile-entry, owner-action, undo, README, and inline-script checks must remain green.
