import { describe, expect, it } from 'vitest';

import {
  DISABLED_OPACITY,
  getButtonForegroundColor,
  getButtonOpacity,
  isButtonInteractive,
  shouldShowButtonBevel,
} from '@/components/ui/button-state';

describe('isButtonInteractive', () => {
  it('is interactive by default', () => {
    expect(isButtonInteractive({})).toBe(true);
  });

  it('is not interactive when disabled', () => {
    expect(isButtonInteractive({ disabled: true })).toBe(false);
  });

  it('is not interactive when loading, even if disabled is explicitly false', () => {
    expect(isButtonInteractive({ disabled: false, loading: true })).toBe(false);
  });

  it('is not interactive when both disabled and loading', () => {
    expect(isButtonInteractive({ disabled: true, loading: true })).toBe(false);
  });
});

describe('getButtonForegroundColor', () => {
  it('maps each variant to its own foreground token', () => {
    expect(getButtonForegroundColor('primary')).toBe('onAccent');
    expect(getButtonForegroundColor('secondary')).toBe('text');
    expect(getButtonForegroundColor('ghost')).toBe('accentText');
    // 'danger', not 'onDanger' — the variant is tonal (dangerBg fill), not a
    // solid fill, so its foreground is ink-on-tint like secondary/ghost, not
    // white-on-solid like primary. See button-state.ts's own doc comment.
    expect(getButtonForegroundColor('danger')).toBe('danger');
    // Scheme-flipping pair: `bgInverse` fill demands `textInverse`, which
    // inverts alongside it. Any other foreground would be correct in one
    // scheme and invisible in the other.
    expect(getButtonForegroundColor('inverse')).toBe('textInverse');
  });

  it('never maps danger to onAccent — the coupling this token split exists to prevent', () => {
    expect(getButtonForegroundColor('danger')).not.toBe('onAccent');
  });

  it('never maps danger to onDanger — that token is for a solid fill this variant deliberately does not use', () => {
    expect(getButtonForegroundColor('danger')).not.toBe('onDanger');
  });
});

describe('getButtonOpacity', () => {
  it('disabled always wins, regardless of pressed or variant', () => {
    expect(getButtonOpacity({ disabled: true, pressed: false, variant: 'primary' })).toBe(DISABLED_OPACITY);
    expect(getButtonOpacity({ disabled: true, pressed: true, variant: 'danger' })).toBe(DISABLED_OPACITY);
  });

  it('primary never dims on press — it signals press via background color instead', () => {
    expect(getButtonOpacity({ pressed: true, variant: 'primary' })).toBe(1);
  });

  it('every non-primary variant dims on press when not disabled', () => {
    for (const variant of ['secondary', 'ghost', 'danger', 'inverse'] as const) {
      expect(getButtonOpacity({ pressed: true, variant })).toBe(0.7);
      expect(getButtonOpacity({ pressed: false, variant })).toBe(1);
    }
  });
});

describe('shouldShowButtonBevel', () => {
  it('shows on an unpressed primary button', () => {
    expect(shouldShowButtonBevel({ variant: 'primary', pressed: false })).toBe(true);
  });

  it('hides while a primary button is pressed — the surface reads as compressed', () => {
    expect(shouldShowButtonBevel({ variant: 'primary', pressed: true })).toBe(false);
  });

  it('never shows on non-primary variants, pressed or not', () => {
    for (const variant of ['secondary', 'ghost', 'danger', 'inverse'] as const) {
      expect(shouldShowButtonBevel({ variant, pressed: false })).toBe(false);
      expect(shouldShowButtonBevel({ variant, pressed: true })).toBe(false);
    }
  });
});
