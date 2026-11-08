import { SymbolView } from 'expo-symbols';

import type { IconName } from '@/components/ui/icon';
import { useAppTheme } from '@/design/theme-provider';

const PERSON_ICON: IconName = { ios: 'person.fill', android: 'person', web: 'person' };

// The glyph fills a bit over half the circle at every size (Avatar's sizes
// were tuned by eye to 14/24 … 48/84, all ≈0.56). A ratio rather than the
// shared `iconSize` scale, which tops out at 28, below the larger circles.
const GLYPH_TO_DIAMETER = 0.56;

/**
 * The "no profile photo" placeholder shared by `Avatar` and `StoryRing`: a
 * generic person glyph in `textTertiary`, centred by the caller's circle.
 * Decorative — the circle's owner carries the accessible name.
 */
export function PersonGlyph({ diameter }: { diameter: number }) {
  const { colors } = useAppTheme();
  return (
    <SymbolView
      name={PERSON_ICON}
      size={Math.round(diameter * GLYPH_TO_DIAMETER)}
      tintColor={colors.textTertiary}
    />
  );
}
