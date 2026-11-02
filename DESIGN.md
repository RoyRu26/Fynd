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

**Two custom display faces, system body.**

- **Expanded display face: Archivo Expanded Black** (900, 125% width), for screen titles and section headers only — `display` and `displaySm`. Bundled as an OFL static in `assets/fonts/` with its licence, because `@expo-google-fonts/archivo` ships only the normal width and no `archivo-expanded` package exists. Turn-4 screens set these **lowercase at the call site**; the variant does not force `textTransform`, so a proper noun in a title is still spelled correctly.
- **Display face: Manrope.** Current preferred candidate — chosen as a contemporary geometric sans with warmth and character, avoiding both high-contrast serifs (read luxury) and neutral grotesques (read cold). **[OPEN] — explicitly reviewable once seen rendered in Fynd.** If it reads wrong in context, we change it; nothing else in this document depends on the specific face.
- **Body face: system.** SF Pro on iOS, Roboto on Android. Perfect Dynamic Type, zero cost, instant render.

### Scale

| Variant | Size / Line height | Weight | Face |
|---|---|---|---|
| `display` | 34 / 38 | 900 | Archivo Expanded, tracking −0.68 |
| `displaySm` | 20 / 24 | 900 | Archivo Expanded |
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

1. The Manrope face is for `title`, `heading`, `price`, `priceSm` **only**; Archivo Expanded is for `display` and `displaySm` **only**. Everything else is system. Keeping the expanded cut on its own two variants is what stops it leaking into ordinary headings.
2. **Every custom-face variant declares an explicit `lineHeight`** — neither Manrope nor Archivo Expanded shares system font metrics, so an inherited line height will be wrong. See rule 5 for the floor it has to clear.
3. Price always uses **tabular numerals**, so prices align in the grid and don't jitter when values change.
4. **`letterSpacing` is points in react-native, not em.** Any tracking taken from a design handoff must be resolved against the variant's own font size before it is written here — an em value passed through renders as near-zero tracking and reads merely "a bit tight", which survives review. `display`'s −0.68 is −0.02em against 34pt, and it does not rescale if the size changes.
5. **Declared `lineHeight` must clear the face's own line box.** CSS lets a tight line-height overlap and spill visibly; react-native CLIPS ascenders and descenders instead, which §12.3 forbids. Archivo Expanded Black measures 1.088em (hhea 878 / −210 at 1000 upem), so `display` ships 34/**38** rather than the handoff's 34/36 — 34pt needs 36.99. Check this whenever a face or a size changes.
6. Fonts load before the splash hides. The existing `AnimatedSplashOverlay` already gates on an `isReady` flag — font loading joins auth resolution as a readiness input.
7. Dynamic Type is respected everywhere. `maxFontSizeMultiplier` is permitted **only** on the feed overlay, never on body content.

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
- `full`: avatars, circular icon buttons, and the two components below. **Chips are never pills** — that part of the original rule stands unchanged (§13's `Chip` stays `sm`).
- **Pill carve-out**, added with the Turn-4 screens: `PillButton` (46pt, full radius) and `ReactionPill` are deliberately pill-shaped. This narrows the former blanket "Fynd does not use pill-shaped chips or buttons"; it does not repeal it. A pill is reachable only through those two named components, so the shape stays a deliberate choice at a known call site rather than something any `borderRadius` can opt into. The Sell tab's "your rack" status badge (§14.4) is a third, narrower case: a small **static** Live/Draft/Sold label, never tappable, so it carries none of the "which control am I" risk a pill button or filter would. Local to that one screen per §15 rule 2 — not a fourth named component.

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

1. **Touch targets ≥ 44×44pt**, enforced inside the primitives (`Button`/`IconButton`, and a selectable `Chip`) via minimum height or `hitSlop` — never left to call sites.
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
| `TextField` | Label + input + helper/error as one unit. Owns focus ring, error state, `color`, and `placeholderTextColor`. Opaque `bgElevated` fill with `elevation.raised` — deliberately not translucent, see §8. Optional `leading` / `trailing` slots render **inside** the stroke: the box decoration lives on the field row, not the `TextInput`, which is what makes that possible. That move takes the 16pt padding out of the input's own touch area, so **the row is a `Pressable` that forwards presses to `focus()`** — without it a tap just inside the stroke misses the input and, under `keyboardShouldPersistTaps="handled"`, dismisses the keyboard instead. `leading` is for static adornments only (`@` prefix, currency symbol) since it sits where users tap to focus, and **must be hidden from AT** (`accessible={false}` + `importantForAccessibility="no"`) — an RN `Text` is otherwise its own announced stop. Interactive controls go in `trailing` and must carry their own `accessibilityLabel` (the field's label is folded into the input's) and their own `minWidth`/`minHeight` to reach 44pt, since the row grants only the space an accessory asks for. Single-line rows centre their accessories; multiline rows pin them to the top, where the caret starts. `shape="pill"` swaps the crisp `radius.md` box for a full-radius ink-stroked one (§7's pill carve-out) — a SHAPE choice only: focus and error still override the resting stroke exactly as they do for `box`, so a pill can never show a quieter error state. |
| `Avatar` | `xs`/`sm`/`md`/`lg`/`xl`. Initials fallback. `xl` (84) is the onboarding picker's size and exists as a real step rather than a `style` override, because the picker's empty state is a separate dashed circle of the same diameter — if the two diverged the control would visibly resize the moment a photo was chosen. |
| `Logo` | The brand lockup. Required `height`, width derived from the source art's 496:234 ratio, so it cannot be stretched; a fixed optical size, deliberately not Dynamic Type-scaling. `tone` names the SURFACE, never the artwork — `auto` follows the scheme; `onLight`/`onDark` are for deliberately inverted surfaces (e.g. `bgInverse`, where `auto` picks the wrong wordmark); `onMedia` is for over photography. Three flat-colour cuts, not one tinted at runtime: `onLight`/`onDark` keep the brand-orange mark and swap only the wordmark, but **`onMedia` is all cream, mark included** — it carries no brand colour and so depends entirely on the scrim beneath it for contrast (rule 2 of §12). |
| `Chip` | Static badge and interactive filter, one component via a `selectable` prop. Radius `sm`–`md`, never pill. Three surfaces: accent fill when `selected` (§3's sanctioned "selected chips/filters" use), `bgInverse`/`textInverse` under `tone="inverse"`, and the quiet neutral default. `tone` describes only how a chip RESTS — selection outranks it, so a selected chip is never painted inverse. Reach for `inverse` when the chip states something already committed and dismissible (Explore's active-filter tokens), not something on offer. A selectable chip carries an invisible **vertical-only** `hitSlop` of (`minTouchTarget` − resting height) / 2, the resting height derived from the `label` line box plus its vertical padding — 8pt today — so it meets §12.1 without looking any bigger. Vertical only because chip rows and walls space chips `space[2]` apart: 8pt of slop reaches exactly to the neighbouring chip's edge and never over it, while horizontal slop would have to share that same gap (and a chip is already ~44pt wide for the shortest real label). A chip packed tighter than `space[2]` would let slop overlap a neighbour — keep chip gaps at `space[2]` or more. |
| `ListRow` | Leading slot / title + subtitle / trailing slot. |
| `Sheet` | Detents, drag handle, scrim, keyboard avoidance. The only bottom-sheet implementation. Its scroll area sets `keyboardShouldPersistTaps="handled"`, so with a field focused the first tap on a chip or button inside the sheet acts instead of only dismissing the keyboard. Optional `footer` slot: pinned below the scroll area, inside the sheet's safe-area padding and the keyboard-avoiding region, separated by a hairline `border` rule — for actions that must stay visible however long the content is (Explore's Clear/Apply). When content outgrows the sheet, the scroll area shrinks; the footer never does. |
| `Skeleton` | Shimmer block, plus composed `SkeletonListingCard` / `SkeletonRow`. |
| `Switch` | Controlled on/off toggle. Thin tokenizing wrapper around RN's native `Switch`: `accent` track when on, `borderStrong` when off, `onAccent` thumb. Touch target and thumb animation are the native control's own. `accessibilityRole="switch"`. |
| `EmptyState` | Icon + title + body + action. Backs `ErrorState` via a `variant`. |
| `StoryRing` | Circular image in a ring — the Explore "Drops" row. `size` is the OUTER diameter and the ring grows INWARD, so selecting a ring never resizes it and the row cannot shift as selection moves. Active is both thicker (2.5 vs 1.5) and `accent`, so the state survives a greyscale reading (§12.4). Presentational: no press behaviour of its own, so the caller owns the role, state and accessible name. |
| `Sticker` | Small rotated uppercase label stuck onto media. Tones `accent` / `inverse` / `paper`, each a contrast-asserted fill + on-colour pair, which is what lets one sit over arbitrary photography without a per-photo check. The hard drop shadow is a real offset View, not a platform shadow — iOS could do it with `shadowRadius: 0` but Android's `elevation` is always blurred, so one backing node renders identically on both. |
| `ReactionPill` | Save-count pill for a grid tile. **Read-only** — it reports a count, it never toggles; favouriting lives on the listing itself, and a second smaller control that looked tappable but only sometimes was would be worse than none. Opaque `bg` plate rather than a scrim, since it sits on photography. |
| `PillButton` | 46pt full-radius button, `primary` / `outline` / `inverse` (§7's pill carve-out). Separate from `Button` rather than a variant of it because the difference is SHAPE, not emphasis — folding both into one component would make "which shape am I getting" depend on an unrelated prop. Reuses `Button`'s own `isButtonInteractive` so the loading/disabled rule cannot drift between the two. `outline`'s label stays `text`, not `accentText`: the outline already carries the accent. `inverse` (added for Profile's "Edit profile" pill, §14.3) mirrors `Button`'s own `inverse` exactly — solid `bgInverse` fill, `textInverse` label, dims on press rather than swapping fill the way `primary` does. |
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

