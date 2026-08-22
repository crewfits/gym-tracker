# First-client V1 scope

Last reviewed: 2026-08-22

This is the delivery and acceptance boundary for the first GymDesk client. Future architecture documents are not part of this committed V1 scope unless separately agreed.

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
- Select a package and membership start/expiry dates.
- Show active, expiring, expired, outstanding, and archived states.
- Renew a membership without losing earlier membership history.
- Default the member list to operationally relevant records; allow explicit archived/all views.

Old members are archived, not deleted. Archived members do not receive reminders and cannot use a QR pass, but their history remains available.

### Payments and reminders

- Record full or partial manual payments.
- Show total, paid, outstanding, due date, and payment history.
- Show due today, overdue, and expiring-soon queues.
- Open an individual prefilled WhatsApp reminder for the owner to review and send.
- Record the reminder as opened/prepared, not delivered, because no WhatsApp API is used.
- Correct payments through a void/reason flow instead of deletion.

### QR attendance

- Generate, share, regenerate, and disable a member QR.
- Admit only non-archived members with an active membership and current QR version.
- First confirmed scan in the business day records entry; the next records exit.
- Ignore an unfinished prior-day entry when suggesting today's first movement.
- Prevent rapid accidental duplicates and keep a manual entry/exit override.
- Show today's movements and searchable attendance history.

## Supporting essentials

- Secure owner sign-in; no public self-registration.
- Gym name, contact details, timezone, and reminder-message settings.
- Dashboard counts for active/expiring/outstanding members and today's attendance.
- CSV export and a documented backup process.
- Mobile-friendly QR scanning and WhatsApp handoff.
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
- WhatsApp Business API, bulk messaging, or delivery tracking.
- Trainer workflows and workout visibility.
- SaaS subscription billing and advanced analytics.

## Acceptance scenarios

1. Owner signs in to the provisioned gym account.
2. Owner finds an existing member or creates a new one and assigns a package.
3. Owner records a full or partial payment and sees the correct balance/history.
4. Owner finds due/expiring members and opens a prefilled WhatsApp reminder.
5. Owner generates and shares a QR, then records entry and exit through confirmed scans.
6. Expired, archived, disabled, replaced, or invalid QR passes are denied.
7. A missed prior-day exit does not make the next day's first scan an exit.
8. Old members remain searchable in archived/all views without cluttering daily operations.
9. Owner can export operational data and the documented backup can be restored.
