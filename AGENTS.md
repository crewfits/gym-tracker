<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# FitKiro project context

Read `docs/CLIENT_V1_SCOPE.md`, `docs/PRODUCT_OVERVIEW.md`, `docs/ARCHITECTURE.md`, and `docs/DEVELOPMENT.md` before substantial product, schema, architecture, authentication, or release work. Implement only the approved first-client V1 scope unless the user explicitly changes it.

- Supabase migrations are the database source of truth. Add a migration; do not rewrite an applied migration.
- Treat `gym_id` isolation as a backend and RLS invariant, never a frontend filter.
- Update the applicable source-of-truth document when a major flow, domain contract, or durable decision changes.
- Run `npm run check:commit` before commits and `npm run check:release` before release/PR handoff.
