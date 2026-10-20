import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View, type ListRenderItemInfo } from 'react-native';

import { Avatar, Button, IconButton, Screen, Text, type IconName } from '@/components/ui';
import { ListingGridTile, type ListingGridTileItem } from '@/components/listing/listing-grid-tile';
import { MoreActionsSheet } from '@/components/report/more-actions-sheet';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { useFollowCounts, useIsFollowing, useToggleFollow } from '@/features/follows/queries';
import { mapListingError } from '@/features/listings/errors';
import { useSellerListings, useSellerProfile } from '@/features/seller-profile/queries';

/**
 * Public Seller Profile v1 — DESIGN.md §14.3's "Instagram-shaped structure":
 * identity header (avatar, display name, handle, counts, follow button) is
 * now complete as of ROADMAP 3.1, then a photo grid reusing the Search
 * tile. Still defers reviews/ratings/verification/location and any edit
 * affordance — none of those have a real destination yet.
 *
 * Deliberately NOT ownership-aware, with ONE narrow exception — mirroring
 * `listing/[id].tsx`'s own exact framing for its one exception (the pinned
 * "Message seller" bar): `isOwnProfile` gates only the Follow/Unfollow
 * button, which a user cannot meaningfully press against their own profile
 * (the `follows_not_self` check would refuse it server-side regardless,
 * same shape as messaging yourself). Follower/following counts render
 * identically for every viewer, including the profile's own owner — they
 * are not part of the ownership branch. As of ROADMAP 3.3, the counts are
 * each wrapped in a `Pressable` that pushes `follows/[id]` (this same
 * profile id, with a `mode` query param) to show the scrollable list
 * behind the number — always tappable, even at 0, landing on that screen's
 * empty state.
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
// Verified against the installed packages: 'ellipsis' exists in
// sf-symbols-typescript's types, and 'more_vert' exists in expo-symbols'
// android/symbols.json.
const MORE_ICON: IconName = { ios: 'ellipsis', android: 'more_vert', web: 'more_vert' };

// DESIGN.md §15.1: touch targets must reach 44×44pt via minimum height or
// hitSlop, never left bare at the call site. The counts' caption text is
// an 18px line (text-variants.ts), so hitSlop makes up the vertical
// difference the same way icon-button.tsx does for its own icon-sized box;
// a little horizontal slop too, since "1 follower" can render narrower
// than 44pt. Asymmetric top/bottom, not split evenly: `identity`'s gap
// below countsRow (space[2] = 8) is narrower than an even split would need,
// and the Follow/Unfollow Button sits right there with its own real hit
// target -- an even 13/13 split would eat 5px into it. Capping bottom at
// the gap and pushing the difference onto top (which only neighbors static
// text, nothing pressable) keeps the full 44pt without encroaching on the
// Button below.
const COUNT_HIT_SLOP = { top: 18, bottom: 8, left: 8, right: 8 };

export default function SellerProfileScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  // viewerId is only undefined for an instant during session hydration —
  // same window `listing/[id].tsx`'s own `isOwnListing` documents. This is
  // the screen's FIRST, and only, ownership branch: a narrow, deliberate
  // exception to an otherwise ownership-agnostic screen (see the top-level
  // doc comment).
  const viewerId = session?.user.id;
  const isOwnProfile = viewerId === id;

  // ROADMAP 5.1 — the "more" menu's Report entry point, targeting this
  // profile's own route id directly. Independent of `profileQuery`'s own
  // loading state (unlike the listing detail screen's analogous button,
  // which needs the loaded row for its listingId) -- the route `id` IS the
  // reported_user_id, so this can open from the very first render.
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const profileQuery = useSellerProfile(id);
  const listingsQuery = useSellerListings(id);
  const followCountsQuery = useFollowCounts(id);
  const isFollowingQuery = useIsFollowing(viewerId, id);
  const { toggleFollow, isPending: followPending } = useToggleFollow(id, viewerId);

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

  const openFollowList = useCallback(
    (mode: 'followers' | 'following') => {
      router.push({ pathname: '/(app)/follows/[id]', params: { id, mode } });
    },
    [router, id],
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
      {/* Default/neutral variant, NOT onMedia -- this header sits over the
          plain screen background. Hidden on the viewer's own profile,
          mirroring the Follow/Unfollow button's own `!isOwnProfile` gate
          below. */}
      {!isOwnProfile ? (
        <IconButton icon={MORE_ICON} accessibilityLabel="More actions" onPress={() => setMoreMenuOpen(true)} />
      ) : null}
    </View>
  );

  // Mounted on every return path below -- the "more" button in `backRow`
  // is visible (and, per the gate above, only ever rendered) regardless of
  // `profileQuery`'s own loading state, since its target is the route id
  // itself, not anything profileQuery resolves.
  const moreActionsSheet = (
    <MoreActionsSheet
      visible={moreMenuOpen}
      onClose={() => setMoreMenuOpen(false)}
      target={{ reportedUserId: id }}
      targetKind="user"
      blockTargetUserId={id}
    />
  );

  if (profileQuery.isPending) {
    return (
      <Screen contentContainerStyle={styles.content}>
        {backRow}
        <View style={styles.centered}>
          <ActivityIndicator color={colors.textTertiary} />
        </View>
        {moreActionsSheet}
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
        {moreActionsSheet}
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
        {moreActionsSheet}
      </Screen>
    );
  }

  const seller = profileQuery.data;
  const sellerName = seller.displayName ?? seller.username ?? 'Fynd seller';
  const followersCount = followCountsQuery.data?.followersCount ?? null;
  const followingCount = followCountsQuery.data?.followingCount ?? null;
  const isFollowing = isFollowingQuery.data ?? false;

  const listHeader = (
    <View style={styles.listHeader}>
      {backRow}
      <View style={styles.identity}>
        <Avatar size="lg" source={seller.avatarUrl ?? undefined} name={sellerName} />
        <Text variant="title">{sellerName}</Text>
        {seller.username ? (
          <Text variant="body" color="textSecondary">{`@${seller.username}`}</Text>
        ) : null}
        <View style={styles.countsRow}>
          {totalCount !== null ? (
            <Text variant="caption" color="textTertiary">
              {totalCount === 1 ? '1 listing' : `${totalCount} listings`}
            </Text>
          ) : null}
          {followersCount !== null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${followersCount} followers`}
              hitSlop={COUNT_HIT_SLOP}
              onPress={() => openFollowList('followers')}>
              <Text variant="caption" color="textTertiary">
                {followersCount === 1 ? '1 follower' : `${followersCount} followers`}
              </Text>
            </Pressable>
          ) : null}
          {followingCount !== null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${followingCount} following`}
              hitSlop={COUNT_HIT_SLOP}
              onPress={() => openFollowList('following')}>
              <Text variant="caption" color="textTertiary">
                {followingCount === 1 ? '1 following' : `${followingCount} following`}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {!isOwnProfile ? (
          <Button
            variant={isFollowing ? 'secondary' : 'primary'}
            size="sm"
            loading={followPending}
            accessibilityLabel={isFollowing ? `Unfollow ${sellerName}` : `Follow ${sellerName}`}
            onPress={() => toggleFollow(isFollowing)}>
            {isFollowing ? 'Following' : 'Follow'}
          </Button>
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
      {moreActionsSheet}
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
    justifyContent: 'space-between',
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
  countsRow: {
    flexDirection: 'row',
    gap: space[4],
  },
  footerSpinner: {
    paddingVertical: space[5],
  },
});
