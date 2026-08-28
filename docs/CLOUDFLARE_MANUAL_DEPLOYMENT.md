# Cloudflare manual deployment

Last reviewed: 2026-08-28

This file is the step-by-step checklist for manually deploying GymDesk to Cloudflare Workers Free.

GitHub pushes do not deploy the app. Production changes go live only when someone runs the Cloudflare deploy command.

## Current production target

- Provider: Cloudflare Workers Free
- Worker name: `gymdesk`
- URL: `https://gymdesk.gym-tracking-system.workers.dev`
- Database/Auth: Supabase hosted project configured through Worker secrets
- Deployment mode: manual local deploy through Wrangler

## One-time setup

These should already be done for the current deployment:

1. Log in to Cloudflare locally:

   ```bash
   npx wrangler login
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Confirm `.env.local` has the required production values:

   ```env
   NEXT_PUBLIC_APP_URL=https://gymdesk.gym-tracking-system.workers.dev
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   QR_SIGNING_SECRET=...
   NEXT_PUBLIC_DEFAULT_COUNTRY_CODE=91
   ```

   Optional email receipt variables:

   ```env
   RESEND_API_KEY=...
   RESEND_FROM_EMAIL=...
   ```

4. Upload or update Cloudflare Worker secrets when a value changes:

   ```bash
   npx wrangler secret bulk
   ```

   Do not commit `.env.local`, service-role keys, QR secrets, CSV imports, or backups.

## Before every deployment

1. Make sure the working tree contains only the intended changes:

   ```bash
   git status --short --branch
   ```

2. Run the full release gate:

   ```bash
   npm run check:release
   ```

3. Run production env preflight with the deployed URL:

   ```bash
   env NEXT_PUBLIC_APP_URL=https://gymdesk.gym-tracking-system.workers.dev node --env-file=.env.local scripts/check-production-env.mjs
   ```

4. If database migrations changed, verify and apply them before deploying app code:

   ```bash
   supabase migration list --linked
   supabase db push --linked --dry-run
   supabase db push --linked
   ```

5. For risky changes, take a backup before deploy:

   ```bash
   npm run data:backup -- --gym-id=<gym-uuid> --output=/secure/path/gym-snapshot.json
   supabase db dump --linked --file=/secure/path/public-schema.sql
   supabase db dump --linked --data-only --use-copy --file=/secure/path/public-data.sql
   ```

## Deploy

Run:

```bash
npm run deploy:cloudflare
```

This command:

1. builds the Next.js app;
2. generates the OpenNext Cloudflare Worker bundle;
3. deploys the Worker with existing Cloudflare secrets preserved.

## After deployment

1. Check health:

   ```bash
   curl -i https://gymdesk.gym-tracking-system.workers.dev/api/health
   ```

   Expected result:

   ```json
   {"status":"ok","database":"reachable"}
   ```

2. Open the app:

   ```text
   https://gymdesk.gym-tracking-system.workers.dev/login
   ```

3. Smoke-test the core owner flow:

   - sign in;
   - open dashboard;
   - open member list;
   - create or view one test member;
   - generate/share QR;
   - scan QR from phone;
   - confirm Check-in/Check-out;
   - verify attendance appears;
   - verify payment reminder and receipt links still open.

4. If QR links point to localhost/ngrok, fix `NEXT_PUBLIC_APP_URL`, update the Worker secret, redeploy, and regenerate any affected QR passes.

## Rollback

Use Cloudflare dashboard or Wrangler versions/deployments to restore a previous Worker version:

```bash
npx wrangler deployments list
```

After rollback, verify:

```bash
curl -i https://gymdesk.gym-tracking-system.workers.dev/api/health
```

If a database migration caused the issue, do not manually delete data or rewrite applied migrations. Create a recovery migration or restore from a verified backup.

## Production cautions

- Keep `QR_SIGNING_SECRET` stable. Rotating it invalidates issued QR passes and signed receipt links.
- Supabase Free does not provide managed automatic backups. Keep manual weekly exports until the client moves to a paid database plan.
- Cloudflare Workers Free is acceptable for V1 traffic, but it is not a formal SLA setup.
- Do not connect GitHub auto-deploy unless we intentionally change the release process.
