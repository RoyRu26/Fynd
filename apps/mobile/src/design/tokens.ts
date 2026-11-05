import { Platform, StyleSheet, type LinearGradientValue } from "react-native";

// Primitive design tokens. Transcribed verbatim from DESIGN.md — no values
// here are invented; every number/hex traces back to a specific DESIGN.md
// section. Screens must never import from this file directly — only
// src/design/theme.ts (the semantic layer) and src/design/theme-provider.tsx
// consume it. See DESIGN.md §15, rule 1.
//
// The color ramps live in src/design/palette.ts and are re-exported here.
// They are kept in a separate, dependency-free module because this file
// imports react-native at the top level, which makes it unimportable by the
// test runner — and the contrast/color-vision harness has to assert against
// the real shipped values. See palette.ts's header for the full reasoning.

export { neutral, paper, ink, teal, magenta, amber } from "@/design/palette";

// DESIGN.md §4 — signature gradient.
//
// REMOVED in the Olive & Oat migration. The stops were the original
// violet-weighted set, never migrated and never consumed at runtime; leaving
// an obsolete violet token in an olive design system is worse than having no
// token at all. DESIGN.md §16.6 requires the rationale be rewritten rather
// than patched, and the only allowlisted consumer that would force the issue
// — the custom bottom bar's gradient center action (§4) — is not built yet.
// A new brand gradient gets defined when that work actually needs one.

// Vertical scrim for media (feed, gallery) — transparent to near-black,
// distinct from the flat overlayScrim semantic token used on sheets/dimming.
// Its first consumer is the Home feed card, behind the price/title/seller
// overlay at the bottom of each full-bleed photo.
//
// Shaped as RN core's own `experimental_backgroundImage` LinearGradientValue,
// so no gradient library is needed. `direction: '180deg'` is the standard CSS
// gradient-angle syntax for top-to-bottom, matching the original numeric
// `angle: 180` this replaces exactly.
//
// The feed card applies this to the overlay content's OWN box (bottom-
// anchored, height intrinsic to its content), not the full card — so these
// percentages span only that much shorter region, not the whole photo.
// Reaching full opacity by 45% keeps the price/title near the top of the
// block adequately backed without needing the ramp to run the entire
// height; the short plateau to 100% is margin for text descenders right at
// the content's own bottom edge, not a hedge against where that edge might
// land (the box's bottom IS the true, safe-area-adjusted edge, always).
export const gradientScrim: LinearGradientValue = {
  type: "linear-gradient",
  direction: "180deg",
  colorStops: [
    { color: "rgba(20,17,13,0)", positions: ["0%"] },
    { color: "rgba(20,17,13,0.75)", positions: ["45%"] },
    { color: "rgba(20,17,13,0.75)", positions: ["100%"] },
  ],
};

// Vertical fade from transparent to the DARK scheme's own `bg`
// (neutral[950], rgb(20,17,13)) — the same ink base as `gradientScrim` above,
// but ramping to FULL opacity rather than stopping at 0.75.
//
// That difference is the whole point. `gradientScrim` backs text over
// photography that stays visible beneath it; this one dissolves an image into
// the page so there is no edge at all, which only works if the final stop
// matches the surface underneath exactly.
//
// Consequence, and the reason this is not a semantic color: it is correct ONLY
// over a dark-scheme `bg`. Its first consumer, the welcome screen, earns that
// by forcing `scheme="dark"` for its whole subtree. Over light `bg` it would
// fade to a dark band instead of disappearing — so anything using this must
// guarantee the dark surface, not merely happen to be on one.
export const gradientFade: LinearGradientValue = {
  type: "linear-gradient",
  direction: "180deg",
  colorStops: [
    { color: "rgba(20,17,13,0)", positions: ["0%"] },
    { color: "rgba(20,17,13,0.65)", positions: ["45%"] },
    { color: "rgba(20,17,13,1)", positions: ["78%"] },
    { color: "rgba(20,17,13,1)", positions: ["100%"] },
  ],
};

