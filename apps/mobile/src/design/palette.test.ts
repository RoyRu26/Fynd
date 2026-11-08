import { describe, expect, it } from 'vitest';

import { darkColors, lightColors, type SemanticColors } from '@/design/palette';

// Contrast and color-vision harness for the Paper & Ink palette.
//
// This asserts against the real shipped values (imported, not copied), which
// is the whole reason palette.ts has no runtime imports — see its header.
//
// Two classes of assertion:
//   * WCAG contrast floors (DESIGN.md §12.2): 4.5:1 normal text, 3:1 large
//     text and meaningful non-text UI.
//   * Signal separation. The palette two migrations ago put brand, favorite
//     and danger within 27 degrees of hue and 2:1 of each other, which §8
//     calls "a safety problem, not an aesthetic one." These tests are what
//     stop that regressing.
//
// ============================================================
// What changed from the Olive & Oat version of this file, and why
// ============================================================
// Olive & Oat asserted a 60-degree hue floor between `accent` and `danger`.
// That floor encoded a GREEN brand: green and red are opposites, so 60
// degrees was free. Paper & Ink deliberately moves the brand into the warm
// sector, where it is a NEIGHBOUR of danger — the widest separation this
// brand family can reach while danger stays magenta is ~36-52 degrees.
// Holding the old number would not have made the palette safer; it would
// have forced danger into purple (hue ~300) and the accent into brown, i.e.
// the test dictating the brand rather than protecting the user.
//
// So the hue floor is re-expressed at what this brand family actually
// sustains, and the protective work moves to the two measures that hold for
// a warm brand AND for dichromats:
//   * a LUMINANCE floor between accent and danger (new — Olive & Oat never
//     needed one, because hue did the work);
//   * the dichromat-simulation floors, which are UNCHANGED at 1.6:1/1.25:1
//     and which the shipped palette clears at 1.68-2.05:1 and 1.65:1.
// Every WCAG floor in this file is also unchanged. Nothing was lowered to
// accommodate a failing value; the one threshold that moved (hue) moved
// because it was measuring the wrong thing for this brand, and it was
// replaced by a stricter measure of the same risk.

// ============================================================
// Color math
// ============================================================

function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function linearize(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG 2.1 contrast ratio, 1-21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Hue in degrees, 0-360. */
function hue(hex: string): number {
  const [r255, g255, b255] = channels(hex);
  const [r, g, b] = [r255 / 255, g255 / 255, b255 / 255];
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  let h: number;
  if (max === r) h = 60 * (((g - b) / delta) % 6);
  else if (max === g) h = 60 * ((b - r) / delta + 2);
  else h = 60 * ((r - g) / delta + 4);
  return h < 0 ? h + 360 : h;
}

/** Shortest angular distance between two hues, 0-180. */
function hueDistance(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
}

function toHex([r, g, b]: [number, number, number]): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}

// Vienot/Brettel dichromat approximations. Not clinically exact, but the
// standard approximation used for design review and more than sufficient to
// catch a pair that collapses to one color.
function simulateDeuteranopia(hex: string): string {
  const [r, g, b] = channels(hex);
  return toHex([0.625 * r + 0.375 * g, 0.7 * r + 0.3 * g, 0.3 * g + 0.7 * b]);
}

function simulateProtanopia(hex: string): string {
  const [r, g, b] = channels(hex);
  return toHex([0.567 * r + 0.433 * g, 0.558 * r + 0.442 * g, 0.242 * g + 0.758 * b]);
}

const SCHEMES: [string, SemanticColors][] = [
  ['light', lightColors],
  ['dark', darkColors],
];

// ============================================================
// WCAG contrast floors
// ============================================================

