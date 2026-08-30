# Fynd Design System

The source of truth for Fynd's visual and interaction design. Rules here are enforceable: if code and this document disagree, the code is wrong.

Status: **approved direction, not yet implemented.** No tokens, primitives, or restyled screens exist yet. Items marked **[OPEN]** are deliberately undecided and must not be resolved by improvisation in a PR.

---

## 1. Brand & product principles

Fynd is a second-hand marketplace built around an immersive discovery feed, advanced search, social seller profiles, and AI-assisted listing creation.

**Four adjectives. Every design decision is judged against them:**

| | |
|---|---|
| **Warm** | Real people selling real things. Warm neutrals, human microcopy, sellers always visible. |
| **Human** | Never sterile, never corporate. Empty states and errors speak like a person. |
| **Confident** | Restrained, not timid. Few elements, each deliberate, well-sized. |
| **Restrained** | Photography does the visual work. The interface recedes. |

**Fynd is not:** a classifieds site, an admin panel, a generic e-commerce template, or a luxury/exclusive brand.

**The one rule that outranks the others:** product photography is the hero. If the interface competes with the photo, the interface is wrong.

### Reference discipline

Instagram is a **quality and interaction reference, not a visual template.** We borrow its level of polish, responsiveness, and its restraint in using color against a neutral base. We do not borrow its look.

- **Home** borrows the **Reels immersive interaction model** — full-viewport paging, overlay on scrim, edge action rail.
- **Search/Explore** borrows the **dense, image-first Explore grid model**.
- **Fynd's visual identity is its own.** Specifically: our gradient is violet-weighted with no orange/yellow terminus precisely so it does not read as Instagram's. Any change that moves us closer to Instagram's palette, gradient, or iconography is a regression.

---

## 2. Light/dark behavior

**Default: every surface follows the system appearance** (`userInterfaceStyle: "automatic"`).

**One exception: the Home discovery feed is always dark**, regardless of system setting. Full-viewport photography demands it.

**Listing detail is not locked. [OPEN]** Its media/gallery area may be dark while the informational portion follows the system theme. Decide when the screen is built, with the real design in front of us — do not pre-commit.

### Implementation requirement

Theme resolution **must go through a provider that a subtree can override**, so a `<DarkSurface>` wrapper can force dark for the feed. Components must not call `useColorScheme()` from `react-native` directly — today `use-theme.ts`, `app-tabs.tsx`, and `app-tabs.web.tsx` all do, and all three must change.

The status bar is pinned to light content on forced-dark surfaces and follows the scheme elsewhere.

---

## 3. Color

### Philosophy

Near-neutral, with **one accent**. The neutral ramp carries almost everything; the violet accent appears only on primary actions, active navigation, and selected states. Photography supplies the rest of the color on screen.

**The neutrals are warm.** This is what makes Fynd premium without being cold, and it is not optional. Neutrals are tinted toward red/yellow, never blue. Pure `#000000` and `#FFFFFF` are banned as surface colors.

The accent is a **cool** violet, deliberately: the warmth lives in the neutrals, the energy lives in the accent, and neither has to do the other's job.

### Primitive ramps

Warm neutrals:

| Token | Hex | | Token | Hex |
|---|---|---|---|---|
| `neutral.0` | `#FFFFFF` | | `neutral.500` | `#857E78` |
| `neutral.25` | `#FAF9F8` | | `neutral.600` | `#655F5A` |
| `neutral.50` | `#F5F3F1` | | `neutral.700` | `#4A4541` |
| `neutral.100` | `#EDEAE7` | | `neutral.800` | `#2E2A28` |
| `neutral.200` | `#E0DCD8` | | `neutral.900` | `#1A1716` |
| `neutral.300` | `#CAC4BF` | | `neutral.950` | `#0C0A0B` |
| `neutral.400` | `#A8A19B` | | | |

Violet / electric orchid:

| Token | Hex | | Token | Hex |
|---|---|---|---|---|
| `violet.300` | `#C89BF5` | | `violet.600` | `#7C2FD4` |
| `violet.400` | `#B478F0` | | `violet.700` | `#6620B0` |
| `violet.500` | `#9B4DEA` | | `violet.800` | `#4F1889` |

Functional:

| Token | Hex | | Token | Hex |
|---|---|---|---|---|
| `magenta.500` | `#E8478F` | | `danger.500` | `#DC3A3A` |
| `magenta.600` | `#D62E7A` | | `success.500` | `#2E9E63` |
| | | | `warning.500` | `#C87A16` |

