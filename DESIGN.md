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
- **Fynd's visual identity is its own.** Specifically: our brand family is paper and ink — a cream canvas, warm black type, and one loud orange-red that shares no hue with Instagram's magenta-violet sweep. Differentiation comes from the palette itself rather than from a gradient's stops. Note the accent is high-chroma, so what keeps product photography the loudest thing on screen is the strict limit on *where* accent may appear (§3 rule 2), not the accent's own quietness. Any change that moves us closer to Instagram's palette or iconography is a regression.

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

Near-neutral, with **one accent**. The neutral ramp carries almost everything; the ink accent appears only on primary actions, active navigation, and selected states. Photography supplies the rest of the color on screen.

**The neutrals are warm.** This is what makes Fynd premium without being cold, and it is not optional. Neutrals are tinted toward red/yellow, never blue. Pure `#000000` and `#FFFFFF` are banned as surface colors.

**Paper and ink.** A paper-cream canvas, warm black ink, and one loud orange-red. The canvas and the type do the quiet work; the orange is the only voice in the room, which is what makes it carry.

**The brand owns the red-orange sector, and `danger` is magenta.** This is the load-bearing structural decision of the palette, and it is the inverse of the one it replaces. Olive & Oat kept the brand *out* of the red sector so `danger` could own it. Paper & Ink gives that sector to the brand instead, and moves `danger` to magenta so the two never trade places.

**That choice has a cost, and it is paid in luminance.** A green brand and a red `danger` are opposites — 78° apart, so hue alone separated them. A red-orange brand and a magenta `danger` are *neighbours*: the widest this family reaches is 36–52°. Hue can no longer carry "Save is not Delete" by itself, so the separation is carried by **luminance**, and that is what dictates most of the values below rather than taste. `palette.test.ts` enforces all three axes — hue, luminance, and dichromat simulation — and the simulation floors are unchanged from Olive & Oat.

**The accent is high-chroma, unlike its predecessor.** Olive was deliberately low-chroma so it receded behind photography. Ink does not recede; it is a single loud mark against a quiet canvas. §1's "the interface recedes" is now carried by the *canvas and the restraint of where accent is allowed* (rule 2), not by desaturating the accent itself.

### Primitive ramps

Warm neutrals:

| Token | Hex | | Token | Hex |
|---|---|---|---|---|
| `neutral.0` | `#FFFFFF` | | `neutral.500` | `#857E78` |
| `neutral.25` | `#FAF9F8` | | `neutral.550` | `#726B65` |
| `neutral.35` | `#F8F4EF` | | `neutral.600` | `#655F5A` |
| `neutral.50` | `#F5F3F1` | | `neutral.700` | `#4A4541` |
| `neutral.100` | `#EDEAE7` | | `neutral.800` | `#2E2A28` |
| `neutral.200` | `#E0DCD8` | | `neutral.900` | `#1E1A15` |
| `neutral.300` | `#CAC4BF` | | `neutral.950` | `#14110D` |
| `neutral.400` | `#A8A19B` | | | |
| `neutral.450` | `#8C857E` | | | |

`neutral.450` and `neutral.550` exist because `textTertiary` was `neutral.500` in both schemes and measured **3.56:1** — below the 4.5:1 floor for the normal-sized text it actually carries (`TextField` placeholder, `TextField` helper text, the onboarding availability caption). `neutral.500` now has no consumer and is retained only so the ramp stays a regular scale.

Paper surfaces (light scheme only — the neutral steps above are near-white greys and read cold against a warm canvas, so surfaces get their own family):

| Token | Hex | Role |
|---|---|---|
| `paper.50` | `#FAF7F0` | light `bgElevated` |
| `paper.100` | `#F4EFE4` | **swatch anchor** — light `bg` |
| `paper.200` | `#E6E0D2` | light `bgSunken` |

Ink brand ramp (hue ≈8–20°):

| Token | Hex | Role |
|---|---|---|
| `ink.200` | `#FFA385` | dark `accentPressed` |
| `ink.300` | `#FF7D52` | dark `accent` |
| `ink.400` | `#F06A45` | dark `accentText`, dark `favoriteActive` |
| `ink.500` | `#E8481F` | **BRAND SWATCH** — large-type brand ink |
| `ink.700` | `#8B1604` | light `accent`, light `accentText`, light `favoriteActive` |
| `ink.800` | `#6B1103` | light `accentPressed` |

