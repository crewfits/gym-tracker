# First-client V1 scope

> Current operating mode (2026-09-05): WhatsApp reminders are owner-triggered only. The cron endpoint is disabled, Cloudflare triggers are commented out, and migration `20260905093000_pause_whatsapp_reminder_cron.sql` removes the Supabase daily job. The scheduling implementation is retained for later; scheduling instructions below describe the paused capability. Deploy the app change and apply the pause migration to pause an existing hosted schedule.

Last reviewed: 2026-08-23

This is the delivery and acceptance boundary for the first FitKiro client. Future architecture documents are not part of this committed V1 scope unless separately agreed.

## Client profile

- One gym business.
- One owner/admin account provisioned by us.
- One location.
- Approximately 300 active members.
- Approximately 1,500 total member records including expired/old members.
- No member login and no staff accounts in V1.

This workload does not require microservices, multi-location architecture, database partitioning, or a separate analytics system.

## Required workflows

### Members and packages

- Create, edit, search, and archive members.
- Optionally attach one private member profile photo for owner/operator identity verification.
- Select a package and membership start/expiry dates.
- Show active, expiring, expired, outstanding, and archived states.
- Renew a membership without losing earlier membership history.
- Default the member list to operationally relevant records; allow explicit archived/all views.

Old members are archived, not deleted. Archived members do not receive reminders and cannot use a QR pass, but their history remains available.

### Payments and reminders

- Record full or partial manual payments, including up to 10 cash/UPI/card/bank-transfer entries in one activation, enrollment, renewal, or balance collection. Each entry has its own amount, date, and optional reference; the customer-facing receipt is grouped per payment operation and lists the payment-method breakdown plus paid and due amounts.
- Show total, paid, outstanding, due date, and payment history.
- Show partial-payment, overdue, and expiring-soon queues.
- Use an automatic seven-day payment follow-up date for new memberships and renewals instead of asking the owner to choose it during enrollment.
- Open an individual prefilled WhatsApp reminder for the owner to review and send.
- Optionally submit an approved WhatsApp Utility template 7 days before membership expiry and on expiry day when the member has explicitly opted in, has no future renewal, and Meta Cloud API is configured.
- Share a payment receipt through a signed, member-readable WhatsApp link.
- Record manual WhatsApp reminders as opened/prepared. Record automated Cloud API attempts as submitted, skipped, or failed with the Meta message ID when accepted.
- Correct payments through a void/reason flow instead of deletion.

### QR attendance

- Generate, share, regenerate, and disable a member QR.
- Let the owner mark the current QR as manually shared, then view/filter members by QR shared status.
- Admit only non-archived members with an active membership and current QR version.
- The installed Android PWA scanner records the first valid scan in the business day as Check-in and the next as Check-out, then shows the result and returns to scanning. Directly opening a scan URL retains explicit confirmation as a fallback. The database continues to store the stable `entry`/`exit` enum values.
- Ignore an unfinished prior-day entry when suggesting today's first movement.
- Prevent rapid accidental duplicates. During the 30-second scanner result, allow the owner to record the opposite movement. Afterward, allow only today's latest event for that member to be undone, with an optional sequence-safe replacement; preserve the original event and correction reason for audit.
- Show today's movements and searchable attendance history.
- Keep attendance without automatic deletion in V1. Any later purge requires a client-approved retention period, a verified backup/export, and an audited bounded deletion process.

## Supporting essentials

- Secure owner sign-in; no public self-registration.
- Gym name, contact details, timezone, and reminder-message settings.
- Dashboard counts for active/expiring/outstanding members and today's attendance.
- CSV export and a documented backup process.
- Installable Android PWA with in-app QR camera scanning, sound/vibration feedback, and no new browser tab, plus mobile-friendly WhatsApp handoff.
- Private member photos on owner-only operational screens when captured.
- Clear validation, error, empty, and expired/denied states.

## Initial data migration

Do not ask the owner to manually recreate approximately 1,500 existing records.

We will perform a one-time controlled CSV import supplied by the client:

- import the approximately 300 active members with current package, dates, phone, and known balance;
- import old members as expired or archived based on supplied data;
- do not invent missing payment or attendance history;
- normalize phone numbers and report duplicates/invalid rows before import;
- take a pre-import backup and provide an import summary.

A reusable customer-facing import UI is not required for V1.

## Explicitly out of scope

- Workout Tracker integration.
- Multi-organization SaaS migration.
- Staff roles and invitations.
- Multiple locations.
- Member-facing app/login.
- Online payments.
- Bulk WhatsApp campaigns, marketing templates, inbound message handling, and webhook-based delivered/read tracking.
- Trainer workflows and workout visibility.
- SaaS subscription billing and advanced analytics.

## Acceptance scenarios

1. Owner signs in to the provisioned gym account.
2. Owner finds an existing member or creates a new one and assigns a package.
3. Owner records a full or partial payment and sees the correct balance/history.
4. Owner finds due/expiring members and opens a prefilled WhatsApp reminder.
5. Owner generates and shares a QR, marks it shared after the manual handoff, then records entry and exit through automatic PWA scans or the confirmation-based URL fallback.
6. Expired, archived, disabled, replaced, or invalid QR passes are denied.
7. A missed prior-day exit does not make the next day's first scan an exit.
8. The owner can undo a member's latest event from today after the scanner's 30-second result window and optionally record the next valid movement without creating consecutive Check-ins or Check-outs.
9. Old members remain searchable in archived/all views without cluttering daily operations.
10. Owner can export operational data and the documented backup can be restored.
11. Reusing an archived member's phone opens that historical profile and offers reactivation instead of creating an accidental duplicate.

## Expired-membership access attempts (2026-09-10)

Expired members with a current, enabled QR remain denied, but the owner scanner now logs their attempted visit. Repeat scans within 30 seconds are suppressed. Active memberships (including expiry day) retain normal attendance; invalid, disabled, replaced, archived, and upcoming-only/no-history cases do not create expired-attempt records.

The separate `denied_access_attempts` ledger never contributes to attendance or occupancy. Attendance → Denied attempts provides search, date filters, pagination and CSV; backups include the ledger. Direct scan-page visits remain read-only until the owner confirms **Log denied attempt**. Apply migration `20260910100000_expired_qr_access_attempts.sql` before deploying. See [QR attendance architecture](qr-attendance-architecture.md#expired-membership-access-attempts-2026-09-10) for database guarantees and verification.