### Semantic tokens

Screens read **only** these. Never a primitive directly.

| Semantic | Light | Dark |
|---|---|---|
| `bg` | `neutral.25` | `neutral.950` |
| `bgElevated` | `neutral.0` | `neutral.900` |
| `bgSunken` | `neutral.50` | `neutral.950` |
| `bgInverse` | `neutral.900` | `neutral.50` |
| `text` | `neutral.900` | `neutral.25` |
| `textSecondary` | `neutral.600` | `neutral.400` |
| `textTertiary` | `neutral.500` | `neutral.500` |
| `textInverse` | `neutral.25` | `neutral.900` |
| `textOnMedia` | `#FFFFFF` | `#FFFFFF` |
| `border` | `neutral.200` | `neutral.800` |
| `borderStrong` | `neutral.300` | `neutral.700` |
| `borderFocus` | `violet.700` | `violet.400` |
| `accent` | `violet.700` | `violet.500` |
| `accentPressed` | `violet.800` | `violet.600` |
| `onAccent` | `#FFFFFF` | `#FFFFFF` |
| `accentText` | `violet.700` | `violet.400` |
| `favoriteActive` | `magenta.600` | `magenta.500` |
| `danger` / `dangerBg` | `danger.500` / `#FDF0F0` | `danger.500` / `#3A1E1E` |
| `success` / `successBg` | `success.500` / `#EDF7F1` | `success.500` / `#17301F` |
| `warning` / `warningBg` | `warning.500` / `#FDF6E8` | `warning.500` / `#332714` |
| `overlayScrim` | `rgba(12,10,11,0.55)` | `rgba(12,10,11,0.55)` |
| `skeleton` | `neutral.100` | `neutral.800` |

### Rules

1. **`accent` is a per-scheme pair, never one hex.** A violet dark enough to pass contrast on white is unreadable on near-black, and vice versa. Same for `accentText` and `borderFocus`.
2. **`accent` is reserved** for: primary buttons, the active tab, selected chips/filters, focus rings, and links. Nothing else.
3. **`textOnMedia` is white in both schemes** and is only valid over a scrim. Text over user photography without a scrim is a defect — arbitrary images cannot guarantee contrast.
4. **`favoriteActive` is magenta, not violet and not the gradient.** It is the one state allowed its own hue, because it is the product's core engagement signal and must not read as "selected."
5. Never introduce a new color without adding it here first.

---

## 4. Signature gradient policy

Fynd's signature gradient is **coral → magenta → orchid → violet, heavily weighted toward the violet end, with no orange or yellow terminus.**

```
gradient.brand   (135°)
  0%    #F2648F   coral rose
  28%   #C93FA8   magenta
  62%   #8B34DC   orchid
  100%  #5B1FB0   deep violet
```

The violet weighting and the absent orange/yellow are what keep this from reading as Instagram's gradient. **Do not rebalance the stops toward the coral end. Do not add a warm terminus.**

### Allowlist — the gradient may appear ONLY here

- The wordmark and app icon
- The splash screen
- The Sell tab's center action in the bottom bar
- A "new" / "featured" / promotional highlight treatment
- **[OPEN]** at most one further brand moment, to be agreed explicitly — not claimed unilaterally

### Prohibited

- ❌ **The favorite state.** Favorite uses solid `favoriteActive` plus an icon/shape change.
- ❌ Normal CTAs, primary buttons, active tabs, selected chips — these use solid `accent`.
- ❌ Any page, screen, card, or section background.
- ❌ Text fills, borders, dividers, icons outside the allowlist.
- ❌ As the sole carrier of contrast for text, or the sole signal of a state. Text on the gradient needs a guaranteed-contrast foreground; a gradient-filled state still needs a shape or icon change.

If a surface feels like it needs the gradient, it almost certainly needs better hierarchy instead.

---

## 5. Typography

**One custom display face, system body.**

- **Display face: Manrope.** Current preferred candidate — chosen as a contemporary geometric sans with warmth and character, avoiding both high-contrast serifs (read luxury) and neutral grotesques (read cold). **[OPEN] — explicitly reviewable once seen rendered in Fynd.** If it reads wrong in context, we change it; nothing else in this document depends on the specific face.
- **Body face: system.** SF Pro on iOS, Roboto on Android. Perfect Dynamic Type, zero cost, instant render.

### Scale

