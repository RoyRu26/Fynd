import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Avatar, Button, Chip, IconButton, Screen, Text, type IconName } from '@/components/ui';
import { ListingGallery } from '@/components/listing/listing-gallery';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { CONDITION_LABELS } from '@/features/listings/condition';
import { mapListingError } from '@/features/listings/errors';
import { formatMoney } from '@/features/listings/price';
import { formatSizeLabel } from '@/features/listings/size';
import { useListingDetail, useToggleFavoriteFromDetail } from '@/features/listing-detail/queries';

/**
 * Listing Detail v1 — a read-only view of one active listing: the full
 * gallery, price/title/condition/size/description, and a seller row (one
 * Pressable, opening /seller/[id] — never the avatar/name separately). No
 * chat, cart, checkout, offers, comments, or "Contact seller" — none of
 * those have a real destination yet, and a dead action area is worse than
 * none at all.
 *
 * This route lives outside the (tabs) NativeTabs group (see (app)/_layout's
 * Stack), so opening it pushes over Home and hides the floating tab bar —
 * no custom bottom nav was added for it.
 *
 * Deliberately NOT ownership-aware: the caller's own active listing renders
 * through the exact same branch as anyone else's. The "Active listings are
 * public and sellers see own listings" RLS policy *would* also let an owner
 * see their own draft/reserved/sold/removed listing here, which is why
 * useListingDetail's own normalization treats anything but an active row as
 * "unavailable" regardless of who's asking — see detail.ts's doc comment.
 */

const BACK_ICON: IconName = { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' };
const HEART_ICON: IconName = { ios: 'heart', android: 'favorite_border', web: 'favorite_border' };
const HEART_FILLED_ICON: IconName = { ios: 'heart.fill', android: 'favorite', web: 'favorite' };

export default function ListingDetailScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const detailQuery = useListingDetail(id);
  const { toggleFavorite, isPending: favoritePending } = useToggleFavoriteFromDetail(id);

  let body: ReactNode;
  if (detailQuery.isPending) {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.textTertiary} />
      </View>
    );
  } else if (detailQuery.isError) {
    body = (
      <View style={styles.centered}>
        <Text variant="body" color="danger">
          {mapListingError(detailQuery.error).message}
        </Text>
        <Button variant="secondary" size="sm" onPress={() => detailQuery.refetch()}>
          Try again
        </Button>
      </View>
    );
  } else if (detailQuery.data === null) {
    body = (
      <View style={styles.centered}>
        <Text variant="body" color="textSecondary" style={styles.centeredText}>
          This listing isn&apos;t available anymore.
        </Text>
        <Button variant="secondary" size="sm" onPress={() => router.back()}>
          Go back
        </Button>
      </View>
    );
  } else {
    const listing = detailQuery.data;
    const price = formatMoney(listing.priceAmount, listing.currency);
    const sellerName = listing.sellerDisplayName ?? listing.sellerUsername ?? 'Fynd seller';

    body = (
      <View style={styles.body}>
        <ListingGallery images={listing.images} title={listing.title} />

        <View style={styles.section}>
          <View style={styles.priceRow}>
            <Text variant="price">{price}</Text>
            <IconButton
              icon={listing.isFavorited ? HEART_FILLED_ICON : HEART_ICON}
              accessibilityLabel={listing.isFavorited ? 'Remove from favorites' : 'Add to favorites'}
              onPress={() => toggleFavorite(listing.isFavorited)}
              disabled={favoritePending}
              color={listing.isFavorited ? 'favoriteActive' : 'text'}
            />
          </View>

          <Text variant="title">{listing.title}</Text>

          <View style={styles.chipRow}>
            <Chip label={CONDITION_LABELS[listing.condition]} />
            <Chip label={formatSizeLabel(listing.size)} />
          </View>

          <Text variant="body" color="textSecondary">
            {listing.description}
          </Text>
        </View>

        <Pressable
          onPress={() =>
            router.push({ pathname: '/(app)/seller/[id]', params: { id: listing.sellerId } })
          }
          accessibilityRole="button"
          accessibilityLabel={`View ${sellerName}'s profile`}
          style={({ pressed }) => [
            styles.section,
            styles.sellerRow,
            { opacity: pressed ? 0.7 : 1 },
          ]}>
          {/* One Pressable for the whole row, not the avatar and name
              separately — source is always omitted: sellerAvatarPath has no
              bucket to resolve against yet (see feed-card.tsx's own note) —
              every seller renders as initials until that pipeline exists. */}
          <Avatar size="md" name={sellerName} />
          <Text variant="bodyStrong">{sellerName}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <IconButton icon={BACK_ICON} accessibilityLabel="Back" onPress={() => router.back()} />
      </View>
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: space[5],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    paddingHorizontal: space[6],
  },
  centeredText: {
    textAlign: 'center',
  },
  body: {
    gap: space[6],
  },
  section: {
    gap: space[3],
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chipRow: {
    flexDirection: 'row',
    gap: space[2],
  },
  sellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
});
