export type MappedReportError = {
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
 * Maps a `reports` insert error to a safe, user-facing message.
 *
 * Mirrors `mapListingError`/`mapInboxError`'s shape. Backend message text is
 * never surfaced: the SQLSTATEs below each cover several distinct causes
 * (`23514` is the note-length cap AND the reason='other'-needs-a-note
 * check AND the exactly-one-target check; `42501` is self-targeting AND a
 * forged reporter_id AND a target the policy can't see), and none of that
 * nuance is something a reporter can act on anyway -- the client-side
 * validator (`isOtherReasonMissingNote`) already catches the one case a
 * user COULD fix, before the request is even sent. Pure and side-effect-
 * free; callers log the original error themselves.
 */
export function mapReportError(error: unknown): MappedReportError {
  const code = isPostgrestErrorLike(error) ? error.code : undefined;

  switch (code) {
    // A CHECK constraint: the note-length cap, the reason='other'-requires-
    // a-note rule, or (unreachable from this client, since the policy
    // below already refuses it first) the exactly-one-target rule.
    case '23514':
      return { message: "Couldn't submit that report. Please check what you entered and try again." };
    // One of the two partial unique indexes -- this target has already
    // been reported by this user.
    case '23505':
      return { message: "You've already reported this." };
    // The insert policy's WITH CHECK: self-targeting, a forged reporter_id,
    // or a target (listing/user) the policy doesn't acknowledge.
    case '42501':
      return { message: "You can't report this." };
    default:
      break;
  }

  if (isNetworkError(error)) {
    return { message: 'Network error. Check your connection and try again.' };
  }

  return { message: 'Something went wrong. Please try again.' };
}
