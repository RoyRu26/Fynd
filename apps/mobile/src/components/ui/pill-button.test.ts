import { describe, expect, it } from 'vitest';

import {
  getPillButtonForegroundColor,
  getPillButtonOpacity,
  PILL_BUTTON_HEIGHT,
} from '@/components/ui/pill-button-state';

describe('getPillButtonForegroundColor', () => {
  it('pairs the solid accent fill with its asserted on-colour', () => {
    expect(getPillButtonForegroundColor('primary')).toBe('onAccent');
  });

  // The outline already carries the accent. Tinting the label too would make
  // a secondary action shout as loudly as the primary one beside it.
  it('keeps the outline label neutral rather than tinting it accent', () => {
    expect(getPillButtonForegroundColor('outline')).toBe('text');
    expect(getPillButtonForegroundColor('outline')).not.toBe('accentText');
  });
});

describe('getPillButtonOpacity', () => {
  it('disabled wins over everything', () => {
    expect(getPillButtonOpacity({ disabled: true, pressed: false, variant: 'primary' })).toBe(0.4);
    expect(getPillButtonOpacity({ disabled: true, pressed: true, variant: 'outline' })).toBe(0.4);
  });

  // Matches Button's primary exactly, so the two controls feel like one
  // family under the finger.
  it('primary signals press by fill swap, not by dimming', () => {
    expect(getPillButtonOpacity({ pressed: true, variant: 'primary' })).toBe(1);
  });

  it('outline dims on press', () => {
    expect(getPillButtonOpacity({ pressed: true, variant: 'outline' })).toBe(0.7);
    expect(getPillButtonOpacity({ pressed: false, variant: 'outline' })).toBe(1);
  });
});

describe('PILL_BUTTON_HEIGHT', () => {
  it('clears the 44pt touch floor on its own', () => {
    expect(PILL_BUTTON_HEIGHT).toBeGreaterThanOrEqual(44);
  });
});
