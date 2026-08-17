# GymDesk

A responsive, owner-operated gym membership and payment tracker built with Next.js, Supabase, and Resend.

## Included

- Owner authentication and gym-level row security
- Members, plans, enrollment, renewals, and full membership history
- Partial payments, outstanding balances, immutable receipts, and void-with-reason corrections
- Optional per-membership GST and integer-paise accounting
- Dashboard metrics, search, filters, printable receipts, and receipt email
- Configurable, idempotent expiry reminder emails

## Local setup

1. Use Node.js 22 or newer.
2. Create a Supabase project and run `supabase/migrations/001_initial_schema.sql` in its SQL editor.
3. Copy `.env.example` to `.env.local` and fill in Supabase, Resend, cron, and application URL values.
4. In Supabase Authentication, configure the site URL and decide whether new accounts require email confirmation.
5. Run `npm run dev`, create the owner account, then add membership plans.

The app automatically creates the single gym profile and default 7/3/1-day reminder rules on first authenticated use. `supabase/seed.sql` is an optional starter-plan seed and must be run in an authenticated SQL context or adapted with a gym ID.

## Verification

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

## Deployment

Deploy to Vercel and set every variable from `.env.example`. `vercel.json` schedules `/api/cron/reminders` daily at 02:30 UTC (08:00 IST). Vercel sends the cron secret as a bearer token when `CRON_SECRET` is configured. Use a verified Resend sender domain in `RESEND_FROM_EMAIL`.

The service-role key is used only by the secured cron route and must never use the `NEXT_PUBLIC_` prefix. Database RLS restricts interactive records to the authenticated gym owner.
