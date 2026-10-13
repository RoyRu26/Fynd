# Fynd Roadmap

Source of truth for what gets built next. The `autopilot` skill works through this file top to bottom.

**Rules**
- Work one item at a time, in order. Tick `[x]` only when the item meets its "Done when" and all checks pass.
- Items tagged **[DECISION]** need Roy's input. Stop and ask before building them, then record the answer under the item.
- Never resolve a DESIGN.md **[OPEN]** item yourself. Stop and ask.
- Each milestone ends with a **Checkpoint**: stop, summarize, and wait for Roy to test on a device.
- Out of scope for v1: in-app payments (Stripe Connect), shipping, offers. Deals happen via chat + meet-up.

**Already built:** auth, onboarding, home feed (paging, impressions, favorites), sell flow (drafts, photos, publish), listing detail, public seller profile, chat database (conversations, messages, read RPCs, realtime).

---

## Milestone 1 — Complete the core loop

- [x] **1.1 Missing UI primitives** — Build `ListRow`, `Sheet`, `Skeleton`, `EmptyState` per DESIGN.md §13, only as far as items in this milestone need them (second-caller rule).
  Done when: each has state-logic tests where it has logic, and is used by at least one screen below.
  Note: `ListRow`/`Skeleton`/`EmptyState` are in real use (My Listings retrofit). `Sheet` is fully built and tested but has no real screen caller yet — its first consumer lands with 1.6 or 1.7.
- [x] **1.2 Inbox** — Inbox tab listing conversations (DESIGN.md §14.5) using the existing chat RPCs: other party avatar + name, listing thumbnail, last message, unread (weight + dot + accessibility label).
  Done when: conversations sort by latest message, unread clears on open, empty state shows when there are none.
  Note: `inbox/[id].tsx` is a deliberate minimal stub (marks read, shows header, placeholder body) — 1.3 fills in the real thread UI.
- [x] **1.3 Conversation screen** — Message thread with realtime updates, send box, optimistic send, pagination of older messages, listing header that links to the listing.
  Done when: two signed-in users can chat live; sending fails gracefully offline.
  Note: chat UI is a deliberate minimal placeholder (plain text rows, no bubble styling) per Roy's decision — DESIGN.md §14.7 documents this pending a real design pass.
- [x] **1.4 "Message seller"** — Primary action on listing detail opens (or creates) the conversation for that listing. Hidden on your own listing.
  Done when: tapping it twice never creates two conversations.
- [ ] **1.5 My listings** — Own Profile tab shows my listings across statuses (active, draft, reserved, sold), with status filter chips.
- [ ] **1.6 Manage a listing** — Edit an active listing; mark reserved / sold / back to active; remove; delete a draft. Server-controlled transitions (RPC), never direct status writes from the client.
  Done when: pgTAP covers allowed and forbidden transitions, including another user trying them.
- [ ] **1.7 Edit profile + avatars** — Edit display name, username, bio; upload avatar to Storage; signed-URL pipeline so avatars render everywhere `Avatar` is used (closes the avatar_path gap noted in DESIGN.md §13).
- [ ] **1.8 Saved items** — Screen listing my favorites (3-up grid tile), reachable from my profile.
- [ ] **Checkpoint 1** — Stop. Summarize what was built and give Roy a test script (step-by-step things to try on the phone).

## Milestone 2 — Discovery

- [ ] **2.1 Categories** — `categories` table (two-level: e.g. Women › Shoes), seeded; `category_id` on listings; category step in the sell flow; shown on listing detail.
- [ ] **2.2 Search backend** — Postgres full-text search over title/description + filters (category, size, condition, price range) + sort (newest, price) in one RPC with keyset pagination. Indexed.
  Done when: pgTAP covers filters and that drafts/removed listings never appear.
- [ ] **2.3 Explore tab** — DESIGN.md §14.2: search bar, 3-up grid reusing the grid tile, filters in a `Sheet` using `Chip`, active-filter chips, empty state.
- [ ] **2.4 Recent searches** — Stored locally, shown when the search bar is focused.
- [ ] **Checkpoint 2**

## Milestone 3 — Social

