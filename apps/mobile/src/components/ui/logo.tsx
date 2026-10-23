import { Image } from 'expo-image';

import { resolveLogoSurface, type LogoSurface, type LogoTone } from '@/components/ui/logo-state';
import { useAppTheme } from '@/design/theme-provider';

// Three flat-colour cuts of the lockup rather than one asset tinted at
// runtime. `onLight` and `onDark` keep the brand-orange mark and change only
// the wordmark (ink vs cream), which a single tint cannot express. `onMedia`
// is different in kind: it is ALL cream, mark included — verified against the
// pixels, not assumed — because over photography the mark has no reliable
// backdrop to hold its own colour against. That also means `onMedia` carries
// no brand colour at all, so it depends entirely on the surface beneath it
// for contrast (DESIGN.md §12 rule 2: that is the scrim's job, not the
// asset's).
//
// Source art is 496x234 for all three; width is derived from that ratio.
const LOGO_SOURCES = {
  onLight: require('@/assets/images/fynd-logo-light.png'),
  onDark: require('@/assets/images/fynd-logo-dark.png'),
  onMedia: require('@/assets/images/fynd-logo-cream.png'),
} satisfies Record<LogoSurface, unknown>;

const SOURCE_ASPECT_RATIO = 496 / 234;

export type { LogoTone } from '@/components/ui/logo-state';

export type LogoProps = {
  /**
   * Required, with width derived from the source art's ratio — the lockup
   * can never be stretched out of proportion.
   *
   * Deliberately a fixed optical size rather than a Dynamic Type-scaling
   * one: a logo is artwork, not copy. Note the consequence — at the largest
   * accessibility sizes the headline beneath it grows while this does not.
   */
  height: number;
  /**
   * Which cut to use. Names the SURFACE the logo sits on, not the logo's own
   * colour — see `LogoTone`. Defaults to `auto`, which follows the active
   * scheme and is correct for any screen using that scheme's own `bg`. Use
   * `onLight`/`onDark` only for deliberately inverted surfaces (e.g.
   * `bgInverse`), where `auto` would pick the wrong wordmark.
   */
  tone?: LogoTone;
};

/** The Fynd brand lockup — mark plus wordmark (DESIGN.md §13). */
export function Logo({ height, tone = 'auto' }: LogoProps) {
  const { scheme } = useAppTheme();

  return (
    <Image
      source={LOGO_SOURCES[resolveLogoSurface(tone, scheme)]}
      accessible
      // On the auth and onboarding screens this lockup is the only brand
      // identity present, so it has to be announced rather than decorative.
      accessibilityLabel="Fynd"
      contentFit="contain"
      style={{ height, width: height * SOURCE_ASPECT_RATIO }}
    />
  );
}
