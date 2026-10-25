import type { TextColor } from '@/components/ui/text-variants';

// Pure logic for PillButton — no runtime import, directly unit-testable.

export type PillButtonVariant = 'primary' | 'outline' | 'inverse';

/** Fixed height. A pill's radius is half its height, so this is also what makes it a pill rather than a rounded rectangle. */
export const PILL_BUTTON_HEIGHT = 46;

/**
 * Foreground token per variant.
 *
 * `primary` is a solid accent fill, so it takes `onAccent` — the pairing
 * `palette.test.ts` holds to 4.5:1. `outline` has no fill, so its label sits
 * on the page and takes `text`, NOT `accentText`: the outline already carries
 * the accent, and tinting the label too would make a secondary action compete
 * with the primary one beside it. `inverse` mirrors `Button`'s own `inverse`
 * variant exactly: a solid `bgInverse` fill takes `textInverse`, the pairing
 * that stays contrast-correct in both schemes by construction (`bgInverse`/
 * `textInverse` flip together — see `Button`'s own doc comment for the full
 * "opposite of the current background, not literally dark" caveat).
 */
export function getPillButtonForegroundColor(variant: PillButtonVariant): TextColor {
  switch (variant) {
    case 'primary':
      return 'onAccent';
    case 'outline':
      return 'text';
    case 'inverse':
      return 'textInverse';
  }
}

/**
 * Disabled always wins. `primary` does not dim on press — it swaps its fill
 * to `accentPressed` instead, exactly as `Button`'s own primary does, so the
 * two feel like one family under the finger.
 */
export function getPillButtonOpacity({
  disabled,
  pressed,
  variant,
}: {
  disabled?: boolean;
  pressed: boolean;
  variant: PillButtonVariant;
}): number {
  if (disabled) return 0.4;
  if (variant === 'primary') return 1;
  return pressed ? 0.7 : 1;
}
