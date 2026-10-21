export type MappedNotificationPreferenceError = {
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
 * Maps a notification-preference update's Postgres error to a safe,
 * user-facing message.
 *
 * Deliberately a separate mapper from `mapProfileError`: this mutation only
 * ever touches the three `notify_*` boolean columns, so there is no
 * Storage/avatar surface, no username uniqueness, and no CHECK-constraint
 * surface to cover -- the only realistic failures are a privilege/RLS
 * denial (42501, which the UI should never actually trigger since the
 * screen only ever updates the signed-in user's own row) and a network
 * failure. Pure and side-effect-free; callers log the original error
 * themselves, same convention as `mapProfileError`.
 */
export function mapNotificationPreferenceError(error: unknown): MappedNotificationPreferenceError {
  const code = isPostgrestErrorLike(error) ? error.code : undefined;

  switch (code) {
    // A column-privilege denial or an RLS ownership rejection -- the UI
    // never offers editing someone else's preferences, but this is still
    // reachable directly, same as mapProfileError's 42501 case.
    case '42501':
      return { message: "You can't change that." };
    default:
      break;
  }

  if (isNetworkError(error)) {
    return { message: 'Network error. Check your connection and try again.' };
  }

  return { message: "Couldn't save that preference. Please try again." };
}

// ============================================================
// Account deletion (ROADMAP 6.1b)
// ============================================================

export type MappedDeleteAccountError = {
  message: string;
};

/**
 * Shape of the thrown value `useDeleteAccountMutation` produces for a
 * resolved-but-unsuccessful `delete-account` response (see queries.ts: it
 * throws the `{ ok: false, reason, message }` payload itself, rather than
 * wrapping it). Distinguished from a thrown transport error/PostgrestError
 * by the presence of `ok === false`, not by `code` the way
 * `isPostgrestErrorLike` above does -- this failure never carries a
 * Postgres SQLSTATE at all, it is the Edge Function's own response body.
 */
function isDeleteAccountFailure(
  error: unknown,
): error is { ok: false; reason: string; message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'ok' in error &&
    (error as { ok: unknown }).ok === false &&
    'reason' in error
  );
}

/**
 * Maps a `delete-account` failure to safe, user-facing copy.
 *
 * Two distinct failure shapes, both handled here (matching
 * `mapNotificationPreferenceError`'s own "one mapper, every shape" style,
 * and `ai-suggestions.ts`'s precedent of collapsing a thrown/transport
 * failure into the same contract as an expected one):
 *
 *   * a resolved `{ ok: false, reason, message }` payload -- mapped per
 *     `reason`, never by surfacing the Edge Function's own `message`
 *     directly (that string is written for this mapper to choose from, not
 *     guaranteed stable wording a UI should commit to verbatim).
 *   * a thrown transport/invoke error (network failure, function not
 *     deployed, an unexpected 500) -- falls through to the network check
 *     and then the generic fallback, same two-step `mapNotificationPreference
 *     Error` already uses.
 *
 * Pure and side-effect-free; callers log the original error themselves.
 */
export function mapDeleteAccountError(error: unknown): MappedDeleteAccountError {
  if (isDeleteAccountFailure(error)) {
    switch (error.reason) {
      case 'unauthorized':
        return { message: 'Your session has expired. Sign in again and try once more.' };
      case 'invalid_request':
      case 'deletion_failed':
        return { message: "Couldn't delete your account right now. Please try again." };
      default:
        return { message: "Couldn't delete your account right now. Please try again." };
    }
  }

  if (isNetworkError(error)) {
    return { message: 'Network error. Check your connection and try again.' };
  }

  return { message: "Couldn't delete your account right now. Please try again." };
}
