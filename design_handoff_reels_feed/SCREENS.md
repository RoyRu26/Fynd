# Handoff: Fynd — Paper & Ink redesign (all screens)

Read `README.md` in this folder first: theme migration plus the feed card (1a). This file covers the remaining screens and the logo. Visual reference: `Thrift Reels.dc.html` (open in a browser; Turn 4 = final Explore/Sell/Inbox/Profile, picks 4a/4c/4e/4g) and `screenshots/`. Turn 2 screens are superseded except the listing editor (2f). Chat = Turn 5, pick 5a.

## Ground rules (same as README)
- Use semantic tokens and existing `components/ui` primitives only. No raw hex in screens.
- Keep NativeTabs (`components/app-tabs.tsx`) and its layout unchanged.
- Keep all existing copy, form logic (react-hook-form + zod), and `mapAuthError` handling.
- Each task ends with `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, then the `code-reviewer` agent.

## Task 1 — Logo
Assets in `assets/` (transparent PNG, ~496×234):
- `fynd-logo-light.png`: orange-red mark + ink wordmark, for paper backgrounds
- `fynd-logo-dark.png`: orange-red mark + cream wordmark, for dark backgrounds
- `fynd-logo-cream.png`: all cream, for use over photos (feed header)

Steps:
1. Copy them to `apps/mobile/assets/images/`. Ask the owner for an SVG master later and swap in place.
2. Create `components/ui/logo.tsx`: `<Logo height={34} tone="auto" | "onMedia" />`. `auto` picks light/dark from `useAppTheme()` scheme; `onMedia` uses cream. Uses `expo-image`, `accessibilityLabel="Fynd"`, width from aspect ratio 496/234.
3. Replace every `<Text variant="wordmark">Fynd</Text>` with `<Logo height={34} />` (sign-in, sign-up incl. check-email branch, onboarding profile). Keep the `wordmark` text variant for now; remove it once unused.
4. Home feed header: `<Logo height={26} tone="onMedia" />`.

## Task 2 — Auth (screens 3a–3e)
- **3a Welcome (new route `app/(auth)/welcome.tsx`, make it the initial auth route):** dark (`bgInverse`) full screen; top ~560px is a 3-column masonry of recent listing photos (static sample or the public feed query) fading into `bgInverse`; bottom block: `Logo tone dark` 60px tall, body "Discover, buy, and sell second-hand." in `textSecondary`-on-dark, primary `Button` "Create account" → sign-up, secondary/outline `Button` "Sign in" → sign-in.
- **3b Sign in:** existing screen. Add: show/hide toggle on password (TextField `trailing` slot), "Forgot password?" ghost link aligned right under the fields (route to a reset screen; Supabase `resetPasswordForEmail`). Field errors render under the field in `danger` (already wired).
- **3c Sign up:** existing. Add a 4-segment password strength bar under Password (segments `success` when met, `border` otherwise) with helper "At least 8 characters" (match the zod rule). Add terms line under the actions in `caption`/`textTertiary`.
- **3d Check email:** existing branch. Add a 72px `accent` circle with a mail icon, "Open email app" (expo-linking `mailto:`/`message:`), "Resend in 0:42" countdown → `supabase.auth.resend`, and bottom "Wrong address? Change email" → back to sign-up with email prefilled.
- **3e Set up profile:** existing. Add optional avatar picker (84px circle, dashed border, small `+` badge) above the fields, using expo-image-picker + existing storage upload. Username field shows `@` prefix. Availability row is already correct.
- Remove `AmbientBackground` from auth screens; plain `bg`.

## Task 3 — Display font + shared social bits
Turn 4 screens use **Archivo Expanded Black** (900, width 125%) for screen titles and section headers, set lowercase.
1. Add `ArchivoExpanded-Black.ttf` (Google Fonts → Archivo → static) to `apps/mobile/assets/fonts/`, load it with `expo-font` next to the existing fonts.
2. Add text variants: `display` (34/36, letter-spacing −0.02em) and `displaySm` (20/24). Use `display` for tab titles, `displaySm` for section headers.
3. New `components/ui` primitives:
   - `StoryRing` — circle image (size prop), 3px gap, 2.5px `accent` ring when `active`, 1.5px `border` ring otherwise; optional label under it.
   - `Sticker` — small uppercase label, Archivo 800 11px, tracking 0.1em, radius 4, hard 0×2 `text`-color shadow, `rotate` prop (deg). Tones: `accent` (white text), `inverse`, `paper`.
   - `ReactionPill` — `bg` pill with filled `accent` heart + count, 12px bold.
   - `PillButton` — 46px full-radius button (primary `accent`, outline). Turn 4 uses pills instead of 8px-radius buttons.

## Task 4 — Explore (4a) · screenshots/4a-explore.png
Search tab. **No prices or descriptions on tiles.**
- Header `display` "explore".
- Search: 48px pill, 1.5px `text` border, `bgRaised`; placeholder "Brands, vibes, sizes…"; 36px `bgInverse` filter circle inside on the right (keep the existing filter sheet).
- "Drops" row (`micro` label): horizontal `StoryRing`s (64px, active) per category/vibe; tap = filter the grid.
- "fresh off the rack" (`displaySm`) + "Shuffle" link in `accentText`.
- Collage grid: 3 columns, 58px row unit, 6px gap, radius 14. Repeating 13-row pattern per 9 items: [2×4, 1×2, 1×2, 1×3, 2×3, 1×3, 1×3, 1×3, 3×3] (cols×rows). Build as a custom layout over the existing listings query (FlashList `masonry` won't do spans; chunk items into pattern blocks).
- On tiles: `ReactionPill` (save count) bottom-left; optional `Sticker` ("just dropped" for <24h old, vibe tag on others) top corner. Tap → listing detail.

## Task 5 — Sell (4c) · screenshots/4c-sell.png
- Header `display` "sell".
- Hero card: `bgInverse`, radius 24, padding 20–24. 56px `accent` circle with camera icon; `display`-style "snap it. / list it." (28/30); body "Start with photos. Add the price and details after." at 75% opacity; two `PillButton`s: "Open camera" (primary) and "From gallery" (outline, cream). Corner `Sticker` "2 min to list" rotated 8°.
- "your rack" (`displaySm`) + "See all N": horizontal row of **76×96 listing thumbnails** (radius 12), status pill under each — Live (`accent`), Draft (dashed `text` border), Sold (`bgInverse`, thumbnail washed). Tap → editor (draft) or listing.
- "buzz": cards (`bgRaised`, 1.5px `text` border, radius 16) with 44×54 thumb + sentence, e.g. "**Maya** and 11 others saved your **Wool overcoat**", "**Shira** offered ₪50 on your **Breton tee**" + "Reply". Hide section if there's no data.
- Listing editor stays as 2f (Turn 2 spec): header back + "New listing" + Publish; photos row; Title, Price, Condition (`CONDITION_LABELS`), Size, Category, Description.

## Task 6 — Inbox & Chat (4e) · screenshots/4e-inbox.png
- Header `display` "inbox" + compose icon.
- Stories row: `StoryRing` 62px per recent conversation partner; `active` ring = has unread.
- Filter pills: All (selected = `bgInverse`) · Buying · Selling · Offers (with `accent` count badge). Filter client-side on buyer/seller role and open offers.
- Rows (no dividers, 12px vertical padding): 54px avatar with the listing thumbnail (26×32, 2px `bg` border, rotated 8°) overlapping its bottom-right; name (15 bold) + time; preview (unread = semibold `text`, read = `textSecondary`); if an open offer exists, `Sticker` "Offer ₪165" (accent, −2°) under the preview; unread = 10px `accent` dot on the right.
- Chat screen: keep 2d (Turn 2 spec) — pinned listing strip, bubbles theirs `bgSunken` / mine `bgInverse`, `accent` send button.

## Task 7 — Profile (4g) · screenshots/4g-profile.png
- Header: handle + menu (Sign out lives in the menu).
- Collage cover (190px): up to 3 of the user's latest listing photos as tilted polaroids (−5°, 3°, −2°; 4px `bgRaised` border, soft shadow). 92px avatar overlaps bottom-left with 4px `bg` ring. Optional seller-badge `Sticker` bottom-right ("ships in 24h") — only if backed by data, otherwise omit.
- Name in `display` 26/28; one line "24 listings · 318 followers · 96 following" in `textSecondary` (hide follow counts if not implemented); bio.
- Pills: "Edit profile" (`bgInverse`) + "Share closet" (outline).
- Highlights row: 58px circles with 1.5px `text` ring — category groupings of the user's listings + "Sold". Tap = filter grid.
- Tabs closet · saved · reviews (`displaySm` 14px, active has 3px `accent` underline over a 1.5px `text` rule). Hide "reviews" until reviews exist.
- 3-col gapless grid, 4:5; sold items get paper wash + rotated "SOLD" stamp in `accent`. No price tags.

## Task 8 — Chat conversation (5a) · screenshots/5a-chat.png
Replaces the 2d chat spec. File: `apps/mobile/src/app/(app)/conversation/[id].tsx` (outside tabs, no tab bar). Keep all existing data/loading/empty/error logic, the ReviewSheet and pagination; restyle only, plus the additions marked NEW.
- Header: back (44px), 42px avatar inside a 2px `accent` ring (`StoryRing`), name (16 bold), caption "Buying from you · ★ 4.8" (`textSecondary`; drop the rating if not available), overflow menu (Report / Block if they exist).
- PinnedListingStrip: `bgRaised` card, 1.5px `text` border, radius 16, hard 0×3 `text` shadow, 16px side margin. 46×58 thumbnail rotated −4° with 2px `bg` border; title (14 bold); "₪180 · Size M" (`textSecondary`); status `Sticker` (Live = accent, Sold = inverse) rotated 3°. Tap → listing.
- Day separators: `micro` 11px, tracking 0.2em, uppercase, `textTertiary`, centered ("Today", "Yesterday", date).
- MessageBubble: max 76% width, 10×14 padding, 15/20 text. Theirs: `bgRaised` + 1.5px `text` border, radius 18/18/18/4. Mine: `bgInverse` text `textInverse`, radius 18/18/4/18. 10px gap between bubbles. Time under the last bubble of a group (11px `textTertiary`).
- Composer: sticky bottom, `bg` 94% + blur, hairline top border. 44px outline circle (camera/photo, NEW — hide if image messages aren't supported), 44px pill input (`bgRaised`, 1.5px border, "Message…"), 44px `accent` send circle with up-arrow and hard 0×2 shadow; disabled = 40% opacity.
- NEW quick replies (optional): horizontally scrolling outline chips above the input, shown only when the conversation has < 3 messages. Static list: "Is it still available?", "Can you send measurements?", "Can we meet?". Tap = fills the input, does not send.
- Needs backend — build only if the data exists, otherwise skip and leave a TODO:
  - Offer message: `accent` card bubble (theirs side), "OFFER" micro label, price in `display` 30 + struck original price, Accept (`bgInverse`) / Counter (outline white) pills.
  - Heart reaction on long-press: small `bg` pill with accent heart, overlapping the bubble's bottom-right by 12px.
  - Image message: 150×190, radius 14, 1.5px border, rotated −1.5°.
- No payments or delivery in v1 — no order status, tracking or progress UI.

## Suggested order
Theme (README) → Task 1 → feed card (README) → Task 2 → 3 → 4 → 5 → 6 → 7 → 8. One commit per task.
