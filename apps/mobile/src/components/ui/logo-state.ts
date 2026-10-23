import type { Scheme } from '@/design/palette';

/**
 * Which cut of the logo to use.
 *
 * Every non-`auto` value names **the surface the logo sits on**, never the
 * logo's own colour — the same convention `IconButtonVariant`'s `onMedia`
 * and the `textOnMedia` token already follow. So `onDark` returns the cut
 * with the *cream* wordmark, because that is the one that reads on a dark
 * surface.
 *
 * `onLight`/`onDark` exist because a screen can be dark while the app scheme
 * is light: anything painted on `bgInverse` (the welcome screen, for one)
 * would get the ink wordmark from `auto` and all but disappear. Reach for
 * them only when the surface is deliberately inverted relative to the
 * scheme; otherwise `auto` is correct and self-maintaining.
 */
export type LogoTone = 'auto' | 'onLight' | 'onDark' | 'onMedia';

/** `LogoTone` with `auto` already resolved — one per actual asset. */
export type LogoSurface = Exclude<LogoTone, 'auto'>;

/**
 * Resolves `auto` against the active scheme, and passes every explicit tone
 * through unchanged.
 *
 * Split out from the component (and exhaustively typed) so the mapping is
 * testable and so adding a `Scheme` member later is a compile error here
 * rather than a silent fall-through to the wrong artwork.
 */
export function resolveLogoSurface(tone: LogoTone, scheme: Scheme): LogoSurface {
  if (tone !== 'auto') return tone;
  return scheme === 'dark' ? 'onDark' : 'onLight';
}