**The brand swatch is not either scheme's `accent` fill, and cannot be.** `ink.500` is the colour the brand *is*, but white on it measures **3.9:1**, as normal text on paper it measures **3.4:1**, and its luminance (0.219) lands *inside* the dark scheme's `danger` window — making it the one orange a dichromat cannot separate from magenta on near-black. So each scheme takes the step that clears its own constraints and the swatch stays the swatch.

The two schemes move in **opposite directions** from it, which is the part most likely to look like a mistake and is not:

- **Light** goes *darker* (`ink.700`, a deep burnt red-orange). The fill has to carry a white label at 4.5:1 **and** sit clearly below `danger`'s luminance window. Measured: white **9.5:1**, **11.5:1** against `bg`.
- **Dark** goes *brighter* (`ink.300`). On near-black the accent must clear `danger`'s window to stay separable, and the only direction with room is up — a darker orange fails 3:1 against the background instead. Measured: **8.1:1** against `bg`, with an **ink** label at **7.5:1** (see rule 6).

There is no `ink.600`. The ramp is numbered by lightness position and nothing needs a step between the swatch and the light accent; an unused step is a value someone eventually reaches for by accident.

Signal ramps. Each is a per-scheme pair for the same reason `accent` is (rule 1) — a value dark enough to read on paper is muddy on near-black:

| Token | Hex | Role | | Token | Hex | Role |
|---|---|---|---|---|---|---|
| `magenta.400` | `#F00094` | dark `danger` | | `teal.400` | `#63CDBC` | dark `success` |
| `magenta.700` | `#D0116A` | light `danger` | | `teal.700` | `#0B5F55` | light `success` |
| `amber.400` | `#C7A123` | dark `warning` | | | | |
| `amber.700` | `#7A6410` | light `warning` | | | | |

**`danger` is pinned, not chosen.** Two constraints squeeze it from both sides: it is a *foreground* token (error captions), so it needs 4.5:1 on its own background; and it is the error *border*, so it needs 3:1 against `borderFocus` (rule 2a). Together those leave a narrow luminance window — roughly **0.117–0.153** on paper, **0.201–0.266** on ink. Both magenta steps sit in their window, and `accent` is placed outside it. That window is also why `danger` is saturated rather than a calmer dusty rose: magenta's blue channel is the only thing left to separate it from an orange accent once hue collapses, and desaturating either step drops accent-vs-danger below **1.6:1** under simulation.

`amber` moved from hue ≈34° to ≈46°. Against an *orange* brand the old amber sat 14–20° away — close enough to read as a dimmer accent. The golder hue restores **31–40°** while staying unmistakably amber, not chartreuse. `teal` is unchanged from Olive & Oat: it was already chosen to sit far from a warm accent and still measures **1.65:1** from `accent` under both simulations.

### Semantic tokens

Screens read **only** these. Never a primitive directly.

| Semantic | Light | Dark |
|---|---|---|
| `bg` | `paper.100` | `neutral.950` |
| `bgElevated` | `paper.50` | `neutral.900` |
| `bgSunken` | `paper.200` | `neutral.950` |
| `bgInverse` | `neutral.950` | `paper.100` |
| `text` | `neutral.950` | `paper.100` |
| `textSecondary` | `neutral.600` | `neutral.400` |
| `textTertiary` | `neutral.550` | `neutral.450` |
| `textInverse` | `paper.100` | `neutral.950` |
| `textOnMedia` | `#FFFFFF` | `#FFFFFF` |
| `border` | `neutral.200` | `neutral.800` |
| `borderStrong` | `neutral.300` | `neutral.700` |
| `borderFocus` | `neutral.950` | `neutral.50` |
| `accent` | `ink.700` | `ink.300` |
| `accentPressed` | `ink.800` | `ink.200` |
| `onAccent` | `#FFFFFF` | `neutral.950` |
| `accentText` | `ink.700` | `ink.400` |
| `favoriteActive` | `ink.700` | `ink.400` |
| `danger` / `dangerBg` | `magenta.700` / `#FBEAF2` | `magenta.400` / `#3A1528` |
| `onDanger` | `#FFFFFF` | `neutral.950` |
| `success` / `successBg` | `teal.700` / `#E4F1EE` | `teal.400` / `#0F2E29` |
| `warning` / `warningBg` | `amber.700` / `#FDF6E8` | `amber.400` / `#332714` |
| `overlayScrim` | `rgba(20,17,13,0.55)` | `rgba(20,17,13,0.55)` |
| `skeleton` | `paper.200` | `neutral.800` |

### Rules

