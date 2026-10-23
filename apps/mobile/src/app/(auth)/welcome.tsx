import { Image } from 'expo-image';
import { useIsFocused, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, type ImageSourcePropType } from 'react-native';

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
 * spreads over the collage. Everything below adapts — no other edit needed,
 * and until then the tiles render as empty toned blocks.
 */
const WELCOME_COLLAGE_PHOTOS: readonly ImageSourcePropType[] = [];

// Fixed per-tile aspect ratios (width/height), in row-major order across three
// columns. Hardcoded rather than randomised so the collage is identical on
// every render and every launch — a layout that reshuffles on a re-render
// reads as a glitch, and the staggered column offsets below only look
// deliberate if they stay put.
const COLLAGE_COLUMN_COUNT = 3;
const COLLAGE_TILE_ASPECT_RATIOS = [
  0.78, 1.1, 0.92,
  1.15, 0.85, 1.0,
  0.9, 1.2, 1.1,
  1.05, 0.8, 0.95,
] as const;

// Vertical stagger per column — what makes this read as a masonry wall rather
// than three aligned stacks. Negative so the shortest column still reaches the
// top edge.
const COLLAGE_COLUMN_OFFSETS = [-space[8], 0, -space[4]] as const;

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
      <Collage />

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

function Collage() {
  const { colors } = useAppTheme();

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
      {Array.from({ length: COLLAGE_COLUMN_COUNT }, (_, columnIndex) => (
        <View
          key={columnIndex}
          style={[styles.collageColumn, { marginTop: COLLAGE_COLUMN_OFFSETS[columnIndex] }]}>
          {COLLAGE_TILE_ASPECT_RATIOS.filter(
            (_ratio, tileIndex) => tileIndex % COLLAGE_COLUMN_COUNT === columnIndex,
          ).map((aspectRatio, rowIndex) => {
            // Row-major lookup, so photos added one at a time spread across
            // the columns instead of stacking up in the first one.
            const photo = WELCOME_COLLAGE_PHOTOS[rowIndex * COLLAGE_COLUMN_COUNT + columnIndex];

            return (
              <View
                key={rowIndex}
                style={[styles.collageTile, { aspectRatio, backgroundColor: colors.skeleton }]}>
                {photo ? (
                  // Bundled brand art, not listing photography: no remote
                  // fetch, no signed URL, no load state to cover, so
                  // `ListingImage`'s skeleton/transition machinery has
                  // nothing to do here. The toned View behind this IS the
                  // placeholder.
                  <Image source={photo} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
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
