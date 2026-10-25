# Handoff: Reels-style Product Feed (option 1a)

## Fynd implementation notes (read first)
Fynd already has the feed, so this is an **edit of the existing card**, not a new screen:
- Edit only `apps/mobile/src/components/feed/feed-card.tsx`. Leave `app/(app)/(tabs)/index.tsx` (paging, impressions, For you / Following chips) and `components/app-tabs.tsx` (NativeTabs) untouched.
- NativeTabs already floats over the feed, and FeedCard already pads by `insets.bottom`. Keep that mechanism. Don't hardcode the 100px / 250px offsets below.
- Use only semantic tokens and existing primitives (`Text`, `IconButton variant="onMedia"`, `Button`, `Avatar`, `space`, `gradientScrim`). Map the type scale: title → `heading` (19px), price → `price`, specs → `micro`/`caption`, seller → `label`.
- Keep Fynd's Manrope and radii. Ignore the mock's square corners. **Colors change app-wide:** see "Theme migration: Paper & Ink" below. Do that as its own step before the card change.
- **DESIGN.md §14.1 conflict:** it allows "at most one obvious primary action" and at most two chips. 1a has Buy now + Offer + a 3-button rail. Before coding, update §14.1 (per §15) or cut to fit: one primary button plus the rail.
- Buy now / Offer have no backend yet (Stripe Connect is planned). Ship them disabled or hidden behind a flag. Message seller can reuse the existing `conversation/[id]` flow.
- Done means `pnpm exec tsc --noEmit`, `pnpm lint` and `pnpm test` all pass, then the `code-reviewer` agent runs.

## Overview
The home screen of a second-hand clothing marketplace. It's a full-screen, vertically snapping feed, like Instagram Reels or TikTok. Each card shows one item for sale: a full-bleed photo with seller, title, specs, price and actions on top of it.

## Read this first: what to adopt and what to keep
- **Adopt:** the feed layout, card structure, hierarchy, sizing, spacing and behavior described below.
- **Keep from the existing app:**
  - **The color scheme.** Map every color in this doc to the existing theme tokens. See "Color roles" below.
  - **The bottom navbar.** Use the existing navbar unchanged. Don't recreate the pill nav from the mock. The only requirement is that the feed scrolls *behind* the existing navbar and the card content clears it. See "Navbar integration".
  - **Fonts.** Use the app's existing font family. The mock uses Archivo (a grotesque) at weights 600 and 800. Use the closest weights from the app's font.

## About the design files
`Thrift Reels.dc.html` is a **design reference built in HTML**. It's a prototype that shows the intended look and behavior, not production code. Rebuild option **1a** (the left phone in the file) in this codebase's existing framework, components and patterns. Options 1b, 1c and 1d are alternatives that weren't chosen. Ignore them, except 1d, which is a rough reference for a later seller-closet screen.

## Theme migration: Paper & Ink (replaces Olive & Oat)
This is a separate task, done **before** the feed card. It touches only `src/design/palette.ts`, `src/design/tokens.ts` (`ambientGlow`, `gradientScrim`) and DESIGN.md §3/§4a. Screens already read semantic tokens, so no screen file should change.

### Ramps
- Replace `oat` with `paper`. Renaming `oat` is optional; changing only the values keeps the diff small:
  - 50: `#FAF7F0` (light bgElevated)
  - 100: `#F4EFE4` (light bg)
  - 200: `#E6E0D2` (light bgSunken)
- `neutral`: set 950 → `#14110D` and 900 → `#1E1A15`. Keep the other steps (already warm).
- Replace `olive` with `ink` (orange-red brand):
  - 300: `#F5A184`
  - 400: `#F06A45` (dark accentText)
  - 500: `#E8481F` (brand, dark accent)
  - 600: `#C23C15` (dark accentPressed)
  - 700: `#B8360F` (light accent + accentText)
  - 800: `#8F2A0B` (light accentPressed)