| Variant | Size / Line height | Weight | Face |
|---|---|---|---|
| `display` | 32 / 38 | 700 | Manrope |
| `title` | 24 / 30 | 700 | Manrope |
| `heading` | 19 / 25 | 600 | Manrope |
| `price` | 22 / 26 | 700 | Manrope, tabular |
| `priceSm` | 15 / 19 | 700 | Manrope, tabular |
| `body` | 16 / 24 | 400 | System |
| `bodyStrong` | 16 / 24 | 600 | System |
| `label` | 14 / 20 | 600 | System |
| `caption` | 13 / 18 | 400 | System |
| `micro` | 11 / 14 | 600 | System |
| `mono` | 12 / 16 | 500 | System mono |

### Rules

1. The custom face is for `display`, `title`, `heading`, `price`, `priceSm` **only**. Everything else is system.
2. **Every custom-face variant declares an explicit `lineHeight`** — Manrope does not share system font metrics, and inherited line heights will be wrong.
3. Price always uses **tabular numerals**, so prices align in the grid and don't jitter when values change.
4. Fonts load before the splash hides. The existing `AnimatedSplashOverlay` already gates on an `isReady` flag — font loading joins auth resolution as a readiness input.
5. Dynamic Type is respected everywhere. `maxFontSizeMultiplier` is permitted **only** on the feed overlay, never on body content.

---

## 6. Spacing

A numeric 4pt scale. `space[3]` is self-documenting in a way named steps are not.

| Key | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **px** | 0 | 4 | 8 | 12 | 16 | 20 | 24 | 32 | 40 | 48 | 64 |

**Two deliberate densities:**

- **Spacious** — auth, onboarding, Sell, Profile, listing detail. Screen padding `space[5]`, section gaps `space[6]`–`space[8]`.
- **Dense** — Search/Explore grid only. 3-up, gutter `space[1]`, because hunting is a different task from browsing.

This is intentional, not an inconsistency. Do not "harmonize" them.

---

## 7. Radii

Crisp. Corners recede rather than draw attention.

| `xs` | `sm` | `md` | `lg` | `xl` | `full` |
|---|---|---|---|---|---|
| 4 | 6 | 8 | 12 | 16 | 9999 |

- Buttons, inputs, chips: `sm`–`md`
- Cards, sheets, grid tiles: `md`–`lg`
- Sheet top corners: `xl`
- `full`: avatars and circular icon buttons **only** — not for pills. Fynd does not use pill-shaped chips or buttons.

---

## 8. Borders & elevation

**Borders:** `hairline` (`StyleSheet.hairlineWidth`), `thin` (1), `thick` (2 — focus rings only).

**Elevation — three levels, no more:**

| Level | Use |
|---|---|
| `raised` | Cards, the bottom bar over content |
| `overlay` | Sheets, popovers |
| `modal` | Full modals |

Each is a platform-split object (iOS `shadow*`, Android `elevation`). Shadows are subtle and warm-tinted, never neutral-blue-black. Prefer a border or a background-tone shift over a shadow where either will do.

---

## 9. Iconography

- **SF Symbols via `expo-symbols`** on iOS, with an explicit Android and web fallback for every symbol used. No PNG icons.
- **Sizes:** `sm 16` · `md 20` · `lg 24` · `xl 28`.
- Consistent weight across the app; icons optically match adjacent text weight.
- **Every icon-only control requires `accessibilityLabel` and `accessibilityRole`.** The feed action rail is entirely icon-only, so this is load-bearing, not a nicety.

---

## 10. Motion

**Snappy.** Fast, near-linear, minimal overshoot. Precise and responsive; never keeps you waiting, never draws attention to itself.

```
duration   instant 100 · fast 160 · normal 240 · slow 320
spring     stiffness 400, damping 35, mass 1
easing     ease-out for entrances, ease-in for exits
```

### Rules

1. **Nothing exceeds 320ms.** Nothing is decorative. Nothing delays a tap.
2. Every animation picks a duration and spring **from these tokens**. No inline timings.
3. **Reduced motion is wired into the motion tokens once**, so every animation inherits it: paging becomes an instant cut, springs become fades, decorative motion is disabled. Respect `AccessibilityInfo.isReduceMotionEnabled()`.

### Catalogue of allowed motion