A collage wall, not a uniform grid. Follows system appearance.

- **Header order**: `display` title (lowercase), pill search, Drops row, section header + Shuffle. The search pill is a persistent sibling of the list; everything below it is the list's own header, so it scrolls away with the results and is absent when recent searches replace the collage.
- **Search is a `TextField` with `shape="pill"`** — the same primitive as every other input, carrying both adornments inside its stroke: a decorative magnifier in `leading`, and the filter disc (36pt, `bgInverse`, with an `accent` count badge) in `trailing`.
- **Drops row**: a horizontal rail of `StoryRing`s that filter by top-level category. `active` means SELECTED, not "always on" — the handoff draws every ring active, but then the row cannot show which filter is in effect, which is a correctness problem rather than a styling one. The rings carry no image because categories have no artwork in the schema; `StoryRing` renders a toned circle and the label does the work.
- **Collage grid**: 3 columns, 58pt row unit, 6pt gap, `radius.lg`. A fixed 9-item pattern — [2×4, 1×2, 1×2, 1×3, 2×3, 1×3, 1×3, 1×3, 3×3] (cols×rows) — repeating every 13 rows. Those spans tile the 3×13 block **exactly** (8+2+2+3+6+3+3+3+9 = 39), which is a tested invariant, not a coincidence: a pattern edit that breaks it opens holes or stacks tiles.
- **The list's rows are BLOCKS, not listings.** Column and row spans cannot be expressed by any masonry list, so each block renders its tiles at absolute positions inside a box of known height. That is what keeps the screen on a `FlatList` and therefore keeps recycling and `onEndReached`; a `ScrollView` would mean hand-rolling pagination. Geometry lives in `features/search/collage.ts` and is pure and tested — never re-derived in the screen.
- **No prices or titles on tiles.** The photography carries the wall. A tile's `accessibilityLabel` is still its title, or every tile announces as an unlabelled button.
- **Stickers go on wide tiles only** (`isFeatureSlot`). A tag on every tile is wallpaper rather than a highlight, and on a one-column tile a rotated sticker covers the photo it annotates.
- **"Just dropped" uses the app's single shared recency rule** (`features/listings/recency.ts`, 48h), not a second definition. One meaning of "new" across the feed and Explore matters more than matching a mock's 24h.
- **Shuffle reorders what is loaded, not the catalogue.** `search_listings` paginates on a keyset cursor over `newest`/`price`; there is no random server order to page through. Seeded so the order is stable across re-renders — `Math.random()` would reshuffle the wall on every unrelated state change and read as a glitch.
- Filters open in the same `Sheet` as every other sheet in the app — one instance serving filters, the category picker and sort as swapped content, so the screen never has two Modals mounted at once. Sort lives there because 4a's header has no sort control, but the capability is worth keeping.
- **Attribute filters (ROADMAP 7.4).** The filter sheet adds Item type and Brand after Category, and a "Details" group (Color, Style, Material, Pattern, Fit) after Price. Every kind is **multi-select** — values within a kind are OR'd, kinds are AND'd, matching `search_listings` — with an "Any {kind}" chip that clears just that kind, and at most 20 values per kind (the RPC's own cap), past which the remaining chips disable. **Brand is a typeahead over catalog brands only**: suggestions come from `search_brands`, chosen brands show as selected chips, and there is no free-text option — a filter must name something the server can match by id (free-text brands are still reachable through the search field). A kind is offered only when at least one of its values applies to the chosen category (a group offers the union of its leaves). **Changing the category prunes values that no longer apply**: inside the sheet a polite live-region caption says what was removed; the Drops row prunes silently, since its change is already the visible event. Clear/Apply sit in the `Sheet`'s pinned `footer`.
- **Active filters are one chip per value**, not one per kind — "Black" and "White" are two `inverse` chips, each removable on its own — in a fixed order (category, brands, item type, condition, size, color, style, material, pattern, fit, price). The accessible label names the kind ("Remove Color Black filter") because the visible label alone ("Slim") is ambiguous out of context. A value whose label has not resolved yet still shows, as "Unknown filter", rather than leaving a live filter invisible. A ghost "Clear all" button follows the chips once there are two or more; it clears filters only, never the query or sort.
- **Save counts are not shown.** `ReactionPill` has no data source: `favorites`' RLS is `user_id = auth.uid()`, so a client can only ever see its own. A real count needs a `SECURITY DEFINER` RPC or a denormalised counter column. **[OPEN]** — until then the tiles carry no count rather than a fabricated one.
- Grid content reserves bottom padding for the native tab bar; `NativeTabs` does not expose its height, so the clearance is a documented per-platform constant that errs high.

### 14.3 Profile

Two different screens share this Instagram-shaped structure, deliberately NOT the same component tree — their headers differ enough (collage cover vs. a plain centered identity block) that forcing one to serve both would mean threading ownership branches through nearly every row.

**Public seller profile** (`seller/[id].tsx`, pushed from a listing/search/inbox — never the Profile tab): identity header (avatar, display name, handle, counts, follow button), then a photo grid **reusing the exact Search tile** — so it inherits 3-up. Still the **square** crop (`ListingGridTile`'s own default `aspectRatio`), not yet retired to 4:5 the way Explore (§14.2) and the Profile tab's closet grid below both are — this screen is untouched by SCREENS.md Task 7, and §14.2's own rule ("retiring the square is a per-screen decision taken with that screen's design in hand") cuts both ways: a screen nobody has redesigned yet keeps the square crop rather than silently inheriting a ratio change made elsewhere. `status = 'active'` only, explicitly filtered even though RLS would already hide another seller's non-active rows — a seller viewing their OWN public profile must see exactly what a buyer sees, never their own drafts/reserved/sold leaking into the buyer-facing view (see `seller-profile/api.ts`'s own header comment). Follow is the standard `Button` primary/secondary pair, toggled. Nothing bespoke. Seller identity gets real presence here — this is where "warm and human" is most visible.

**Profile tab** (`(tabs)/profile/index.tsx`, SCREENS.md Task 7) — the owner's own view, never shown to anyone else:

- **Collage cover**: up to 3 of the viewer's own most-recent closet photos as tilted polaroids (`bgElevated` frame — the handoff's own "bgRaised" names what this token system calls `bgElevated`, no literal `bgRaised` token exists), the 92px avatar overlapping bottom-left with a `bg`-colour ring (a cutout against whatever's behind it, same cutout-ring technique the handoff's own listing-thumbnail badge on an Inbox row uses — §14.5). Omitted entirely (plain avatar instead) for a seller with no closet photos yet, rather than reserving dead space.
- **Closet grid**: `status in ('active', 'reserved', 'sold')` — unlike the public grid above, a sold item is exactly what this screen's own stamp treatment exists to show, and reserved/sold are never faked as active. Gapless, 4:5, **no price tags** — retiring the square crop here (§14.2's own note: "a per-screen decision taken with that screen's design in hand") and dropping price/title captions entirely, both deliberate departures from the Search tile this public grid above still reuses verbatim. A sold tile gets a `bg`-tinted wash (55% opacity) over the photo plus a rotated accent `Sticker` reading "SOLD".
- **Highlights row**: `StoryRing` per top-level category actually present in the closet (not the full taxonomy — only groups with at least one listing), plus a "Sold" circle when at least one listing is sold. Tapping toggles it as the grid's filter. A fourth reuse of the same horizontal-rail-of-`StoryRing`s shape Explore's Drops row, the Sell hero's rack strip, and Inbox's Stories row each already built locally — flagged here, not consolidated: each is scoped to its own screen's task and a shared primitive is a deliberate future call, not an accidental omission.
- **Tabs**: closet · saved · reviews, `displaySm`'s own face at a 14px override (same size-only-override technique `Sticker`'s 11px label already uses) with a 3px `accent` underline over a 1.5px `text` rule. "reviews" is hidden until the viewer has at least one (`reviewCount > 0`), mirroring the "hide rather than show empty chrome" rule the optional seller badge below follows.
- **Pills**: "Edit profile" is `PillButton`'s new `inverse` variant (§7/§13) — solid `bgInverse` fill, `textInverse` label, mirroring `Button`'s own `inverse` exactly. "Share closet" is `outline`, opening the native share sheet with a plain text message (no URL: there is no public web presence or universal link to share yet).
- **Not built**: the handoff's optional "ships in 24h" seller badge. No shipping-speed column exists anywhere in the schema — hidden rather than faked, the same rule "Sold" and "reviews" above both already follow for their own missing-data cases.

