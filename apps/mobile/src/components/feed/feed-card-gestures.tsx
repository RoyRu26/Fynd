import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import type { IconName } from '@/components/ui';
import { duration, spring } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

/**
 * Tap handling for the Home feed's full-bleed photo: a single tap opens the
 * listing detail screen, a double tap favorites it (with a centered,
 * decorative heart pop). Isolated here so feed-card.tsx stays a thin
 * composition of this plus the existing favorite button, rather than
 * growing its own gesture/animation code.
 *
 * This only ever wraps the photo, never the metadata/favorite-button
 * overlay rendered above it in feed-card.tsx — those are separate sibling
 * views higher in z-order, so a tap landing on the heart IconButton is
 * handled by that Pressable directly and never reaches these Tap gestures.
 *
 * Single vs double tap is `Gesture.Exclusive(doubleTap, singleTap)` — RNGH's
 * own documented pattern for this exact ambiguity, not a hand-rolled
 * timestamp diff. `doubleTap` (`numberOfTaps(2)`) gets first refusal: on a
 * single tap it only *fails* once its `maxDelay` elapses with no second tap,
 * and only on that failure does `singleTap` get to recognize the SAME touch
 * sequence. That failure-to-fail-over window is exactly what stops the
 * single-tap navigation from firing before a double tap had a chance to be
 * recognized — the cost is a single tap waiting out that same short window,
 * which is the inherent, unavoidable trade-off of supporting both gestures
 * on the same target (the same trade-off Instagram/every double-tap-to-like
 * feed makes). Either gesture's own `maxDistance` default is what makes a
 * scroll/drag fail both outright, so normal FlatList paging is untouched.
 * `.runOnJS(true)` on both because the callbacks reach a TanStack mutation
 * and `expo-router` navigation on the JS thread anyway, and neither has a
 * latency budget tight enough to need UI-thread handling.
 *
 * The heart animation's trigger is routed through a counter + `useEffect`
 * rather than mutating the shared values directly inside the gesture
 * callback — same reason ambient-background.tsx does its own shared-value
 * writes inside a `useEffect`: the `react-hooks/immutability` lint rule
 * flags a `SharedValue.value` write made directly inside an arbitrary
 * callback as mutating a hook's return value, but recognizes a `useEffect`
 * body as the sanctioned place for it.
 *
 * The haptic fires from the gesture callback itself (not the effect) since
 * it has nothing to do with the shared values and `Haptics.impactAsync`
 * already returns a plain Promise — nothing here ever lets its rejection
 * propagate, so an unsupported device/simulator can't turn "no haptics
 * engine" into a crash.
 */

const HEART_ICON: IconName = { ios: 'heart.fill', android: 'favorite', web: 'favorite' };
// Deliberately outside the shared `iconSize` scale (max 28) — this is a
// one-off "hero" size for the pop animation, not a reusable UI icon size.
const HEART_SIZE = 96;

const APPEAR_DURATION = duration.instant;
const HOLD_DURATION = duration.slow;
const FADE_DURATION = duration.normal;
const TAP_WINDOW_MS = 250;

export type FeedCardGesturesProps = {
  children: ReactNode;
  /**
   * Called once per recognized double-tap. The caller decides whether that
   * actually favorites anything (double-tap is never a toggle here) — this
   * component only detects the gesture and plays the animation.
   */
  onDoubleTap: () => void;
  /** Called once per recognized single tap — opens the listing detail. */
  onSingleTap: () => void;
};

export function FeedCardGestures({ children, onDoubleTap, onSingleTap }: FeedCardGesturesProps) {
  const { colors } = useAppTheme();
  const reducedMotion = useReducedMotion();

  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  // Incremented once per recognized double-tap; the effect below is what
  // actually plays the animation, never the gesture callback directly.
  const [tapSignal, setTapSignal] = useState(0);

  useEffect(() => {
    // Skip the mount-time run — a signal of 0 means "no tap has happened
    // yet," not "replay the animation."
    if (tapSignal === 0) return;

    if (reducedMotion) {
      // DESIGN.md §10 rule 3: reduced motion drops the scale/spring pop
      // entirely — opacity alone carries the appear/hold/fade.
      scale.value = 1;
      opacity.value = withSequence(
        withTiming(1, { duration: APPEAR_DURATION, easing: Easing.linear }),
        withDelay(HOLD_DURATION, withTiming(0, { duration: FADE_DURATION, easing: Easing.linear })),
      );
      return;
    }

    scale.value = 0;
    scale.value = withSpring(1, spring);
    opacity.value = withSequence(
      withTiming(1, { duration: APPEAR_DURATION }),
      withDelay(HOLD_DURATION, withTiming(0, { duration: FADE_DURATION })),
    );
  }, [tapSignal, reducedMotion, opacity, scale]);

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDuration(TAP_WINDOW_MS)
        .maxDelay(TAP_WINDOW_MS)
        .runOnJS(true)
        .onEnd((_event, success) => {
          if (!success) return;
          setTapSignal((count) => count + 1);
          // Non-fatal by construction: a rejected promise here (no haptics
          // engine, simulator, permission quirk) must never surface as an
          // unhandled rejection or interrupt the favorite itself.
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          onDoubleTap();
        }),
    [onDoubleTap],
  );

  const singleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(1)
        .maxDuration(TAP_WINDOW_MS)
        .runOnJS(true)
        .onEnd((_event, success) => {
          if (success) onSingleTap();
        }),
    [onSingleTap],
  );

  // doubleTap gets first refusal — see the header comment for exactly why
  // this ordering is what makes a single tap wait out the double-tap window
  // instead of firing immediately.
  const composedGesture = useMemo(() => Gesture.Exclusive(doubleTap, singleTap), [doubleTap, singleTap]);

  const heartStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={composedGesture}>
      <View style={styles.container}>
        {children}
        {/* Transient and purely visual: never read as favorite state by
            anything else, and never intercepts a touch. */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.heartLayer, heartStyle]}>
          <SymbolView name={HEART_ICON} size={HEART_SIZE} tintColor={colors.favoriteActive} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heartLayer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
