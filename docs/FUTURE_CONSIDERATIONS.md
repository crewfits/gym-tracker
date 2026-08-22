# Future considerations — not current scope

This file is an uncommitted product-idea archive for possible work after the first-client V1. It is intentionally not referenced by the README, active architecture, development workflow, or agent instructions. Nothing here should influence implementation without an explicit new requirement and commercial scope agreement.

## Possible SaaS evolution

- Rename the technical tenant concept from gym to organization.
- Allow organizations to have multiple locations.
- Add global users with many-to-many organization memberships.
- Add owner, manager, front-desk, and trainer capabilities.
- Add organization invitations, suspension, subscriptions, feature limits, and platform administration.
- Retain a shared database/shared schema with organization IDs, strict RLS, tenant-scoped services, and organization-aware foreign keys.

Possible hierarchy:

```text
Platform
  `-- Organization
        |-- Organization users
        |-- Locations
        |-- Members
        |-- Memberships and payments
        `-- Access and attendance
```

These changes would require additive migrations from `gyms`/`gym_id`, owner backfills into an organization-membership table, capability-aware authorization helpers, isolation tests, and organization/location selectors.

## Possible Workout Tracker integration

The existing Expo Workout Tracker could eventually become the member-facing client. The preferred long-term boundary would use one canonical authenticated user identity while keeping business records and private workout records separate.

```text
Global authenticated user
  |-- organization-owned member link
  |     |-- membership/payment summaries
  |     |-- QR pass
  |     `-- attendance
  `-- user-owned private workout data
```

An admin-created gym member should link to a Workout Tracker user only through a short-lived, single-use invitation accepted after authentication. Never auto-link accounts using only phone or email.

Gym membership should not grant automatic access to routines, weights, progress, or workout history. Trainer visibility would require explicit, scoped, revocable member consent and audit history.

If the applications use different production Supabase projects, integration would first require an identity/data inventory and a staged migration or server-to-server bridge. Service-role keys must never be exposed to the mobile app.

## Possible access enhancements

- Built-in authenticated QR scanner/PWA.
- Member photo verification.
- Configurable business-day rollover for gyms open after midnight.
- Attendance corrections with immutable audit history.
- Location/access-point identifiers.
- Offline-capable access devices.
- Short-lived rotating member passes if measured QR-sharing abuse justifies them.

## Possible payment enhancements

- Online provider checkout.
- Idempotent payment attempts/transactions.
- Signed webhook inbox with unique provider event IDs.
- Refunds, allocations, and reconciliation.
- Member self-service renewal.

Organization SaaS billing would remain separate from member membership payments.

## Possible communication enhancements

- Approved WhatsApp Business provider.
- Member communication consent/preferences.
- Delivery status webhooks.
- Bulk campaigns with audit and opt-out behavior.
- Push notifications and member-app inbox.

## Possible operational enhancements

- Full audit event ledger.
- Advanced analytics and reporting.
- Usage metering and feature entitlements.
- Controlled platform-support access.
- Organization exports, suspension, retention, and delayed deletion.

Do not implement any item in this file as part of the first-client V1.
