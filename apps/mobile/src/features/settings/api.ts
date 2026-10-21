import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';

/**
 * Database access for the Settings screen's notification-preference
 * switches (ROADMAP 6.1a).
 *
 * `notify_new_message`/`notify_new_review`/`notify_new_follower` are the
 * only columns this module writes, matching the column-level UPDATE
 * allowlist `20261021062550_profile_notification_preferences.sql` grants on
 * `profiles` -- same "allowlisted columns only" shape as
 * `features/profile/api.ts`'s `updateProfile`. RLS's existing "Users can
 * update own profile" policy (`auth.uid() = id`) scopes this to the
 * caller's own row; there is nothing settings-specific to add there.
 */

export type ProfileRow = Tables<'profiles'>;

/**
 * Updates one or more notification-preference columns. RLS silently matches
 * zero rows for an id that isn't the caller's own (shouldn't happen -- the
 * UI never offers another user's id -- but the Settings screen always calls
 * this for the signed-in user's own id), so the explicit empty check turns
 * that into a real failure instead of a silent no-op, same defensive shape
 * as `updateProfile`.
 */
export async function updateNotificationPreferences(
  userId: string,
  prefs: Partial<{
    notifyNewMessage: boolean;
    notifyNewReview: boolean;
    notifyNewFollower: boolean;
  }>,
): Promise<ProfileRow> {
  const patch: Partial<{
    notify_new_message: boolean;
    notify_new_review: boolean;
    notify_new_follower: boolean;
  }> = {};
  if (prefs.notifyNewMessage !== undefined) {
    patch.notify_new_message = prefs.notifyNewMessage;
  }
  if (prefs.notifyNewReview !== undefined) {
    patch.notify_new_review = prefs.notifyNewReview;
  }
  if (prefs.notifyNewFollower !== undefined) {
    patch.notify_new_follower = prefs.notifyNewFollower;
  }

  const { data, error } = await supabase.from('profiles').update(patch).eq('id', userId).select();
  if (error) throw error;
  if (data.length === 0) {
    throw new Error('Profile not found, or it is no longer editable');
  }
  return data[0];
}
