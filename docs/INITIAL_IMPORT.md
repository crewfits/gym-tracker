# Controlled first-client member import

Last reviewed: 2026-08-22

The initial CSV import is an operator-run onboarding procedure, not a client-facing feature. It validates the complete file before any write, creates a pre-import gym snapshot, and sends all valid rows through one database transaction. If any database row fails, the whole batch rolls back.

## Prerequisites

1. Apply migrations through `009_controlled_member_import.sql` or later.
2. Provision the gym and create every plan name referenced by the client file.
3. Put the linked project URL and service-role key in `.env.local`. Never send that file to the client.
4. Copy [initial-import-template.csv](initial-import-template.csv) and replace the sample rows.

## Column contract

- `name`, `phone`, and `is_archived` are required for every row.
- `allow_shared_phone=true` is required on every intentional duplicate-phone row.
- A non-archived member requires `plan_name`, membership dates, `due_on`, and `charge_total`.
- An archived member may omit all membership fields when the source has no reliable commercial history.
- `paid_amount` is optional. When it is greater than zero, `payment_method` and `payment_date` are required. GymDesk records one explicitly labelled controlled-import payment; it does not fabricate historical installments.
- Dates use `YYYY-MM-DD`; amounts use rupees with at most two decimals.
- Plan names must exactly match a configured gym plan, ignoring letter case.

## Dry run and approval

```bash
npm run data:import -- --gym-id=<gym-uuid> --file=/absolute/path/members.csv
```

The command writes a private `members.csv.report.json` containing invalid rows, duplicate phones, warnings, and counts. Resolve every invalid row and obtain client approval for active/archived counts and opening balances before applying.

## Atomic apply

```bash
npm run data:import -- --gym-id=<gym-uuid> --file=/absolute/path/members.csv --apply
```

Apply is blocked while validation issues remain. A timestamped pre-import JSON support snapshot is written next to the CSV before the single atomic database call. Use `--backup=/secure/path/pre-import.json` and `--report=/secure/path/import-report.json` to choose protected locations.

## Reconciliation

- Match imported, active, archived, and invalid counts to the approved report.
- Compare plan counts and total outstanding balance to the client source.
- Spot-check at least five active, five archived, two shared-phone, and two partial-payment rows.
- Confirm imported members have no invented QR or attendance events.
- Store the approved source, report, and pre-import snapshot in encrypted project storage, not in Git.
