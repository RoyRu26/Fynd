import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { ratingForStarIndex, STAR_COUNT, starFillForIndex } from '@/components/ui/star-rating-state';
import { iconSize, minTouchTarget, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

export type { StarFill } from '@/components/ui/star-rating-state';

/**
 * A 5-star rating, read-only or interactive depending on whether `onChange`
 * is passed -- read-only for a profile's average-rating summary and a
 * review row's own rating, interactive for the rating picker in the review
 * submission sheet. No separate `readOnly`/`interactive` prop: the presence
 * of a handler already fully determines the mode, so there is no way for
 * the two to disagree (an interactive-looking control with no `onChange`,
 * or a handler nobody can reach).
 *
 * `value` can be fractional in read-only mode (a seller's average rating,
 * e.g. 4.3) -- `starFillForIndex` renders the one boundary star half-filled.
 * In interactive mode `value` is always a whole 1-5 integer (or 0 before a
 * pick), which `starFillForIndex` already handles correctly without a
 * separate code path (see its own doc comment: 'half' is simply never
 * reached for a whole-number value).
 *
 * Fill is communicated by icon SHAPE (filled/half/outline star), never
 * color alone, per DESIGN.md §4/§12.4 -- every star renders in the same
 * `accent` tint regardless of fill state.
 *
 * Verified against the installed packages, same discipline as every other
 * `IconName` constant in this codebase: 'star.fill', 'star.lefthalf.fill',
 * and 'star' all exist in sf-symbols-typescript's dist/index.d.ts; 'star',
 * 'star_half', and 'star_border' all exist in expo-symbols' android
 * symbols.json (used for both android and web, per `IconName`'s own
 * contract).
 */

const FILLED_ICON: IconName = { ios: 'star.fill', android: 'star', web: 'star' };
const HALF_ICON: IconName = { ios: 'star.lefthalf.fill', android: 'star_half', web: 'star_half' };
const EMPTY_ICON: IconName = { ios: 'star', android: 'star_border', web: 'star_border' };

function iconForFill(fill: ReturnType<typeof starFillForIndex>): IconName {
  if (fill === 'filled') return FILLED_ICON;
  if (fill === 'half') return HALF_ICON;
  return EMPTY_ICON;
}

export type StarRatingProps = {
  value: number;
  /** Interactive when passed -- each star becomes its own tappable button. Read-only otherwise. */
  onChange?: (value: number) => void;
  size?: keyof typeof iconSize;
  /** Required in both modes: read-only needs it as the single accessible node's name, interactive needs it to disambiguate which rating this control is (there can be more than one on a screen). */
  accessibilityLabel: string;
};

export function StarRating({ value, onChange, size = 'lg', accessibilityLabel }: StarRatingProps) {
  const { colors } = useAppTheme();

  if (!onChange) {
    // A single accessible node, not five -- a screen reader should hear
    // "4.3 out of 5 stars for average rating", not five separate decorative
    // icons announced one after another.
    return (
      <View
        style={styles.row}
        accessible
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min: 0, max: STAR_COUNT, now: value }}>
        {Array.from({ length: STAR_COUNT }, (_, index) => (
          <Icon key={index} name={iconForFill(starFillForIndex(value, index))} size={size} color={colors.accent} />
        ))}
      </View>
    );
  }

  // Interactive: each star is its OWN accessible button ("Rate 3 stars"),
  // not one adjustable slider -- clearer for VoiceOver/TalkBack than a
  // single control whose value changes via swipe gestures most users won't
  // discover. The outer View carries no accessibility props of its own, so
  // it never competes with its children for a screen reader's focus.
  //
  // Same 44pt touch-target construction as `IconButton`: the visual box is
  // sized to the icon (not forced to a full 44pt, which would look
  // oversized), and hitSlop makes up the difference.
  const visualBoxSize = iconSize[size] + VISUAL_BOX_PADDING * 2;
  const hitSlopValue = Math.max(0, (minTouchTarget - visualBoxSize) / 2);

  return (
    <View style={styles.row}>
      {Array.from({ length: STAR_COUNT }, (_, index) => {
        const starValue = ratingForStarIndex(index);
        return (
          <Pressable
            key={index}
            onPress={() => onChange(starValue)}
            hitSlop={hitSlopValue}
            accessibilityRole="button"
            accessibilityLabel={`${accessibilityLabel}: rate ${starValue} star${starValue === 1 ? '' : 's'}`}
            accessibilityState={{ selected: value === starValue }}
            style={[styles.box, { width: visualBoxSize, height: visualBoxSize }]}>
            <Icon name={iconForFill(starFillForIndex(value, index))} size={size} color={colors.accent} />
          </Pressable>
        );
      })}
    </View>
  );
}

const VISUAL_BOX_PADDING = 4;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space[1],
  },
  box: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