- [ ] **3.1 Follows** — `follows` table with RLS; follow/unfollow button on seller profile (DESIGN.md §14.3); follower/following counts.
- [ ] **3.2 Following feed** — Toggle on Home between "For you" and "Following".
- [ ] **3.3 Followers lists** — Tappable counts open follower / following lists (`ListRow`).
- [ ] **Checkpoint 3**

## Milestone 4 — AI listing assist

- [ ] **4.1 [DECISION] AI provider** — Which model/API to call, and Roy adds the API key as a Supabase secret. Ask before starting.
- [ ] **4.2 Suggest-from-photos Edge Function** — Takes the draft's uploaded photos, returns suggested title, category, condition, description and a price range. Key stays server-side; rate-limited per user.
- [ ] **4.3 Suggestions in the sell flow** — Pre-filled, editable fields marked "suggested" (DESIGN.md §14.4). Never auto-publishes. Works fine if the function fails.
- [ ] **Checkpoint 4**

## Milestone 5 — Trust & safety

- [ ] **5.1 Report** — Report a listing or user (reason + note) from the feed "more" menu, listing detail and profiles. `reports` table, insert-only for users.
- [ ] **5.2 Block** — Block a user: their listings disappear from my feed/search, and neither side can message the other. Enforced in RLS/RPCs, not just the UI.
- [ ] **5.3 Mark sold to a buyer** — When marking sold, pick the buyer from people who messaged about the listing.
- [ ] **5.4 Reviews** — After 5.3, buyer and seller can each leave one rating + comment. Average rating and count on seller profiles.
- [ ] **5.5 [DECISION] Push notifications** — Expo push for new message, new review, new follower. Needs an Expo/EAS account and a real device; ask before starting.
- [ ] **Checkpoint 5**

## Milestone 6 — Launch readiness

- [ ] **6.1 Settings** — Settings screen: sign out, notification toggles, privacy policy + terms links, delete account (App Store requirement; deletes or anonymizes data server-side).
- [ ] **6.2 Polish pass** — Every screen has loading (Skeleton), empty and error states with human copy (DESIGN.md §1).
- [ ] **6.3 Accessibility pass** — DESIGN.md §12 on every screen.
- [ ] **6.4 Security audit** — Run `supabase-security-reviewer` across ALL migrations; fix Critical/High.
- [ ] **6.5 [DECISION] Build & release setup** — EAS build config, app icons/splash, store listing. Ask before starting.
- [ ] **Checkpoint 6**

---

## Progress log

Autopilot appends one line per finished item: date, item, commit hash, notes.

- 2026-10-12 — 1.1 Missing UI primitives — `98d3f30` — Built ListRow, Sheet, Skeleton(+SkeletonRow/SkeletonListingCard), EmptyState(+ErrorState) and retrofitted My Listings to use them. Sheet has no real screen caller yet; deferred to 1.6/1.7. One review round found and fixed a stale-drag-offset bug in Sheet plus two should-fix items (keyboard avoidance, a duplicated DISABLED_OPACITY constant); re-review passed clean.
- 2026-10-12 — 1.2 Inbox — `ef72b0d` — Added the Inbox tab and list, consuming existing chat RPCs (no new migration). Added a minimal inbox/[id].tsx stub for 1.3 to build on. One review round found two must-fix items (missing test coverage for a normalizer, a detail query bypassing the inboxKeys convention) and two should-fix items (a misleading RPC doc comment, DESIGN.md §14.5 not documenting the listing thumbnail the roadmap requires); all fixed, re-review passed clean.
- 2026-10-13 — 1.3 Conversation screen — `b8c40bb` — Replaced the inbox stub with the real thread: new conversation_messages RPC (SECURITY INVOKER), realtime via Postgres Changes (first in the app), optimistic send with client_nonce idempotency. Roy chose a minimal token-only placeholder UI over inventing bubble styling, since DESIGN.md had no spec for this screen (flagged and asked rather than improvised) — documented in new §14.7. Independent code review and supabase-security-reviewer both came back clean on first pass; no fix round needed.
- 2026-10-13 — 1.4 Message seller — `51162b0` — Added the pinned "Message seller" action bar to listing detail, reusing the existing get_or_create_listing_conversation RPC (no new migration). Review found one real bug (ScrollView missing its own flex:1 style, so the pinned action bar wouldn't actually stay pinned on any real listing) plus a minor hydration-window nit; both fixed, re-review passed clean.
