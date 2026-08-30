# FitKiro development workflow

Last reviewed: 2026-08-23

## Repository sources of truth

- Product scope: [PRODUCT_OVERVIEW.md](PRODUCT_OVERVIEW.md)
- V1 architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- QR attendance: [qr-attendance-architecture.md](qr-attendance-architecture.md)
- Initial data import: [INITIAL_IMPORT.md](INITIAL_IMPORT.md)
- Production operations: [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md)
- Release acceptance: [V1_ROLLOUT_CHECKLIST.md](V1_ROLLOUT_CHECKLIST.md)
- Database schema: ordered files in `supabase/migrations/`

Update the relevant document in the same change whenever a product invariant, schema contract, authorization rule, integration boundary, or major user flow changes.

## Local commands

```bash
npm run dev
npm run dev:tunnel
```

`dev:tunnel` starts ngrok first, discovers the current HTTPS endpoint, and starts Next.js with that endpoint as `NEXT_PUBLIC_APP_URL` so regenerated QR links use the live tunnel.

Browser sessions are scoped to the website hostname. Restarting on the same stable hostname preserves the Supabase session; using a different ngrok hostname is a different browser origin and requires one new sign-in. Use a stable reserved tunnel domain or the production domain for client demos that must retain sign-in.

## Commit checks

The required fast commit gate is:

```bash
npm run check:commit
```

It runs:

- ESLint;
- strict TypeScript validation;
- automated tests.

Install the repository-managed Git hook once after cloning:

```bash
npm run hooks:install
```

`npm install` also runs the hook installer through the `prepare` script when the checkout contains Git metadata. The committed `.githooks/pre-commit` hook runs `check:commit` before each commit.

Do not bypass the hook to commit failing code. If an urgent exception is genuinely required, document why and run the missed checks before pushing.

## Release/PR checks

Run the larger gate before a pull request is declared ready or before deployment:

```bash
npm run check:release
```

This adds a production build to the commit gate.

The production build currently uses Next.js's supported `--webpack` option. This keeps local and CI release checks deterministic while the default Turbopack CSS worker fails in restricted environments when attempting to bind an internal port. Re-evaluate this after upgrading Next.js or when Turbopack builds are verified across local and CI environments.

When a migration changes, also run the relevant Supabase validation:

```bash
supabase db lint --local
supabase migration list --linked
```

Use `supabase db lint --linked` only when the linked remote project is the intended environment. Database migration files are append-only after deployment; evolve the schema with a new migration.

## Definition of done

- Requested behavior and failure states are implemented.
- Tenant and authorization checks exist in both server logic and RLS where applicable.
- Cross-tenant/IDOR behavior is tested for new data access paths.
- Loading, empty, error, retry, and duplicate-submission states are considered.
- Database mutations that span tables are transactional or idempotent.
- Tests, TypeScript, lint, and the production build pass at the appropriate gate.
- Product/architecture documentation is updated when the decision or flow changed.
- No secret, service-role key, personal data fixture, or provider credential is committed.

## Migration review checklist

- Every gym-owned table has a non-null `gym_id` column.
- RLS is enabled and policies cover each intended operation.
- Foreign keys cannot create cross-tenant relationships.
- Indexes support tenant-leading access patterns.
- Backfills are bounded and backward-compatible.
- Rollout order supports old and new application versions where needed.
- Destructive or irreversible changes have a recovery plan.

## Documentation maintenance

- Product behavior belongs in `PRODUCT_OVERVIEW.md`.
- Durable technical decisions and diagrams belong in `ARCHITECTURE.md`.
- Feature-specific implementation details belong in a focused document such as the QR architecture.
- Temporary task notes and terminal output do not belong in architecture documents.