1. **`accent` is a per-scheme pair, never one hex.** A value dark enough to pass contrast on paper is muddy on near-black, and vice versa. The same applies to `accentText`, `favoriteActive`, `danger`, `success` and `warning` — every signal token is a pair.
2. **`accent` is reserved** for: primary buttons, the active tab, selected chips/filters, links, and — the one deliberate addition to this list — the Home feed card's **price plate and recency tag** (§14.1). Nothing else. Those two are non-interactive accent *fills* rather than accent *text*, always paired with `onAccent`, which is what keeps them legible over arbitrary photography where accent-coloured text would measure ≈1.1:1. This restraint matters more under Paper & Ink than it did under Olive & Oat: the accent is now high-chroma, so the places it is *not* allowed are what keep §1's "the interface recedes" true.
2a. **Focus rings are NOT an accent use.** `borderFocus` is achromatic (`neutral.950` light / `neutral.50` dark), deliberately decoupled from the brand. An accent-colored focus ring would make `TextField`'s focused and focused+error states hard to separate, and the ring must also not read as a brand moment on a control the user is merely typing in. It separates from `danger` on two axes at once — luminance (3.56:1 light / 3.70:1 dark) and chroma (achromatic vs. saturated) — while reading 18.1:1 / 15.3:1 against the field fill. This rule is also one half of what pins `danger`'s luminance window (see the signal ramps above). **Do not "restore" this to the accent color.** Focus is a system state, not a brand moment.
3. **`textOnMedia` is white in both schemes** and is only valid over a scrim. Text over user photography without a scrim is a defect — arbitrary images cannot guarantee contrast.
4. **`favoriteActive` is the brand ramp, and that is a deliberate reversal.** Olive & Oat gave favorite its own hue (rose) specifically so it could not read as "selected." Paper & Ink puts favorite *on* the brand — in the light scheme it is the same value as `accent`. The old rule's protection is therefore gone by choice, and what replaces it is **shape**: the heart's filled/outline change is what communicates the state, never colour (§12.4). What still holds, and is still tested, is separation from `danger` — a filled heart must never read as a destructive control (1.79:1 light / 1.34:1 dark, plus ≥15° of hue).
5. Never introduce a new color without adding it here first.
6. **`onAccent` and `onDanger` are each their own token, and neither is white in both schemes.** `onDanger` has always been ink on dark. Under Paper & Ink `onAccent` joins it: an orange loud enough to be the dark accent carries a white label at only 3.1:1, so the dark label is ink (7.5:1). A color surface must never assume another surface's foreground token happens to work for it too — and must not assume its *own* foreground is the same in both schemes.
7. **`bgElevated` is never pure `#FFFFFF`/`#000000`** — light `bgElevated` is `paper.50`, dark is `neutral.900`. Enforced by `palette.test.ts`, not by review.
8. **Contrast floors are tested, not asserted.** `palette.test.ts` holds every pair in this section to its floor, in both schemes, plus deuteranopia/protanopia separation for `accent` against `danger` and `success`. A palette change that breaks a floor fails CI. Do not weaken a threshold to make a color fit — change the color.
9. **With a warm brand, luminance is the load-bearing axis.** Olive & Oat could separate `accent` from `danger` by hue alone (78°). Paper & Ink cannot (36–52°), so `palette.test.ts` adds a luminance floor between them and treats the dichromat-simulation floors as the primary guard rather than a backstop. If a future change moves `accent` or `danger`, check the *simulated* separation first — the raw hue angle is the least informative number for this brand family.

---

## 4. Signature gradient policy

**There is currently no signature gradient.** `gradientBrand` was removed in the Olive & Oat migration.

The previous stops were coral → magenta → orchid → violet, justified as "violet-weighted precisely so it does not read as Instagram's." That rationale died with the red palette and was already flagged for rewrite rather than patching; the stops were never migrated and never had a runtime consumer. An obsolete violet token sitting in a palette that no longer contains violet is worse than no token — it invites someone to use it.

Differentiation from Instagram now comes from the palette itself (§1): a paper-cream canvas with a single orange-red mark shares no hue with a magenta-violet sweep. Note that Paper & Ink's `danger` *is* magenta — which is exactly why magenta is confined to the error role and never used as a brand surface or gradient stop.

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

## 4a. Ambient background — REMOVED

Two soft radial washes (`ambientGlow.primary` / `.secondary`, driven by `ambientMotion`) sat behind Sign In, Sign Up and profile onboarding. The auth redesign replaced all three of those screens with a solid `bg` and moved the atmosphere into the welcome screen's photo collage instead, leaving `components/ambient-background.tsx` with zero consumers. Per §15 rule 5 the component and both token objects were deleted rather than parked.

