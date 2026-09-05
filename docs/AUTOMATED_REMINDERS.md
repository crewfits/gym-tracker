# Automated WhatsApp payment reminders

> Current operating mode (2026-09-05): WhatsApp reminders are individual owner-reviewed click-to-chat only. The bulk Meta send button, automated Server Actions, and automation settings UI are commented out; saving Settings preserves existing Supabase reminder configuration. The cron endpoint is disabled, Cloudflare triggers are commented out, and migration `20260905093000_pause_whatsapp_reminder_cron.sql` removes the Supabase daily job. The scheduling implementation is retained for later; scheduling instructions below describe the paused capability. Deploy the app change and apply the pause migration to pause an existing hosted schedule.

FitKiro can submit one approved WhatsApp Utility template for memberships approaching expiry. Automation is opt-in at both gym and member level, uses Meta WhatsApp Cloud API directly, records submitted/skipped/failed attempts, and will not submit the same membership/rule reminder twice for the same scheduled date.

Manual `wa.me` reminders remain available at no platform cost. Automated reminders are limited to individual membership-expiry renewal/payment follow-ups; outstanding-balance collection, bulk campaigns, and marketing automation are not included.

## Required deployment secrets

```text
WHATSAPP_ACCESS_TOKEN=<Meta system-user token>
WHATSAPP_PHONE_NUMBER_ID=<sending phone number ID>
WHATSAPP_GRAPH_API_VERSION=v25.0
CRON_SECRET=<long-random-value>
SUPABASE_SERVICE_ROLE_KEY=<server-only Supabase key>
```

Never prefix these values with `NEXT_PUBLIC_`.

## Meta authentication setup

1. Create or select the gym's Meta Business Portfolio and complete business verification when Meta requests it.
2. Create a **Business** app in Meta for Developers and add the **WhatsApp** product.
3. In WhatsApp API Setup, connect the production sending number and note its **Phone number ID**. Add billing in WhatsApp Manager before production sends.
4. In **Business Settings → Users → System users**, create an admin system user, assign the Meta app and WhatsApp account, then generate a non-expiring token with `whatsapp_business_messaging`. Add `whatsapp_business_management` only if this integration will manage templates through the API.
5. Store the token and Phone number ID as Cloudflare Worker secrets. Store the same `CRON_SECRET` in both Cloudflare and Supabase Vault. Never put these values in Git, browser code, or a `NEXT_PUBLIC_` variable.
6. Use Meta's temporary token/test number only for initial sandbox testing; replace both with the production system-user token and sending number before enabling Cron.

## Required Meta template

Create and obtain approval for a Utility template named `membership_payment_reminder` (or save the approved name in FitKiro Settings). Its language code and parameter order must match the application:

```text
Hi {{1}}, your {{3}} membership at {{2}} expires on {{4}}.
Please complete your renewal payment to continue without interruption.
```

Parameter order:

1. Member name
2. Gym name
3. Plan name
4. Membership expiry date

Do not add promotions, offers, or unrelated content; Meta may classify that as Marketing rather than Utility.

## Daily schedule

Production uses Supabase `pg_cron` plus `pg_net` to call the secured app endpoint:

- Schedule: `0 3 * * *` (03:00 UTC / 08:30 Asia/Kolkata)
- Target: the existing secured `/api/cron/reminders` route
- Vault secret names: `fitkiro_app_url` and `fitkiro_cron_secret`

The database migration creates or updates the `fitkiro_payment_reminders_daily` cron job. The job reads `fitkiro_app_url` and `fitkiro_cron_secret` from Supabase Vault at runtime, then posts to the Next.js route with `Authorization: Bearer <CRON_SECRET>`. If either Vault secret is missing, the cron function logs a warning and does not call the app.

The endpoint calculates each enabled gym's local date. It processes only active memberships expiring either 7 days from that local date or on that local date, skips members already renewed into a future membership, and does not send reminders for outstanding balances or historical overdue charges.

Current production rules:

1. 7 days before membership expiry.
2. On the membership expiry date.

The `reminder_rules.days_before` table keeps this configurable at the database layer. The app intentionally processes only `7` and `0` for V1 so old default rules such as `3` or `1` days cannot accidentally send. Future outstanding-amount or other payment reminder types should add an explicit rule type/channel contract before being enabled.

Use this SQL in Supabase SQL Editor after choosing the final production values:

```sql
select vault.create_secret('https://musclefitness.fitkiro.com', 'fitkiro_app_url');
select vault.create_secret('<same value as Cloudflare CRON_SECRET>', 'fitkiro_cron_secret');
```

If a secret already exists, delete or rotate that named Vault secret in the Supabase dashboard before creating the replacement. Do not paste the Meta access token into Supabase Vault; only Cloudflare needs it.

## Enable and verify

1. Apply the latest Supabase migration.
2. Configure Meta billing, the approved template, production secrets in Cloudflare, and the two Supabase Vault secrets above.
3. Configure the exact template name/language in the gym record, then enable automatic WhatsApp reminders in FitKiro Settings.
4. Record member consent on the member profile.
5. Ensure the test member has an active membership expiring either 7 days from today or today, with no future renewal already created.
6. Use **Send due WhatsApp reminders** once.
7. Review **Automatic WhatsApp reminders** for submitted, skipped, or failed attempts.

The manual button and Cron use the same idempotent engine. A database claim token prevents two workers from submitting the same membership/rule/date/channel at once. Failed attempts may be retried on the scheduled date; submitted and skipped attempts are not duplicated. A submitted status means Meta accepted the API request. Delivered/read status requires webhook handling and is not claimed by this version.

Check scheduled executions in **Supabase Dashboard → Database → Cron Jobs** and `net._http_response`. Cloudflare Observability shows the corresponding app request. The reminder delivery table in FitKiro remains the business-level audit log.
