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
