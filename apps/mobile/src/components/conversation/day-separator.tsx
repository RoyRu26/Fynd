import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { space } from '@/design/tokens';

/**
 * A day boundary in the thread (SCREENS.md Task 8) — "Today", "Yesterday",
 * or a bare date, from `buildChatListItems`'s own grouping. Genuinely
 * useful context when scrolling a long history, so unlike `Sticker`'s
 * purely decorative label this one stays in the accessibility tree rather
 * than being hidden.
 */
export function DaySeparator({ label }: { label: string }) {
  return (
    <View style={styles.row}>
      <Text variant="micro" color="textTertiary" style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

// "tracking 0.2em" resolved against `micro`'s 11px size (DESIGN.md §5 rule
// 4: react-native's letterSpacing is in points, not em).
const LABEL_LETTER_SPACING = 11 * 0.2;

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    paddingVertical: space[2],
  },
  label: {
    textTransform: 'uppercase',
    letterSpacing: LABEL_LETTER_SPACING,
  },
});