- `gradientScrim` / `overlayScrim`: change rgb `12,10,11` → `20,17,13`.
- `ambientGlow`: primary → `rgba(232,72,31,…)`, secondary → `rgba(216,210,196,…)`. Retune the alphas on device.

### Semantic mapping
- light: `accent` / `accentText` = ink.700, `accentPressed` = ink.800, `onAccent` = #FFFFFF
- dark: `accent` = ink.500, `accentText` = ink.400, `accentPressed` = ink.600, `onAccent` = #FFFFFF
- `favoriteActive` (both schemes) = the scheme's `accentText`. The saved heart uses the brand ink, as in the mock. The `rose` ramp can then be deleted.

### Why the light accent isn't #E8481F (contrast, measured)
- White on `#E8481F` ≈ 3.9:1, and `#E8481F` on paper ≈ 3.4:1. Both fail 4.5:1 for normal-size text (Button labels, accentText).
- `#B8360F` gives ≈ 5.9:1 under white and ≈ 5.1:1 on paper, so it passes.
- `#E8481F` on `#14110D` ≈ 4.8:1, so it passes as the dark-scheme accent. On paper, keep the bright `#E8481F` for large type only (`price` variant, 22px bold, 3:1 rule).

### Danger conflict (must resolve)
Orange-red is about 10° of hue from `crimson`. DESIGN.md §3/§8 forbid accent and danger sharing the red sector ("a safety problem"). Move `danger` off red:
- Proposed: magenta-red. Light `#A3155A`, dark `#F0609A`. Set `onDanger` to white on light and to neutral.900 on dark. Update `dangerBg` to match (`#FBEAF2` / `#3A1528`).
- Or the owner may override §8 explicitly. Either way, record the decision in DESIGN.md.

### Verify
- Run `pnpm test`. `palette.test.ts` is the contrast and colour-vision harness. If an assertion fails, adjust the hex to fit the threshold, not the other way round.
- Check accent vs success (teal) and accent vs danger under deuteranopia and protanopia in that harness.
- `app-tabs.tsx` reads `getColors('dark')`, so the selected tab icon automatically becomes `#E8481F`. The navbar layout is unchanged.
- Update the DESIGN.md §3 rationale text, rewriting rather than patching it as §16.6 requires.

## Fidelity
High fidelity for layout, type scale, spacing and behavior. Low fidelity for color, which comes from the app's theme.

## Screen: Feed

### Container
- Full-screen. Each card is exactly one viewport tall: `100%` of the screen height, under any translucent status bar.
- Vertical paging with snap, one item per swipe:
  - Web: `overflow-y: scroll; scroll-snap-type: y mandatory;` with each card set to `scroll-snap-align: start; height: 100dvh`
  - React Native: `FlatList` with `pagingEnabled`, `snapToInterval={screenHeight}`, `decelerationRate="fast"`, `showsVerticalScrollIndicator={false}`
  - Flutter: `PageView(scrollDirection: Axis.vertical)`
  - iOS/SwiftUI: `ScrollView(.vertical)` with `.scrollTargetBehavior(.paging)`
- Hide the scroll indicator.

### Card layers (bottom to top)
1. **Photo:** full-bleed, `cover` fit. Shows a neutral placeholder while loading.
2. **Scrim gradient** (needed so text stays legible on any photo), top to bottom:
   - 0–16%: dark at 72% opacity
   - 34–52%: transparent
   - 100%: dark at 80% opacity
   Use the theme's darkest neutral.
3. **Top bar** (52px from the top of the screen, 20px side insets): wordmark or logo on the left, a small filter chip on the right ("Near you": 11px, weight 700, uppercase, letter-spacing 0.2em, 1px border at 55% opacity, padding 5×10). Keep the app's own header if it has one.
4. **Action rail** (right edge, 16px inset, sits above the caption block): vertical stack with a 16px gap.
   - Three 48×48 circular buttons: **Save** (heart), **Message seller** (speech bubble), **Share** (arrow)
   - Each button: translucent light fill at 14% with a 6px backdrop blur, and a 22px outline icon with a 1.8 stroke
   - Under the buttons: a position counter ("1/24"), 11px, weight 700, letter-spacing 0.14em
   - Save toggles to a filled heart in the accent color
