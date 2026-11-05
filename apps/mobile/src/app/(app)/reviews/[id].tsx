import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, type ReactNode } from 'react';
import { FlatList, StyleSheet, View, type ListRenderItemInfo } from 'react-native';

import { EmptyState, IconButton, Screen, SkeletonRow, Text, type IconName } from '@/components/ui';
import { ReviewRow } from '@/components/review/review-row';
import { space } from '@/design/tokens';
import { mapListingError } from '@/features/listings/errors';
import { useSellerReviews } from '@/features/reviews/queries';
import type { SellerReview } from '@/features/reviews/reviews';

/**
 * A seller's review list — ROADMAP 5.4. The scrollable destination behind
 * the tappable rating count on `seller/[id].tsx`'s identity header.
 *
 * Structural twin of `follows/[id].tsx`: manual back row + title (this
 * app's pushed non-tab screens have no native header), the same
 * skeleton/empty/error branching, offset-paginated `FlatList`. Renders
 * `ReviewRow` instead of `ListRow` — a review needs an avatar, name, star
 * rating, comment, AND a date together, more than `ListRow`'s shape has
 * room for (see that component's own doc comment for the full reasoning,
 * which mirrors `message-bubble.tsx`'s identical precedent).
 *
 * `mapListingError` is reused here for a non-listing error, same as
 * `follows/[id].tsx`'s own reuse of it for a non-listing error — it maps
 * generic Postgres/network failure shapes to safe copy, nothing
 * listing-specific.
 */

const BACK_ICON: IconName = { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' };
// Same glyph family as star-rating.tsx's own empty-star icon — this screen
// is about the same reputation content.
const EMPTY_ICON: IconName = { ios: 'star', android: 'star_border', web: 'star_border' };
const ERROR_ICON: IconName = { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' };

const SKELETON_ROW_COUNT = 6;

export default function SellerReviewsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const reviewsQuery = useSellerReviews(id);
  const reviews = reviewsQuery.data?.pages.flatMap((page) => page.reviews) ?? [];

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = reviewsQuery;
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SellerReview>) => <ReviewRow review={item} />,
    [],
  );

  let listEmpty: ReactNode = null;
  if (reviewsQuery.isPending) {
    listEmpty = (
      <View style={styles.rows}>
        {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
          <SkeletonRow key={index} />
        ))}
      </View>
    );
  } else if (reviewsQuery.isError) {
    listEmpty = (
      <EmptyState
        variant="error"
        icon={ERROR_ICON}
        title="Something went wrong"
        body={mapListingError(reviewsQuery.error).message}
        actionLabel="Try again"
        onAction={() => reviewsQuery.refetch()}
      />
    );
  } else {
    listEmpty = (
      <EmptyState variant="empty" icon={EMPTY_ICON} title="Reviews" body="No reviews yet." />
    );
  }

  return (
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <IconButton icon={BACK_ICON} accessibilityLabel="Back" onPress={() => router.back()} />
      </View>
      <Text variant="title" style={styles.title}>
        Reviews
      </Text>
      <FlatList
        style={styles.list}
        data={reviews}
        keyExtractor={(item) => String(item.reviewId)}
        renderItem={renderItem}
        ListEmptyComponent={listEmpty}
        onEndReached={handleEndReached}
        onEndReachedThreshold={1.5}
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.footerSpinner}>
              <SkeletonRow />
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: space[4],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    paddingHorizontal: space[4],
  },
  list: {
    flex: 1,
  },
  rows: {
    gap: space[2],
  },
  footerSpinner: {
    paddingVertical: space[2],
  },
});
