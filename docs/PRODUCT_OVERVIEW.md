# GymDesk product overview

Last reviewed: 2026-08-23

This document defines the intended product boundary. Update it whenever a major user flow, product decision, or scope boundary changes.

## Product direction

GymDesk is currently a minimal, owner-operated gym management application for the first contracted client. It manages members/packages, manual payments/reminders, and QR attendance.

The V1 client has approximately 300 active members and 1,500 total current/historical member records. The existing modular monolith and PostgreSQL database are more than sufficient for this workload.

## Primary actors

- **Gym owner** — the single provisioned application user who manages members, packages, payments, reminders, and attendance.
- **Member** — a gym customer managed by the owner; members do not sign in to V1.

## Current core flows

### Member onboarding

1. An owner signs in and creates a member with contact details.
2. The owner may attach a private compressed profile photo for later operator verification.
3. The owner selects a plan, start date, calculated editable end date, charge, discount/tax, and initial payment.
4. The database creates the member, membership, charge, and optional payment transactionally.
5. QR issuance is optional. It may happen immediately or later from the member list.

### QR access and attendance

1. GymDesk generates a compact first-party QR URL using a short random code stored on the QR credential row. The QR image itself is not stored.
2. The owner shares the pass link or PNG manually, including through WhatsApp.
3. After the handoff, the owner can mark the current QR as shared so the member list shows who still needs a QR handoff.
4. An authenticated operator scans the member's QR.
5. GymDesk validates tenant ownership, QR version, member state, and active membership.
6. The operator explicitly confirms Check-in or Check-out; opening the URL never records attendance.
7. The first confirmed scan of a gym business day is a Check-in. Later movements alternate, with a manual override for missed scans.

### Membership and payment operations

- Create and renew memberships.
- Record manual payments and outstanding balances.
- Automatically place unpaid membership balances into the partial-payment reminder window seven days after the membership start or renewal start date.
- Produce immutable receipt numbers and signed, member-readable receipt links for individual WhatsApp sharing.
- Void incorrect payments with a reason instead of deleting them.
- Open owner-reviewed WhatsApp payment/renewal reminders and record only that the handoff was opened.

### Daily operations and reporting

- Member, payment, and attendance lists are filtered and paginated in PostgreSQL rather than loading the full gym history into a browser request.
- The dashboard uses database aggregates, so counts remain accurate beyond the Data API row cap.
- Attendance shows today, current occupancy, yesterday's missing Check-outs, and searchable/exportable history.
- Member, payment, and attendance CSV exports are owner-authenticated and reflect the selected operational view.
- Initial client data uses a validated, pre-backed-up, atomic operator-run import rather than a public import screen.

## Product invariants

- Every operational record must remain scoped to the provisioned gym.
- Money is stored as integer paise; display formatting is not the source of truth.
- Applied plans, prices, and membership terms are snapshotted for historical accuracy.
- Attendance and financial activity are append-only or corrected through audited actions.
- WhatsApp handoffs are never represented as sent or delivered without a provider API; QR share tracking records only a manual owner confirmation.
- Public QR pages expose the minimum information required for the pass.
- Member photos are private operational data and are not shown on public pass or receipt pages.
- Frontend visibility is never the authorization boundary.

## Deliberately out of scope for the current MVP

- Online payment gateways and automatic refunds.
- WhatsApp Business API and bulk messaging.
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
