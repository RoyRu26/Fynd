import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { ambientGlow, ambientMotion } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

// Two oversized, off-canvas radial washes (brick red + dusty rose) drifting
// slowly behind screen content. See DESIGN.md §4a.
//
// Progressive enhancement: the root View's `colors.bg` fill is a plain,
// universally-supported backgroundColor — always present regardless of
// whether the platform/renderer honors `experimental_backgroundImage`
// (an experimental RN API). If a given glow's gradient doesn't render for
// any reason, that shape is simply invisible; the screen still reads
// correctly on the solid neutral `bg` fill underneath. No feature detection
// or fallback branching is needed for this — it falls out of the layering
// itself, deliberately, rather than adding a compatibility abstraction.

const CONTAINER_SIZE = '140%';

function Glow({
  corner,
  gradient,
  cycleDurationMs,
  reducedMotion,
}: {
  corner: 'topRight' | 'bottomLeft';
  gradient: (typeof ambientGlow)['primary'];
  cycleDurationMs: number;
  reducedMotion: boolean;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);

  // Animations are started here, not directly in the render body, so a
  // parent re-render (e.g. a light/dark scheme change causing
  // AmbientBackground to re-render) can never restart or reassign an
  // already-running loop — this runs exactly once, on mount.
  useEffect(() => {
    if (reducedMotion) return;

    const half = cycleDurationMs / 2;
    const easing = Easing.inOut(Easing.sin);
    const loop = (target: number) =>
      withRepeat(
        withSequence(
          withTiming(target, { duration: half, easing }),
          withTiming(-target, { duration: half, easing }),
        ),
        -1,
        true,
      );

    translateX.value = loop(ambientMotion.translateRange);
    translateY.value = loop(ambientMotion.translateRange);
    scale.value = withRepeat(
      withSequence(
        withTiming(1 + ambientMotion.scaleRange, { duration: half, easing }),
        withTiming(1, { duration: half, easing }),
      ),
      -1,
      true,
    );
    rotate.value = loop(ambientMotion.rotateRangeDeg);
  }, [cycleDurationMs, reducedMotion, rotate, scale, translateX, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
      { rotate: `${rotate.value}deg` },
    ],
  }));

  const cornerStyle = corner === 'topRight' ? styles.topRight : styles.bottomLeft;

  return (
    <Animated.View
      style={[
        styles.glow,
        cornerStyle,
        { experimental_backgroundImage: [gradient] },
        animatedStyle,
      ]}
    />
  );
}

export function AmbientBackground() {
  const { colors } = useAppTheme();
  const reducedMotion = useReducedMotion();

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]} pointerEvents="none">
      <Glow
        corner="topRight"
        gradient={ambientGlow.primary}
        cycleDurationMs={ambientMotion.cycleDurationMs.primary}
        reducedMotion={reducedMotion}
      />
      <Glow
        corner="bottomLeft"
        gradient={ambientGlow.secondary}
        cycleDurationMs={ambientMotion.cycleDurationMs.secondary}
        reducedMotion={reducedMotion}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    width: CONTAINER_SIZE,
    height: CONTAINER_SIZE,
  },
  topRight: {
    top: '-8%',
    right: '-12%',
  },
  bottomLeft: {
    // Pulled up from the original -25% so the wash reads around the lower
    // fields/CTA area rather than bleeding into the unused space below the
    // button — tuning pass per on-device feedback.
    bottom: '-5%',
    left: '-15%',
  },
});
