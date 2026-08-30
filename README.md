# FitKiro

FitKiro is the minimal owner-operated application for the first contracted gym client: member/package management, manual payment and WhatsApp follow-up, and versioned QR entry/exit attendance.

## V1 capabilities

- Provisioned single-owner authentication with gym-level RLS and disabled-access states
- Paginated member directory for approximately 1,500 current/historical records
- Plans, membership history, renewals, archive views, and timezone-correct status
- Full/partial manual payments, due dates, immutable receipts, and audited reversals
- Due, overdue, and expiring queues with individual prefilled WhatsApp messages
- Versioned QR generate/share/regenerate/disable without storing QR images or tokens
- Confirmed entry/exit, daily reset, missed-exit indication, occupancy, history, and CSV export
- Controlled atomic initial CSV import, operational exports, and backup/runbook tooling

## Local setup

1. Use Node.js 22.13 or newer and run `npm install`.
2. Copy `.env.example` to `.env.local` and configure the linked Supabase project and a stable 32-byte-or-longer `QR_SIGNING_SECRET`.
3. Apply every ordered migration with a reviewed `supabase db push`.
4. Disable public email signup in hosted Supabase Authentication; local Supabase already has signup disabled.
5. Provision the owner account:

```bash
FITKIRO_OWNER_PASSWORD='<temporary-strong-password>' npm run owner:provision -- --email=owner@example.com --gym-name="Client Gym"
```

6. Start with `npm run dev`. For mobile QR testing through ngrok, use `npm run dev:tunnel`.

The QR PNG and signed token are generated on demand. Only a credential version and enabled state are persisted. Changing `QR_SIGNING_SECRET` invalidates all previously shared member QRs.

## Commands

```bash
npm run check:commit
npm run check:release
npm run owner:access -- --email=owner@example.com --active=false
npm run data:backup -- --gym-id=<uuid> --output=/secure/path/backup.json
npm run data:import -- --gym-id=<uuid> --file=/absolute/path/members.csv
```

The import command is a dry run unless `--apply` is explicitly supplied. See [controlled import](docs/INITIAL_IMPORT.md).

## Documentation

- [First-client V1 scope](docs/CLIENT_V1_SCOPE.md)
- [Product overview](docs/PRODUCT_OVERVIEW.md)
- [Architecture](docs/ARCHITECTURE.md)
- [QR attendance architecture](docs/qr-attendance-architecture.md)
- [Development workflow](docs/DEVELOPMENT.md)
- [Production runbook](docs/PRODUCTION_RUNBOOK.md)
- [V1 rollout checklist](docs/V1_ROLLOUT_CHECKLIST.md)

Receipt email remains an optional existing convenience when Resend is configured. V1 membership/payment reminders are manual WhatsApp click-to-chat actions; FitKiro does not use a WhatsApp API and never claims message delivery.