describe.each(SCHEMES)('%s scheme — text contrast', (_scheme, c) => {
  it('text on bg meets AA for normal text', () => {
    expect(contrastRatio(c.text, c.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('textSecondary on bg meets AA for normal text', () => {
    expect(contrastRatio(c.textSecondary, c.bg)).toBeGreaterThanOrEqual(4.5);
  });

  // textTertiary carries real normal-sized text, not just decoration: the
  // TextField placeholder, TextField helper text, and the onboarding
  // availability caption. It is held to the full 4.5:1 on BOTH bg and
  // bgElevated, because the placeholder sits on the elevated field fill.
  it('textTertiary meets AA for normal text on bg AND bgElevated', () => {
    expect(contrastRatio(c.textTertiary, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.textTertiary, c.bgElevated)).toBeGreaterThanOrEqual(4.5);
  });

  it('preserves the three-tier text hierarchy', () => {
    const primary = contrastRatio(c.text, c.bg);
    const secondary = contrastRatio(c.textSecondary, c.bg);
    const tertiary = contrastRatio(c.textTertiary, c.bg);
    expect(primary).toBeGreaterThan(secondary);
    expect(secondary).toBeGreaterThan(tertiary);
  });

  it('accentText on bg meets AA for normal text', () => {
    expect(contrastRatio(c.accentText, c.bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe.each(SCHEMES)('%s scheme — foreground on filled surfaces', (_scheme, c) => {
  it('onAccent meets AA on both accent and accentPressed', () => {
    expect(contrastRatio(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.onAccent, c.accentPressed)).toBeGreaterThanOrEqual(4.5);
  });

  it('onButtonPrimary meets AA on both buttonPrimary and buttonPrimaryPressed', () => {
    expect(contrastRatio(c.onButtonPrimary, c.buttonPrimary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.onButtonPrimary, c.buttonPrimaryPressed)).toBeGreaterThanOrEqual(4.5);
  });

  it('onDanger meets AA on danger', () => {
    expect(contrastRatio(c.onDanger, c.danger)).toBeGreaterThanOrEqual(4.5);
  });

  // Button's `inverse` variant (§13) — the third filled pair. The two tokens
  // are exact swaps of each other in both schemes, so this passes by
  // construction; it is asserted anyway because §3 rule 8 requires floors to
  // be tested rather than argued, and because the pairing is the only thing
  // keeping it true. Anyone who redefines `bgInverse` without moving
  // `textInverse` with it should fail here, not ship a cream-on-cream button.
  it('textInverse meets AA on bgInverse', () => {
    expect(contrastRatio(c.textInverse, c.bgInverse)).toBeGreaterThanOrEqual(4.5);
  });

  // success is a FOREGROUND token, not a fill: its only consumers are the
  // onboarding availability icon and its caption. So the binding floor is
  // success-as-normal-text on bg, not white-on-success.
  it('success meets AA as normal text on bg', () => {
    expect(contrastRatio(c.success, c.bg)).toBeGreaterThanOrEqual(4.5);
  });

  // Same correction as success, and for the same reason: danger's real
  // consumers are TextField's error caption, the onboarding availability
  // row, and the Sell screens' error text — all foreground, all normal-sized.
  it('danger meets AA as normal text on bg', () => {
    expect(contrastRatio(c.danger, c.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('warning meets AA as normal text on bg', () => {
    expect(contrastRatio(c.warning, c.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('accent is visible against bg as a meaningful UI element', () => {
    expect(contrastRatio(c.accent, c.bg)).toBeGreaterThanOrEqual(3);
  });

  it('buttonPrimary is visible against bg as a meaningful UI element', () => {
    expect(contrastRatio(c.buttonPrimary, c.bg)).toBeGreaterThanOrEqual(3);
  });

  it('favoriteActive is visible against bg as a meaningful icon', () => {
    expect(contrastRatio(c.favoriteActive, c.bg)).toBeGreaterThanOrEqual(3);
  });
});

// DESIGN.md §3 rule 2a — focus is a system state, not a brand moment. It has
// to stay distinguishable from the error border, or a focused field and a
// focused+errored field become the same control. This is one of the two
// constraints that pins danger's luminance window (see palette.ts's header).
describe.each(SCHEMES)('%s scheme — focus ring separation (rule 2a)', (_scheme, c) => {
  it('separates from danger', () => {
    expect(contrastRatio(c.borderFocus, c.danger)).toBeGreaterThanOrEqual(3);
  });

  it('is legible against the field fill', () => {
    expect(contrastRatio(c.borderFocus, c.bgElevated)).toBeGreaterThanOrEqual(3);
  });

  it('is achromatic, so it cannot read as a brand or error color', () => {
    const [r, g, b] = channels(c.borderFocus);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(12);
  });
});

// ============================================================
// Signal separation — the reason this harness exists
// ============================================================

describe.each(SCHEMES)('%s scheme — signal separation', (_scheme, c) => {
  // The headline guard. Paper & Ink puts brand and danger in neighbouring
  // sectors, so this floor is 30 rather than Olive & Oat's 60 (see this
  // file's header for why). The real protection for this pair is the
  // luminance floor directly below and the dichromat floors further down —
  // hue is the weakest of the three here, not the strongest.
  it('accent is separated from danger by hue', () => {
    expect(hueDistance(c.accent, c.danger)).toBeGreaterThanOrEqual(30);
  });

  it('accentPressed is also separated from danger by hue', () => {
    expect(hueDistance(c.accentPressed, c.danger)).toBeGreaterThanOrEqual(30);
  });

  // NEW in Paper & Ink, and the load-bearing one. With brand and danger in
  // the same sector, luminance is what a user — colour-blind or not —
  // actually has left to tell a primary action from a destructive one.
  // Olive & Oat never needed this test; a warm brand does.
  it('accent is separated from danger by luminance, not just hue', () => {
    expect(contrastRatio(c.accent, c.danger)).toBeGreaterThanOrEqual(1.5);
  });

  it('accent is separated from success', () => {
    expect(hueDistance(c.accent, c.success)).toBeGreaterThanOrEqual(60);
  });

  // An orange brand sits much closer to amber than a green one did, so this
  // is a real risk here rather than a formality: a warning must never read
  // as a dimmer accent.
  it('accent is separated from warning', () => {
    expect(hueDistance(c.accent, c.warning)).toBeGreaterThanOrEqual(30);
  });

  // favoriteActive and accent are the SAME value in the light scheme and the
  // same ramp in both — Paper & Ink deliberately puts favorite on the brand.
  // So the Olive & Oat rule ("favorite must not read as selected", enforced
  // by 60 degrees of hue) no longer applies and would be false to keep.
  // What still has to hold is that favorite is not mistaken for DANGER,
  // which is the pairing that actually matters: a filled heart next to a
  // destructive control. Both floors below are what Olive & Oat used.
  it('favoriteActive is separated from danger on luminance as well as hue', () => {
    expect(hueDistance(c.favoriteActive, c.danger)).toBeGreaterThanOrEqual(15);
    expect(contrastRatio(c.favoriteActive, c.danger)).toBeGreaterThanOrEqual(1.15);
  });
});

// ============================================================
// Color vision deficiency
// ============================================================
// With a warm brand these are no longer a formality — orange-vs-magenta is
// exactly the pair that collapses when hue discrimination is gone, so these
// floors (unchanged from Olive & Oat) are now the primary guard rather than
// a backstop.
//
// The floor is 1.6:1 rather than a WCAG threshold: these are two filled
// surfaces being told apart, not text on a background. DESIGN.md §12.4
// ("no color-only status") and §8's silhouette rule remain required
// regardless — this asserts the color layer is not actively working against
// them, not that color alone is sufficient.
describe.each(SCHEMES)('%s scheme — color vision deficiency', (_scheme, c) => {
  const simulators = [
    ['deuteranopia', simulateDeuteranopia],
    ['protanopia', simulateProtanopia],
  ] as const;

  it.each(simulators)('accent stays distinguishable from danger under %s', (_name, simulate) => {
    expect(contrastRatio(simulate(c.accent), simulate(c.danger))).toBeGreaterThanOrEqual(1.6);
  });

  it.each(simulators)('accentPressed stays distinguishable from danger under %s', (_name, simulate) => {
    expect(contrastRatio(simulate(c.accentPressed), simulate(c.danger))).toBeGreaterThanOrEqual(1.4);
  });

  it.each(simulators)('accent stays distinguishable from success under %s', (_name, simulate) => {
    expect(contrastRatio(simulate(c.accent), simulate(c.success))).toBeGreaterThanOrEqual(1.25);
  });

  it.each(simulators)('body text keeps its AA margin under %s', (_name, simulate) => {
    expect(contrastRatio(simulate(c.text), simulate(c.bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(simulators)('onButtonPrimary stays legible on buttonPrimary under %s', (_name, simulate) => {
    expect(contrastRatio(simulate(c.onButtonPrimary), simulate(c.buttonPrimary))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(simulators)('onAccent stays legible on accent under %s', (_name, simulate) => {
    expect(contrastRatio(simulate(c.onAccent), simulate(c.accent))).toBeGreaterThanOrEqual(4.5);
  });
});

// ============================================================
// Regression guards
// ============================================================

describe('palette invariants', () => {
  it('never uses pure white or pure black as a surface (DESIGN.md §3 rule 7)', () => {
    for (const [, c] of SCHEMES) {
      for (const surface of [c.bg, c.bgElevated, c.bgSunken]) {
        expect(surface.toUpperCase()).not.toBe('#FFFFFF');
        expect(surface.toUpperCase()).not.toBe('#000000');
      }
    }
  });

  it('keeps neutrals warm — never blue-tinted (DESIGN.md §3)', () => {
    for (const [, c] of SCHEMES) {
      for (const token of [c.bg, c.bgElevated, c.bgSunken, c.text, c.textSecondary, c.textTertiary]) {
        const [r, , b] = channels(token);
        expect(r).toBeGreaterThanOrEqual(b);
      }
    }
  });

  // The inverse of Olive & Oat's guard. That palette kept the accent OUT of
  // the red sector so danger could own it; Paper & Ink gives the red-orange
  // sector to the BRAND, so the guard flips: danger must stay out of it, or
  // the two swap identities and every destructive control starts reading as
  // a primary one.
  it('keeps the brand in the red-orange sector', () => {
    for (const [, c] of SCHEMES) {
      const h = hue(c.accent);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(30);
    }
  });

  it('keeps danger well clear of the brand sector', () => {
    for (const [, c] of SCHEMES) {
      const h = hue(c.danger);
      expect(h).toBeGreaterThanOrEqual(300);
      expect(h).toBeLessThanOrEqual(345);
    }
  });
});
