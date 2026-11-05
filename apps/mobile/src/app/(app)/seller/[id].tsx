import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View, type ListRenderItemInfo } from 'react-native';

import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  Screen,
  Skeleton,
  SkeletonListingCard,
  StarRating,
  Text,
  type IconName,
} from '@/components/ui';
import { ListingGridTile, type ListingGridTileItem } from '@/components/listing/listing-grid-tile';
import { MoreActionsSheet } from '@/components/report/more-actions-sheet';
import { minTouchTarget, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { useFollowCounts, useIsFollowing, useToggleFollow } from '@/features/follows/queries';
import { mapListingError } from '@/features/listings/errors';
import { formatAverageRatingLabel } from '@/features/reviews/reviews';
import { useSellerReviewSummary } from '@/features/reviews/queries';
import { useSellerListings, useSellerProfile } from '@/features/seller-profile/queries';

/**
 * Public Seller Profile v1 — DESIGN.md §14.3's "Instagram-shaped structure":
 * identity header (avatar, display name, handle, counts, follow button) is
 * now complete as of ROADMAP 3.1, then a photo grid reusing the Search
 * tile. ROADMAP 5.4 adds the average-rating/review-count third count,
 * pushing `reviews/[id]` the same way the followers/following counts
 * already push `follows/[id]` — see ROADMAP 3.3's own precedent for that
 * shape. Still defers verification/location and any edit affordance — none
 * of those have a real destination yet.
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
// Same shape as explore.tsx/inbox/index.tsx's own ERROR_ICON constants.
const ERROR_ICON: IconName = { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' };
// Same "hidden/removed" icon listing-actions-sheet.tsx's ACTION_ICON.remove
// already uses for this exact semantic.
const HIDDEN_ICON: IconName = { ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' };
// Same "no listings" icon my-listings.tsx/sell/index.tsx's own EMPTY_ICON
// constants already use.
const EMPTY_LISTINGS_ICON: IconName = { ios: 'bag', android: 'shopping_bag', web: 'shopping_bag' };

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
  const reviewSummaryQuery = useSellerReviewSummary(id);
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

  const openReviews = useCallback(() => {
    router.push({ pathname: '/(app)/reviews/[id]', params: { id } });
  }, [router, id]);

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
        <View style={styles.identity}>
          <Skeleton width={56} height={56} radius="full" />
          <Skeleton height={24} width="50%" radius="xs" />
          <View style={styles.countsRow}>
            <Skeleton height={16} width={64} radius="xs" />
            <Skeleton height={16} width={64} radius="xs" />
            <Skeleton height={16} width={64} radius="xs" />
          </View>
          {/* Matches Button's real sm-size metrics (button.tsx:
              BUTTON_MIN_HEIGHT.sm = minTouchTarget, borderRadius: radius.md)
              so the Follow button doesn't jump size when it replaces this. */}
          <Skeleton height={minTouchTarget} width={96} radius="md" />
        </View>
        {moreActionsSheet}
      </Screen>
    );
  }

  if (profileQuery.isError) {
    return (
      <Screen contentContainerStyle={styles.content}>
        {backRow}
        <EmptyState
          variant="error"
          icon={ERROR_ICON}
          title="Something went wrong"
          body={mapListingError(profileQuery.error).message}
          actionLabel="Try again"
          onAction={() => profileQuery.refetch()}
        />
        {moreActionsSheet}
      </Screen>
    );
  }

  if (profileQuery.data === null) {
    return (
      <Screen contentContainerStyle={styles.content}>
        {backRow}
        <EmptyState
          variant="empty"
          icon={HIDDEN_ICON}
          title="This seller isn't available."
          actionLabel="Go back"
          onAction={() => router.back()}
        />
        {moreActionsSheet}
      </Screen>
    );
  }

  const seller = profileQuery.data;
  const sellerName = seller.displayName ?? seller.username ?? 'Fynd seller';
  const followersCount = followCountsQuery.data?.followersCount ?? null;
  const followingCount = followCountsQuery.data?.followingCount ?? null;
  const isFollowing = isFollowingQuery.data ?? false;
  const reviewSummary = reviewSummaryQuery.data ?? null;

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
          {reviewSummary !== null ? (
            // Same always-tappable-even-at-zero pattern ROADMAP 3.3 already
            // established for the followers/following counts above — a
            // seller with no reviews yet still pushes `reviews/[id]`,
            // landing on that screen's own empty state, rather than hiding
            // the row until there is something to show.
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Rating: ${formatAverageRatingLabel(reviewSummary.averageRating, reviewSummary.reviewCount)}`}
              hitSlop={COUNT_HIT_SLOP}
              onPress={openReviews}
              style={styles.ratingPressable}>
              <StarRating value={reviewSummary.averageRating} size="sm" accessibilityLabel="Average rating" />
              <Text variant="caption" color="textTertiary">
                {formatAverageRatingLabel(reviewSummary.averageRating, reviewSummary.reviewCount)}
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
    listEmpty = <EmptyState variant="empty" icon={EMPTY_LISTINGS_ICON} title="No active listings yet." />;
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
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  identity: {
    alignItems: 'center',
    gap: space[2],
  },
  countsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
  },
  ratingPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  footerSpinner: {
    paddingVertical: space[5],
  },
});
