import { Image, type ImageContentFit } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { duration } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

/**
 * The one wrapper over expo-image for listing/avatar photography (DESIGN.md
 * §11) — raw expo-image call sites for product photography are prohibited.
 * This is the first consumer (the Sell photo grid); feed and listing cards
 * reuse it as they're built, which is the point of factoring it out now
 * rather than inlining `<Image>` in the grid.
 *
 * Deliberately minimal for this phase: `contentFit`, a motion-token
 * `transition`, and a reserved-aspect-ratio container (rule 2 — layout
 * shift on load is a defect) are all in place. `recyclingKey` is accepted
 * for when this is reused in a recycled list. `cachePolicy` is fixed at
 * 'memory-disk' rather than exposed, since every current and near-term
 * consumer wants the same thing.
 *
 * NOT yet implemented: a blurhash/thumbhash `placeholder`. §11 asks for one,
 * but generating it needs a step in the upload pipeline (or server-side)
 * that doesn't exist yet — out of scope for "photo section only." The flat
 * `skeleton` background underneath stands in for it: it still reserves the
 * aspect ratio before load and still fades to the real image, just without
 * a shape hint. Revisit when the upload pipeline grows a blurhash step.
 */
export type ListingImageProps = {
  /** undefined while a signed URL is still loading — renders the skeleton alone. */
  uri: string | undefined;
  /** Reserves layout space before load (the Sell grid's mode). Ignored when `fill` is true. Defaults to 1 (square). */
  aspectRatio?: number;
  /**
   * Full-bleed mode (the Home feed): no `aspectRatio` is applied at all —
   * the container is `{ flex: 1 }` and fills whatever size the parent's own
   * layout already establishes (e.g. a FlatList page sized from a measured
   * viewport height). This component never hardcodes or guesses a feed
   * page's dimensions; the parent owns that entirely.
   * @default false
   */
  fill?: boolean;
  contentFit?: ImageContentFit;
  recyclingKey?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function ListingImage({
  uri,
  aspectRatio = 1,
  fill = false,
  contentFit = 'cover',
  recyclingKey,
  accessibilityLabel,
  style,
}: ListingImageProps) {
  const { colors } = useAppTheme();
  // DESIGN.md §10 rule 3 / §12.5: reduced motion disables this image's own
  // fade-in outright (0ms) rather than merely shortening it.
  const reducedMotion = useReducedMotion();

  return (
    <View
      style={[
        styles.container,
        fill ? styles.fill : { aspectRatio },
        { backgroundColor: colors.skeleton },
        style,
      ]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          transition={reducedMotion ? 0 : duration.normal}
          cachePolicy="memory-disk"
          recyclingKey={recyclingKey}
          accessible={Boolean(accessibilityLabel)}
          accessibilityLabel={accessibilityLabel}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  fill: {
    flex: 1,
  },
});
