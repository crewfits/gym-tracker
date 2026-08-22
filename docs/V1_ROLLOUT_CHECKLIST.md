# First-client V1 rollout checklist

Last reviewed: 2026-08-22

Record evidence and the tester for every item in the release issue. A failed required item blocks rollout.

## Release and infrastructure

- [ ] Exact release commit passes `npm run check:release`.
- [ ] Local/remote migration history is reconciled and the dry-run contains only reviewed migrations.
- [ ] Pre-migration backup exists in protected storage.
- [ ] Production environment passes `npm run ops:preflight`.
- [ ] Production URL and `/api/health` return successfully over HTTPS.
- [ ] Security headers include no-referrer, no-sniff, frame denial, permissions policy, and HSTS.
- [ ] Monitoring, alert recipient, support contact, and provider billing owner are recorded.
- [ ] A restore rehearsal has passed and its evidence is linked.

## Authentication and isolation

- [ ] Hosted Supabase public signup is disabled.
- [ ] Provisioned owner can sign in; there is no create-account UI.
- [ ] Authenticated user without a gym sees access-not-configured.
- [ ] Disabled owner sees access-disabled and cannot read/write gym data through the API.
- [ ] Cross-gym IDs are denied by RLS for members, finance, reminders, QR credentials, and attendance.

## Members, plans, and import

- [ ] Member directory defaults to non-archived records and paginates at 50 rows.
- [ ] Search and active, expiring, expired, outstanding, archived, and all views return correct totals beyond 1,000 rows.
- [ ] Future renewal does not hide the currently active membership.
- [ ] Archive preserves history and prevents QR/reminder actions.
- [ ] Initial CSV dry run has zero invalid rows and approved counts/balances.
- [ ] Apply creates a pre-import snapshot and the final reconciliation passes.

## Payments and reminders

- [ ] Full and partial payment balances use integer-paise calculations.
- [ ] Every charge has a visible/editable due date.
- [ ] Due-today, overdue, and expiring queues are correct in the gym timezone.
- [ ] Opening a reminder creates an `opened` WhatsApp audit event and never claims sent/delivered.
- [ ] Prefilled payment and renewal messages use the configured templates and correct member phone.
- [ ] Payment reversal retains the original receipt and updates balances/exports.

## QR attendance

- [ ] Create member with QR enabled and with QR skipped both succeed.
- [ ] Current QR PNG can be shared/downloaded; no image or signed token is stored in the database.
- [ ] Regeneration invalidates the previous version; disable, archived, expired, invalid, and cross-gym passes are denied.
- [ ] Scanning only opens review; a POST confirmation records movement.
- [ ] First movement today suggests entry, second suggests exit, and manual override remains available.
- [ ] A missed prior-day exit appears as an open entry but today still starts with entry.
- [ ] Rapid duplicate submissions are suppressed/idempotent.
- [ ] Today, inside, missed-exit, history, search, direction, pagination, and attendance CSV export are correct.

## Exports and handoff

- [ ] Current/all/archived member CSV exports open correctly in spreadsheet software.
- [ ] Filtered payments and attendance CSV exports match on-screen totals.
- [ ] Owner receives the production URL, credential rotation guidance, and minimal operating guide.
- [ ] Client accepts the imported counts and the three contracted workflows.
- [ ] Known non-blocking limitations and the support/warranty dates are recorded.
