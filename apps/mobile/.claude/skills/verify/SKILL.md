---
name: verify
description: Run Fynd's full check suite (typecheck, lint, unit tests, DB tests) and fix failures. Use before saying a task is done or before committing.
---

# Verify

Run in order and fix failures before moving on. Do not report "done" with failures outstanding.

1. `cd apps/mobile && pnpm exec tsc --noEmit`
2. `cd apps/mobile && pnpm lint`
3. `cd apps/mobile && pnpm test`
4. If anything under `supabase/` changed (check `git status`): from the repo root, `pnpm exec supabase test db --local` (requires `pnpm exec supabase start`; if it isn't running, say so rather than skipping silently).
5. Check `git status` for unintended changes to unrelated files and revert them.

Report a short summary: each step pass/fail, what you fixed.