**If atmosphere is ever wanted again**, three things from the original are worth keeping and one is not:

- *Keep the mechanism.* `react-native` core's own `experimental_backgroundImage` gradient support, no library. `gradientScrim` and `gradientFade` in `tokens.ts` still use it.
- *Keep the falloff rule.* Each wash must fade to full alpha-0, not merely low opacity, so its own geometric boundary is never visible — only a soft interior falloff. Centers belong substantially off-canvas so the effect reads as light spilling in from outside the frame, never a discrete shape on the screen.
- *Keep the layering rule.* The surface's semantic `bg` is always the base fill underneath. If `experimental_backgroundImage` does not render on some platform, the washes are simply invisible and the screen still reads correctly — progressive enhancement that falls out of the layering, with no feature detection.
- *Do not restore the old alphas.* They were tuned on-device for the low-chroma Olive & Oat wash and were never re-tuned after Paper & Ink moved the primary stop to the brand ink orange (`ink.500`), which is far more assertive at the same alpha. They needed retuning downward and never got it.

A reintroduction is a fresh decision at the same bar as a gradient-allowlist addition (§4), not a revert.

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

| Level | Use | Values |
|---|---|---|
| `raised` | Cards, the bottom bar over content, `TextField`, primary `Button` | iOS: `shadowColor #2E2A28 (neutral.800), offset {0,1}, opacity 0.08, radius 3`. Android: `elevation 2`. |
| `overlay` | Sheets, popovers | **[OPEN]** — not yet specified |
| `modal` | Full modals | **[OPEN]** — not yet specified |

Each is a platform-split object (iOS `shadow*`, Android `elevation`). Shadows are subtle and warm-tinted (`neutral.800`), never neutral-blue-black. Prefer a border or a background-tone shift over a shadow where either will do — `raised` above is deliberately barely-there, not a visible drop shadow.

### Destructive actions must differ by silhouette, not hue — STILL REQUIRED

This rule was written when `accent` and `danger` were hue-identical (1° apart, 1.87:1) and a user could not tell "Save" from "Delete" by color alone. Olive & Oat removed that specific collision by moving the brand to the opposite sector (82°). **Paper & Ink gives part of it back on purpose**, and the rule is correspondingly *more* load-bearing now, not less:

- §12.4 forbids color-only status outright. Color may reinforce a destructive action; it may never be the only thing carrying it.
- `accent` and `danger` are now **neighbours** (36–52°), not opposites. The separation is carried by luminance and verified under deuteranopia/protanopia (1.68–2.05:1) rather than by hue — see §3. That is enough to tell two surfaces apart; it is *not* enough to let colour alone mark one of them destructive.

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

