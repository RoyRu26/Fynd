# Fynd

Fynd is a production-oriented second-hand marketplace application.

## Architecture

Mobile:
- React Native
- Expo
- TypeScript
- Expo Router

Backend:
- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Storage
- Supabase Realtime
- Supabase Edge Functions

State and validation:
- TanStack Query for server state
- Zustand for local UI state
- React Hook Form for forms
- Zod for validation

Payments will use Stripe Connect.

## Engineering Rules

- TypeScript strict mode.
- Do not use `any` unless absolutely necessary.
- Do not modify unrelated files.
- Keep business logic out of React components.
- Database access belongs in feature API/service modules.
- Use TanStack Query for server state.
- Use Zod for input validation.
- All database schema changes must use migrations.
- Every exposed database table must use Row Level Security.
- Never expose server secrets to the mobile app.
- Treat all client input as untrusted.
- Money must be stored as integer minor units.
- Critical operations must be transactional and server-controlled.
- Run type checking and linting after changes.

## Local Database Safety

Never delete, reset, truncate, recreate, or otherwise wipe local database contents unless I explicitly instruct you to do so in that specific task.

This includes:
- never run `supabase db reset`
- never truncate tables
- never delete existing dev users/listings/messages/favorites just to make tests pass
- never replace current dev data with fixtures
- never run destructive seed/reset scripts

Prefer:
- `supabase migration up --local`
- additive/idempotent seed logic
- fixture-scoped tests
- targeted changes that preserve unrelated data

If a proposed change would require deleting or resetting data, stop and ask first.

Existing dev data should be treated as persistent unless explicitly told otherwise.

## Repo layout

- pnpm monorepo. App lives in `apps/mobile`, database in `supabase/`.
- `apps/mobile/src/app/` — Expo Router screens only (thin: render + wire hooks).
- `apps/mobile/src/features/<feature>/` — one folder per feature:
  - `api.ts` — Supabase calls only. Throws on `error`.
  - `queries.ts` — TanStack Query hooks + a `<feature>Keys` query-key object.
  - `<feature>.ts` (pure logic) — row normalization, derivations. NO react-native or `@/lib/supabase` imports, so it is unit-testable.
  - `<name>.test.ts` — Vitest tests for the pure module.
  - `schemas.ts` / `errors.ts` when needed (Zod schemas, error mapping).
- `apps/mobile/src/components/ui/` — design-system primitives; UI state logic lives in `*-state.ts` with tests.
- `apps/mobile/src/types/database.ts` — GENERATED. Never hand-edit; regenerate after migrations.
- `supabase/migrations/` — one file per change, timestamped. `supabase/tests/database/` — pgTAP suites, one per domain.

## Commands

Run from `apps/mobile` unless noted:
- Typecheck: `pnpm exec tsc --noEmit`
- Lint: `pnpm lint`
- Unit tests: `pnpm test`
- Regenerate DB types: `pnpm gen:types`
- New migration (repo root): `pnpm exec supabase migration new <snake_case_name>`
- Apply new migrations locally, without resetting (repo root): `pnpm exec supabase migration up --local`
- DB tests (repo root): `pnpm exec supabase test db --local`
- Seed local dev data (repo root, on `main`): `pnpm seed:dev` — additive and idempotent, see Local Database Safety above

## Design

`DESIGN.md` is the design system and is binding. Screens use semantic tokens only (no hex, no magic numbers). Follow §15 contribution rules; accessibility (§12) is part of "done".

## Workflow

- Plan before building anything that touches more than one layer (DB + API + UI).
- A task is done only when typecheck, lint, unit tests (and DB tests if SQL changed) pass.
- After a feature, run the `code-reviewer` agent; for any SQL change, also run `supabase-security-reviewer`.
- Repeatable procedures live in `.claude/skills/` (new-migration, new-feature, verify).
