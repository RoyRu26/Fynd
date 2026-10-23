import { Pressable, StyleSheet } from 'react-native';

import { ListingImage, Text } from '@/components/ui';
import { radius, space } from '@/design/tokens';
import { formatMoney } from '@/features/listings/price';

/**
 * One tile in a dense, image-first 3-up grid — DESIGN.md §14.2's Search
 * tile, which §14.3 says the Profile grid reuses exactly. "priceSm +
 * truncated title only, no chips at this size" is DESIGN.md's own spec, not
 * an addition: a plain cover-only tile would be the *wrong* reuse of it.
 *
 * Same radius as every other listing photo in the app, with the crop left to
 * the caller (`aspectRatio`) — Explore is 4:5, Saved and the seller closet
 * are square. No card surface — just the image and two lines of text, so the
 * grid stays dense rather than reading as a wall of small cards.
 */

export type ListingGridTileItem = {
  listingId: string;
  title: string;
  priceAmount: number;
  currency: string;
  coverUrl: string;
};

/**
 * Portrait 4:5 crop — Explore's own tile proportion (DESIGN.md §14.2).
 *
 * Exported rather than inlined because the grid and `SkeletonListingCard`
 * must agree on it exactly: a skeleton at a different ratio makes every tile
 * jump height the moment real data lands.
 */
export const TALL_TILE_ASPECT_RATIO = 4 / 5;

export type ListingGridTileProps = {
  listing: ListingGridTileItem;
  onPress: () => void;
  /**
   * Cover aspect ratio (width/height). Defaults to a square, which is what
   * the Saved and seller-closet grids use; Explore passes
   * `TALL_TILE_ASPECT_RATIO`. A prop rather than a hard change so retiring
   * the square crop stays a per-screen decision made with that screen's
   * design in hand.
   */
  aspectRatio?: number;
};

export function ListingGridTile({ listing, onPress, aspectRatio = 1 }: ListingGridTileProps) {
  const price = formatMoney(listing.priceAmount, listing.currency);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${listing.title}, ${price}`}
      style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.7 : 1 }]}>
      <ListingImage
        uri={listing.coverUrl}
        aspectRatio={aspectRatio}
        style={styles.image}
        recyclingKey={listing.listingId}
      />
      <Text variant="priceSm" numberOfLines={1}>
        {price}
      </Text>
      <Text variant="caption" color="textSecondary" numberOfLines={1}>
        {listing.title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: '33.3333%',
    // Half the DESIGN.md §14.2 gutter (space[1]) on each side, so two
    // adjacent tiles sum back to exactly one full gutter between them.
    padding: space[1] / 2,
    gap: space[1],
  },
  image: {
    width: '100%',
    borderRadius: radius.sm,
  },
});
