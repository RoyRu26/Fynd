import { useIsFocused, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeedCard } from '@/components/feed/feed-card';
import { Chip, EmptyState, type IconName } from '@/components/ui';
import { space } from '@/design/tokens';
import { AppThemeProvider, useAppTheme } from '@/design/theme-provider';
import { prefetchFeedCoverImages } from '@/features/feed/api';
import { recordListingImpression } from '@/features/feed/events';
import {
  EMPTY_IMPRESSION_TRACKER,
  flattenFeedPages,
  getFeedSessionId,
  markImpressionConfirmed,
  markImpressionFailed,
  markImpressionsPending,
  selectNewlyViewableImpressions,
  type ImpressionTrackerState,
} from '@/features/feed/impressions';
import type { FeedListing } from '@/features/feed/pagination';
import { useFeed } from '@/features/feed/queries';
import { mapListingError } from '@/features/listings/errors';

/**
 * Fynd's discovery feed — DESIGN.md §14.1. Always dark, full-viewport,
 * vertically paged, one listing per page.
 */

// Flip to true only for local testing against the single-account fixture,
// where the only feed-eligible listings in the DB belong to the signed-in
// user and would otherwise be excluded by design (see queries.ts). Never
// user-facing, never left true.
const INCLUDE_OWN_LISTINGS_FOR_LOCAL_TESTING = false;

const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 60, minimumViewTime: 800 };

// Small and deliberately position-driven: only the covers just past
// whatever is primarily in view right now, never the whole loaded feed.
const PREFETCH_AHEAD_COUNT = 3;

// Gap between the scope toggle and the safe-area inset above it, and
// between the toggle and the feed content below — DESIGN.md §6's 4pt scale,
// same token family the card overlay itself uses for this purpose.
const SCOPE_TOGGLE_TOP_GAP = space[3];

