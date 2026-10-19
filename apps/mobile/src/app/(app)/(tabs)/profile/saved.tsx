import { useRouter } from 'expo-router';
import { useCallback, useMemo, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View, type ListRenderItemInfo } from 'react-native';

import { EmptyState, Screen, SkeletonListingCard, Text, type IconName } from '@/components/ui';
import { ListingGridTile, type ListingGridTileItem } from '@/components/listing/listing-grid-tile';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { mapListingError } from '@/features/listings/errors';
import { useSavedListings } from '@/features/saved-items/queries';

/**
 * Saved Items (ROADMAP 1.8) — a 3-up grid of the viewer's own favorited,
 * currently-active listings, reachable from the Profile hub. Read +
 * navigate only: there is no un-favorite affordance on the tile itself
 * (see `features/saved-items/saved-items.ts`'s header comment for why);
 * tapping a tile opens the listing, same as the public seller-profile
 * grid's own tiles do, and unfavoriting happens from there.
 *
 * The FlatList is the screen's only scroll container (title rides along
 * as `ListHeaderComponent`) — same reasoning `seller/[id].tsx`'s own
 * header comment gives: `onEndReached` pagination never fires correctly
 * if something else is doing the actual scrolling, hence `Screen`'s
 * default `scroll={false}`.
 */

const ERROR_ICON: IconName = { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' };
// Verified against the installed packages: 'heart' exists in
// sf-symbols-typescript's types, 'favorite_border' in expo-symbols'
// android/symbols.json.
const EMPTY_ICON: IconName = { ios: 'heart', android: 'favorite_border', web: 'favorite_border' };

export default function SavedItems() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const userId = session?.user.id;

  const listingsQuery = useSavedListings(userId);

  const listings = useMemo(
    () => listingsQuery.data?.pages.flatMap((page) => page.listings) ?? [],
    [listingsQuery.data],
  );

  const openListing = useCallback(
    (listingId: string) => {
      router.push({ pathname: '/(app)/listing/[id]', params: { id: listingId } });
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ListingGridTileItem>) => (
      <ListingGridTile listing={item} onPress={() => openListing(item.listingId)} />
    ),
    [openListing],
  );

  const handleEndReached = useCallback(() => {
    if (listingsQuery.hasNextPage && !listingsQuery.isFetchingNextPage) {
      listingsQuery.fetchNextPage();
    }
  }, [listingsQuery]);

  const listHeader = (
    <Text variant="title" style={styles.title}>
      Saved items
    </Text>
  );

  let listEmpty: ReactNode = null;
  if (listingsQuery.isPending) {
    listEmpty = (
      <View style={styles.skeletonGrid}>
        {Array.from({ length: 6 }, (_, index) => (
          <SkeletonListingCard key={index} />
        ))}
      </View>
    );
  } else if (listingsQuery.isError) {
    listEmpty = (
      <EmptyState
        variant="error"
        icon={ERROR_ICON}
        title="Something went wrong"
        body={mapListingError(listingsQuery.error).message}
        actionLabel="Try again"
        onAction={() => listingsQuery.refetch()}
      />
    );
  } else {
    listEmpty = (
      <EmptyState
        variant="empty"
        icon={EMPTY_ICON}
        title="No saved items yet."
        body="Tap the heart on a listing you like, and it'll show up here."
      />
    );
  }

  return (
    <Screen contentContainerStyle={styles.content}>
      <FlatList
        data={listings}
        keyExtractor={(item) => item.listingId}
        renderItem={renderItem}
        numColumns={3}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        onEndReached={handleEndReached}
        onEndReachedThreshold={1.5}
        ListFooterComponent={
          listingsQuery.isFetchingNextPage ? (
            <ActivityIndicator style={styles.footerSpinner} color={colors.textTertiary} />
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
  },
  title: {
    marginBottom: space[5],
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  footerSpinner: {
    paddingVertical: space[5],
  },
});
