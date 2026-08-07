# iPhone Calendar Reminder Design

## Goal

Let an iPhone user turn an eligible vehicle due date into a useful Apple Calendar event with one in-app action and one explicit iOS confirmation.

The browser creates a standards-based `.ics` file locally. It does not silently insert an event, request calendar-account access, or require a new backend.

## Eligible reminders

Calendar export is offered for tasks with a reliable date, including:

- Scheduled maintenance with a due date.
- Insurance, tax, inspection, warranty, and other fixed-date obligations.
- A mileage-based task only when the application also has an explicit or calculated due-date estimate.

A distance-only task remains an in-app reminder. The interface must not invent a calendar date merely to make it exportable.

For a task governed by both date and mileage, the event description states the condition, for example `預計 2027-05-28 或 10,000 公里，以先到者為準`.

## Confirmation sheet

Selecting `加入行事曆` opens a bottom sheet before any file is created. It shows:

- Event title.
- Event date.
- Mileage or service condition, when applicable.
- Reminder schedule: seven days before and one day before.

The primary action is `下載並開啟行事曆`; the secondary action is `取消`. The first implementation uses the two default reminders and does not require reminder customization.

## iPhone user flow

1. The user selects `加入行事曆` on an eligible task.
2. The app shows the confirmation sheet.
3. The user selects `下載並開啟行事曆`.
4. Safari creates or opens the `.ics` file.
5. iOS presents its event preview/import interface.
6. The user confirms adding the event to a calendar.

The app never claims the event was automatically added. After creating the file, it says: `已建立行事曆檔；若未自動開啟，請從下載項目開啟`.

## ICS generation

The file is generated in the frontend as UTF-8 with MIME type `text/calendar;charset=utf-8` and contains:

```text
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Superb Maintenance//Vehicle Reminder//ZH-TW
CALSCALE:GREGORIAN
BEGIN:VEVENT
UID:...
DTSTAMP:...
DTSTART;VALUE=DATE:...
DTEND;VALUE=DATE:...
SUMMARY:...
DESCRIPTION:...
BEGIN:VALARM
TRIGGER:-P7D
ACTION:DISPLAY
DESCRIPTION:...
END:VALARM
BEGIN:VALARM
TRIGGER:-P1D
ACTION:DISPLAY
DESCRIPTION:...
END:VALARM
END:VEVENT
END:VCALENDAR
```

Implementation rules:

- Use an all-day event. `DTEND` is the day after `DTSTART`, as required for a non-inclusive all-day end date.
- Generate a stable UID from non-sensitive task identity such as vehicle identifier, task type, and due date so repeated export of the same task does not create an arbitrary new identity.
- Generate `DTSTAMP` in UTC.
- Escape backslashes, commas, semicolons, and newlines in text values.
- Use CRLF line endings and fold lines that exceed the ICS content-line limit.
- Keep titles concise; put mileage conditions and explanatory details in `DESCRIPTION`.
- Include both display alarms: `TRIGGER:-P7D` and `TRIGGER:-P1D`.
- Use a safe filename derived from the task name and date, with invalid filename characters removed.

## Failure and safety behavior

- If Blob creation, object-URL creation, or download triggering fails, show an understandable error toast and leave the confirmation sheet available for retry.
- A failed or cancelled export does not modify records, reminder dates, synchronization state, or task completion state.
- Revoke temporary object URLs after use.
- Calendar export does not bypass or interact with record duplicate warnings, backup recovery, deletion Undo, or cloud sync.
- No calendar credentials, event data, or private vehicle data is transmitted to a third-party calendar service by this feature.

## Accessibility

- The sheet follows the same focus, Escape, focus-return, 44 px touch-target, safe-area, and reduced-motion rules as other bottom sheets.
- The action includes a text label and does not rely on the calendar icon alone.
- Status and error messages are announced through the site's existing accessible feedback mechanism.

## Acceptance criteria

1. A fixed-date task opens a confirmation sheet with the correct title, date, condition, and two reminder times.
2. Confirming produces a valid UTF-8 `.ics` file with one all-day event and two display alarms.
3. Chinese titles, punctuation, and multiline descriptions remain valid after ICS escaping and folding.
4. A distance-only task without a due-date estimate does not offer calendar export.
5. Cancelling or encountering a generation/download error changes no record or reminder data.
6. The interface clearly requires the user to confirm the event in iOS and never reports an automatic calendar insertion.
7. On current iPhone Safari, the generated file can be opened from the immediate browser flow or Downloads and presented for Calendar import.

## Verification

- Unit-test required calendar and event fields, date formatting, deterministic UID input, UTF-8 output, CRLF endings, line folding, and text escaping.
- Unit-test both `VALARM` blocks and the exclusive all-day `DTEND` calculation.
- Test eligible fixed-date, eligible mixed date/mileage, and ineligible distance-only task mapping.
- Test confirmation-sheet rendering, cancel, success-copy, and failure/retry paths.
- Manually test on an iPhone in Safari, including the fallback path through browser Downloads.

## Out of scope

- Silent or background insertion into Apple Calendar.
- Calendar account authentication, event synchronization, recurring-event editing, or deletion of previously imported events.
- Native iOS notifications, push notifications, email reminders, or server-side scheduling.
- Predicting a due date for mileage-only work when the application has no reliable estimate.
