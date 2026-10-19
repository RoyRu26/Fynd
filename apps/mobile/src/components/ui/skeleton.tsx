import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { duration, minTouchTarget, radius as radiusScale, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

// Pure presentational — no -state.ts/test, same precedent as
// listing-image.tsx (no behavior to unit-test independent of rendering).

export type SkeletonProps = {
  width?: number | `${number}%`;
  height?: number;
  aspectRatio?: number;
  radius?: keyof typeof radiusScale;
  style?: StyleProp<ViewStyle>;
};

/**
 * Shimmering placeholder block (DESIGN.md §13). Decorative only: hidden
 * from the accessibility tree unconditionally. The consuming screen owns
 * announcing "Loading…" (e.g. via its own accessibilityLiveRegion) —
 * Skeleton itself never does.
 */
export function Skeleton({ width, height, aspectRatio, radius: radiusKey = 'sm', style }: SkeletonProps) {
  const { colors } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(1);

  // Started here (not in the render body) so a parent re-render never
  // restarts or reassigns an already-running loop — same discipline
  // ambient-background.tsx's Glow effect follows. Reduced motion simply
  // never starts the loop, leaving opacity at its static initial value of 1.
  useEffect(() => {
    if (reducedMotion) return;

    // No dedicated shimmer-cadence token exists in DESIGN.md §10 — reusing
    // duration.slow rather than inventing a new one.
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.4, { duration: duration.slow }),
        withTiming(1, { duration: duration.slow }),
      ),
      -1,
      true,
    );
  }, [opacity, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height,
          aspectRatio,
          borderRadius: radiusScale[radiusKey],
          backgroundColor: colors.skeleton,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** Loading placeholder for a single ListRow — same container metrics, so a loading list doesn't jump when real data arrives. */
export function SkeletonRow({ showTrailing = false }: { showTrailing?: boolean }) {
  return (
    <View style={styles.row}>
      <Skeleton width={40} height={40} radius="full" />
      <View style={styles.rowMain}>
        <Skeleton height={24} width="60%" radius="xs" />
        <Skeleton height={18} width="40%" radius="xs" />
      </View>
      {showTrailing ? <Skeleton width={48} height={48} radius="sm" /> : null}
    </View>
  );
}

/** Loading placeholder mirroring ListingGridTile's own tile/image metrics, so a grid of these lines up pixel-for-pixel with real tiles. */
export function SkeletonListingCard() {
  return (
    <View style={styles.tile}>
      <Skeleton width="100%" aspectRatio={1} radius="sm" />
      <Skeleton height={19} width="50%" radius="xs" />
      <Skeleton height={18} width="70%" radius="xs" />
    </View>
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
  rowMain: {
    flex: 1,
    gap: space[1],
  },
  tile: {
    width: '33.3333%',
    // Half the DESIGN.md §14.2 gutter (space[1]) on each side, matching
    // ListingGridTile exactly so two adjacent tiles sum to one full gutter.
    padding: space[1] / 2,
    gap: space[1],
  },
});