| Interaction | Behavior |
|---|---|
| Feed paging | Hard snap, `decelerationRate="fast"`. Never rest between items. |
| Favorite | Optimistic. Fill + `1 → 1.15 → 1` scale, ~180ms, light haptic. No spinner, no toast. Revert quietly with an inline message on failure. |
| Feed → detail | Continuation of the photo, not a generic push. |
| All other navigation | Standard platform transitions. Do not invent custom ones. |
| Sheets | Slide up and settle. No bounce. |
| Images | Fade in ~200ms from placeholder. |
| Press states | Opacity or background shift within `fast`. |

---

## 11. Image treatment

All listing and avatar imagery goes through **one wrapper over `expo-image`**. Raw `expo-image` call sites for product photography are prohibited.

The wrapper always sets: `contentFit`, a `transition` from the motion tokens, a blurhash/thumbhash `placeholder`, `recyclingKey` (list reuse), and a `cachePolicy`.

### Rules

1. **Feed: full-bleed, true full-viewport**, `contentFit: "cover"`.
2. **Aspect ratio is always reserved before load.** Layout shift on image load is a defect.
3. **Upload-time resizing is mandatory.** Decoding original camera images at full-viewport size in a paged list will thrash memory.
4. **The Sell flow must show the seller their feed crop and let them adjust it.** Full-viewport cropping cuts the top or bottom off portrait-shot garments. Without this, the feed fills with decapitated items. This is a requirement of the image pipeline, not later polish.
5. Any text over an image sits on `overlayScrim` or a gradient scrim. No exceptions.

---

## 12. Accessibility

Non-negotiable. Every screen passes this checklist.

1. **Touch targets ≥ 44×44pt**, enforced inside `Button`/`IconButton` via minimum height or `hitSlop` — never left to call sites.
2. **Contrast** ≥ 4.5:1 body text, ≥ 3:1 large text and meaningful icons. Over photography this is achieved via the mandatory scrim, not by color choice.
3. **Dynamic Type** respected with scalable units, tested at the largest accessibility sizes. The feed overlay must truncate gracefully, never clip.
4. **No color-only status.** Condition, sold state, unread, username availability, and validation each need an icon, label, or weight change in addition to color.
5. **Reduced motion** honored via the motion tokens.
6. **`accessibilityLabel` + `accessibilityRole` on every icon-only control.**
7. The custom bottom bar owns its own tab semantics (`accessibilityRole="tab"`, selected state, labels) — responsibilities the OS tab bar previously provided for free.

---

## 13. Component primitives

The smallest useful set. Under `src/components/ui/`, one file each.

| Primitive | Notes |
|---|---|
| `Text` | Variants per §5. Replaces `ThemedText`. `color` prop keyed to semantic tokens. |
| `Button` | `primary` / `secondary` / `ghost` / `danger` × `sm` / `md` / `lg`. Loading and disabled built in. 44pt enforced. |
| `IconButton` | Icon-only, `hitSlop` to 44pt. `onMedia` variant carries its own scrim. |
| `TextField` | Label + input + helper/error as one unit. Owns focus ring, error state, `color`, and `placeholderTextColor`. |
| `Avatar` | `xs`/`sm`/`md`/`lg`. Initials fallback — `avatar_path` is null for every user today. |
| `Chip` | Static badge and interactive filter, one component via a `selectable` prop. Radius `sm`–`md`, never pill. |
| `ListRow` | Leading slot / title + subtitle / trailing slot. |
| `Sheet` | Detents, drag handle, scrim, keyboard avoidance. The only bottom-sheet implementation. |
| `Skeleton` | Shimmer block, plus composed `SkeletonListingCard` / `SkeletonRow`. |
| `EmptyState` | Icon + title + body + action. Backs `ErrorState` via a `variant`. |
| `Screen` | Owns safe-area insets, max width, scroll behavior, keyboard avoidance. |
| `DarkSurface` | Forces the dark scheme for a subtree (§2). |

**Deliberately excluded** until a second real caller exists: Card, Modal, Tooltip, Accordion, Tabs, Menu, toast system.

---

## 14. Screen patterns

### 14.1 Home feed

The visual anchor of the product. Always dark. Full-viewport, vertically paged, one listing per page. Borrows the **Reels interaction model**.

**Hierarchy — strongest to weakest:**

