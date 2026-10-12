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
 * Square crop, same radius as every other listing photo in the app. No
 * card surface — just the image and two lines of text, so the grid stays
 * dense rather than reading as a wall of small cards.
 */

export type ListingGridTileItem = {
  listingId: string;
  title: string;
  priceAmount: number;
  currency: string;
  coverUrl: string;
};

export type ListingGridTileProps = {
  listing: ListingGridTileItem;
  onPress: () => void;
};

export function ListingGridTile({ listing, onPress }: ListingGridTileProps) {
  const price = formatMoney(listing.priceAmount, listing.currency);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${listing.title}, ${price}`}
      style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.7 : 1 }]}>
      <ListingImage uri={listing.coverUrl} style={styles.image} recyclingKey={listing.listingId} />
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
