export type MappedReviewError = {
  message: string;
};

function isPostgrestErrorLike(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  return error instanceof Error && /network|fetch/i.test(error.message);
}

/**
 * Maps a `submit_review` error to a safe, user-facing message. Mirrors
 * `mapReportError`/`mapBlockError`'s exact shape and discipline: backend
 * message text is never surfaced, pure and side-effect-free, callers log
 * the original error themselves.
 */
export function mapReviewError(error: unknown): MappedReviewError {
  const code = isPostgrestErrorLike(error) ? error.code : undefined;

  switch (code) {
    // No completed sale to review (wrong listing status, or sold with no
    // recorded buyer), or an out-of-range rating caught before the insert.
    case 'P0001':
      return { message: "That review isn't allowed right now." };
    // The listing no longer exists.
    case 'P0002':
      return { message: 'That listing no longer exists.' };
    // Not part of this sale -- neither the recorded buyer nor the seller.
    case '42501':
      return { message: "You can't review this." };
    // (listing_id, reviewer_id) is unique -- already reviewed.
    case '23505':
      return { message: "You've already reviewed this sale." };
    // reviews_rating_range / reviews_comment_length -- unreachable from this
    // client today (the rating picker and comment field both already
    // enforce their own bounds before the request is sent), kept for the
    // same defense-in-depth reason `mapReportError` keeps its own 23514 case.
    case '23514':
      return { message: "That rating or comment isn't allowed." };
    default:
      break;
  }

  if (isNetworkError(error)) {
    return { message: 'Network error. Check your connection and try again.' };
  }

  return { message: 'Something went wrong. Please try again.' };
}
