# Client handover load-test plan

Use this plan before first-client handover to verify that FitKiro remains usable with realistic data volume, staff roles, membership states, payments, reminders, QR scanning, pagination, and cleanup.

## Goals

The handover test should answer these questions:

- Can the owner operate the product with 1,500 members without slow or broken screens?
- Do member list, attendance, transactions, reminders, denied attempts, and staff screens still paginate, search, and filter correctly?
- Do role restrictions match the intended scope for owner, trainer, and receptionist?
- Can activation and renewal payments be recorded clearly, including split payment methods?
- Can expired QR access attempts be reviewed without changing occupancy or attendance totals?
- Can all synthetic data be safely removed after testing?

## Synthetic gym shape

The load-test seed creates a separate gym named `FitKiro Load Test <run-id>` and refuses cleanup for gyms that do not use that prefix.

Default volume:

- 1 admin account.
- 1 owner account.
- 5 trainer accounts.
- 1 receptionist account.
- 1,500 members.
- 600 currently active memberships.
- Active memberships spread across monthly, quarterly, half-year, and annual plans.
- A subset of active members expiring in 0-7 days for reminder and renewal testing.
- Expired, upcoming, and archived members for filter and edge-case testing.
- Full, partial, split, and unpaid payment states across cash, UPI, card, and bank transfer.
- Attendance entries for active members.
- Denied-attempt entries for expired QR scans.
- Reminder delivery rows for expiring memberships.

## Commands

Make sure `.env.local` points to the intended Supabase project and includes `SUPABASE_SERVICE_ROLE_KEY`. Apply migrations first.

Seed data:

```bash
npm run testdata:load:seed -- --confirm --members=1500 --active=600 --run-id=client-v1
```

The seed prints JSON and writes a manifest such as:

```text
tmp/load-test-client-v1.json
```

Use the emails and password in that manifest for manual role testing. The default password is `FitKiroLoadTest#2026`; override it with `--password=<value>` if needed.

Cleanup after testing:

```bash
npm run testdata:load:cleanup -- --confirm --manifest=tmp/load-test-client-v1.json
```

If the manifest is missing but the gym ID is known:

```bash
npm run testdata:load:cleanup -- --confirm --gym-id=<load-test-gym-id> --run-id=client-v1
```

Cleanup deletes the load-test gym and the generated auth users. It refuses to delete any gym whose name does not start with `FitKiro Load Test `.

## Manual test pass

Open these sessions in separate normal/incognito browser windows:

- Admin.
- Owner.
- Trainer 1.
- Trainer 2 or Trainer 3.
- Receptionist.

### Admin checks

- Admin can access owner-level screens plus admin-only feature flags.
- Admin can see admin users where owner-specific staff screens intentionally hide them.
- Admin can verify feature flags without exposing those controls to owner, trainer, or receptionist.

### Owner checks

- Dashboard loads and cards look correct with 1,500 members and 600 active memberships.
- Dashboard financial widgets show payment mix without visual overflow.
- Members list paginates, searches by name/member code/phone, filters by active/expired/upcoming/archived, and opens member detail.
- Add member validation shows messages below fields and keeps entered data after failed submit.
- Activate and renew membership allow trainer assignment and handled-by staff selection.
- Split payment entries are visible on the member receipt and transactions view.
- Transactions view filters by method, date, search, and handled-by staff.
- Attendance logs and denied attempts paginate and filter correctly.
- Expired QR scans create repeated denied-attempt rows for fresh scans and do not affect occupancy.
- Staff screen hides admin users from owner, allows trainer/receptionist management, and does not allow owner rows to be modified.
- CSV export buttons are visible only where owner should have them.

### Trainer checks

- Trainer can view the dashboard scope intended for staff.
- Trainer can add members, activate memberships, renew memberships, share receipts, and use the QR scanner.
- Trainer can see transaction/payment workflows needed to support renewal and activation.
- Trainer cannot export CSV data.
- Trainer cannot access staff management, settings, plans, or admin-only feature flags.

### Receptionist checks

- Receptionist can add members, share receipts, and use QR scanning.
- Receptionist can see operational member counts but not financial dashboard cards.
- Receptionist cannot access transactions, exports, staff management, settings, plans, or admin-only feature flags.
- Direct route entry for blocked pages shows the access-denied state instead of data.

### QR and scanner checks

- Webcam scanner fits desktop and mobile widths.
- Success and failure sound settings work and persist without restarting the camera while changing result timer.
- Active member QR produces check-in/check-out feedback.
- Expired member QR produces a denied result and a new denied-attempt row for each fresh scan.
- Invalid, disabled, replaced, archived, and cross-gym QR codes remain denied without attendance changes.

## Performance notes

Record rough timings from browser devtools or the browser status bar for the first load and for repeated navigation. Focus on user-visible performance rather than synthetic request counts.

Recommended acceptance targets for first-client handover:

- Main dashboard usable within 3 seconds on a normal broadband connection.
- Members list first page usable within 2 seconds.
- Search and filters respond within 1 second after the request completes.
- Transactions and attendance pages keep pagination stable at high row counts.
- No screen should require loading all 1,500 members into a dropdown except staff-sized dropdowns such as trainer assignment.

If a screen exceeds these targets, capture the route, active filters, network request duration, and screenshot before cleanup.

