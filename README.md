# Fynd

Fynd is a mobile second-hand marketplace. People list items with photos, browse a swipeable feed, search with filters, chat with sellers in real time, and meet up to complete the deal.

Built as a pnpm monorepo: an Expo / React Native app and a Supabase backend (Postgres, Auth, Storage, Realtime and Edge Functions).

> **Status:** work in progress. The core loop (list, discover, chat, review) is built. Push notifications and store release setup are still to do. In-app payments are out of scope for v1, so deals happen through chat and meet-up.

## Features

**Buying and discovering**
- Home feed with a "For you" / "Following" toggle
- Search with filters for category, size, condition, price, brand and item attributes (color, style, material, pattern, fit)
- Hebrew-aware full-text search, with handling for prefixes, plurals and final letters, alongside English
- Saved items (favorites) and recent searches

**Selling**
- Sell flow with drafts, photo upload and publish
- AI listing assist: suggests a title, category, condition, description and price range from your photos. Suggestions are editable, clearly marked, and never auto-published
- Manage listings: edit, reserve, mark sold (optionally to a buyer who messaged you), remove

**Social and trust**
- Real-time chat between buyer and seller, with an inbox and unread state
- Public seller profiles with follow / unfollow and follower lists
- Ratings and reviews after a completed sale
- Report and block, enforced in the database rather than only hidden in the UI
- Account deletion that preserves other users' conversation history

## Tech stack

| Layer | Technology |
|---|---|
| Mobile | React Native, Expo, Expo Router, TypeScript (strict) |
| State and forms | TanStack Query, React Hook Form, Zod |
| Backend | Supabase: PostgreSQL, Auth, Storage, Realtime, Edge Functions (Deno) |
| AI | Anthropic Claude via the `suggest-listing` Edge Function |
| Testing | Vitest (app logic), pgTAP (database) |
| Tooling | pnpm workspaces, ESLint |

## Architecture

```
apps/mobile/        Expo app
  src/app/            Expo Router screens (thin: render + wire hooks)
  src/features/       One folder per feature: api, queries, pure logic, tests
  src/components/ui/  Design-system primitives
supabase/
  migrations/         Timestamped SQL, one file per change
  functions/          Edge Functions (suggest-listing, delete-account)
  tests/database/     pgTAP suites, one per domain
scripts/
  seed-dev.mjs        Additive, idempotent local seed data
```

Design decisions worth knowing about:

- **Security lives in the database.** Every exposed table uses Row Level Security. Status changes, blocking, reviews and account deletion go through server-side RPCs, never direct client writes.
- **Keys stay server-side.** The mobile app only holds the public Supabase key. The Anthropic API key is used only inside the Edge Function, which is rate-limited per user.
- **Feature modules keep logic out of components.** Supabase calls live in `api.ts`, data hooks in `queries.ts`, and testable pure logic is separate from React Native code.
- **Money is stored as integer minor units**, and the database types are generated, never hand-edited.

## Getting started

**Prerequisites:** Node.js, [pnpm](https://pnpm.io), Docker (for the local Supabase stack), and the Expo Go app or an iOS / Android simulator.

```bash
# 1. Install dependencies (from the repo root)
pnpm install

# 2. Start the local Supabase stack and apply migrations
pnpm exec supabase start

# 3. (Optional) Seed local dev data. Additive and safe to re-run
pnpm seed:dev
```

Create `apps/mobile/.env` with your Supabase project values:

```
EXPO_PUBLIC_SUPABASE_URL=<your Supabase API URL>
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your Supabase publishable key>
```

`pnpm exec supabase status` prints the local URL and keys.

For the AI suggestions, add `ANTHROPIC_API_KEY` to `supabase/functions/.env` and run `pnpm exec supabase functions serve`. Without a key, everything else works and listings can still be created manually.

```bash
# 4. Run the app
cd apps/mobile
pnpm start
```

## Scripts

Run from `apps/mobile` unless noted.

| Command | What it does |
|---|---|
| `pnpm start` | Start the Expo dev server |
| `pnpm exec tsc --noEmit` | Type check |
| `pnpm lint` | Lint |
| `pnpm test` | Run unit tests |
| `pnpm gen:types` | Regenerate database types after a migration |
| `pnpm exec supabase migration up --local` | Apply new migrations without resetting data (repo root) |
| `pnpm exec supabase test db --local` | Run database (pgTAP) tests (repo root) |

## Roadmap

- Push notifications (new message, review, follower)
- Smarter search: synonyms and tap-to-apply filter chips
- Engagement signals for future recommendations
- Privacy policy and terms
- Build and release setup (EAS, store listing)
- In-app payments with Stripe Connect (after v1)

## How it's built

Development is driven by a written roadmap with milestone checkpoints. Each feature is planned, built, reviewed (code review, plus a security review for any SQL change) and tested before it is marked done. I use Claude Code as an assistant in this workflow.