**Ambient/decorative background motion would be a separate category from the table above**, not an extension of it — but there is none in the app today. The `ambientMotion` constants were deleted with the ambient background (§4a), and nothing currently animates on a multi-second cycle. The distinction is recorded because it still binds anything that brings such motion back: the interactive-feedback tokens (`duration` 100–320ms, `spring`) are for responses to user action and top out at 320ms, so decorative motion on 12–20 **second** cycles needs its own constants rather than stretching these, and carries the same no-spring, no-bounce discipline — smooth ease in/out, never `withSpring`.

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
| `Button` | `primary` / `secondary` / `ghost` / `danger` / `inverse` × `sm` / `md` / `lg`. Loading and disabled built in. 44pt enforced. `primary` carries `elevation.raised` and a top/bottom bevel highlight — see §8. `inverse` is a solid `bgInverse` fill with a `textInverse` label, borderless and unbevelled (the fill is already the highest-contrast surface against the page, so it needs no stroke to separate it). Note what `inverse` means: "the opposite of the current background," so it is near-black on paper in light and cream on ink in dark. Anything that must stay literally dark in both schemes is **not** this variant. |
| `IconButton` | Icon-only, `hitSlop` to 44pt. `onMedia` variant carries its own scrim. |
| `TextField` | Label + input + helper/error as one unit. Owns focus ring, error state, `color`, and `placeholderTextColor`. Opaque `bgElevated` fill with `elevation.raised` — deliberately not translucent, see §8. Optional `leading` / `trailing` slots render **inside** the stroke: the box decoration lives on the field row, not the `TextInput`, which is what makes that possible. That move takes the 16pt padding out of the input's own touch area, so **the row is a `Pressable` that forwards presses to `focus()`** — without it a tap just inside the stroke misses the input and, under `keyboardShouldPersistTaps="handled"`, dismisses the keyboard instead. `leading` is for static adornments only (`@` prefix, currency symbol) since it sits where users tap to focus, and **must be hidden from AT** (`accessible={false}` + `importantForAccessibility="no"`) — an RN `Text` is otherwise its own announced stop. Interactive controls go in `trailing` and must carry their own `accessibilityLabel` (the field's label is folded into the input's) and their own `minWidth`/`minHeight` to reach 44pt, since the row grants only the space an accessory asks for. Single-line rows centre their accessories; multiline rows pin them to the top, where the caret starts. |
| `Avatar` | `xs`/`sm`/`md`/`lg`/`xl`. Initials fallback. `xl` (84) is the onboarding picker's size and exists as a real step rather than a `style` override, because the picker's empty state is a separate dashed circle of the same diameter — if the two diverged the control would visibly resize the moment a photo was chosen. |
| `Logo` | The brand lockup. Required `height`, width derived from the source art's 496:234 ratio, so it cannot be stretched; a fixed optical size, deliberately not Dynamic Type-scaling. `tone` names the SURFACE, never the artwork — `auto` follows the scheme; `onLight`/`onDark` are for deliberately inverted surfaces (e.g. `bgInverse`, where `auto` picks the wrong wordmark); `onMedia` is for over photography. Three flat-colour cuts, not one tinted at runtime: `onLight`/`onDark` keep the brand-orange mark and swap only the wordmark, but **`onMedia` is all cream, mark included** — it carries no brand colour and so depends entirely on the scrim beneath it for contrast (rule 2 of §12). |
| `Chip` | Static badge and interactive filter, one component via a `selectable` prop. Radius `sm`–`md`, never pill. Three surfaces: accent fill when `selected` (§3's sanctioned "selected chips/filters" use), `bgInverse`/`textInverse` under `tone="inverse"`, and the quiet neutral default. `tone` describes only how a chip RESTS — selection outranks it, so a selected chip is never painted inverse. Reach for `inverse` when the chip states something already committed and dismissible (Explore's active-filter tokens), not something on offer. |
| `ListRow` | Leading slot / title + subtitle / trailing slot. |
| `Sheet` | Detents, drag handle, scrim, keyboard avoidance. The only bottom-sheet implementation. |
| `Skeleton` | Shimmer block, plus composed `SkeletonListingCard` / `SkeletonRow`. |
| `Switch` | Controlled on/off toggle. Thin tokenizing wrapper around RN's native `Switch`: `accent` track when on, `borderStrong` when off, `onAccent` thumb. Touch target and thumb animation are the native control's own. `accessibilityRole="switch"`. |
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
| **2 — Legible without reading** | **Price** (the most-scanned datum in second-hand; the one element allowed to be loud), set as a solid `accent` **price plate** with an `onAccent` label — opaque, so it never depends on the photo underneath · **Favorite** (large target, right-thumb reachable). |
| **3 — One glance** | Title, uppercase, truncated 1–2 lines · a **size · condition** specs line — the same two attributes that decide relevance faster than the title, set as one tracked uppercase line rather than two `Chip`s. The card uses no `Chip` at all. |
| **4 — Trust** | Seller avatar + handle. Present on every item — this is what makes it social rather than classifieds — but visually quiet. The row is tappable and opens the seller's closet (`/(app)/seller/[id]`); it shows `@handle` where one exists, falling back to display name. |
| **5 — Deliberate** | Tapping the photo opens detail. **One** explicit primary action — **Text seller** — closes the caption block, hidden on the viewer's own listing. More/report stays the smallest, lowest-contrast element. Share remains unbuilt. |

**Layout:** photo fills the page. A single bottom gradient scrim serves **both** the overlay and the bottom bar — design them as one gradient, not two stacked treatments. A right-edge vertical rail carries favorite / more (share unbuilt). The rail is **top-aligned beside the seller/title block**, so the favorite button lines up with the seller's avatar, and the price + CTA row sits below spanning the full width. That placement does three jobs: it matches the design, it keeps the rail out of the title's way (the rail claims horizontal space rather than floating over it), and it keeps the rail far enough down the scrim's ramp to have real backing — stacked above the whole caption it would sit in the gradient's transparent top, where the accent-tinted favorited glyph measures ~1.4:1 against a bright photo. Height stays content-driven and the `insets.bottom` clearance for the floating tab bar is unchanged. **No fixed offsets from the bottom edge, ever** — the mock's 100px/250px are not reproducible across devices.

