# Fynd Design System

The source of truth for Fynd's visual and interaction design. Rules here are enforceable: if code and this document disagree, the code is wrong.

Status: **implemented.** Primitives and semantic tokens live in `apps/mobile/src/design/palette.ts`, with `tokens.ts` and `theme.ts` re-exporting them; the contrast and color-vision floors below are enforced by `palette.test.ts` in CI, not by review. Screens are migrated as they are built. Items marked **[OPEN]** are deliberately undecided and must not be resolved by improvisation in a PR.

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
- **Fynd's visual identity is its own.** Specifically: our brand family is olive and oat — an earth palette that shares no hue with Instagram's magenta-violet sweep, and whose low chroma lets product photography stay the loudest thing on screen. Differentiation now comes from the palette itself rather than from a gradient's stops. Any change that moves us closer to Instagram's palette or iconography is a regression.

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

Near-neutral, with **one accent**. The neutral ramp carries almost everything; the olive accent appears only on primary actions, active navigation, and selected states. Photography supplies the rest of the color on screen.

**The neutrals are warm.** This is what makes Fynd premium without being cold, and it is not optional. Neutrals are tinted toward red/yellow, never blue. Pure `#000000` and `#FFFFFF` are banned as surface colors.

**The palette is warm throughout** — an oat canvas and a deep olive accent, reading editorial and curated rather than utilitarian. Olive also carries meaning here: it is the hue of workwear, army surplus and vintage, which is what second-hand actually looks like.

**The brand is deliberately outside the red sector.** This is the load-bearing structural decision of the palette. The previous brick-crimson accent sat 1° of hue and 1.87:1 from `danger`, which meant a user could not tell "Save" from "Delete" by color — a safety problem, not an aesthetic one (§8). Red now belongs to `danger` alone, and pink to `favoriteActive` alone. Every signal color is verified against the accent in `palette.test.ts`, including under deuteranopia and protanopia.

**The accent is low-chroma on purpose.** A saturated accent competes with product photography; §1's "the interface recedes" is a constraint on the palette, not just on layout.

### Primitive ramps

Warm neutrals:

| Token | Hex | | Token | Hex |
|---|---|---|---|---|
| `neutral.0` | `#FFFFFF` | | `neutral.500` | `#857E78` |
| `neutral.25` | `#FAF9F8` | | `neutral.550` | `#726B65` |
| `neutral.35` | `#F8F4EF` | | `neutral.600` | `#655F5A` |
| `neutral.50` | `#F5F3F1` | | `neutral.700` | `#4A4541` |
| `neutral.100` | `#EDEAE7` | | `neutral.800` | `#2E2A28` |
| `neutral.200` | `#E0DCD8` | | `neutral.900` | `#1A1716` |
| `neutral.300` | `#CAC4BF` | | `neutral.950` | `#0C0A0B` |
| `neutral.400` | `#A8A19B` | | | |
| `neutral.450` | `#8C857E` | | | |

`neutral.450` and `neutral.550` exist because `textTertiary` was `neutral.500` in both schemes and measured **3.56:1** — below the 4.5:1 floor for the normal-sized text it actually carries (`TextField` placeholder, `TextField` helper text, the onboarding availability caption). `neutral.500` now has no consumer and is retained only so the ramp stays a regular scale.

Oat surfaces (light scheme only — the neutral steps above are near-white greys and read cold against a warm canvas, so surfaces get their own family):

| Token | Hex | Role |
|---|---|---|
| `oat.50` | `#FCFAF3` | light `bgElevated` |
| `oat.100` | `#F6F2E8` | **swatch anchor** — light `bg` |
| `oat.200` | `#EAE4D4` | light `bgSunken` |

Softened from the previous cream anchor (`#FBF1D8`, S 72%) to roughly S 44%: at full cream saturation the canvas tints every thumbnail in a 3-up Search grid and competes with the photography §1 makes the hero.

Olive brand ramp (hue ≈78–83°, S 33–45%):

