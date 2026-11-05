import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button, Sheet, StarRating, Text, TextField } from '@/components/ui';
import { space } from '@/design/tokens';
import { mapReviewError } from '@/features/reviews/errors';
import { useSubmitReview } from '@/features/reviews/queries';

export type ReviewSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** The thread this submission was opened from -- its own `conversation_detail` cache entry is invalidated on success so the CTA that opened this sheet disappears on its own. */
  conversationId: string;
  listingId: string;
  revieweeId: string;
  /** Resolved display name -- drives the sheet's title and the rating's accessible label. */
  revieweeName: string;
};

/**
 * ROADMAP 5.4's review submission sheet, opened from the conversation
 * screen's "Leave a review" row. Mirrors `ReportReasonPicker`'s shape
 * exactly: an interactive control (a `StarRating` here, a `Chip` wall
 * there), an optional multiline `TextField` below it, inline error text via
 * `mapReviewError`, and a `Button` calling the submit mutation.
 *
 * Owns its own `Sheet`, unlike `ReportReasonPicker` (which is content-only,
 * folded into `MoreActionsSheet`'s single shared `Sheet` instance): there
 * is no existing sheet on the conversation screen for this to fold into, so
 * a self-contained sheet is the right shape here -- same precedent as
 * `listing-actions-sheet.tsx`/`category-picker-sheet.tsx`, which both own
 * their own `Sheet` too.
 */
export function ReviewSheet({ visible, onClose, conversationId, listingId, revieweeId, revieweeName }: ReviewSheetProps) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submitReview = useSubmitReview(conversationId);

  // No pre-check mirroring the server's own eligibility rules here (unlike
  // ReportReasonPicker's isOtherReasonMissingNote, which DOES duplicate a
  // server CHECK client-side) -- there's nothing for this sheet to get
  // wrong about reviewability: it only ever opens when the conversation
  // screen's own `canReview` flag is already true.
  const canSubmit = rating > 0;

  function resetAndClose() {
    setRating(0);
    setComment('');
    setErrorMessage(null);
    onClose();
  }

  function handleSubmit() {
    if (!canSubmit || submitReview.isPending) return;
    setErrorMessage(null);
    submitReview.mutate(
      { listingId, rating, comment, revieweeId },
      {
        onSuccess: () => {
          resetAndClose();
          // Lightweight post-action feedback, reusing the native-Alert
          // pattern `ReportReasonPicker`/`MoreActionsSheet` already use for
          // their own confirmations -- not a toast system this codebase
          // doesn't otherwise have.
          Alert.alert('Review submitted', `Thanks for reviewing ${revieweeName}.`);
        },
        onError: (err) => {
          if (__DEV__) {
            console.error(err);
          }
          setErrorMessage(mapReviewError(err).message);
        },
      },
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={resetAndClose}
      title={`Review ${revieweeName}`}
      accessibilityLabel={`Review ${revieweeName}`}>
      <View style={styles.content}>
        <View style={styles.field}>
          <Text variant="label" color="textSecondary">
            Rating
          </Text>
          <StarRating value={rating} onChange={setRating} accessibilityLabel={`Your rating for ${revieweeName}`} />
        </View>

        <TextField
          label="Comment (optional)"
          placeholder={`What was it like doing business with ${revieweeName}?`}
          value={comment}
          onChangeText={setComment}
          multiline
          numberOfLines={4}
        />

        {errorMessage ? (
          <Text variant="caption" color="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
            {errorMessage}
          </Text>
        ) : null}

        <Button onPress={handleSubmit} disabled={!canSubmit} loading={submitReview.isPending}>
          Submit review
        </Button>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: space[4],
    paddingBottom: space[4],
  },
  field: {
    gap: space[1],
  },
});
