import { Platform, StyleSheet, type RadialGradientValue } from "react-native";

// Primitive design tokens. Transcribed verbatim from DESIGN.md — no values
// here are invented; every number/hex traces back to a specific DESIGN.md
// section. Screens must never import from this file directly — only
// src/design/theme.ts (the semantic layer) and src/design/theme-provider.tsx
// consume it. See DESIGN.md §15, rule 1.

// DESIGN.md §3 — warm neutral ramp.
export const neutral = {
  0: "#FFFFFF",
  25: "#FAF9F8",
  // Genuinely cream, not a near-gray-white like 25 — a real 4-9pt channel
  // gap (R248/G244/B239) rather than 25's 1-2pt gap. Light-scheme `bg` only;
  // dark scheme and every other semantic mapping is untouched. See DESIGN.md §3.
  // Superseded as `bg` by cream.100 in the cream/brick-crimson palette;
  // retained for dark-scheme use and as a neutral step.
  35: "#F8F4EF",
  50: "#F5F3F1",
  100: "#EDEAE7",
  200: "#E0DCD8",
  300: "#CAC4BF",
  400: "#A8A19B",
  500: "#857E78",
  600: "#655F5A",
  700: "#4A4541",
  800: "#2E2A28",
  900: "#1A1716",
  950: "#0C0A0B",
} as const;

// DESIGN.md §3 — cream surface ramp. Light-scheme surfaces only. The
// neutral steps above are near-white greys and read cold against a true
// cream, so surfaces get their own warm family. Anchored on the #FBF1D8
// swatch at the 100 step.
export const cream = {
  50: "#FDF8EA", // light bgElevated
  100: "#FBF1D8", // swatch anchor — light bg
  200: "#F5E9C9", // light bgSunken
} as const;

// DESIGN.md §3 — brick-crimson brand ramp. Anchored on the #B12B29 swatch
// at the 500 step; hue ~1 degree throughout, S 62-65%.
export const red = {
  300: "#E48D8B",
  400: "#D65452",
  500: "#B12B29", // swatch anchor — dark accent, ambient glow primary
  600: "#912321", // light accent, light accentText, dark accentPressed
  700: "#751B1A", // light accentPressed
  // No consumer under the current mapping (light pressed is 700, dark
  // pressed is 600). Retained so the ramp stays a regular 6-step scale.
  800: "#581413",
} as const;

// DESIGN.md §3 — favorite-active + functional colors.
// Retained deliberately through the cream/brick-crimson migration:
// favoriteActive is still magenta pending an on-device read of how it sits
// against the new brand red. Measured 2.35:1 from the light accent
// (adequate) but only 1.02:1 from `danger` — near-identical luminance,
// separated by hue alone (333 degrees vs 0). Tolerable only because favorite
// is always a filled-heart icon, never a text or fill color competing with
// an error. Final value is an open decision.
export const magenta = {
  500: "#E8478F",
  600: "#D62E7A",
} as const;

export const functional = {
  // #D93A3A, not the originally-specified #DC3A3A: the minimum adjustment
  // needed to bring white-foreground contrast above WCAG AA 4.5:1 (verified
  // 4.55:1) — see DESIGN.md §3.
  danger: "#D93A3A",
  success: "#2E9E63",
  warning: "#C87A16",
} as const;

// DESIGN.md §4 — signature gradient.
//
// PENDING PALETTE MIGRATION. These stops are the original violet-weighted
// set and have NOT been migrated to the cream/brick-crimson palette. Left
// unchanged deliberately: the gradient has no runtime consumer yet, and the
// direction is being validated on-device before the stops are redefined.
// Note the §1/§4 rationale ("violet-weighted precisely so it does not read
// as Instagram's") is stale against a red brand and must be rewritten when
// this is migrated — not silently patched.
export const gradientBrand = {
  angle: 135,
  stops: [
    { offset: 0, color: "#F2648F" },
    { offset: 0.28, color: "#C93FA8" },
    { offset: 0.62, color: "#8B34DC" },
    { offset: 1, color: "#5B1FB0" },
  ],
} as const;

// Vertical scrim for media (feed, gallery) — transparent to near-black,
// distinct from the flat overlayScrim semantic token used on sheets/dimming.
// Data only — no expo-linear-gradient consumer exists yet; see Dependencies.
export const gradientScrim = {
  angle: 180,
  stops: [
    { offset: 0, color: "rgba(12,10,11,0)" },
    { offset: 1, color: "rgba(12,10,11,0.75)" },
  ],
} as const;

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
// library needed). Deliberately distinct from `gradientBrand` above — not
// the signature gradient's stops, not subject to its allowlist. Each stop
// fades to full alpha-0 transparency, not just low opacity, so the shape's
// own geometric boundary is never visible — only a soft interior falloff.
// Keys are palette-agnostic (primary/secondary, not hue names) so a future
// palette shift is a value change here rather than a rename across consumers.
//
// The 0.45 / 0.30 core alphas are PHYSICAL-DEVICE TUNING VALUES, deliberately
// conservative: the previous 0.70 / 0.50 were tuned for violet/magenta over a
// near-white canvas, and red over a saturated cream reads far hotter at the
// same alpha. Expect to retune these on-device.
export const ambientGlow: Record<"primary" | "secondary", RadialGradientValue> = {
  primary: {
    type: "radial-gradient",
    shape: "ellipse",
    size: { x: "90%", y: "70%" },
    position: { top: "-8%", right: "-8%" },
    colorStops: [
      {
        color: "rgba(233,23,19,0.70)",
        positions: ["0%"],
      },
      {
        color: "rgba(233,23,19,0.62)",
        positions: ["30%"],
      },
      {
        color: "rgba(177,43,41,0)",
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
        color: "rgba(214,84,82,0.90)",
        positions: ["0%"],
      },
      {
        color: "rgba(214,84,82,0.78)",
        positions: ["46%"],
      },
      {
        color: "rgba(214,84,82,0.58)",
        positions: ["56%"],
      },
      {
        color: "rgba(214,84,82,0)",
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