**Chrome budget — moderate, leaning minimal.** Scrim, an optional recency tag, a quiet tappable seller row, title, one specs line, a price plate, **exactly one** obvious primary action, and the two-icon rail. No chips on the card. No large floating cards. No pills.

**Never on the feed:** description, shipping, full attribute lists, or any rendered timestamp. One **derived binary** recency flag ("Just dropped", `created_at` within `JUST_DROPPED_WINDOW_MS` = 48h) is permitted: it shows no date, no clock time, and no "x days ago" age. A second such flag needs the same explicit bar.

**Type treatment — this card, and nowhere else.** `heading` (title), `micro` (tag, specs line) and `label` (handle) carry local inline `textTransform: 'uppercase'` and `letterSpacing` — title −0.2, tag +2.2, specs +1.8. Recorded here so the values are traceable rather than magic; no new `Text` variant is added (§15.2 — one caller). `Button`'s own label is **not** uppercased: it forwards container `style` but renders its label through its own `Text`, so no text style or font-scale cap reaches it. `maxFontSizeMultiplier` is capped at 1.4 on these nodes — the one place §5 rule 5 permits it.

**On-media text is never dimmed with `opacity`.** The scrim only guarantees legibility for opaque `textOnMedia`, and at `gradientScrim`'s 0.75 bottom alpha even that measures ≈3.45:1 against a maximally bright photo. The mock's 72%-opacity specs line measures ≈2.77:1, failing both floors. De-emphasis comes from size and tracking, not alpha.

**Accessibility invariant — invisible to visual review, so it is written down.** The card is five AT stops: the photo (one composed label carrying tag, title, price, size, condition and seller), favorite, more, the seller row, and Text seller — plus a conditional **sixth** when the CTA errors. Three things must not be "simplified":
- Every non-interactive group carries `pointerEvents="none"`, the error plate included. A plain `View` is a hit-test target and the gesture detector is a *sibling*, not an ancestor — so without it, taps there stop reaching the photo's recognizers and "tap anywhere to open" dies silently.
- The hide props (`accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"`) are narrower: they go only on the three **decorative** groups (tag, title block, price plate), whose content the photo's composed label already speaks. The error plate is deliberately *not* hidden — a screen-reader user who taps the CTA and gets nothing must be told why. `accessibilityLiveRegion` is Android-only, so `accessibilityRole="alert"` is what carries that on iOS; both go on the `Text`, matching every other error site in the app.
- The hide props live on the **individual groups**, never on the caption container. On the container they would delete the seller row and the CTA from the accessibility tree, with no visual change to catch it.

**Error surface.** The CTA's failure message sits on a solid `danger` fill with an `onDanger` label — not `danger` on `dangerBg`, which measures 3.89:1 in the dark scheme (below the 4.5:1 this caption-sized text needs) and is asserted nowhere in `palette.test.ts`. `onDanger`-on-`danger` is a tested pair at 4.60:1. Bare `danger` text over photography is worst-case ~1.5:1 and is never acceptable here.

**Touch-target exception.** The seller row reaches 44pt via `hitSlop` at the call site rather than inside a primitive — the one place §12 rule 1's "never left to call sites" is relaxed, because a `minHeight` would add dead vertical space to a tight caption and make the scrim taller. Listing detail's own seller row does the same.

**[OPEN] — favorited-glyph contrast.** The rail's own `overlayScrim` disc plus the gradient at the rail's position give the accent-tinted *favorited* heart **≈2.0–2.8:1** against a maximally bright photo (2.7 with the recency tag present, 2.0 without), short of §12 rule 2's 3:1 for meaningful icons. The unfavorited white glyph and the ellipsis are fine at ≈4.2:1. Not a §12 rule 4 problem — the state is also carried by the filled/outline glyph swap, the `accessibilityState.selected` flag, and the label swap — so this is glyph legibility against the worst-case photo, not state encoding, and the realistic case is far better. Closing it properly means either deepening `gradientScrim`'s early ramp (its only consumer is this card) or giving `IconButton`'s `onMedia` variant a denser disc; both are shared-surface changes deferred rather than made here.

**Performance:** only the visible page and its immediate neighbours keep active media.

**Scope toggle (ROADMAP 3.2).** A "For you" / "Following" pair sits above the feed as screen-level chrome, not card content — it is **not** subject to the chrome budget above, which bounds what one card overlay shows, not the screen's own top-level navigation — note the budget now bars chips from the card entirely, which makes these two the only `Chip`s on the screen. Implemented as two `Chip`s in their existing `selectable`/`selected` mode (§13) — no new SegmentedControl primitive; two carefully-indistinguishable options is exactly what the second-caller rule (§15.2) asks to inline rather than invent a component for. Introduces no new scrim or gradient: each card's `gradientScrim` is already transparent at its top stop, so legibility comes from the Chip's own opaque fill.

