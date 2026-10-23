import { describe, expect, it } from 'vitest';

import { resolveLogoSurface, type LogoSurface, type LogoTone } from '@/components/ui/logo-state';

describe('resolveLogoSurface', () => {
  it('resolves auto from the active scheme', () => {
    expect(resolveLogoSurface('auto', 'light')).toBe('onLight');
    expect(resolveLogoSurface('auto', 'dark')).toBe('onDark');
  });

  // The whole reason the explicit tones exist: a screen painted on
  // `bgInverse` is dark while the app scheme is still light, so `auto` would
  // pick the ink wordmark and lose it against the background.
  it('passes explicit tones through, ignoring the scheme', () => {
    const explicit: LogoSurface[] = ['onLight', 'onDark', 'onMedia'];
    for (const tone of explicit) {
      expect(resolveLogoSurface(tone, 'light')).toBe(tone);
      expect(resolveLogoSurface(tone, 'dark')).toBe(tone);
    }
  });

  // Guards the naming convention itself: every non-auto tone names the
  // SURFACE, so `onDark` must never resolve to the dark-wordmark cut.
  it('names the surface, not the artwork — onDark is for dark backgrounds', () => {
    expect(resolveLogoSurface('onDark', 'light')).toBe('onDark');
    expect(resolveLogoSurface('onLight', 'dark')).toBe('onLight');
  });

  it('returns a surface for every tone, so the asset lookup can be exhaustive', () => {
    const tones: LogoTone[] = ['auto', 'onLight', 'onDark', 'onMedia'];
    for (const tone of tones) {
      expect(['onLight', 'onDark', 'onMedia']).toContain(resolveLogoSurface(tone, 'light'));
    }
  });
});
