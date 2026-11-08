import { Image } from 'expo-image';
import { useIsFocused, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, View, type ImageSourcePropType } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Button, Logo, Screen, Text } from '@/components/ui';
import { AppThemeProvider, useAppTheme } from '@/design/theme-provider';
import { gradientFade, radius, space } from '@/design/tokens';

/**
 * Bundled collage photography for the entry screen.
 *
 * Deliberately bundled rather than pulled from the live feed. `feed_listings`
 * is `security invoker` and its covers are signed URLs from a private bucket,
 * so a signed-out caller gets zero rows and no images — there is no version of
 * this screen that shows real listings before authentication without opening
 * read access to anonymous callers, which is not a trade worth making for
 * decoration.
 *
 * TO ADD PHOTOS: drop files in `assets/images/welcome/` and `require` them
 * here. Order fills across columns, not down them, so a partial set still
 * spreads over the collage. Tiles without a photo render as toned blocks.
 * Only public-domain / CC0 images belong here — they ship in the app (see
 * that folder's ATTRIBUTION.md).
 */
const WELCOME_COLLAGE_PHOTOS: readonly ImageSourcePropType[] = [
  require('@/assets/images/welcome/blouse.jpg'),
  require('@/assets/images/welcome/dress.jpg'),
  require('@/assets/images/welcome/hoodie.jpg'),
  require('@/assets/images/welcome/jacket.jpg'),
  require('@/assets/images/welcome/heels.jpg'),
  require('@/assets/images/welcome/tote.jpg'),
  require('@/assets/images/welcome/sneakers.jpg'),
  require('@/assets/images/welcome/linen-shirt.jpg'),
  require('@/assets/images/welcome/polo.jpg'),
  require('@/assets/images/welcome/hoodie-detail.jpg'),
  require('@/assets/images/welcome/cargo-pants.jpg'),
  require('@/assets/images/welcome/jacket-detail.jpg'),
  require('@/assets/images/welcome/blouse-detail.jpg'),
];

// Photo drift (SCREENS.md Task 11). Decorative motion, so per DESIGN.md §10 it
// has its own constants rather than stretching the interaction `duration`
// tokens, and eases in/out with no spring. One 9s cycle: hold at rest
// (0–30%), move to the column's amplitude (30–45%), hold there (45–80%),
// return (80–95%), hold (95–100%).
const DRIFT_CYCLE_MS = 9000;
const DRIFT_HOLD_AT_REST_MS = DRIFT_CYCLE_MS * 0.3;
const DRIFT_MOVE_MS = DRIFT_CYCLE_MS * 0.15;
const DRIFT_HOLD_AWAY_MS = DRIFT_CYCLE_MS * 0.35;
const DRIFT_HOLD_TAIL_MS = DRIFT_CYCLE_MS * 0.05;
const DRIFT_EASING = Easing.bezier(0.65, 0, 0.35, 1);

type CollageColumn = {
  /**
   * Vertical stagger, what makes this read as a masonry wall rather than three
   * aligned stacks. Negative, and deep enough that the column still covers
   * the top edge at the far end of its drift.
   */
  offset: number;
  /**
   * Per-tile aspect ratios (width/height), top to bottom. Hardcoded rather
   * than randomised so the collage is identical on every render and launch: a
   * layout that reshuffles on a re-render reads as a glitch. The middle column
   * has one extra tile because it drifts DOWN, so its bottom edge has the
   * furthest to travel before the fade hides it.
   */
  aspectRatios: readonly number[];
  /** Drift amplitude in px; the middle column moves opposite to the outer two. */
  drift: number;
  /** First-cycle start delay, staggering the three columns. */
  startDelayMs: number;
};

const COLLAGE_COLUMNS: readonly CollageColumn[] = [
  { offset: -space[10], aspectRatios: [0.78, 1.15, 0.9, 1.05], drift: -28, startDelayMs: 0 },
  { offset: -space[10], aspectRatios: [1.1, 0.85, 1.2, 0.8, 1.0], drift: 28, startDelayMs: 700 },
  { offset: -space[10] * 2, aspectRatios: [0.92, 1.0, 1.1, 0.95], drift: -22, startDelayMs: 1400 },
];

// Photo slot for each tile, numbered row by row across the columns and
// skipping rows a column doesn't have (the middle column is one tile longer),
// so every tile gets its own photo and the list fills across, not down.
const COLLAGE_PHOTO_SLOTS: readonly (readonly number[])[] = (() => {
  const slots: number[][] = COLLAGE_COLUMNS.map(() => []);
  const rows = Math.max(...COLLAGE_COLUMNS.map((column) => column.aspectRatios.length));
  let next = 0;
  for (let row = 0; row < rows; row += 1) {
    COLLAGE_COLUMNS.forEach((column, columnIndex) => {
      if (row < column.aspectRatios.length) slots[columnIndex].push(next++);
    });
  }
  return slots;
})();

export default function Welcome() {
  // Forced dark for the whole subtree, the same mechanism the Home feed uses.
  // Better than painting `bgInverse` by hand: inside a dark subtree every
  // token resolves for a dark surface on its own — `bg`, both Button variants,
  // text colors, and `Logo`'s own `auto` tone picking the cream wordmark. A
  // hand-inverted surface would need each of those overridden at the call
  // site, and would silently go wrong the moment one was missed.
  return (
    <AppThemeProvider scheme="dark">
      <WelcomeContent />
    </AppThemeProvider>
  );
}