### 14.2 Search / Explore

The inverse of the feed: dense where the feed is singular. Borrows the **Instagram Explore dense, image-first grid model** — the structure, not the look. Follows system appearance.

- **3-up grid**, gutter `space[1]`, **4:5 portrait covers** (`TALL_TILE_ASPECT_RATIO`). The Saved and seller-closet grids still use the square crop, so the ratio is a `ListingGridTile` prop — retiring the square is a per-screen decision taken with that screen's design in hand, not a silent global restyle. `SkeletonListingCard` takes the same prop and callers **must** pass the matching value, or every row jumps height when results land.
- The tile is **not the feed card shrunk**: `priceSm` + truncated title only. No chips at this size.
- Same photo treatment and radius as everywhere else.
- **Header order**: title, search field, category tabs, active-filter chips, result count + sort. The search field is a persistent sibling of the list; everything from the tabs down is the grid list's own header, so it scrolls away with the results and is absent entirely when recent searches replace the grid.
- **Category tabs commit a top-level group id**, which needs no client-side fan-out: `search_listings` matches `cat.id = p_category_id OR cat.parent_id = p_category_id`. A leaf chosen in the filter sheet lights up its parent tab, since both resolve through `findCategoryMatch`. Use that, never the leaf-only `findCategorySelection`, anywhere a group id can reach — an unresolved label makes `deriveActiveFilterChips` drop the chip, leaving a live filter invisible and unremovable.
- **The result count is a floor, not a total.** `search_listings` returns a page and no count, so the line reads "24+ results" whenever another page exists and a bare "24 results" only once every page is loaded. A real total needs a server-side count; until then, do not print the loaded count as if it were one.
- **Sort offers only what the RPC supports** — `newest` and `price`, the latter ascending only (`order by l.price_amount asc`), which is why its label names the direction. A bare "Price" would imply a toggle that does not exist.
- Filters use the same `Chip` as the feed's scope toggle and listing detail's attributes, and open in the same `Sheet` as every other sheet in the app — one `Sheet` instance serving filters, the category picker and sort as swapped content, so the screen never has two Modals mounted at once. That continuity is what makes filtering feel like the product rather than a form.
- Grid content reserves bottom padding for the native tab bar; `NativeTabs` does not expose its height, so the clearance is a documented constant that errs high.

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

The feed card unfolded: same elements, more room — but a different emphasis and order. The feed leads with the photo and defers everything else to a caption block (tag → seller → title → specs → price); detail leads with price and title and gives the attributes their own row.

Horizontally paged gallery (same image wrapper) → price → title → attribute chips → seller row → description → pinned bottom action bar.

**Attribute chips (ROADMAP 2.1)** are three: condition, size, and a category breadcrumb (e.g. "Women › Shoes"). This is the screen that uses chips for attributes — the feed card compresses the same condition/size pair into a single specs line (§14.1) — and it has no numeric cap.

**[OPEN] — dark treatment.** The media/gallery area may be dark while the informational portion follows the system theme. Not locked; decide with the real design in hand.

### 14.7 Conversation thread

