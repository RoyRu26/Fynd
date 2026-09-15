import { describe, expect, it } from 'vitest';

import { darkColors, lightColors, type SemanticColors } from '@/design/palette';

// Contrast and color-vision harness for the Olive & Oat palette.
//
// This asserts against the real shipped values (imported, not copied), which
// is the whole reason palette.ts has no runtime imports — see its header.
//
// Two classes of assertion:
//   * WCAG contrast floors (DESIGN.md §12.2): 4.5:1 normal text, 3:1 large
//     text and meaningful non-text UI.
//   * Signal separation. The palette this replaced put brand, favorite and
//     danger within 27 degrees of hue and 2:1 of each other, which §8 calls
//     "a safety problem, not an aesthetic one." These tests are what stop
//     that regressing.

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
  // availability caption. It was neutral.500 in both schemes and measured
  // 3.56:1 on the old cream — a pre-existing AA failure this migration
  // corrects. It is held to the full 4.5:1 on BOTH bg and bgElevated,
  // because the placeholder sits on the elevated field fill, not on bg.
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

  it('onDanger meets AA on danger', () => {
    expect(contrastRatio(c.onDanger, c.danger)).toBeGreaterThanOrEqual(4.5);
  });

  // success is a FOREGROUND token, not a fill: its only consumers are the
  // onboarding availability icon and its caption. So the binding floor is
  // success-as-normal-text on bg, not white-on-success. Checking the wrong
  // one is what hid success measuring 3.73:1 on the dark scheme.
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

  it('favoriteActive is visible against bg as a meaningful icon', () => {
    expect(contrastRatio(c.favoriteActive, c.bg)).toBeGreaterThanOrEqual(3);
  });
});

// DESIGN.md §3 rule 2a — focus is a system state, not a brand moment. It has
// to stay distinguishable from BOTH the error border and (new in this
// palette) the accent, or a focused field and an errored field become the
// same control.
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
// Signal separation — the reason for the migration
// ============================================================

describe.each(SCHEMES)('%s scheme — signal separation', (_scheme, c) => {
  // The headline fix. Was 1 degree / 1.87:1, which made "Save" and "Delete"
  // the same color.
  it('accent is decisively separated from danger by hue', () => {
    expect(hueDistance(c.accent, c.danger)).toBeGreaterThanOrEqual(60);
  });

  it('accentPressed is also separated from danger', () => {
    expect(hueDistance(c.accentPressed, c.danger)).toBeGreaterThanOrEqual(60);
  });

  // A green brand introduces a collision risk a red brand did not have:
  // success is also green. This is the check that olive did not simply move
  // the problem.
  it('accent is separated from success', () => {
    expect(hueDistance(c.accent, c.success)).toBeGreaterThanOrEqual(60);
  });

  it('accent is separated from warning', () => {
    expect(hueDistance(c.accent, c.warning)).toBeGreaterThanOrEqual(30);
  });

  // Was 1.02:1 — near-identical luminance, separated by hue alone.
  it('favoriteActive is separated from danger on luminance as well as hue', () => {
    expect(hueDistance(c.favoriteActive, c.danger)).toBeGreaterThanOrEqual(15);
    expect(contrastRatio(c.favoriteActive, c.danger)).toBeGreaterThanOrEqual(1.15);
  });

  it('favoriteActive is separated from accent, so favorite never reads as selected', () => {
    expect(hueDistance(c.favoriteActive, c.accent)).toBeGreaterThanOrEqual(60);
  });
});

// ============================================================
// Color vision deficiency
// ============================================================
// Olive-vs-red is the classic red-green trap, so it is verified rather than
// assumed. It holds because the two differ substantially in LIGHTNESS, which
// dichromats still perceive — and it measures better than the red-on-red
// palette it replaces.
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

  it.each(simulators)('accent stays distinguishable from success under %s', (_name, simulate) => {
    expect(contrastRatio(simulate(c.accent), simulate(c.success))).toBeGreaterThanOrEqual(1.25);
  });

  it.each(simulators)('body text keeps its AA margin under %s', (_name, simulate) => {
    expect(contrastRatio(simulate(c.text), simulate(c.bg))).toBeGreaterThanOrEqual(4.5);
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

  it('keeps accent out of the red sector entirely', () => {
    for (const [, c] of SCHEMES) {
      const h = hue(c.accent);
      expect(h).toBeGreaterThan(30);
      expect(h).toBeLessThan(330);
    }
  });
});
