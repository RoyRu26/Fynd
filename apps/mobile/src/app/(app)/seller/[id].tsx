import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View, type ListRenderItemInfo } from 'react-native';

import { Avatar, Button, IconButton, Screen, Text, type IconName } from '@/components/ui';
import { ListingGridTile, type ListingGridTileItem } from '@/components/listing/listing-grid-tile';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { mapListingError } from '@/features/listings/errors';
import { useSellerListings, useSellerProfile } from '@/features/seller-profile/queries';

/**
 * Public Seller Profile v1 — DESIGN.md §14.3's "Instagram-shaped structure"
 * minus everything this phase explicitly defers: no follow, no
 * followers/following counts, no reviews/ratings/verification/location, no
 * edit affordance. Renders identically whether the viewer is a stranger or
 * the seller themselves — this IS the buyer-facing view, on purpose, so
 * there is nothing to branch on.
 *
 * Pushed outside the (tabs) NativeTabs group (see (app)/_layout's Stack),
 * same as Listing Detail — opening a seller hides the floating tab bar
 * without a 4th tab or any custom bottom nav.
 *
 * The grid's own FlatList is the screen's ONLY scroll container (identity
 * header + back button both ride along as `ListHeaderComponent`), rather
 * than nesting it inside Screen's ScrollView: `onEndReached`/pagination is
 * driven by the FlatList's own scroll offset, which never fires if
 * something else is doing the actual scrolling. `Screen scroll={false}`
 * (the default) is used for exactly that reason.
 */

const BACK_ICON: IconName = { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' };

export default function SellerProfileScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const profileQuery = useSellerProfile(id);
  const listingsQuery = useSellerListings(id);

  const listings = useMemo(
    () => listingsQuery.data?.pages.flatMap((page) => page.listings) ?? [],
    [listingsQuery.data],
  );
  const totalCount = listingsQuery.data?.pages[0]?.totalCount ?? null;

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

  const backRow = (
    <View style={styles.header}>
      <IconButton icon={BACK_ICON} accessibilityLabel="Back" onPress={() => router.back()} />
    </View>
  );

  if (profileQuery.isPending) {
    return (
      <Screen contentContainerStyle={styles.content}>
        {backRow}
        <View style={styles.centered}>
          <ActivityIndicator color={colors.textTertiary} />
        </View>
      </Screen>
    );
  }

  if (profileQuery.isError) {
    return (
      <Screen contentContainerStyle={styles.content}>
        {backRow}
        <View style={styles.centered}>
          <Text variant="body" color="danger">
            {mapListingError(profileQuery.error).message}
          </Text>
          <Button variant="secondary" size="sm" onPress={() => profileQuery.refetch()}>
            Try again
          </Button>
        </View>
      </Screen>
    );
  }

  if (profileQuery.data === null) {
    return (
      <Screen contentContainerStyle={styles.content}>
        {backRow}
        <View style={styles.centered}>
          <Text variant="body" color="textSecondary" style={styles.centeredText}>
            This seller isn&apos;t available.
          </Text>
          <Button variant="secondary" size="sm" onPress={() => router.back()}>
            Go back
          </Button>
        </View>
      </Screen>
    );
  }

  const seller = profileQuery.data;
  const sellerName = seller.displayName ?? seller.username ?? 'Fynd seller';

  const listHeader = (
    <View style={styles.listHeader}>
      {backRow}
      <View style={styles.identity}>
        {/* source is always omitted: avatarPath has no bucket to resolve
            against yet (see feed-card.tsx's own note) — every seller
            renders as initials until that pipeline exists. */}
        <Avatar size="lg" name={sellerName} />
        <Text variant="title">{sellerName}</Text>
        {seller.username ? (
          <Text variant="body" color="textSecondary">{`@${seller.username}`}</Text>
        ) : null}
        {totalCount !== null ? (
          <Text variant="caption" color="textTertiary">
            {totalCount === 1 ? '1 listing' : `${totalCount} listings`}
          </Text>
        ) : null}
      </View>
    </View>
  );

  let listEmpty: ReactNode = null;
  if (listingsQuery.isPending) {
    listEmpty = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.textTertiary} />
      </View>
    );
  } else if (listingsQuery.isError) {
    listEmpty = (
      <View style={styles.centered}>
        <Text variant="body" color="danger">
          {mapListingError(listingsQuery.error).message}
        </Text>
        <Button variant="secondary" size="sm" onPress={() => listingsQuery.refetch()}>
          Try again
        </Button>
      </View>
    );
  } else {
    listEmpty = (
      <View style={styles.centered}>
        <Text variant="body" color="textSecondary">
          No active listings yet.
        </Text>
      </View>
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
  listHeader: {
    gap: space[5],
    marginBottom: space[5],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    paddingHorizontal: space[6],
    paddingVertical: space[10],
  },
  centeredText: {
    textAlign: 'center',
  },
  identity: {
    alignItems: 'center',
    gap: space[2],
  },
  footerSpinner: {
    paddingVertical: space[5],
  },
});