| Token | Hex | Role |
|---|---|---|
| `olive.300` | `#B8CC8A` | — |
| `olive.400` | `#8FA855` | dark `accentText` |
| `olive.500` | `#6B8A36` | ambient glow primary |
| `olive.600` | `#5E7A2E` | dark `accent` |
| `olive.700` | `#4A5D28` | **swatch anchor** — light `accent`, light `accentText`; dark `accentPressed` |
| `olive.800` | `#33421A` | light `accentPressed` |

White text reads **7.27:1** on `olive.700` and **4.88:1** on `olive.600`, so `onAccent` stays white in both schemes.

Signal ramps. Each is a per-scheme pair for the same reason `accent` is (rule 1) — a value dark enough to read on oat is muddy on near-black:

| Token | Hex | Role | | Token | Hex | Role |
|---|---|---|---|---|---|---|
| `rose.500` | `#FF6FA5` | dark `favoriteActive` | | `crimson.400` | `#E8564B` | dark `danger` |
| `rose.600` | `#E93A7D` | light `favoriteActive` | | `crimson.700` | `#BF2A22` | light `danger` |
| `teal.400` | `#63CDBC` | dark `success` | | `amber.400` | `#C87A16` | dark `warning` |
| `teal.700` | `#0B5F55` | light `success` | | `amber.700` | `#9A5D0E` | light `warning` |

Three of these are corrections, not restyles. The old single `danger.500 #D93A3A` was tuned so a *white foreground on it* cleared AA — but `danger`'s real consumers use it as a foreground (error captions), where it measured **4.07:1** light and **4.34:1** dark. `warning.500` measured **3.00:1** as light-scheme text. `success` moved from a yellow-green `#2E9E63` to teal because with an olive brand a green success would reproduce the exact collision this palette exists to remove; the first teal candidate (`#12796B`) was rejected for measuring **1.21:1** from the accent under protanopia.

### Semantic tokens

Screens read **only** these. Never a primitive directly.

| Semantic | Light | Dark |
|---|---|---|
| `bg` | `oat.100` | `neutral.950` |
| `bgElevated` | `oat.50` | `neutral.900` |
| `bgSunken` | `oat.200` | `neutral.950` |
| `bgInverse` | `neutral.900` | `neutral.50` |
| `text` | `neutral.900` | `neutral.25` |
| `textSecondary` | `neutral.600` | `neutral.400` |
| `textTertiary` | `neutral.550` | `neutral.450` |
| `textInverse` | `neutral.25` | `neutral.900` |
| `textOnMedia` | `#FFFFFF` | `#FFFFFF` |
| `border` | `neutral.200` | `neutral.800` |
| `borderStrong` | `neutral.300` | `neutral.700` |
| `borderFocus` | `neutral.950` | `neutral.50` |
| `accent` | `olive.700` | `olive.600` |
| `accentPressed` | `olive.800` | `olive.700` |
| `onAccent` | `#FFFFFF` | `#FFFFFF` |
| `accentText` | `olive.700` | `olive.400` |
| `favoriteActive` | `rose.600` | `rose.500` |
| `danger` / `dangerBg` | `crimson.700` / `#FDF0F0` | `crimson.400` / `#3A1E1E` |
| `onDanger` | `#FFFFFF` | `neutral.900` |
| `success` / `successBg` | `teal.700` / `#E4F1EE` | `teal.400` / `#0F2E29` |
| `warning` / `warningBg` | `amber.700` / `#FDF6E8` | `amber.400` / `#332714` |
| `overlayScrim` | `rgba(12,10,11,0.55)` | `rgba(12,10,11,0.55)` |
| `skeleton` | `neutral.100` | `neutral.800` |

### Rules

