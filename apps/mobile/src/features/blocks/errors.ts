export type MappedBlockError = {
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
 * Maps a `blocks` insert/delete error to a safe, user-facing message.
 *
 * Mirrors `mapReportError`'s/`mapInboxError`'s exact shape. Backend
 * message text is never surfaced. Pure and side-effect-free; callers log
 * the original error themselves.
 */
export function mapBlockError(error: unknown): MappedBlockError {
  const code = isPostgrestErrorLike(error) ? error.code : undefined;

  switch (code) {
    // The composite primary key -- this user is already blocked.
    case '23505':
      return { message: "You've already blocked this user." };
    // blocks_not_self -- unreachable from the UI (there is no self block
    // affordance), but mapped defensively rather than falling through to
    // the generic message.
    case '23514':
      return { message: "You can't block yourself." };
    // The insert/delete policy's WITH CHECK/USING: a forged blocker_id, or
    // (for delete) a row the caller doesn't own.
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
