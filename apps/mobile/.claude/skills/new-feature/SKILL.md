---
name: new-feature
description: Build a new Fynd app feature or screen end to end (feature module, query hooks, pure logic with tests, Expo Router screen). Use when adding a screen or feature in apps/mobile.
---

# New feature

Reference implementation to copy the shape of: `src/features/seller-profile/` + `src/app/(app)/seller/[id].tsx`.

1. **Plan first.** Identify: data needed, whether the DB already supports it (check `src/types/database.ts` and migrations), which DESIGN.md §14 screen pattern applies, and which existing `components/ui` primitives to use. If the DB needs changes, do the `new-migration` skill first.
2. **Pure logic** — `src/features/<feature>/<feature>.ts`: row types, normalize functions (row → domain, snake_case → camelCase), derivations, pagination helpers. No react-native or `@/lib/supabase` imports. Throw loudly on violated invariants rather than silently coercing.
3. **Tests** — `src/features/<feature>/<feature>.test.ts` with Vitest: fixture builders with `overrides`, cover normal, empty, and invariant-violation cases.
4. **API** — `src/features/<feature>/api.ts`: Supabase queries only, `if (error) throw error`, returns normalized domain types. Avoid N+1 (embed selects, batch signed URLs). Doc comment explaining non-obvious filters and RLS interplay.
5. **Queries** — `src/features/<feature>/queries.ts`: a `<feature>Keys` object, `useQuery`/`useInfiniteQuery`/`useMutation` hooks; mutations invalidate or update the right keys.
6. **Validation** — user input goes through Zod schemas in `schemas.ts`; forms use React Hook Form + zodResolver. Map errors to user messages in `errors.ts`.
7. **Screen** — in `src/app/...`: thin. Hooks + rendering only. Semantic tokens from `@/design/tokens` / `useAppTheme`, primitives from `@/components/ui`. Handle loading, error, empty states. Accessibility labels and roles (DESIGN.md §12).
8. **Verify** — run the `verify` skill, then the `code-reviewer` agent.
