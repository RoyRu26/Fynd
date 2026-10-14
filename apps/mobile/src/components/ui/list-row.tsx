import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { DISABLED_OPACITY } from '@/components/ui/button-state';
import {
  getListRowAccessibilityLabel,
  getListRowTitleVariant,
  isListRowInteractive,
} from '@/components/ui/list-row-state';
import { Text } from '@/components/ui/text';
import type { TextColor } from '@/components/ui/text-variants';
import { minTouchTarget, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

export type ListRowProps = {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  /** Drives title weight, a dot, and the accessible label — never color alone (DESIGN.md §12.4). */
  unread?: boolean;
  /**
   * Overrides the title's color — e.g. `danger` for a destructive action row,
   * paired with a danger-tinted leading icon so the signal is never color
   * alone (DESIGN.md §12.4). Defaults to `text`.
   */
  titleColor?: TextColor;
  /** Override; otherwise composed from title/subtitle/unread. */
  accessibilityLabel?: string;
};

// Unread dot: 8px circle, radius = size/2 as a local literal — the same
// pattern avatar.tsx uses for its own circular fill. `radius.full` (§7) is
// scoped to avatars/circular icon buttons specifically, not arbitrary dots.
const UNREAD_DOT_SIZE = 8;

export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  onPress,
  disabled,
  unread,
  titleColor = 'text',
  accessibilityLabel,
}: ListRowProps) {
  const { colors } = useAppTheme();
  const interactive = isListRowInteractive({ onPress, disabled });
  const label = accessibilityLabel ?? getListRowAccessibilityLabel({ title, subtitle, unread });

  const content = (
    <>
      {leading}
      <View style={styles.main}>
        <View style={styles.titleRow}>
          <Text
            variant={getListRowTitleVariant(unread)}
            color={titleColor}
            numberOfLines={1}
            style={styles.titleText}>
            {title}
          </Text>
          {unread ? (
            <View style={[styles.unreadDot, { backgroundColor: colors.accent }]} />
          ) : null}
        </View>
        {subtitle ? (
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </>
  );

  if (!interactive) {
    return <View style={[styles.row, { opacity: disabled ? DISABLED_OPACITY : 1 }]}>{content}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    minHeight: minTouchTarget,
  },
  main: {
    flex: 1,
    gap: space[1],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  titleText: {
    flexShrink: 1,
  },
  unreadDot: {
    width: UNREAD_DOT_SIZE,
    height: UNREAD_DOT_SIZE,
    borderRadius: UNREAD_DOT_SIZE / 2,
  },
});