1. **`accent` is a per-scheme pair, never one hex.** A value dark enough to pass contrast on oat is muddy on near-black, and vice versa. The same applies to `accentText`, `favoriteActive`, `danger`, `success` and `warning` — every signal token is a pair.
2. **`accent` is reserved** for: primary buttons, the active tab, selected chips/filters, and links. Nothing else.
2a. **Focus rings are NOT an accent use.** `borderFocus` is achromatic (`neutral.950` light / `neutral.50` dark), deliberately decoupled from the brand. An accent-colored focus ring would make `TextField`'s focused and focused+error states hard to separate, and the ring must also not read as a brand moment on a control the user is merely typing in. It separates from `danger` on two axes at once — luminance (3.36:1 light / 3.24:1 dark) and chroma (achromatic vs. saturated) — while reading 18.9:1 / 16.1:1 against the field fill. It was deepened from `neutral.800`/`neutral.200` when the `danger` correction moved the error border closer to it. **Do not "restore" this to the accent color.** Focus is a system state, not a brand moment.
3. **`textOnMedia` is white in both schemes** and is only valid over a scrim. Text over user photography without a scrim is a defect — arbitrary images cannot guarantee contrast.
4. **`favoriteActive` is rose, and never the accent.** It is the one state allowed its own hue, because it is the product's core engagement signal and must not read as "selected." It sits 104° from `accent` and is verified to separate from `danger` on luminance as well as hue — the previous magenta measured 1.02:1 from `danger`, distinguishable by hue alone.
5. Never introduce a new color without adding it here first.
6. **`onDanger` is its own token, decoupled from `onAccent`.** This is no longer hypothetical: on the dark scheme a red light enough to read as text cannot carry a white foreground, so `onDanger` is ink there while `onAccent` stays white. A color surface must never assume another surface's foreground token happens to work for it too.
7. **`bgElevated` is never pure `#FFFFFF`/`#0C0A0B`** — light `bgElevated` is `oat.50`, dark is `neutral.900`. Enforced by `palette.test.ts`, not by review.
8. **Contrast floors are tested, not asserted.** `palette.test.ts` holds every pair in this section to its floor, in both schemes, plus deuteranopia/protanopia separation for `accent` against `danger` and `success`. A palette change that breaks a floor fails CI. Do not weaken a threshold to make a color fit — change the color.

---

## 4. Signature gradient policy

**There is currently no signature gradient.** `gradientBrand` was removed in the Olive & Oat migration.

The previous stops were coral → magenta → orchid → violet, justified as "violet-weighted precisely so it does not read as Instagram's." That rationale died with the red palette and was already flagged for rewrite rather than patching; the stops were never migrated and never had a runtime consumer. An obsolete violet token sitting in an olive design system is worse than no token — it invites someone to use it.

Differentiation from Instagram now comes from the palette itself (§1): an olive-and-oat earth family shares no hue with a magenta-violet sweep, and its low chroma keeps photography the loudest thing on screen.

### Reintroducing one

A brand gradient gets defined when an allowlisted use actually needs it — realistically the Sell tab's center action, when the custom bottom bar is built. Until then this section is deliberately empty rather than speculatively filled.

When it is defined, the allowlist below applies from the start and is **closed** (§15 rule 6):

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
- ❌ As the sole carrier of contrast for text, or the sole signal of a state.

If a surface feels like it needs a gradient, it almost certainly needs better hierarchy instead.

---

## 4a. Ambient background

Two soft, low-intensity radial washes used as atmosphere behind content — currently on Sign In, Sign Up, and profile onboarding. Distinct from a signature gradient in construct and in rule: a gradient is a fixed brand mark for a closed allowlist that explicitly excludes screen backgrounds; this is a background and nothing else.

**Mechanism**: `react-native` core's own `experimental_backgroundImage` radial-gradient support — no gradient library. Each wash fades to full alpha-0 transparency, not just low opacity, so its own geometric boundary is never visible — only a soft interior falloff. Centers sit substantially off-canvas (via the gradient's own `position`, offset beyond a corner), so the effect reads as light spilling in from outside the frame, never a discrete shape sitting on the screen.

