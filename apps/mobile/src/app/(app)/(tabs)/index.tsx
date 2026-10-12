import { useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';

import { FeedCard } from '@/components/feed/feed-card';
import { Button, Text } from '@/components/ui';
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

export default function HomeScreen() {
  return (
    <AppThemeProvider scheme="dark">
      <HomeFeed />
    </AppThemeProvider>
  );
}

function HomeFeed() {
  const { colors } = useAppTheme();
  // NativeTabs keeps inactive tabs mounted rather than unmounting them, so a
  // bare <StatusBar style="light" /> here would stay mounted — and, being
  // the last one rendered, win — even while the user is on Sell or Profile.
  // Gating on focus is what lets the root layout's system-driven StatusBar
  // take back over the instant Home loses focus.
  const isFocused = useIsFocused();

  const feedQuery = useFeed(INCLUDE_OWN_LISTINGS_FOR_LOCAL_TESTING);
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
        <FeedCard listing={item} includeOwn={INCLUDE_OWN_LISTINGS_FOR_LOCAL_TESTING} />
      </View>
    ),
    [pageHeight],
  );

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
        <Text variant="body" style={styles.centeredText}>
          {mapListingError(feedQuery.error).message}
        </Text>
        <Button variant="secondary" size="sm" onPress={() => feedQuery.refetch()}>
          Try again
        </Button>
      </View>
    );
  } else if (listings.length === 0) {
    body = (
      <View style={styles.centered}>
        <Text variant="body" color="textSecondary" style={styles.centeredText}>
          No listings yet. Check back soon.
        </Text>
      </View>
    );
  } else if (pageHeight === 0) {
    // Still measuring — render nothing rather than guessing a height that
    // would produce wrong paging offsets the instant the real one lands.
    body = null;
  } else {
    body = (
      <FlatList
        data={listings}
        keyExtractor={(item) => item.listingId}
        renderItem={renderItem}
        pagingEnabled
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        getItemLayout={getItemLayout}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews
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
  centeredText: {
    textAlign: 'center',
  },
  paginationIndicator: {
    position: 'absolute',
    bottom: space[6],
    alignSelf: 'center',
  },
});
