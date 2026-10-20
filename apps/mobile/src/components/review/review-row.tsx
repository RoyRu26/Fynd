import { StyleSheet, View } from 'react-native';

import { Avatar, StarRating, Text } from '@/components/ui';
import { space } from '@/design/tokens';
import { formatReviewAge, resolveReviewerName, type SellerReview } from '@/features/reviews/reviews';

export type ReviewRowProps = {
  review: SellerReview;
};

/**
 * One row of a seller's review list -- avatar, reviewer name, a read-only
 * star rating, the comment (if any), and a relative date.
 *
 * Deliberately NOT built on `ListRow`: that primitive's shape is one
 * leading element plus a single title/subtitle pair, with no room for a
 * star rating AND a comment AND a date together. `message-bubble.tsx` is
 * its own bespoke component for the identical reason (a thread bubble
 * needs more than `ListRow`'s shape allows) -- this follows that same
 * precedent rather than forcing a four-part row into a two-part primitive.
 *
 * One composed `accessibilityLabel` on the row itself, not four separate
 * accessible children: a screen reader should hear "Jamie Doe rated 5 out
 * of 5, 2 weeks ago: Great transaction!" as a single coherent announcement,
 * the same discipline `ListRow` already applies to its own
 * title/subtitle/unread composition.
 */
export function ReviewRow({ review }: ReviewRowProps) {
  const name = resolveReviewerName(review.reviewer);
  const age = formatReviewAge(review.createdAt);
  const label = `${name} rated ${review.rating} out of 5, ${age}${review.comment ? `: ${review.comment}` : ''}`;

  return (
    <View style={styles.row} accessible accessibilityLabel={label}>
      <Avatar size="md" source={review.reviewer.avatarUrl ?? undefined} name={name} />
      <View style={styles.main}>
        <View style={styles.headerRow}>
          <Text variant="bodyStrong">{name}</Text>
          <Text variant="caption" color="textTertiary">
            {age}
          </Text>
        </View>
        <StarRating value={review.rating} size="sm" accessibilityLabel={`${name}'s rating`} />
        {review.comment ? (
          <Text variant="body" color="textSecondary">
            {review.comment}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
  },
  main: {
    flex: 1,
    gap: space[1],
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space[2],
  },
});