## Other handover checks

Before giving the build to the client, also complete:

- Run `npm run check:release` locally.
- Run Supabase dry-run and deployment commands against the intended project.
- Verify RLS with at least one blocked direct route for trainer and receptionist.
- Verify owner/admin login recovery and staff invite/provisioning flow.
- Take a production backup before any real client data import.
- Confirm Cloudflare environment variables match `.env.local` names without exposing service-role keys to the browser.
- Verify mobile layout for login, add member, member profile, scanner, dashboard, and receipt share.
- Verify empty states by creating a second small disposable gym or using filters that return no rows.
- Verify cleanup by running the cleanup command and confirming the load-test gym, members, memberships, payments, QR credentials, attendance, denied attempts and generated auth users are gone.

## Scanner endpoint load run

Use this after the main seed when you want to exercise the same Supabase RPC that the camera scanner uses to create attendance and expired-member denied attempts. This is useful for validating the expected first-client scale: 600 active members scanning twice per day is about 1,200 scans per day and roughly 36,000-40,000 attendance rows per month.

The scanner-load script signs in as one of the generated staff users, reads active QR-enabled members from the load-test gym, and calls `process_qr_access` with unique request IDs. It runs entries first and then exits as the member list cycles, so each member has enough time between entry and exit to avoid the normal 30-second accidental rescan cooldown. It can also expire a subset of memberships during the run so later scans create denied-attempt rows instead of attendance rows.

Run a quick dry-run shape check:

```bash
npm run testdata:scanner-load -- --confirm --dry-run --manifest=tmp/load-test-client-v1.json --duration-minutes=1 --scans=10
```

Run a realistic one-hour load:

```bash
npm run testdata:scanner-load -- --confirm --manifest=tmp/load-test-client-v1.json --duration-minutes=60 --scans=1200 --expire-after=600 --expire-count=30 --scanner-role=trainer
```

Run a two-hour load:

```bash
npm run testdata:scanner-load -- --confirm --manifest=tmp/load-test-client-v1.json --duration-minutes=120 --scans=2400 --expire-after=1200 --expire-count=60 --scanner-role=trainer
```

The script prints progress every 100 scans and writes a JSON report in `tmp/scanner-load-<run-id>-<timestamp>.json` with recorded, denied, failed, duplicate, and latency counts. Keep that report with handover evidence if performance looks acceptable.

Recommended acceptance points:

- Failed scans should be zero. A denied scan is expected only after the script intentionally expires members mid-run.
- p95 RPC latency should stay comfortably below 1 second for this synthetic first-client volume.
- Attendance row count should increase by the recorded count in the report.
- Denied-attempt row count should increase after the configured expiry point.
- Dashboard occupancy should still make sense after the run. If you run an entry-only or interrupted load, occupancy can remain high until exit scans are created.

After scanner-load testing, use the normal cleanup command from this document. The cleanup removes the seeded gym and all generated attendance/denied rows through the gym cascade, plus the generated auth users.

## First scanner-load evidence — 2026-09-12

Environment: Supabase project from local `.env.local`, load-test gym `FitKiro Load Test client-v1-admin-2`.

Run command:

```bash
npm run testdata:scanner-load -- --confirm --manifest=tmp/load-test-client-v1-admin-2.json --duration-minutes=60 --scans=1200 --expire-after=600 --expire-count=30 --scanner-role=trainer --progress-every=10
```

Report file:

```text
tmp/scanner-load-client-v1-admin-2-1789215298109.json
```

Database metrics snapshot:

```text
tmp/first-scanner-load-metrics.json
```

Result summary:

| Metric | Result |
| --- | ---: |
| Planned scans | 1,200 |
| Active members sampled | 600 |
| Memberships expired mid-run | 30 |
| Scanner recorded responses | 1,170 |
| Scanner denied responses | 30 |
| Scanner failed responses | 0 |
| Cooldown duplicate responses | 17 |
| New attendance rows during run | 1,153 |
| New denied-attempt rows during run | 30 |
| Entry rows during run | 600 |
| Exit rows during run | 553 |
| Denied reason | `membership_expired` × 30 |

Latency from the scanner-load report:

| Latency | Milliseconds |
| --- | ---: |
| Minimum | 170 |
| p50 | 196 |
| p95 | 482 |
| p99 | 842 |
| Maximum | 3,829 |

Post-run database shape for the load-test gym:

| Table/measure | Count |
| --- | ---: |
| Members | 1,500 |
| Memberships | 1,500 |
| Active memberships after mid-run expiry | 570 |
| QR credentials | 1,095 |
| Attendance events total | 1,713 |
| Denied attempts total | 150 |

Assessment: the one-hour scanner-load run completed without failed scan requests. The 17 duplicate responses are expected from the database scanner cooldown: `process_qr_access` returned the existing cooldown-protected attendance event instead of inserting a new row. The difference between 1,170 recorded responses and 1,153 new attendance rows matches those 17 duplicates. The 30 denied responses match the 30 memberships intentionally expired mid-run and were persisted as `membership_expired` denied attempts.

Follow-up observations for handover: keep pagination checks on Attendance and Denied attempts after this run, because the database now includes more than a normal seed volume. For larger soak testing, increase `--duration-minutes` and `--scans`, but keep `--progress-every` small enough to confirm the run is moving.
