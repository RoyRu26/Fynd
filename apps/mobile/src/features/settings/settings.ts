// Pure logic for the Settings screen (ROADMAP 6.1a) -- no react-native or
// `@/lib/supabase` import, same split as inbox.ts, so this is directly
// unit-testable.

/**
 * The three notification-preference columns
 * (`20261021062550_profile_notification_preferences.sql`), normalized to a
 * camelCase domain object the Settings screen's switches bind to directly.
 */
export type NotificationPreferences = {
  notifyNewMessage: boolean;
  notifyNewReview: boolean;
  notifyNewFollower: boolean;
};

/**
 * Row -> domain normalization.
 *
 * All three columns carry `not null default true` server-side, so a
 * genuinely-null value should never reach this function for a row read
 * through the normal client -- but the generated `ProfileRow` type is wider
 * than that guarantee (it has no way to express "not null" narrower than
 * `boolean`, and defensive normalization at this boundary is cheap insurance
 * against a stale cached row or a future nullable migration). Mirrors
 * `normalizeInboxRow`'s own defensive-null philosophy: default to `true`
 * (the same value the column default uses) rather than throwing, since a
 * missing preference should read as "notifications on," not as an
 * invariant violation worth crashing the Settings screen over.
 */
export function normalizeNotificationPreferences(row: {
  notify_new_message: boolean | null | undefined;
  notify_new_review: boolean | null | undefined;
  notify_new_follower: boolean | null | undefined;
}): NotificationPreferences {
  return {
    notifyNewMessage: row.notify_new_message ?? true,
    notifyNewReview: row.notify_new_review ?? true,
    notifyNewFollower: row.notify_new_follower ?? true,
  };
}