// SCREENS.md Task 9 / the 6a handoff — Listing Detail's gallery header
// gradient. Same rgb base (20,17,13 — neutral.950, the dark scheme's own
// `bg`) as gradientScrim/gradientFade above, but the OPPOSITE shape: opaque
// at the top, fading to fully transparent, so the status bar stays readable
// over a photo without darkening the photo itself further down. The
// handoff's own "120px" is the HEIGHT of the box this is applied to
// (GALLERY_HEADER_GRADIENT_HEIGHT in listing/[id].tsx), not encoded here —
// same convention gradientScrim/gradientFade already follow, where the
// caller owns the box the percentages are relative to.
export const gradientGalleryHeader: LinearGradientValue = {
  type: "linear-gradient",
  direction: "180deg",
  colorStops: [
    { color: "rgba(20,17,13,0.35)", positions: ["0%"] },
    { color: "rgba(20,17,13,0)", positions: ["100%"] },
  ],
};

// DESIGN.md §6 — 4pt spacing scale.
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

// DESIGN.md §7 — radii. Crisp. `full` is for avatars, circular icon
// buttons, and §7's named pill carve-out (PillButton, ReactionPill) —
// never for chips, which stay square-cornered.
export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

// DESIGN.md §8 — borders.
export const border = {
  hairline: StyleSheet.hairlineWidth,
  thin: 1,
  thick: 2,
} as const;

// DESIGN.md §8 — elevation. First concrete values (the `raised` level only —
// `overlay`/`modal` stay open, see DESIGN.md §16.4). Warm-tinted shadow color
// (neutral.800), never neutral-blue-black, per §8's own rule. Shared by
// TextField and Button rather than each defining its own shadow.
export const elevation = {
  raised: Platform.select({
    ios: {
      shadowColor: "#2E2A28",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 3,
    },
    android: { elevation: 2 },
    default: {},
  }),
} as const;

// Primary Button's top/bottom bevel highlight — alpha-based, not a semantic
// color: it works unchanged over either scheme's `accent` fill, so it lives
// here rather than in theme.ts's SemanticColors. Top+bottom only (no left/
// right), which is what keeps this reading as a restrained native-control
// highlight rather than a full skeuomorphic bevel.
export const buttonHighlight = {
  top: "rgba(255,255,255,0.18)",
  bottom: "rgba(0,0,0,0.12)",
} as const;

// DESIGN.md §9 — icon sizes.
export const iconSize = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 28,
} as const;

// DESIGN.md §12 — minimum touch target.
export const minTouchTarget = 44;

// DESIGN.md §10 — motion. Snappy: fast, near-linear, minimal overshoot.
export const duration = {
  instant: 100,
  fast: 160,
  normal: 240,
  slow: 320,
} as const;

export const spring = {
  stiffness: 400,
  damping: 35,
  mass: 1,
} as const;

// DESIGN.md §4a's ambient background tokens (`ambientGlow`, `ambientMotion`)
// were REMOVED with the auth redesign. Their only consumer was
// `components/ambient-background.tsx`, which the new auth and onboarding
// screens no longer render; §15 rule 5 says an orphaned component is deleted
// rather than parked, and these tokens had no other caller.
//
// Worth knowing if a decorative wash is ever wanted again: the alphas were
// tuned on-device for the LOW-CHROMA Olive & Oat wash and were never re-tuned
// after Paper & Ink moved the primary stop to the brand ink orange
// (`ink.500`), which is far more assertive at the same alpha. They would have
// needed retuning downward, so they are not values to restore verbatim.

// DESIGN.md §5 — font-family strings matching the registration keys in
// use-app-fonts.ts. Only the weights the type scale actually uses are loaded:
// Manrope heading=600 and title/price=700, plus the bundled Archivo Expanded
// Black for `display`/`displaySm`.
export const fontFamily = {
  displaySemiBold: "Manrope_600SemiBold",
  displayBold: "Manrope_700Bold",
  // Archivo Expanded Black (900, 125% width) — screen titles and section
  // headers only. A genuinely different face from Manrope, not a heavier
  // weight of it: the extra width is the point, and it is why this cannot be
  // expressed as a `fontWeight` on the existing display face.
  displayExpanded: "ArchivoExpanded_900Black",
  mono: Platform.select({
    ios: "ui-monospace",
    android: "monospace",
    default: "monospace",
  }),
} as const;
