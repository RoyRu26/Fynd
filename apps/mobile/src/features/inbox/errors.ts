export type MappedInboxError = {
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
 * Maps an inbox/chat RPC error to a safe, user-facing message.
 *
 * Mirrors `mapListingError`'s shape, minus the Storage branch — the inbox
 * has no uploads. Backend message text is never surfaced: the RPCs raise
 * readable messages, but they are written for developers, are not
 * localised, and the same SQLSTATE covers several distinct causes. Pure and
 * side-effect-free; callers log the original error themselves.
 */
export function mapInboxError(error: unknown): MappedInboxError {
  const code = isPostgrestErrorLike(error) ? error.code : undefined;

  switch (code) {
    // Raised by get_or_create_listing_conversation for a validation
    // failure (messaging yourself, a non-active listing).
    case 'P0001':
      return {
        message: "That action isn't allowed right now. Please try again.",
      };
    // Raised when a conversation id doesn't resolve, or doesn't belong to
    // the caller — conversation_detail and mark_conversation_read both
    // treat "not found" and "not yours" as externally indistinguishable.
    case 'P0002':
      return { message: 'That conversation is no longer available.' };
    // Authentication required, or an RPC's own ownership rejection.
    case '42501':
      return { message: "You can't do that." };
    default:
      break;
  }

  if (isNetworkError(error)) {
    return { message: 'Network error. Check your connection and try again.' };
  }

  return { message: 'Something went wrong. Please try again.' };
}
