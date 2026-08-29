# GymDesk V1 production runbook

Last reviewed: 2026-08-22

## Ownership

- Application deployment, secrets, migrations, owner provisioning, and restore tests: Crewfits/GymDesk delivery team.
- Day-to-day member, payment, reminder, and attendance data: gym owner.
- Hosting and Supabase invoices after the contracted period: client, with credentials handed over through a secure channel.

## Release deployment

1. Run `npm run check:release` on the exact commit.
2. Run `supabase migration list --linked`; stop if local and remote history diverge unexpectedly.
3. Review `supabase db push --linked --dry-run`, take a backup, then apply the pending append-only migrations during the agreed window.
4. Configure production variables from `.env.example`. Do not deploy `GYMDESK_OWNER_PASSWORD`; it is only for the provisioning command.
5. Run `npm run ops:preflight` in the production environment.
6. Deploy the Next.js application, then verify `/api/health` returns HTTP 200.
7. Complete every item in [V1_ROLLOUT_CHECKLIST.md](V1_ROLLOUT_CHECKLIST.md).

## Supabase authentication

- Disable public email signups in the hosted Supabase Authentication settings. Local config already sets `enable_signup = false`, but hosted settings are independent.
- Set the production site URL to the exact HTTPS application origin.
- Add the production password-reset callback to Supabase allowed redirect URLs:

```text
https://gymdesk.gym-tracking-system.workers.dev/auth/callback
```

- Provision the single confirmed owner with:

```bash
GYMDESK_OWNER_PASSWORD='<temporary-strong-password>' npm run owner:provision -- --email=owner@example.com --gym-name="Client Gym"
```

- Share the temporary password separately and rotate it after handoff.
- Disable or restore owner access with `npm run owner:access -- --email=owner@example.com --active=false|true`.

## Secrets

- `SUPABASE_SERVICE_ROLE_KEY` and `QR_SIGNING_SECRET` are server-only.
- Keep `QR_SIGNING_SECRET` stable and at least 32 bytes. Rotation invalidates every issued QR.
- Restrict deployment-project access and enable MFA for provider accounts.
- Never put service keys, exports, backups, client CSVs, screenshots, or personal data in Git or issue comments.

## Monitoring and incident response

- Monitor the production URL and `/api/health` every five minutes. Alert after two consecutive failures.
- Review Vercel application errors and Supabase database/auth health daily during the first free-support month, then weekly.
- For a suspected credential leak, rotate the affected provider key, redeploy, and verify health. If the QR secret leaked, rotate it and notify the owner that all member QRs must be regenerated.
- For incorrect payment records, use the audited reversal flow. Never delete payment or attendance history directly.
- For owner lockout, verify identity, reset through Supabase Admin, and record who authorized the reset.

## Backups

Provider-managed database backups are the primary disaster-recovery copy because they also cover managed Supabase state. Confirm the actual retention shown by the selected Supabase plan before launch.

Additionally:

```bash
npm run data:backup -- --gym-id=<gym-uuid> --output=/secure/path/gym-snapshot.json
supabase db dump --linked --file=/secure/path/public-schema.sql
supabase db dump --linked --data-only --use-copy --file=/secure/path/public-data.sql
supabase storage cp --linked --recursive ss:///member-photos /secure/path/member-photos
```

- Take the gym snapshot before imports and material support changes.
- Take encrypted schema/data dumps weekly and before every migration.
- Export the private `member-photos` bucket with the same retention as database dumps when profile photos are enabled.
- Keep at least four weekly copies in storage separate from the application and database providers.
- The JSON snapshot is a support/reconciliation artifact, not the sole disaster-recovery mechanism.

## Restore rehearsal

Once before launch and quarterly thereafter:

1. Create an isolated non-production Supabase project or local Supabase stack.
2. Apply the repository migrations in order.
3. Restore the approved SQL data dump with `psql` using the isolated database connection.
4. Restore or create a test auth owner and link its `owner_id` only in the isolated environment.
5. Verify member counts, outstanding totals, receipts, QR metadata, member-photo object counts, and attendance counts against the backup report.
6. Run the smoke scenarios without contacting real members.
7. Record the date, operator, backup timestamp, result, duration, and any corrective action in the release issue.

Do not run a restore against production unless the incident owner has approved the exact target and a new pre-restore backup exists.