// Verified against the installed packages, matching every other IconName
// constant in this codebase: 'exclamationmark.triangle'/'warning' already
// used verbatim elsewhere (e.g. explore.tsx); 'photo.on.rectangle'/
// 'photo_library' and 'person.2'/'people' both exist in sf-symbols-
// typescript's dist/index.d.ts and expo-symbols' android/symbols.json
// respectively.
const ERROR_ICON: IconName = { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' };
const FOR_YOU_EMPTY_ICON: IconName = { ios: 'photo.on.rectangle', android: 'photo_library', web: 'photo_library' };
const FOLLOWING_EMPTY_ICON: IconName = { ios: 'person.2', android: 'people', web: 'people' };

type FeedScope = 'forYou' | 'following';

export default function HomeScreen() {
  return (
    <AppThemeProvider scheme="dark">
      <HomeFeed />
    </AppThemeProvider>
  );
}

function HomeFeed() {
  const { colors } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // NativeTabs keeps inactive tabs mounted rather than unmounting them, so a
  // bare <StatusBar style="light" /> here would stay mounted — and, being
  // the last one rendered, win — even while the user is on Sell or Profile.
  // Gating on focus is what lets the root layout's system-driven StatusBar
  // take back over the instant Home loses focus.
  const isFocused = useIsFocused();

  // ROADMAP 3.2's "For you"/"Following" toggle. Ephemeral screen-local
  // state, deliberately not persisted (AsyncStorage, a query param, etc.) —
  // each visit to Home starts on "For you", same as the tab itself always
  // reopening at its default top-level route.
  const [scope, setScope] = useState<FeedScope>('forYou');
  const followingOnly = scope === 'following';

  const feedQuery = useFeed(INCLUDE_OWN_LISTINGS_FOR_LOCAL_TESTING, followingOnly);
  const listings = useMemo(
    () => flattenFeedPages(feedQuery.data?.pages ?? []),
    [feedQuery.data],
  );

  // Measured, never guessed — but this is just the screen's own height.
  // NativeTabs floats its bar on top rather than shrinking this container,
  // so a page here is intentionally the full screen height; the bar's own
  // occlusion is handled inside FeedCard, which pads its overlay content
  // (never the card/page itself) by the real safe-area inset underneath it.
  const [pageHeight, setPageHeight] = useState(0);
  const onContainerLayout = useCallback((event: LayoutChangeEvent) => {
    setPageHeight(event.nativeEvent.layout.height);
  }, []);

  // Refs so the frozen viewability callback below always reaches CURRENT
  // data/state. React Native forbids changing onViewableItemsChanged's
  // identity after mount ("Changing onViewableItemsChanged on the fly is
  // not supported"), so the callback itself is created exactly once (a
  // useCallback with an empty dependency array, never a ref dereferenced
  // directly in JSX — the React Compiler disallows touching `.current`
  // during render) and must never close over `listings` or the tracker
  // state directly. `listingsRef` is synced via effect, strictly after
  // render, never during it.
  const listingsRef = useRef<FeedListing[]>(listings);
  useEffect(() => {
    listingsRef.current = listings;
  }, [listings]);
  const impressionStateRef = useRef<ImpressionTrackerState>(EMPTY_IMPRESSION_TRACKER);

  // Same ref-sync reason as listingsRef: onViewableItemsChanged is frozen
  // (stable identity, empty deps — RN forbids changing it after mount) and
  // must read the CURRENT scope, not whatever scope was active when the
  // callback was created.
  const scopeRef = useRef<FeedScope>(scope);
  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  // The FlatList is no longer remounted on scope change (see below), so
  // each scope's last-viewed page needs to be remembered independently —
  // otherwise whichever scope the user is NOT currently on would silently
  // keep whatever scroll position the other one left it at.
  const flatListRef = useRef<FlatList<FeedListing>>(null);
  const lastIndexByScope = useRef<Record<FeedScope, number>>({ forYou: 0, following: 0 });

  // A plain module-scope object already has fully stable identity across
  // every render — no ref needed for viewabilityConfig at all.
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<FeedListing>[] }) => {
      const currentListings = listingsRef.current;
      const nowViewable = viewableItems.filter((token) => token.isViewable);

      // Impressions ---------------------------------------------------
      const viewableIds = nowViewable.map((token) => token.item.listingId);
      const newlyEligible = selectNewlyViewableImpressions(
        viewableIds,
        impressionStateRef.current,
      );

      if (newlyEligible.length > 0) {
        // Marked pending synchronously, before any RPC call starts — this
        // is what closes the window a second viewability event could
        // otherwise fire a concurrent duplicate send through.
        impressionStateRef.current = markImpressionsPending(
          impressionStateRef.current,
          newlyEligible,
        );

        const sessionId = getFeedSessionId();
        for (const listingId of newlyEligible) {
          // The item's index in the fully flattened feed IS the absolute
          // feed_position — see flattenFeedPages's own doc comment.
          const feedPosition = currentListings.findIndex((l) => l.listingId === listingId);
          if (feedPosition === -1) {
            continue;
          }

          recordListingImpression({ listingId, sessionId, feedPosition })
            .then(() => {
              impressionStateRef.current = markImpressionConfirmed(
                impressionStateRef.current,
                listingId,
              );
            })
            .catch((error: unknown) => {
              // Never surfaced to the user and never interrupts scrolling —
              // released back to eligible so it retries next time this
              // listing becomes viewable again.
              if (__DEV__) {
                console.warn('[feed] impression failed, will retry when viewable again', error);
              }
              impressionStateRef.current = markImpressionFailed(
                impressionStateRef.current,
                listingId,
              );
            });
        }
      }

      // Prefetch --------------------------------------------------------
      const primary = nowViewable[0];
      if (primary && typeof primary.index === 'number') {
        lastIndexByScope.current[scopeRef.current] = primary.index;

        const upcoming = currentListings
          .slice(primary.index + 1, primary.index + 1 + PREFETCH_AHEAD_COUNT)
          .map((l) => l.coverUrl);
        if (upcoming.length > 0) {
          prefetchFeedCoverImages(upcoming);
        }
      }
    },
    [],
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feedQuery;
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const getItemLayout = useCallback(
    (_data: ArrayLike<FeedListing> | null | undefined, index: number) => ({
      length: pageHeight,
      offset: pageHeight * index,
      index,
    }),
    [pageHeight],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FeedListing>) => (
      <View style={{ height: pageHeight }}>
        <FeedCard
          listing={item}
          includeOwn={INCLUDE_OWN_LISTINGS_FOR_LOCAL_TESTING}
          followingOnly={followingOnly}
        />
      </View>
    ),
    [pageHeight, followingOnly],
  );

  const goToExplore = useCallback(() => {
    router.push('/(app)/(tabs)/explore');
  }, [router]);

  // Restores the scope being switched TO at whatever page it was last left
  // on, rather than the top. Unconditional -- including index 0 -- because
  // without key={scope} forcing a remount, the FlatList's scroll offset
  // never resets on its own: if it doesn't, switching to a scope that was
  // never scrolled (index 0) would leave it sitting at whatever pixel
  // offset the PREVIOUS scope had reached, so whatever this scope's data
  // happens to render at that same offset (often still the previous
  // scope's card, for an instant) stays on screen instead of jumping to
  // this one's actual top. Runs whenever scope or pageHeight changes:
  // pageHeight is in the dependency list because the offset math needs it,
  // not because it signals a scope change. useLayoutEffect, not useEffect,
  // so the jump happens before the frame is presented rather than as a
  // visible flash to the old position first.
  useLayoutEffect(() => {
    if (pageHeight === 0) return;
    const index = lastIndexByScope.current[scope];
    flatListRef.current?.scrollToOffset({ offset: index * pageHeight, animated: false });
  }, [scope, pageHeight]);

  let body: ReactNode;
  if (feedQuery.isPending) {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.textTertiary} />
      </View>
    );
  } else if (feedQuery.isError) {
    body = (
      <View style={styles.centered}>
        <EmptyState
          variant="error"
          icon={ERROR_ICON}
          title={mapListingError(feedQuery.error).message}
          actionLabel="Try again"
          onAction={() => feedQuery.refetch()}
        />
      </View>
    );
  } else if (listings.length === 0) {
    body = (
      <View style={styles.centered}>
        {followingOnly ? (
          // One honest message for both "you follow nobody" and "people you
          // follow have no active listings right now" — telling those two
          // apart would cost a second query (how many people does the
          // viewer follow) purely to pick which sentence to show, for a
          // distinction the user cannot act on differently either way.
          <EmptyState
            variant="empty"
            icon={FOLLOWING_EMPTY_ICON}
            title="No listings yet from people you follow."
            body="Follow sellers from their profile — their new listings will show up here."
            actionLabel="Explore"
            onAction={goToExplore}
          />
        ) : (
          <EmptyState variant="empty" icon={FOR_YOU_EMPTY_ICON} title="No listings yet. Check back soon." />
        )}
      </View>
    );
  } else if (pageHeight === 0) {
    // Still measuring — render nothing rather than guessing a height that
    // would produce wrong paging offsets the instant the real one lands.
    body = null;
  } else {
    body = (
      <FlatList
        // No key={scope} here on purpose: "For you" and "Following" are
        // different result sets, but switching between them should return
        // each to wherever the user last left it, not reset to the top —
        // which means the same FlatList instance has to persist across the
        // switch. The useLayoutEffect above is what restores each scope's
        // own remembered position when `data` swaps out from under it.
        ref={flatListRef}
        data={listings}
        keyExtractor={(item) => item.listingId}
        renderItem={renderItem}
        pagingEnabled
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        getItemLayout={getItemLayout}
        initialNumToRender={2}
        // 3 (not the previous 2) and 5 (not 3): tight enough to still cap a
        // full-viewport image feed's memory footprint, but with enough
        // headroom that a user flicking through several pages in quick
        // succession is less likely to outrun React's render queue. Raised
        // alongside removing removeClippedSubviews below as the suspected
        // cause of a reported bug: opening a post deep in a fast scroll
        // sometimes opened a different one instead -- consistent with the
        // tapped cell's visible content not having caught up to its new
        // list position yet when the tap landed.
        maxToRenderPerBatch={3}
        windowSize={5}
        // Deliberately NOT set. React Native's own docs flag this prop as
        // having rendering bugs ("may have bugs (missing content) in some
        // circumstances") — exactly the kind of stale-view-under-a-tap
        // symptom above, and the most likely single cause of it. The memory
        // saving isn't worth that risk for a feed whose images are already
        // managed by ListingImage's own caching.
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={VIEWABILITY_CONFIG}
        onEndReached={handleEndReached}
        onEndReachedThreshold={1.5}
      />
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]} onLayout={onContainerLayout}>
      {isFocused ? <StatusBar style="light" /> : null}
      {body}

      {/* Screen-level chrome, not per-card content — DESIGN.md §14.1's "at
          most two chips" budget is about the card overlay (condition/size),
          and does not apply here. box-none so the surrounding transparent
          area never swallows the feed's vertical swipe; only the two Chips
          themselves (real Pressables) claim a touch. No new scrim: Chip's
          own opaque fill is what keeps these legible over photography, the
          same mechanism the card's own condition/size chips already rely
          on — gradientScrim's top stop is already transparent. */}
      <View
        pointerEvents="box-none"
        style={[styles.scopeToggle, { paddingTop: insets.top + SCOPE_TOGGLE_TOP_GAP }]}>
        <Chip label="For you" selectable selected={scope === 'forYou'} onPress={() => setScope('forYou')} />
        <Chip
          label="Following"
          selectable
          selected={scope === 'following'}
          onPress={() => setScope('following')}
        />
      </View>

      {isFetchingNextPage ? (
        <View pointerEvents="none" style={styles.paginationIndicator}>
          <ActivityIndicator color={colors.textOnMedia} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    paddingHorizontal: space[6],
  },
  scopeToggle: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: space[2],
    paddingHorizontal: space[5],
  },
  paginationIndicator: {
    position: 'absolute',
    bottom: space[6],
    alignSelf: 'center',
  },
});