**[OPEN] — no visual spec yet.** Shipped as a deliberate functional placeholder: plain left/right-aligned `Text` rows (own messages right, the other party's left), no bubble fill, shape, or shadow invented. Replace the styling once a real design exists; the data contract (message list + composer) is not expected to change.

### 14.8 Auth & onboarding

Five screens: welcome, sign in, create account, check email, set up profile — plus a password-reset request screen. All share one shape: `Logo` + title + supporting line, a field stack, then actions, left-aligned on a solid `bg`. (They previously sat on the ambient washes; see §4a for why those are gone.)

**Welcome is the entry point and the one exception.** It forces the dark scheme for its whole subtree, the same mechanism the Home feed uses, rather than painting `bgInverse` by hand. That is load-bearing: inside a dark subtree every token resolves for a dark surface on its own — `bg`, both button variants, text colors, and `Logo`'s own `auto` tone picking the cream wordmark. Hand-inverting the surface would mean overriding each of those at the call site and would silently go wrong the first time one was missed.

Its top ~62% is a three-column photo collage dissolved into the page by `gradientFade`. Two rules: the collage is **decorative** (`pointerEvents="none"`, and the whole subtree hidden from screen readers — a dozen unlabelled images announced ahead of the sign-in buttons buries the only content that matters), and its tile layout is **fixed, never randomised**, because a wall that reshuffles on re-render reads as a glitch. Photos are bundled assets, not live listings: `feed_listings` is `security invoker` over a private bucket, so a signed-out caller gets no rows and no signed URLs — showing real listings pre-auth would mean opening anonymous read access, which is not a trade worth making for decoration.

**Where this deliberately departs from the handoff mock:**

1. *Buttons.* The mock draws `#E8481F` + white, which measures **3.9:1** and fails AA — the exact reason §3 keeps the brand swatch out of both schemes' `accent`. Welcome uses dark-scheme `primary` (coral fill, ink label) instead. Do not "fix" it back toward the mock.
2. *Password minimum.* The mock's helper reads "At least 8 characters" while also saying to match the zod rule, which is `MIN_PASSWORD_LENGTH = 6`. The code wins, and the copy is **interpolated from the constant** (`PASSWORD_HELPER_TEXT`) so the two can never drift again.

**The password meter measures length only** — four segments at `MIN_PASSWORD_LENGTH` and every two characters after. It is not entropy and not a security claim: a repeated character fills the bar. That is why the copy beside it states the length requirement outright instead of calling a full bar "strong", and why nothing gates on its value. It is hidden from screen readers as a decorative duplicate of the helper text it visualises.

**Check email's primary action is `inverse`, not `primary`** — the one auth screen where that is true. The accent is already spent on the 72px mail badge directly above it, and §3 rule 2 limits where accent may appear; a second accent-filled element would make the screen's loudest mark compete with itself. This is deliberate, not an oversight to normalise later.

**Password reset is request-only.** The client sets `detectSessionInUrl: false`, so a recovery deep link cannot establish the session a reset needs; the emailed link resolves to the project's Site URL instead. The confirmation screen says so plainly rather than letting the user discover it. It also says "if an account exists" rather than "email sent", because GoTrue answers 200 either way specifically to prevent account enumeration — wording it as a confirmed send would leak what that protects.

**Check email owns the resend cooldown.** 60 seconds, client-side, and a courtesy rather than a limit: the real one is GoTrue's `over_email_send_rate_limit`, which `mapAuthError` translates. The countdown is driven by a **fixed deadline and a clock**, never a decrementing counter — JS timers are throttled while backgrounded, which is precisely what happens when the user leaves for their mail app, and a counter would come back wrong.

**Avatar in onboarding is optional and commits immediately**, independent of the form's Continue button — the same precedent as `profile/edit.tsx` and Sell's photo section, and the reason `onboardingSchema` has no avatar field. The dashed empty circle plus `+` badge is **one** touch target with one accessible name; the badge is chrome on that button, not a second control. Its caption sits INSIDE that target, so the words that read as the control's label are tappable and do not announce twice.

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
| 7 | ~~**`favoriteActive` vs `danger`**~~ | **Closed, on different grounds than before.** Paper & Ink moves favorite onto the brand ramp (`ink.700`/`ink.400`), so it is no longer a separate hue and in the light scheme it equals `accent` — see §3 rule 4. Separation from `danger` is still enforced by `palette.test.ts` (1.79:1 light / 1.34:1 dark, ≥15° hue); separation from `accent` is now carried by the heart's filled/outline shape, not by colour. |
| 8 | **Destructive-button treatment** | Specified in §8, **implemented (ROADMAP 6.1b) — `Button`'s `danger` variant is outlined/tonal, not solid.** Paper & Ink makes the rule *more* important, not less: `accent` and `danger` are now 36–52° apart rather than 82°, so silhouette carries more of the load. |
| 4 | **Exact elevation shadow values** | `raised` now has concrete values (§8). `overlay`/`modal` remain unspecified. |
| 9 | ~~**Ambient glow intensity**~~ | **Closed by removal, not by tuning.** The auth redesign took the ambient washes off the only three screens that used them, so the component and both token objects were deleted (§4a, §15 rule 5) and the untuned alphas went with them. Nothing was retuned and nothing shipped on hardware — if atmosphere returns, §4a records what to keep and explicitly warns against restoring these alphas verbatim. |
| 5 | ~~**Schema gaps blocking these patterns**~~ | **Closed.** `size`, `favorites`, `categories`, and now `follows` (ROADMAP 3.1) are all shipped — `size`/`favorites` for the feed hierarchy §14.1 / Search filters §14.2's dependencies, `categories` via ROADMAP 2.1's seeded taxonomy table, `follows` backing §14.3's identity header (counts, follow button). |