`saved`/`reviews` tab content reuses `useSavedListings`/`useSellerReviews` and `ReviewRow` directly — no new data layer for either. `profile/saved.tsx` (the old pushed "Saved items" screen) is deleted: its content is now the in-page `saved` tab, and nothing else linked to it.

### 14.4 Sell

**Sell tab home.** A dark hero card (forced via `AppThemeProvider scheme="dark"`, same mechanism as §14.1/§14.8 — see those screens' own code comments) carries the one primary CTA: "snap it. / list it.", a camera badge, and two `PillButton`s, "Open camera" / "From gallery" (outline, which reads cream automatically inside the forced-dark subtree — no hand-picked color). Either one creates a draft and lands in the editor below with that same picker already open, so starting a listing is never more than "pick a photo source, pick a photo." Below it, **"your rack"** is a horizontal strip of the seller's own listings (every status but `removed`), each thumbnail carrying a small static Live/Draft/Sold pill (§7's pill carve-out, third case) — capped to a render-cost limit, with "See all N" always showing the true total and routing to My Listings for full status-filtered management. A seller with nothing listed yet sees only the hero card.

**"Buzz"** — seller-facing activity ("Maya and 11 others saved your Wool overcoat", an offer) — is specified but not built. It needs two things the data cannot support: who favourited a listing (`favorites`' RLS is `user_id = auth.uid()`, so a seller cannot read saves on their OWN listings any more than Explore's tiles can show a save count — same gap, see explore.tsx's header comment) and offers (no table or RPC exists at all — §1a's handoff notes "no backend yet"). Hidden rather than faked, per the task's own rule for a section with no data; revisit once either exists.

One step per screen, generous spacing, large touch targets, inside the editor itself. The photo grid is the first and largest element, and includes the **mandatory feed-crop preview** (§11.4).

**AI assistance appears as pre-filled, editable fields**, visually marked as suggestions with a subtle accent border or a small "suggested" chip. It is never a separate magic surface, and the user can always edit or discard. Same `TextField` and `Button` as auth.

**Category (ROADMAP 2.1)** is a pressable field, not chips: a `Sheet`-based two-level drill-down (`CategoryPickerSheet`) picks a top-level group, then one of its leaves, since ~35 leaves across 6 groups would be an unusable wall of chips.

### 14.5 Inbox

SCREENS.md Task 6 replaces the plain `ListRow` list with: a Stories row (`StoryRing` per recent conversation partner, `active` = has unread), an All/Buying/Selling filter, then a bespoke row — `Avatar` with a small, rotated listing-cover thumbnail overlapping its corner, name + time, and a preview line whose weight/color (not the title's) carries the unread state. Buying/Selling is derived client-side by comparing the viewer's own id against `inbox_conversations`'s `seller_id` column (`features/inbox/inbox.ts`'s `getInboxRole`) — never a precomputed flag, same "the client already knows its own id and can compare" shape `conversation_detail`'s `can_review` already established. Unread is still never color alone: weight, a dot, and an accessible label all carry it.

**Deviation from the handoff: the filter pills use `Chip`'s existing `selected` (solid `accent`) state, not a `bgInverse` "All" fill.** `Chip`'s own rule is that `selected` always wins over `tone` (§13's `Chip` row: "selection outranks it, so a selected chip is never painted inverse"), and the condition/size pickers in Explore's filter sheet already use plain `selected` for an identical pick-one control. Introducing a second "this is the active choice" color just for this one row would fragment a rule the rest of the app just established. `tone="inverse"` stays reserved for a committed, dismissible token (an active-filter chip), not a selection state.

**"Offers" is not a fourth filter, and no row shows an offer `Sticker`.** There is no offers table or RPC at all (§1a's handoff: "Buy now / Offer have no backend yet"), so a count badge would have nothing behind it. Same "hide rather than fake" rule Sell's own "buzz" section (§14.4) follows for the identical gap.

### 14.6 Listing detail

SCREENS.md Task 9 (the 6a handoff) resolves this section's own former **[OPEN] — dark treatment** item: the gallery runs full-bleed and edge-to-edge under the status bar (`ListingGallery`'s own fixed `GALLERY_HEIGHT` = 500, not a crop ratio), a content sheet overlaps it by a bespoke 28px radius the token scale's `radius.xl` (16) doesn't reach, and everything in the sheet follows the system theme same as before — "dark" is the gallery area's own photography, not a forced scheme.

Floating header → full-bleed gallery (page dots, not a "1/N" counter) → content sheet: price + condition `Sticker` → title → attribute badges → description → seller card → sticky bottom action bar.

**Gallery header gradient** (`gradientGalleryHeader`, `tokens.ts`): opaque-to-transparent top-down over the gallery's own top 120px, the same rgb base as `gradientScrim`/`gradientFade` (neutral.950) but the inverse shape — keeps the status bar readable over a bright photo without darkening the photo further down, where `gradientScrim`-style text legibility isn't needed (nothing but the floating header's own `bg`-filled circles sits there).

**Attribute badges (ROADMAP 2.1)** are two now, not three: size (filled `bgInverse` pill) and a category breadcrumb (e.g. "Women › Shoes", `text`-outline pill) — condition moved into the price row's own `Sticker`. Static pills, not `Chip`: display-only tags, never a filter, and `Chip`'s own radius is capped at `radius.sm` (§7's pill carve-out reaches `PillButton`/`ReactionPill` and the Sell rack's static status pill, not these). No numeric cap, same as before — the feed card compresses the same condition/size pair into one specs line instead (§14.1).

**Seller card and sticky bar** both carry a hard, offset `text`-colour shadow (a real backing `View`, not a platform shadow) — the same technique `PinnedListingStrip` (§14.7) and `Composer`'s send button already use, now a third and fourth consumer of the identical pattern.

**Favorite moved**: it no longer sits in the price row: the sticky bottom bar's own 52px outline circle is now the only favorite control (filled `favoriteActive` heart when favorited), freeing the price row for price + condition alone.

No blur anywhere the handoff asks for one ("bg 88%/94% + blur" on the floating header circles and the sticky bar): the same documented simplification `Composer` already uses for its own identical request — `expo-blur` isn't a dependency anywhere in this app, and a raw rgba literal would violate §15 rule 1 regardless. A solid `bg` fill is visually close and adds neither.

### 14.7 Conversation thread

**Resolved by SCREENS.md Task 8 / the handoff's "5a" reference**, which explicitly supersedes Task 6's own "2d" styling (SCREENS.md: "Chat = Turn 5, pick 5a... Replaces the 2d chat spec"). Restyle only — the data contract (message list, composer, `ReviewSheet`, pagination) is unchanged from Task 6, same as that task's own note predicted for 2d.

- **Header**: a `StoryRing` avatar (42pt, forced `active` for a permanent `accent` ring — this header never shows the inactive state) replaces the plain `Avatar`, plus a role/rating caption and a new overflow menu. The caption reads "Buying from you" / "Selling to you" — the OTHER participant's role, from the viewer's own point of view (`formatConversationRoleCaption`, built on the same `getInboxRole` comparison the Inbox row's own Buying/Selling filter uses) — with the rating (`★ 4.8`, via `useSellerReviewSummary` on the OTHER participant's id, not the viewer's own) appended only when `reviewCount > 0`. The overflow menu reuses `MoreActionsSheet` verbatim, the same Report/Block sheet `seller/[id].tsx` already mounts, targeting the other participant.
- **Pinned listing strip** (`components/conversation/pinned-listing-strip.tsx`): now a `bgElevated` card with a 1.5px `text` border, radius `xl`, and a hard offset `text`-colour shadow — a real backing `View`, not a platform shadow, the same technique `Sticker` already uses and for the same reason (the handoff's "hard" shadow is not what a platform shadow renders). The thumbnail is now rotated (−4°) with a `bg`-colour cutout border. The trailing "View ›" link is gone, replaced by a status `Sticker` (`accent` "Live" for active/reserved, `inverse` "Sold") — `conversation_detail` grew `seller_id` and `listing_size` for this (20261025134644): `seller_id` so the header caption above can derive role client-side (mirroring `inbox_conversations`'s own `seller_id`, 20261025090146), `listing_size` so the strip's "price · size" line needs no second round trip.
- **Day separators** (`components/conversation/day-separator.tsx`): "Today" / "Yesterday" / a bare date, interleaved into the message list by `buildChatListItems` (`features/conversation/conversation.ts`) — a pure function over the already newest-first message array, so it costs no extra query. The same pass also decides `showTime` per bubble: only the newest message of a consecutive-same-sender, same-day run gets a timestamp, never every bubble.
- **Message bubbles** (`MessageBubble`): theirs is now `bgElevated` + a 1.5px `text` outline (previously a solid `bgSunken` fill with no border); mine stays `bgInverse`/`textInverse`. Corner radius is a bespoke 18pt on three corners (the shared scale's nearest, `xl` at 16, was visibly off) with `radius.xs` on the fourth ("tail") corner — bottom-left for theirs, bottom-right for mine, unchanged placement from Task 6. A failed send still swaps the fill to `dangerBg` regardless of side.
- **Composer**: the pill `TextField` (`shape="pill"`, DESIGN.md §7's carve-out — the same shape Explore's search field uses) replaces the box field Task 6 shipped. The send button is now circular (`radius.full`) with a hard offset shadow (the same backing-`View` technique as the pinned strip above) instead of the square accent button; disabled state is now a flat 40% opacity on the same accent fill, never a swap to a muted `bgSunken`/`textTertiary` pair. The camera/photo button the handoff names as NEW is not built — see this file's own TODO and §14.3's "ships in 24h" precedent for the same "hide, don't fake" rule. Quick-reply chips (`PillButton` `outline`, horizontally scrolling) show only while the thread has under 3 messages; tapping one fills the input without sending.
- **Not built** (SCREENS.md Task 8's own "Needs backend" list — none has a column, table, or RPC anywhere in the schema, so building any now would mean inventing data): inline offer message cards, a heart long-press reaction, and image messages. Each has a `TODO` at its natural call site (`MessageBubble`, `Composer`) rather than being silently absent.

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
