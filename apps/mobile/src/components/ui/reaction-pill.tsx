import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { getReactionPillLabel } from '@/components/ui/reaction-pill-state';
import { Text } from '@/components/ui/text';
import { radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

// Verified against the installed packages, same discipline as every other
// IconName in this codebase: 'heart.fill' exists in sf-symbols-typescript's
// types and 'favorite' in expo-symbols' android/symbols.json.
const HEART_ICON: IconName = { ios: 'heart.fill', android: 'favorite', web: 'favorite' };

export type ReactionPillProps = {
  /** Number of saves. Rendered as-is; the caller decides any abbreviation. */
  count: number;
  /** Overrides the accessible name. Default reads as "N saves". */
  accessibilityLabel?: string;
};

/**
 * A save-count pill for a grid tile (DESIGN.md §13; §14.2 still describes
 * the previous Explore and is rewritten when that screen is rebuilt).
 *
 * Read-only by design: it reports a count, it does not toggle. Favouriting
 * lives on the listing itself (the feed card's heart), and a second, smaller
 * control that looked tappable but only sometimes was would be worse than no
 * control. A caller wanting a tappable version should add it deliberately
 * rather than by wrapping this in a Pressable.
 *
 * `bg` fill rather than a scrim: these sit on photography, so the pill is an
 * opaque plate carrying its own `text` colour, not a translucent overlay whose
 * contrast depends on the photo beneath it.
 */
export function ReactionPill({ count, accessibilityLabel }: ReactionPillProps) {
  const { colors } = useAppTheme();

  return (
    <View
      style={[styles.pill, { backgroundColor: colors.bg }]}
      accessible
      // One node, one name — the heart is decorative, so the pill speaks for
      // the pair rather than announcing an unlabelled glyph then a bare
      // number.
      accessibilityLabel={accessibilityLabel ?? getReactionPillLabel(count)}>
      <Icon name={HEART_ICON} size="sm" color={colors.accent} />
      {/*
        `micro` (11/600) where the handoff says 12px bold — the nearest
        existing variant, taken rather than inventing a one-off size for a 1pt
        difference. DESIGN.md §15 rule 1: screens and primitives read the
        scale, they do not extend it casually.
      */}
      <Text variant="micro">{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space[1],
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: radius.full,
  },
});
