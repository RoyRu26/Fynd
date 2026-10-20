import { Platform, StyleSheet, type LinearGradientValue, type RadialGradientValue } from "react-native";

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

export { neutral, oat, olive, rose, teal, crimson, amber } from "@/design/palette";

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
// Shaped as RN core's own `experimental_backgroundImage` LinearGradientValue
// (no gradient library needed) — the same mechanism `ambientGlow` already
// uses for its radial gradients. `direction: '180deg'` is the standard CSS
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
    { color: "rgba(12,10,11,0)", positions: ["0%"] },
    { color: "rgba(12,10,11,0.75)", positions: ["45%"] },
    { color: "rgba(12,10,11,0.75)", positions: ["100%"] },
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

// DESIGN.md §7 — radii. Crisp; no pill shapes.
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

// DESIGN.md §4a — ambient background. Uses react-native core's own
// `experimental_backgroundImage` radial-gradient support (no gradient
// library needed). Each stop fades to full alpha-0 transparency, not just
// low opacity, so the shape's own geometric boundary is never visible — only
// a soft interior falloff. Keys are palette-agnostic (primary/secondary, not
// hue names), which is exactly why the Olive & Oat migration is a value
// change here rather than a rename across consumers.
//
// Migrated to olive (primary, olive.500 #6B8A36 lightened toward #6B7F3A for
// the wash) and oat-gold (secondary, #C9A87A). The previous values were
// rgba(233,23,19) and rgba(214,84,82) — both within 1 degree of hue of
// `danger`, so the auth screens were washed in the error color.
//
// These alphas are PHYSICAL-DEVICE TUNING VALUES and are deliberately
// conservative. Olive over oat is far less assertive than red over cream at
// the same alpha — a low-chroma green reads as a shadow rather than a glow
// if it is too faint. Expect to retune upward on-device.
export const ambientGlow: Record<"primary" | "secondary", RadialGradientValue> = {
  primary: {
    type: "radial-gradient",
    shape: "ellipse",
    size: { x: "90%", y: "70%" },
    position: { top: "-8%", right: "-8%" },
    colorStops: [
      {
        color: "rgba(107,127,58,0.70)",
        positions: ["0%"],
      },
      {
        color: "rgba(107,127,58,0.62)",
        positions: ["30%"],
      },
      {
        color: "rgba(107,127,58,0)",
        positions: ["58%"],
      },
    ],
  },
  secondary: {
    type: "radial-gradient",
    shape: "ellipse",
    size: { x: "90%", y: "70%" },
    position: { bottom: "-8%", left: "-10%" },
    colorStops: [
      {
        color: "rgba(201,168,122,0.90)",
        positions: ["0%"],
      },
      {
        color: "rgba(201,168,122,0.78)",
        positions: ["46%"],
      },
      {
        color: "rgba(201,168,122,0.58)",
        positions: ["56%"],
      },
      {
        color: "rgba(201,168,122,0)",
        positions: ["78%"],
      },
    ],
  },
};

// Ambient/decorative background motion — a deliberately separate category
// from `duration`/`spring` above, which are for interactive feedback
// (button presses, sheets, transitions) and top out at 320ms. These cycles
// are seconds, not milliseconds, and are never used for interaction
// feedback. See DESIGN.md §10.
export const ambientMotion = {
  cycleDurationMs: { primary: 16000, secondary: 19000 },
  translateRange: 20,
  scaleRange: 0.06,
  rotateRangeDeg: 4,
} as const;

// DESIGN.md §5 — font-family strings matching the @expo-google-fonts/manrope
// import binding names (see use-app-fonts.ts). Only the two weights the type
// scale actually uses are loaded: heading=600, display/title/price=700.
export const fontFamily = {
  displaySemiBold: "Manrope_600SemiBold",
  displayBold: "Manrope_700Bold",
  mono: Platform.select({
    ios: "ui-monospace",
    android: "monospace",
    default: "monospace",
  }),
} as const;