5. **Caption block** (20px side insets, anchored to the bottom and clearing the navbar), vertical stack with an 8px gap:
   - **Seller row:** 26px circular avatar, handle (13px, weight 700, e.g. "@mira.archive"), location (11px, uppercase, letter-spacing 0.16em, 70% opacity). The row is tappable and opens the seller's closet.
   - Optional **tag** ("Just dropped"): 11px, weight 800, uppercase, letter-spacing 0.24em, accent color
   - **Title:** 20px, weight 800, line-height 1.05, letter-spacing -0.01em, uppercase, single line where possible, at most 2 lines. Keep it small; it was deliberately shrunk so the photo stays visible.
   - **Specs line:** 12px, weight 600, uppercase, letter-spacing 0.16em, 72% opacity, e.g. "W28 L26 · Very good · Ships in 2 days" (size · condition · shipping)
   - **Action row** (4px top margin, 10px gap, items vertically centered):
     - **Price plate:** solid accent fill, light text, 24px, weight 800, padding 10×16, square corners
     - **Buy now:** fills the remaining width, light fill with dark text, 13px, weight 800, uppercase, letter-spacing 0.2em, 15px vertical padding
     - **Offer:** outlined with a 1.5px light border at 60% opacity, light text, 13px, weight 800, uppercase, letter-spacing 0.14em, padding 14×14
- All text on the card is light-on-dark over the scrim.
- Corners are square throughout (radius 0) except the circular rail buttons and avatar. This is part of the zine look. If the app's buttons are rounded, follow the app.

### Navbar integration
- Keep the existing navbar as it is.
- The feed must render **edge-to-edge behind the navbar**, so the photo shows beneath or around it. Make the navbar overlay the feed instead of shrinking the feed's viewport. If the existing navbar is opaque and docked, that's fine. Only the layering changes.
- Bottom offset for the caption block = navbar height + bottom safe-area inset + about 14px. In the mock the navbar occupies the bottom 86px and the caption sits 100px from the bottom.
- The action rail sits about 250px from the bottom so it never collides with the caption.

## Interactions & behavior
- Swipe up or down: snap to the next or previous item.
- Double-tap the photo: save (optional, like Instagram's double-tap like), with a brief heart burst animation of about 400ms.
- Save: optimistic toggle that persists to the user's saved list.
- Message: open a chat with the seller about this item.
- Share: native share sheet with the item link.
- Buy now: go to checkout for this item.
- Offer: open the offer sheet (amount input, starting at the asking price).
- Seller row: open the seller's closet/profile.
- Prefetch images for the next 2 items. Pause any off-screen media.

## State / data per card
`id, photoUrl, title, sizeLabel, condition, shippingLabel, price, currency, tag?, seller { handle, avatarUrl, location }, isSaved, index/total`

## Color roles (map to existing theme tokens)
The mock's own palette is listed only so you can identify each role. **Don't use these hex values.**
- Darkest neutral (scrim, dark text on light buttons): mock `#14110d`
- Light surface/text (on-image text, Buy now fill): mock `#f4efe4`
- Accent (price plate, tag, saved state): mock `#e8481f`
- Image placeholder: mock `#d8d2c4`

## Spacing & sizing tokens
4, 8, 10, 14, 16, 20px. Rail buttons are 48px and the avatar is 26px. The type scale is 9 / 11 / 12 / 13 / 20 / 24px.

## Files
- `Thrift Reels.dc.html`: the design reference. Option **1a** is the target. Open it in a browser.
- `image-slot.js`: helper for the photo placeholders in the reference only. Not needed in the app.