**Rules**:
1. Two washes only — `ambientGlow.primary` (olive, `rgba(107,127,58,…)`) and `ambientGlow.secondary` (oat-gold, `rgba(201,168,122,…)`). Keys are palette-agnostic by design, which is exactly why the Olive & Oat migration was a value change here rather than a rename across consumers. The previous values were within 1° of hue of `danger` — the auth screens were washed in the error color. This is deliberately not open-ended; a third color or a third wash needs the same explicit-agreement bar as a gradient allowlist addition.
2. Extremely low intensity (low-single-digit-to-low-double-digit percent alpha at the core, fading to zero) — quiet atmosphere, never a visible tint competing with content.
3. `pointerEvents="none"` always — never intercepts a touch.
4. Motion is slow and continuous (see §10's ambient-motion note) — never the snappy interaction motion used elsewhere.
5. **Progressive enhancement, not a hard dependency**: the surface's semantic `bg` color is always the base fill underneath the washes. If `experimental_backgroundImage` doesn't render on a given platform/renderer, the washes are simply invisible and the screen still reads correctly on the solid neutral background — no feature-detection or fallback branching is added for this; it falls out of the layering itself.
6. Reserved for auth-shaped, otherwise-quiet screens today. Extending it elsewhere is a "does this screen genuinely want atmosphere over content" decision, not an automatic reuse.

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
| `wordmark` | 22 / 28 | 700 | Manrope, letter-spacing -0.3 |
| `price` | 22 / 26 | 700 | Manrope, tabular |
| `priceSm` | 15 / 19 | 700 | Manrope, tabular |
| `body` | 16 / 24 | 400 | System |
| `bodyStrong` | 16 / 24 | 600 | System |
| `label` | 14 / 20 | 600 | System |
| `caption` | 13 / 18 | 400 | System |
| `micro` | 11 / 14 | 600 | System |
| `mono` | 12 / 16 | 500 | System mono |

### Rules

1. The custom face is for `display`, `title`, `heading`, `wordmark`, `price`, `priceSm` **only**. Everything else is system.
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

| Level | Use | Values |
|---|---|---|
| `raised` | Cards, the bottom bar over content, `TextField`, primary `Button` | iOS: `shadowColor #2E2A28 (neutral.800), offset {0,1}, opacity 0.08, radius 3`. Android: `elevation 2`. |
| `overlay` | Sheets, popovers | **[OPEN]** — not yet specified |
| `modal` | Full modals | **[OPEN]** — not yet specified |

Each is a platform-split object (iOS `shadow*`, Android `elevation`). Shadows are subtle and warm-tinted (`neutral.800`), never neutral-blue-black. Prefer a border or a background-tone shift over a shadow where either will do — `raised` above is deliberately barely-there, not a visible drop shadow.

### Destructive actions must differ by silhouette, not hue — STILL REQUIRED

This rule was written when `accent` and `danger` were hue-identical (1° apart, 1.87:1) and a user could not tell "Save" from "Delete" by color alone. The Olive & Oat palette removes that specific collision — `accent` now sits **82°** from `danger`, and the pair is verified under deuteranopia and protanopia — but **the rule stands**, for two reasons:

- §12.4 forbids color-only status outright. Color may reinforce a destructive action; it may never be the only thing carrying it.
- The dark-scheme margin is the thinner one. Olive and red separate mostly by hue there, and hue is exactly what a dichromat loses.

The required resolution is structural:

- **primary** — solid `accent` fill, white label (current behavior, unchanged)
- **destructive** — outlined/tonal: transparent or `dangerBg` fill, `danger` border and label

This makes the two differ in shape, so the distinction never depends on color vision. **This remains a prerequisite for shipping any destructive action.** Until it lands, no solid-filled danger button should reach a user-facing screen.

**Primary `Button` also gets a top/bottom bevel highlight** — `borderTopColor rgba(255,255,255,0.18)` / `borderBottomColor rgba(0,0,0,0.12)`, 1px each, no left/right border. Alpha-based (`buttonHighlight` in `tokens.ts`), not a semantic color — it works unchanged over either scheme's `accent` fill. Top+bottom only, never all four edges: that's the specific choice that keeps this reading as a restrained native-control highlight rather than a skeuomorphic bevel. The highlight disappears while pressed (the fill also swaps to `accentPressed` at the same time), simulating the surface compressing under touch. Primary-only today — extending it to `danger` (the only other solid-fill variant) is a deliberate future decision, not an automatic follow-on.

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

**Ambient/decorative background motion is a separate category from the table above**, not an extension of it. The interactive-feedback tokens (`duration` 100–320ms, `spring`) exist for responses to user action and top out at 320ms; ambient motion (see §4a) runs on 12–20 **second** cycles and is never used for interaction feedback. It uses its own constants (`ambientMotion` in `tokens.ts`) and the same no-spring, no-bounce discipline — smooth ease in/out, never `withSpring`.

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
| `Button` | `primary` / `secondary` / `ghost` / `danger` × `sm` / `md` / `lg`. Loading and disabled built in. 44pt enforced. `primary` carries `elevation.raised` and a top/bottom bevel highlight — see §8. |
| `IconButton` | Icon-only, `hitSlop` to 44pt. `onMedia` variant carries its own scrim. |
| `TextField` | Label + input + helper/error as one unit. Owns focus ring, error state, `color`, and `placeholderTextColor`. Opaque `bgElevated` fill with `elevation.raised` — deliberately not translucent, see §8. |
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

**Category (ROADMAP 2.1)** is a pressable field, not chips: a `Sheet`-based two-level drill-down (`CategoryPickerSheet`) picks a top-level group, then one of its leaves, since ~35 leaves across 6 groups would be an unusable wall of chips.

### 14.5 Inbox

Pure `ListRow` + `Avatar`, with a small listing cover thumbnail in the row's trailing slot. The calmest surface in the app — it is the negative space that makes the feed feel loud. Unread is indicated by weight, a dot, **and** an accessible label; never color alone.

### 14.6 Listing detail

The feed card unfolded: same elements, same order, more room.

Horizontally paged gallery (same image wrapper) → price → title → attribute chips → seller row → description → pinned bottom action bar.

**Attribute chips (ROADMAP 2.1)** are three, not two: condition, size, and a category breadcrumb (e.g. "Women › Shoes"). Unlike the feed card's "at most two chips," this screen has no numeric cap.

**[OPEN] — dark treatment.** The media/gallery area may be dark while the informational portion follows the system theme. Not locked; decide with the real design in hand.

### 14.7 Conversation thread

**[OPEN] — no visual spec yet.** Shipped as a deliberate functional placeholder: plain left/right-aligned `Text` rows (own messages right, the other party's left), no bubble fill, shape, or shadow invented. Replace the styling once a real design exists; the data contract (message list + composer) is not expected to change.

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
| 3 | **One further gradient allowlist entry** | Reserved, unassigned. Must be agreed, not claimed. Moot until a gradient exists again (§4). |
| 6 | ~~**`gradientBrand` palette migration**~~ | **Closed.** Resolved by deletion, not redefinition — see §4. The stale §1/§4 rationale was rewritten rather than patched, as this item required. A gradient gets defined when an allowlisted use needs one. |
| 7 | ~~**`favoriteActive` vs `danger`**~~ | **Closed.** Now `rose.600`/`rose.500`, a per-scheme pair. 1.02:1 → **1.75:1** from `danger` with 22° of hue, and 104° from `accent`. Enforced by `palette.test.ts`. The on-device read of the new rose is still worth doing, but it is a tuning question, not an open decision. |
| 8 | **Destructive-button treatment** | Specified in §8, **still not implemented, still blocking.** The Olive & Oat palette removed the hue collision that motivated it (1° → 82°), which lowers the urgency but not the requirement: §12.4 forbids color-only status, and the dark-scheme margin leans on hue, which dichromats lose. |
| 4 | **Exact elevation shadow values** | `raised` now has concrete values (§8). `overlay`/`modal` remain unspecified. |
| 9 | **Ambient glow intensity on oat** | Alphas were carried over from the red-on-cream tuning and are almost certainly wrong for olive-on-oat — a low-chroma green reads as a shadow rather than a glow if too faint. Retune on device (§4a). |
| 5 | ~~**Schema gaps blocking these patterns**~~ | **Closed.** `size`, `favorites`, `categories`, and now `follows` (ROADMAP 3.1) are all shipped — `size`/`favorites` for the feed hierarchy §14.1 / Search filters §14.2's dependencies, `categories` via ROADMAP 2.1's seeded taxonomy table, `follows` backing §14.3's identity header (counts, follow button). |