| Tier | Elements |
|---|---|
| **1 — Dominant** | Photography, full-bleed, full-viewport. |
| **2 — Legible without reading** | **Price** (the most-scanned datum in second-hand; the one element allowed to be loud) · **Favorite** (large target, right-thumb reachable). |
| **3 — One glance** | Title, truncated 1–2 lines · **Size** and **condition** chips — the two attributes that decide relevance faster than the title. |
| **4 — Trust** | Seller avatar + handle. Present on every item — this is what makes it social rather than classifieds — but visually quiet. |
| **5 — Deliberate** | One primary action. Tapping the photo opens detail. Share and more/report as the smallest, lowest-contrast elements. |

**Layout:** photo fills the page. A single bottom gradient scrim serves **both** the overlay and the bottom bar — design them as one gradient, not two stacked treatments. A right-edge vertical rail carries favorite / share / more.

**Chrome budget — moderate, leaning minimal.** Scrim, price, title, **at most two chips**, a quiet seller row, and **at most one** obvious primary action. No large floating cards. No pills.

**Never on the feed:** description, shipping, full attribute lists, timestamps.

**Performance:** only the visible page and its immediate neighbours keep active media.

### 14.2 Search / Explore

The inverse of the feed: dense where the feed is singular. Borrows the **Instagram Explore dense, image-first grid model** — the structure, not the look. Follows system appearance.

- **3-up grid**, gutter `space[1]`.
- The tile is **not the feed card shrunk**: `priceSm` + truncated title only. No chips at this size.
- Same photo treatment and radius as everywhere else.
- Filters use the same `Chip` as the feed's attributes and open in the same `Sheet` as every other sheet in the app. That continuity is what makes filtering feel like the product rather than a form.

### 14.3 Profile

Instagram-shaped structure: identity header (avatar, display name, handle, counts, follow button), then a photo grid **reusing the exact Search tile** — so it inherits 3-up.

Follow is the standard `Button` primary/secondary pair, toggled. Nothing bespoke. Seller identity gets real presence here — this is where "warm and human" is most visible.

### 14.4 Sell

One step per screen, generous spacing, large touch targets. The photo grid is the first and largest element, and includes the **mandatory feed-crop preview** (§11.4).

**AI assistance appears as pre-filled, editable fields**, visually marked as suggestions with a subtle accent border or a small "suggested" chip. It is never a separate magic surface, and the user can always edit or discard. Same `TextField` and `Button` as auth.

### 14.5 Inbox

Pure `ListRow` + `Avatar`. The calmest surface in the app — it is the negative space that makes the feed feel loud. Unread is indicated by weight, a dot, **and** an accessible label; never color alone.

### 14.6 Listing detail

The feed card unfolded: same elements, same order, more room.

Horizontally paged gallery (same image wrapper) → price → title → attribute chips → seller row → description → pinned bottom action bar.

**[OPEN] — dark treatment.** The media/gallery area may be dark while the informational portion follows the system theme. Not locked; decide with the real design in hand.

---

## 15. Contribution & consistency rules

1. **Screens read semantic tokens only.** Never a primitive ramp value, never a raw hex, never a magic number. Zero exceptions.
2. **The second-caller rule.** Do not create a component, variant, or token for one use. Inline it; extract when a genuine second caller appears.
3. **Adding to the system requires updating this document first**, in the same PR.
4. **Order of preference when something doesn't fit:** use an existing token → add a variant to an existing primitive → add a token → add a primitive. Take the first that works.
5. **Deleting is contribution.** Unused variants, dead components, and orphaned assets are removed, not kept "just in case."
6. **The gradient allowlist (§4) is closed.** Adding to it requires explicit agreement, not a judgment call in review.
7. **Accessibility is not a follow-up.** §12 is part of "done."
8. **Instagram is a quality bar, never a visual template.** Changes that move Fynd's palette, gradient, or iconography closer to Instagram's are regressions, regardless of how good they look in isolation.

---

## 16. Open decisions

Tracked deliberately. Each must be resolved explicitly, not by improvisation.

| # | Decision | Notes |
|---|---|---|
| 1 | **Display typeface** | Manrope is the preferred candidate. Reviewable once rendered in Fynd. Nothing else depends on the specific face. |
| 2 | **Listing detail dark treatment** | Media area dark + informational portion system-following is the leading idea. Decide with the real design. |
| 3 | **One further gradient allowlist entry** | Reserved, unassigned. Must be agreed, not claimed. |
| 4 | **Exact elevation shadow values** | Three levels agreed; the warm-tinted values are not yet specified. |
| 5 | **Schema gaps blocking these patterns** | No `size` column, and no `categories`, `favorites`, or `follows` tables exist. The feed hierarchy (§14.1) and Search filters (§14.2) depend on them. |
