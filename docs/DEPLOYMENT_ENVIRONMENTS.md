# Deployment environments

FitKiro uses explicit dev/prod deploy commands to reduce the chance of deploying to the wrong Supabase project or Cloudflare Worker.

## Local env files

Create two ignored files from `.env.deploy.example`:

```bash
cp .env.deploy.example .env.dev.local
cp .env.deploy.example .env.prod.local
```

Set these fields carefully:

- `.env.dev.local` must contain `FITKIRO_ENV=dev` and the dev Supabase URL/keys.
- `.env.prod.local` must contain `FITKIRO_ENV=prod`, the prod Supabase URL/keys, and `ALLOW_PROD_DEPLOY=yes`.
- `SUPABASE_PROJECT_REF` is optional but recommended. If present, it must match the project ref inside `NEXT_PUBLIC_SUPABASE_URL`.
- Never copy dev Supabase keys into prod or prod keys into dev.
- Do not commit either local env file.

## Supabase deploy commands

Dry-run dev migrations:

```bash
npm run deploy:dev:check
```

Apply dev migrations:

```bash
npm run deploy:dev:supabase
```

Dry-run prod migrations:

```bash
npm run deploy:prod:check
```

Apply prod migrations:

```bash
npm run deploy:prod:supabase
```

Every command runs a preflight first. The preflight refuses to continue when the env file does not match the command target.

## Cloudflare deploy commands

Deploy dev Worker:

```bash
npm run deploy:dev:cloudflare
```

Deploy prod Worker:

```bash
npm run deploy:prod:cloudflare
```

Cloudflare environments are defined in `wrangler.jsonc`:

- `dev` deploys as Worker `fitkiro-dev`.
- `prod` deploys as Worker `fitkiro` and uses `musclefitness.fitkiro.com`.

Dev is configured for `https://dev.fitkiro.com`. Keep the same URL in `.env.dev.local` as `NEXT_PUBLIC_APP_URL` so build-time and runtime values agree. Production remains the first-client URL `https://musclefitness.fitkiro.com`.

## Supabase Auth URLs and invitation email

In each Supabase project, add these exact URLs to **Authentication -> URL Configuration -> Redirect URLs**:

```text
https://dev.fitkiro.com/auth/callback
https://dev.fitkiro.com/auth/complete
https://musclefitness.fitkiro.com/auth/callback
https://musclefitness.fitkiro.com/auth/complete
```

Set the Site URL to the matching environment's app URL. The first URL completes a user-requested password reset; the second completes the staff or owner invitation before showing the password form. In the Supabase **Invite user** email template, preserve `{{ .ConfirmationURL }}` so the one-time invitation token reaches that page.

## Recommended V1 release flow

For now, deploy from local using explicit commands:

```bash
npm run check:release
npm run deploy:dev:check
npm run deploy:dev:supabase
npm run deploy:dev:cloudflare
```

After dev smoke testing:

```bash
npm run check:release
npm run deploy:prod:check
npm run deploy:prod:supabase
npm run deploy:prod:cloudflare
```

Keep GitHub Actions for later, after first-client acceptance. When added, use the same scripts: merge to `develop` deploys dev; merge to `main` requires manual approval before prod deploy.