function WelcomeContent() {
  const router = useRouter();
  const { colors } = useAppTheme();
  // The collage runs under the status bar on a near-black surface, so the
  // root layout's system-driven StatusBar would put DARK icons there whenever
  // the device is in light mode — invisible. Focus-gated for the same reason
  // the Home feed gates its own: the last StatusBar rendered wins, so one left
  // mounted here would keep forcing light icons onto sign-in and sign-up.
  const isFocused = useIsFocused();

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {isFocused ? <StatusBar style="light" /> : null}
      {/* Drifts only while this screen is visible; restarts from rest on return. */}
      <Collage animate={isFocused} />

      {/*
        Dissolves the collage into the page. `pointerEvents="none"` because it
        spans the upper half of the screen and would otherwise swallow nothing
        important today — but would silently eat the first control anyone adds
        up there later.
      */}
      <View style={styles.fade} pointerEvents="none" />

      {/*
        `edges={['bottom']}` only: the collage is meant to run under the status
        bar, so the top inset is deliberately not reserved. Transparent
        background so Screen's own `bg` fill does not cover the collage.
      */}
      <Screen edges={['bottom']} style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.identity}>
          <Logo height={60} />
          <Text variant="title">Discover, buy, and sell second-hand.</Text>
        </View>

        <View style={styles.actions}>
          <Button size="lg" onPress={() => router.push('/(auth)/sign-up')}>
            Create account
          </Button>
          <Button size="lg" variant="secondary" onPress={() => router.push('/(auth)/sign-in')}>
            Sign in
          </Button>
        </View>
      </Screen>
    </View>
  );
}

function Collage({ animate }: { animate: boolean }) {
  // Reduce Motion: the collage stays still at its resting layout.
  const reducedMotion = useReducedMotion();
  const drifting = animate && !reducedMotion;

  return (
    <View
      style={styles.collage}
      pointerEvents="none"
      // Purely decorative, and the whole subtree is: announcing a dozen
      // unlabelled images before the sign-in buttons would bury the only
      // content that matters here. Both props are needed — iOS reads the
      // first, Android the second.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {COLLAGE_COLUMNS.map((column, columnIndex) => (
        <DriftColumn key={columnIndex} column={column} columnIndex={columnIndex} drifting={drifting} />
      ))}
    </View>
  );
}

function DriftColumn({
  column,
  columnIndex,
  drifting,
}: {
  column: CollageColumn;
  columnIndex: number;
  drifting: boolean;
}) {
  const { colors } = useAppTheme();
  const translateY = useSharedValue(0);
  const { drift, startDelayMs } = column;

  useEffect(() => {
    if (!drifting) {
      cancelAnimation(translateY);
      translateY.value = 0;
      return;
    }
    translateY.value = withDelay(
      startDelayMs,
      withRepeat(
        withSequence(
          withDelay(DRIFT_HOLD_AT_REST_MS, withTiming(drift, { duration: DRIFT_MOVE_MS, easing: DRIFT_EASING })),
          withDelay(DRIFT_HOLD_AWAY_MS, withTiming(0, { duration: DRIFT_MOVE_MS, easing: DRIFT_EASING })),
          withDelay(DRIFT_HOLD_TAIL_MS, withTiming(0, { duration: 0 })),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(translateY);
  }, [drifting, drift, startDelayMs, translateY]);

  const driftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  return (
    <Animated.View style={[styles.collageColumn, { marginTop: column.offset }, driftStyle]}>
      {column.aspectRatios.map((aspectRatio, rowIndex) => {
        const photo = WELCOME_COLLAGE_PHOTOS[COLLAGE_PHOTO_SLOTS[columnIndex][rowIndex]];

        return (
          <View key={rowIndex} style={[styles.collageTile, { aspectRatio, backgroundColor: colors.skeleton }]}>
            {photo ? (
              // Bundled brand art, not listing photography: no remote fetch,
              // no signed URL, no load state to cover, so `ListingImage`'s
              // skeleton/transition machinery has nothing to do here. The
              // toned View behind this IS the placeholder.
              <Image source={photo} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : null}
          </View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  screen: {
    backgroundColor: 'transparent',
  },
  collage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '62%',
    flexDirection: 'row',
    gap: space[2],
    paddingHorizontal: space[2],
    overflow: 'hidden',
  },
  collageColumn: {
    flex: 1,
    gap: space[2],
  },
  collageTile: {
    width: '100%',
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  fade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Same box as the collage: the gradient reaches full opacity at 78% and
    // holds it to 100%, so the join with the solid page below is seamless and
    // the bottom of the collage is genuinely gone rather than dimmed.
    height: '62%',
    experimental_backgroundImage: [gradientFade],
  },
  content: {
    flexGrow: 1,
    // Bottom-anchored: the collage owns the top of the screen.
    justifyContent: 'flex-end',
    gap: space[8],
    paddingBottom: space[6],
  },
  identity: {
    gap: space[4],
  },
  actions: {
    gap: space[3],
  },
});
