# GymDesk V1 architecture

Last reviewed: 2026-08-22

This document describes only the architecture required for the contracted first-client application. Ideas that are not part of V1 are intentionally kept outside the active documentation set.

## Product boundary

GymDesk V1 is a single-gym, single-location, owner-operated application for:

1. member and package management;
2. manual payment tracking and individual payment reminders;
3. QR-based entry and exit logging.

The client has approximately 300 active members and 1,500 total current/historical member records. This is a small workload for the existing application and database.

## System overview

```text
Owner's browser or phone
          |
    Next.js application
      |           |
Server Components Server Actions
      |           |
      +----- Supabase Auth
      +----- PostgreSQL + RLS
      +----- Resend (optional receipt email only)
```

The system remains a modular monolith. There is one Next.js deployment and one Supabase project. No microservices, job queue, analytics warehouse, or separate mobile backend is required.

## Current code structure

```text
src/app/                 Routes, Server Components and Server Actions
src/components/          Reusable UI and client interactions
src/lib/                 Authentication, domain rules, QR signing and Supabase clients
supabase/migrations/     Authoritative ordered database schema
docs/                    Current product, architecture and operating documentation
```

Important modules:

- `src/lib/auth.ts` resolves the authenticated gym owner.
- `src/app/actions/core.ts` handles member, membership, payment and settings mutations.
- `src/app/actions/attendance.ts` handles QR lifecycle and attendance writes.
- `src/lib/qr-token.ts` signs and verifies versioned QR tokens.
- `supabase/migrations/001_initial_schema.sql` contains the main operational schema and RLS.
- `supabase/migrations/002_create_member_with_enrollment.sql` makes onboarding transactional.
- `supabase/migrations/005_qr_attendance.sql` contains QR credential and attendance persistence.
- `supabase/migrations/006_owner_access_member_directory.sql` disables interactive gym bootstrap and adds the paginated member directory contract.
- `supabase/migrations/007_manual_whatsapp_reminders.sql` adds due dates, manual reminder history, and due/expiry queues.
- `supabase/migrations/008_attendance_operations.sql` adds timezone-aware attendance operations.
- `supabase/migrations/009_controlled_member_import.sql` exposes the service-role-only atomic onboarding import.
- `supabase/migrations/010_transaction_directory.sql` and `011_dashboard_summary.sql` keep financial/history views accurate past API row limits.

## Authentication and data isolation

The owner account is provisioned by us. Public account creation is not part of V1.

Every operational record is scoped by `gym_id`. Server-side queries resolve the authenticated owner's gym and PostgreSQL RLS independently enforces the same boundary. Route parameters and form values are never sufficient authorization.

V1 retains the current relationship:

```text
Supabase auth user
        |
        `-- one gyms row through owner_id
```

Do not replace this with staff, organization, or role-management infrastructure for V1.

Required authentication states:

- valid provisioned owner → dashboard;
- signed-out user → login;
- authenticated user without a provisioned gym → access-not-configured message;
- archived/disabled owner account → access denied.

## Data model

```text
gyms
  |-- members
  |     |-- memberships
  |     |     `-- charges
  |     |           `-- payments
  |     |-- member_qr_credentials
  |     `-- attendance_events
  |-- plans
  `-- manual_reminder_events
```

### Members

- A member belongs to the gym and receives a stable member code.
- Old members are archived, never permanently deleted through normal UI.
- Archived members retain membership, payment, and attendance history.
- Archived members cannot receive reminders or use QR access.
- Phone numbers should be normalized and duplicates reported, while intentional shared family numbers remain possible.

### Packages and memberships

- Plans are reusable templates.
- Membership rows snapshot the applied plan name, duration, start date, and expiry date.
- Renewals create new membership history rather than overwriting previous memberships.
- Active access is determined from membership dates in the gym timezone.

### Charges and payments

- Money is stored as integer paise.
- Each membership has a charge with subtotal, discount, tax, total, paid, and outstanding values.
- Payments are manual records tied to a charge.
- Incorrect payments are voided with a reason instead of deleted.
- An explicit charge due date is required for accurate due/overdue reminders.

### Reminder activity

V1 reminders are owner-initiated WhatsApp click-to-chat messages.

- The application prepares a message and opens WhatsApp.
- The owner reviews and sends it from their own account.
- Without a WhatsApp API, the application records `opened` or `prepared`, never `sent` or `delivered`.
- Archived members are excluded.
- Renewal reminders use membership expiry; outstanding-payment reminders use the charge due date.

## QR access and attendance

The QR image and signed token are generated on demand and are not stored. The database stores only enabled state, credential version, and lifecycle metadata.

```text
payload   = gym ID + member ID + credential version
signature = HMAC-SHA256(server-only secret, payload)
QR        = public scan URL containing payload.signature
```

Regeneration increments the credential version and invalidates old copies. Disabling the credential denies all scans until a new version is issued.

Attendance rules:

- Opening/scanning a URL never records attendance by itself.
- An authenticated owner reviews the member and explicitly confirms the movement.
- The write transaction revalidates the gym, member, QR version, archive state, and active membership.
- First confirmed movement in a business day is entry; the next is exit.
- A missed prior-day exit does not turn today's first movement into an exit.
- Rapid duplicate submissions are idempotent/suppressed.
- Manual entry/exit override remains available for missed same-day scans.
- Attendance events remain an append-only ledger.

With 300 active members, even two scans per member every day would be about 219,000 events annually, which PostgreSQL handles comfortably with the existing indexes and paginated attendance view.

## Initial data import

Initial onboarding uses a one-time controlled CSV import performed by us, not a customer-facing import feature.

1. Obtain the client's member list and field definitions.
2. Validate and normalize names, phone numbers, package names, dates, balances, and active status.
3. Produce a duplicate/invalid-row report for approval.
4. Take a pre-import backup.
5. Import approximately 300 active records with available current commercial data.
6. Import old records as expired or archived based on supplied information.
7. Do not invent missing payment or attendance history.
8. Reconcile counts and totals with the client after import.

## Operational safeguards

- Default member views should focus on active/expiring/outstanding records.
- Expired, archived, and all-record views must remain available.
- Payment and attendance history must be paginated as it grows.
- Sensitive actions require server-side validation and clear confirmation.
- Secrets stay server-only and must not use `NEXT_PUBLIC_` names.
- Application and provider logs must not contain secrets or unnecessary personal data.
- Database migrations are append-only after deployment.
- CSV export and a tested backup/restore process are launch requirements.

## V1 rollout boundary

The required application paths are implemented in the repository. Rollout still requires environment-specific evidence: hosted signup disabled, migrations applied without drift, initial client CSV approved/imported, monitoring configured, and a restore rehearsal completed. The source of truth is [V1_ROLLOUT_CHECKLIST.md](V1_ROLLOUT_CHECKLIST.md); anything outside the approved scope requires explicit approval.

## Verification

Every commit runs:

```bash
npm run check:commit
```

Release or deployment handoff runs:

```bash
npm run check:release
```

Migration changes additionally require Supabase linting and tenant-isolation checks.
