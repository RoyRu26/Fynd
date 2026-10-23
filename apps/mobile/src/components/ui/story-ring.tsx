import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { getStoryRingMetrics } from '@/components/ui/story-ring-state';
import { Text } from '@/components/ui/text';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

export type StoryRingProps = {
  /** Outer diameter, ring included. See `getStoryRingMetrics` for why the ring grows inward. */
  size: number;
  /** Image URI. Omitted renders the toned empty circle, which is a valid resting state, not an error. */
  uri?: string;
  active?: boolean;
  /** Optional caption under the ring. */
  label?: string;
  /** Overrides the accessible name; falls back to `label`. */
  accessibilityLabel?: string;
};

/**
 * A circular image inside a ring — the Explore "Drops" row's unit
 * (DESIGN.md §13; §14.2 still describes the previous Explore and is rewritten
 * when that screen is rebuilt).
 *
 * Presentational only: it has no press behaviour of its own, so a caller that
 * needs tapping wraps it in a `Pressable` and owns the role, state and
 * accessible name. That keeps one component from guessing whether it is a
 * button, a tab, or decoration.
 */
export function StoryRing({ size, uri, active = false, label, accessibilityLabel }: StoryRingProps) {
  const { colors } = useAppTheme();
  const metrics = getStoryRingMetrics({ size, active });

  // One named node for the whole unit, on the container — NOT on the caption.
  // Hanging it off the caption would silently drop the name whenever a caller
  // passes `accessibilityLabel` with no visible `label`, leaving the ring
  // unnamed with nothing in the types to warn them.
  const name = accessibilityLabel ?? label;

  return (
    <View
      style={styles.container}
      accessible={name !== undefined}
      accessibilityLabel={name}>
      <View
        style={[
          styles.ring,
          {
            width: metrics.outerSize,
            height: metrics.outerSize,
            borderRadius: metrics.outerRadius,
            borderWidth: metrics.ringWidth,
            // Thickness changes with state too, so "active" survives a
            // grayscale or colour-blind reading (§12.4).
            borderColor: active ? colors.accent : colors.border,
            padding: metrics.gap,
          },
        ]}>
        <View
          style={{
            width: metrics.imageSize,
            height: metrics.imageSize,
            borderRadius: metrics.imageRadius,
            backgroundColor: colors.skeleton,
            overflow: 'hidden',
          }}>
          {uri ? (
            <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : null}
        </View>
      </View>

      {label ? (
        // Absorbed into the container's single accessible node above, so the
        // caption is not announced a second time after the name.
        <Text
          variant="micro"
          color={active ? 'text' : 'textSecondary'}
          numberOfLines={1}
          importantForAccessibility="no">
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: space[1],
  },
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
