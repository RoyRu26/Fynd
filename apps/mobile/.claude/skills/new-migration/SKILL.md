---
name: new-migration
description: Create a Supabase schema change in Fynd (table, column, policy, RPC, enum) with its pgTAP tests and regenerated types. Use for any database change.
---

# New migration

1. **Read context first.** Read the latest migrations touching the same tables, and the matching suite in `supabase/tests/database/`.
2. **Create the file** from the repo root: `pnpm exec supabase migration new <snake_case_name>`. Never edit an already-applied migration; always add a new one.
3. **Write the SQL** following the existing house style (see `20260922090200_favorites.sql` as the reference):
   - Header comment explaining WHY, and which DESIGN.md section / earlier migration it relates to.
   - `enable row level security` on every new table, one policy per operation, `(select auth.uid())`.
   - `revoke all on <table> from anon, authenticated;` then explicit grants, using column allowlists for insert/update so server-controlled columns can't be written by clients.
   - Money columns are integer minor units. Multi-step critical operations go in a single RPC (`security definer`, `set search_path = ''`, own auth checks).
   - Comment every non-obvious policy/grant with the reasoning.
4. **Write/extend pgTAP tests** in `supabase/tests/database/<domain>.sql`: fixtures with distinct users, test both allowed and denied paths per role. Use 4-arg `throws_ok(sql, sqlstate, null, description)`, SQLSTATE only, and row-survival checks for silent RLS denials. Update `plan(n)`.
5. **Apply and test** (repo root): `pnpm exec supabase db reset` then `pnpm exec supabase test db --local`.
6. **Regenerate types**: `cd apps/mobile && pnpm gen:types`, then `pnpm exec tsc --noEmit` to surface code that needs updating.
7. **Review**: run the `supabase-security-reviewer` agent and fix anything Critical/High before finishing.
