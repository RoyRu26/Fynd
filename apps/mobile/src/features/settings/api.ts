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

// ============================================================
// Account deletion (ROADMAP 6.1b)
// ============================================================

/**
 * Hand-duplicated from `supabase/functions/delete-account/index.ts`'s own
 * `DeleteAccountResponse` type -- there is no mechanism in this repo for
 * sharing types across the Deno/mobile boundary, same precedent
 * `features/listings/ai-suggestions.ts` already established for
 * `suggest-listing`. If either side changes (a new `reason`, a renamed
 * field), update both by hand; a mismatch here would only surface at
 * runtime, not at typecheck time, since `data` below is typed by the
 * generic parameter, not inferred from the function's actual return.
 */
export type DeleteAccountResponse =
  | { ok: true }
  | { ok: false; reason: 'unauthorized' | 'invalid_request' | 'deletion_failed'; message: string };

/**
 * Requests deletion of the signed-in user's own account.
 *
 * A thin passthrough, deliberately UNLIKE `suggestListingFromPhotos` (which
 * collapses a transport failure into its own `ok:false` shape): this
 * follows this module's own `api.ts` convention instead (CLAUDE.md: "api.ts
 * -- Supabase calls only. Throws on error.") -- a transport/invoke failure
 * throws, and a resolved `{ ok: false, reason, message }` payload is
 * returned as-is for the caller (`useDeleteAccountMutation`) to turn into a
 * thrown value, so both failure shapes end up flowing through the exact
 * same `catch` + `mapDeleteAccountError` path at the call site.
 */
export async function requestAccountDeletion(): Promise<DeleteAccountResponse> {
  const { data, error } = await supabase.functions.invoke<DeleteAccountResponse>('delete-account', {
    body: {},
  });
  if (error) throw error;
  if (!data) {
    throw new Error('No response from delete-account');
  }
  return data;
}
