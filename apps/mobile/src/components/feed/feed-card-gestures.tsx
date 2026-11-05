import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { Directions, Gesture, GestureDetector } from 'react-native-gesture-handler';
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
 * Tap and swipe handling for the Home feed's full-bleed photo: a single tap
 * or a leftward swipe both open the listing detail screen (the swipe is a
 * second, more forgiving way to reach the same "see this post's info"
 * destination — a quick horizontal flick is far more reliable to land than
 * a precise stationary tap on a screen that is simultaneously being paged
 * vertically), a double tap favorites it (with a centered, decorative heart
 * pop). Isolated here so feed-card.tsx stays a thin composition of this
 * plus the existing favorite button, rather than growing its own
 * gesture/animation code.
 *
 * This only ever wraps the photo, never the metadata/favorite-button
 * overlay rendered above it in feed-card.tsx — those are separate sibling
 * views higher in z-order, so a tap landing on the heart IconButton is
 * handled by that Pressable directly and never reaches these gestures.
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
 * feed makes).
 *
 * Both tap gestures set an explicit, generous `.maxDistance` (RNGH's own
 * default is tight — a few pixels — which is what made taps feel like they
 * only landed in a tiny patch of the card: completely ordinary finger
 * jitter during a press was enough to make the recognizer treat it as a
 * drag and fail the tap outright). The wider budget still fails outright,
 * and defers to the surrounding FlatList, for any touch that moves far
 * enough to be an actual scroll/drag — normal vertical paging is untouched.
 *
 * `swipeLeft` is a separate `Gesture.Fling()` constrained to
 * `Directions.LEFT` — direction-gated, so a vertical flick (paging to the
 * next post) never satisfies it and falls through to the FlatList exactly
 * as before. Composed with the tap pair via `Gesture.Race`: a fling and a
 * (near-)stationary tap can never both be the same touch, but Race still
 * guarantees whichever recognizes first cancels the other outright rather
 * than risking both callbacks firing for one gesture.
 *
 * `.runOnJS(true)` on all three because the callbacks reach a TanStack
 * mutation and `expo-router` navigation on the JS thread anyway, and none
 * has a latency budget tight enough to need UI-thread handling.
 *
 * The heart animation's trigger is routed through a counter + `useEffect`
 * rather than mutating the shared values directly inside the gesture
 * callback: the `react-hooks/immutability` lint rule
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
// See the header comment: RNGH's own Tap default is a few pixels, tight
// enough that ordinary finger jitter during a press reads as a drag and
// fails the tap. A touch still has to move this far before it's treated as
// one, so a real scroll/drag is unaffected.
const TAP_MAX_DISTANCE = 24;

export type FeedCardGesturesProps = {
  children: ReactNode;
  /**
   * Called once per recognized double-tap. The caller decides whether that
   * actually favorites anything (double-tap is never a toggle here) — this
   * component only detects the gesture and plays the animation.
   */
  onDoubleTap: () => void;
  /**
   * Called once per recognized single tap OR leftward swipe — both open
   * the listing detail; see the header comment for why the swipe exists as
   * a second way to reach it.
   */
  onSingleTap: () => void;
  /**
   * DESIGN.md §12.6: this is the feed's primary navigation gesture (§14.1
   * "Tapping the photo opens detail"), but it's a raw gesture recognizer on
   * a plain View, invisible to VoiceOver/TalkBack by default. Composed from
   * the listing's title + price by the caller (see listing-grid-tile.tsx
   * for the same convention) and applied to the gesture's own wrapping View
   * below, with `onAccessibilityTap` wired to the SAME `onSingleTap` the
   * gesture recognizer already calls — so a screen-reader double-tap reaches
   * the identical "open detail" outcome a sighted single tap does. Purely
   * additive: none of the gesture/animation wiring above changes.
   */
  accessibilityLabel: string;
};

export function FeedCardGestures({
  children,
  onDoubleTap,
  onSingleTap,
  accessibilityLabel,
}: FeedCardGesturesProps) {
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
        .maxDistance(TAP_MAX_DISTANCE)
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
        .maxDistance(TAP_MAX_DISTANCE)
        .runOnJS(true)
        .onEnd((_event, success) => {
          if (success) onSingleTap();
        }),
    [onSingleTap],
  );

  // Direction-gated, so a vertical flick (paging to the next post) never
  // satisfies this and falls straight through to the FlatList. See the
  // header comment for why this exists alongside the tap above rather than
  // replacing it.
  const swipeLeft = useMemo(
    () =>
      Gesture.Fling()
        .direction(Directions.LEFT)
        .runOnJS(true)
        .onEnd((_event, success) => {
          if (success) onSingleTap();
        }),
    [onSingleTap],
  );

  // doubleTap gets first refusal within the tap pair — see the header
  // comment for exactly why this ordering is what makes a single tap wait
  // out the double-tap window instead of firing immediately. The tap pair
  // races against swipeLeft: a fling and a (near-)stationary tap can never
  // both be the same touch, but Race still guarantees whichever recognizes
  // first cancels the other outright.
  const composedGesture = useMemo(
    () => Gesture.Race(Gesture.Exclusive(doubleTap, singleTap), swipeLeft),
    [doubleTap, singleTap, swipeLeft],
  );

  const heartStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={composedGesture}>
      <View
        style={styles.container}
        accessible
        accessibilityRole="imagebutton"
        accessibilityLabel={accessibilityLabel}
        // `onAccessibilityTap` is iOS-only (VoiceOver's own activate
        // gesture) -- confirmed against the installed react-native source,
        // there is no Android dispatch path for it at all. A bare View
        // wrapped by GestureDetector (not Pressable/Touchable, which wire a
        // native click listener Android's accessibility layer falls back
        // to) has nothing for TalkBack's ACTION_CLICK to land on without
        // this. `accessibilityActions`/`onAccessibilityAction` with the
        // reserved 'activate' name is RN's documented cross-platform
        // mechanism for exactly this case -- Android's TalkBack double-tap
        // maps to it directly; iOS keeps using `onAccessibilityTap` above
        // (redundant with 'activate' there, kept for clarity/parity, not
        // required). Both call the SAME onSingleTap the gesture recognizer
        // already does -- still no change to the gesture/animation logic.
        accessibilityActions={[{ name: 'activate' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'activate') onSingleTap();
        }}
        onAccessibilityTap={onSingleTap}>
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
