# FitKiro product overview

> Current operating mode (2026-09-05): WhatsApp reminders are owner-triggered only. The cron endpoint is disabled, Cloudflare triggers are commented out, and migration `20260905093000_pause_whatsapp_reminder_cron.sql` removes the Supabase daily job. The scheduling implementation is retained for later; scheduling instructions below describe the paused capability. Deploy the app change and apply the pause migration to pause an existing hosted schedule.

Last reviewed: 2026-08-23

This document defines the intended product boundary. Update it whenever a major user flow, product decision, or scope boundary changes.

## Product direction

FitKiro is currently a minimal, owner-operated gym management application for the first contracted client. It manages members/packages, manual payments/reminders, and QR attendance.

The V1 client has approximately 300 active members and 1,500 total current/historical member records. The existing modular monolith and PostgreSQL database are more than sufficient for this workload.

## Primary actors

- **Gym owner** — the single provisioned application user who manages members, packages, payments, reminders, and attendance.
- **Member** — a gym customer managed by the owner; members do not sign in to V1.

## Current core flows

### Member onboarding

1. An owner signs in and creates a member with contact details.
2. The owner selects a plan, start date, calculated editable end date, charge, discount/tax, and initial payment. New-member validation appears under the relevant field, and activation is disabled until required inputs are valid. Failed enrollment keeps the entered data and selected photo. Intentional shared phones require confirmation and allow up to three member records; archived duplicates offer reactivation.
3. The database creates the member, membership, charge, and optional payment transactionally.
4. QR issuance is optional. It may happen immediately or later from the member list. When a payment receipt exists, the QR pass screen is the owner handoff point for sharing both the pass and latest receipt.

### QR access and attendance

1. FitKiro generates a compact first-party QR URL using a short random code stored on the QR credential row. The QR image itself is not stored.
2. The owner shares the pass PNG manually, including through WhatsApp; one primary action includes the latest payment receipt link with the pass handoff. Receipt history is collapsed below the pass, with pagination and individual sharing for older payments, including clearly labelled reversed receipts. Membership expiry blocks scans without replacing the QR; an enabled pass works again when a renewed membership becomes active and can be reshared with the renewal receipt.
3. An authenticated operator uses the installed Android PWA camera scanner, which reads the QR without navigating to a new browser tab.
4. FitKiro validates tenant ownership, QR version, member state, and active membership on the server.
5. A valid camera scan automatically records Check-in or Check-out and shows a colour-coded result for 30 seconds with sound/vibration feedback. The operator can close it sooner after removing the QR from view. A database-enforced 30-second member cooldown prevents an early close, app refresh, or second device from immediately recording the opposite movement. Directly opening a scan URL remains a confirmation-based fallback and never records attendance on GET.
6. The first scan of a gym business day is a Check-in. Later movements alternate. An immediate correction records the opposite movement as a new audited event rather than rewriting attendance history.
7. After the 30-second result window, Attendance Logs can undo only that member's latest event from the current business day. The original direction and time remain stored with the correction reason, operator, and time. The owner may also create the next sequence-safe movement as a manual replacement.

The installed scanner PWA limits its navigation to Scanner, Attendance, and Sign out. Opening FitKiro as a normal website retains the complete owner dashboard and management navigation.

### Membership and payment operations

- Manage member details and memberships in separate views of the same member page. Profile editing is the default; the Membership view contains renewal and membership history. The shared summary provides direct renewal and collection actions. Unpaid periods appear above the views with their own remaining balances and collection buttons, oldest first. Collection shows the member, membership period, total, paid amount, and remaining balance after the entered payment; it records another payment against that period and opens receipt sharing. Renewal payments apply only to the new period, leaving previous balances separately collectible.
- Record manual payments and outstanding balances.
- Automatically place unpaid membership balances into the partial-payment reminder window seven days after the membership start or renewal start date.
- Produce immutable receipt numbers and signed, member-readable receipt links for individual WhatsApp sharing.
- Reverse incorrect payments with a reason from the authenticated receipt page instead of deleting them. If renewal creation succeeds but its payment step fails, direct the owner back to the existing membership balance and receipts, with an explicit warning not to renew again.
- Open owner-reviewed WhatsApp payment/renewal reminders and record only that the handoff was opened.
- Reminders separates All renewals, Expiring, Expired, and Payment follow-ups. Payment follow-ups defaults to positive balances with a follow-up date today or earlier; Upcoming shows the next seven days. Each unpaid period remains eligible even after renewal, with direct WhatsApp, collection, and follow-up rescheduling actions. Settled balances, archived members, and reverted periods are excluded. Payment filtering and pagination run in PostgreSQL using the existing charge balance view; no new migration is required.
- Optionally submit an idempotent WhatsApp Utility template 7 days before membership expiry and on expiry day for opted-in members without a future renewal, recording submitted, skipped, or failed attempts.

### Daily operations and reporting

- Member, payment, attendance, and reminder lists are filtered, allowlist-sorted, and paginated in PostgreSQL rather than loading the full gym history into a browser request. The member directory defaults to newest-created first so recently enrolled members remain immediately available for QR sharing.
- The dashboard uses database aggregates, so counts remain accurate beyond the Data API row cap.
- Attendance shows today, current occupancy, yesterday's missing Check-outs, and searchable/exportable history.
- Member, payment, and attendance CSV exports are owner-authenticated and reflect the selected operational view.
- Initial client data uses a validated, pre-backed-up, atomic operator-run import rather than a public import screen.

## Product invariants

- Every operational record must remain scoped to the provisioned gym.
- Money is stored as integer paise; display formatting is not the source of truth.
- Applied plans, prices, and membership terms are snapshotted for historical accuracy.
- Attendance and financial activity are append-only or corrected through audited actions. An undone attendance event remains stored but is excluded from operational status, totals, and exports.
- Manual WhatsApp handoffs are never represented as sent or delivered, and QR share tracking records only owner confirmation; automated Cloud API records are labelled submitted until webhook delivery tracking is added.
- Public QR pages expose the minimum information required for the pass.
- Frontend visibility is never the authorization boundary.

## Deliberately out of scope for the current MVP

- Online payment gateways and automatic refunds.
- Bulk WhatsApp campaigns, marketing automation, inbound messaging, and webhook-based delivered/read tracking.
- Full staff invitation/RBAC implementation.
- Multiple physical locations.
- Platform subscription billing and feature entitlements.
- Offline access-control devices.
- Trainer access to personal workout details.
- Microservices, queues, and a general event bus.
- Workout Tracker integration and the multi-tenant organization migration.

## Product source-of-truth documents

- [First-client V1 scope](CLIENT_V1_SCOPE.md)
- [Architecture](ARCHITECTURE.md)
- [QR attendance architecture](qr-attendance-architecture.md)
- [Development and commit checks](DEVELOPMENT.md)
