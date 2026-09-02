# Automated WhatsApp payment reminders

FitKiro can submit one approved WhatsApp Utility template on a charge's `due_on` date. Automation is opt-in at both gym and member level, uses Meta WhatsApp Cloud API directly, records submitted/skipped/failed attempts, and will not submit the same charge reminder twice for the same date.

Manual `wa.me` reminders remain available at no platform cost. Automated reminders are limited to individual payment follow-ups; bulk campaigns and marketing automation are not included.

## Required deployment secrets

```text
WHATSAPP_ACCESS_TOKEN=<Meta system-user token>
WHATSAPP_PHONE_NUMBER_ID=<sending phone number ID>
WHATSAPP_GRAPH_API_VERSION=v23.0
CRON_SECRET=<long-random-value>
SUPABASE_SERVICE_ROLE_KEY=<server-only Supabase key>
```

Never prefix these values with `NEXT_PUBLIC_`.

## Meta authentication setup

1. Create or select the gym's Meta Business Portfolio and complete business verification when Meta requests it.
2. Create a **Business** app in Meta for Developers and add the **WhatsApp** product.
3. In WhatsApp API Setup, connect the production sending number and note its **Phone number ID**. Add billing in WhatsApp Manager before production sends.
4. In **Business Settings → Users → System users**, create an admin system user, assign the Meta app and WhatsApp account, then generate a non-expiring token with `whatsapp_business_messaging`. Add `whatsapp_business_management` only if this integration will manage templates through the API.
5. Store the token and Phone number ID as Cloudflare Worker secrets. Never put them in Git, browser code, or a `NEXT_PUBLIC_` variable.
6. Use Meta's temporary token/test number only for initial sandbox testing; replace both with the production system-user token and sending number before enabling Cron.

## Required Meta template

Create and obtain approval for a Utility template named `fitkiro_payment_follow_up` (or save the approved name in FitKiro Settings). Its language code and parameter order must match the application:

```text
Hi {{1}}, this is a payment reminder from {{2}} for your {{3}} membership.
Outstanding balance: {{4}}.
Payment follow-up date: {{5}}.
```

Parameter order:

1. Member name
2. Gym name
3. Plan name
4. Outstanding amount
5. Follow-up date

Do not add promotions, offers, or unrelated content; Meta may classify that as Marketing rather than Utility.

## Daily schedule

Production uses a Cloudflare Cron Trigger declared in `wrangler.jsonc`:

- Schedule: `0 3 * * *` (03:00 UTC / 08:30 Asia/Kolkata)
- Worker entrypoint: `custom-worker.ts`
- Target: the existing secured `/api/cron/reminders` route

The scheduled handler invokes the Next.js route internally with `CRON_SECRET`. Deploying with Wrangler creates or updates the trigger; Cloudflare notes that trigger changes can take up to 15 minutes to propagate. Supabase `pg_cron` and `pg_net` are not required.

The endpoint calculates each enabled gym's local date. It processes only outstanding charges whose follow-up date is that date. Historical overdue balances are not sent in bulk when automation is enabled.

## Enable and verify

1. Apply the latest Supabase migration.
2. Configure Meta billing, the approved template, and production secrets in Cloudflare.
3. In FitKiro Settings, save the exact template name/language and enable automatic WhatsApp reminders.
4. Record member consent on the member profile.
5. Ensure the member has an outstanding charge due today.
6. Use **Send due WhatsApp reminders** once.
7. Review **Automatic WhatsApp reminders** for submitted, skipped, or failed attempts.

The manual button and Cron use the same idempotent engine. Failed attempts may be retried on the scheduled date; submitted and skipped attempts are not duplicated. A submitted status means Meta accepted the API request. Delivered/read status requires webhook handling and is not claimed by this version.

Check scheduled executions in **Cloudflare Dashboard → Workers & Pages → fitkiro → Observability → Events**. The reminder delivery table in FitKiro remains the business-level audit log.
