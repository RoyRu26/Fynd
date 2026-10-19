import { supabase } from '@/lib/supabase';

/**
 * Resolves the signed-in user's id from the live session, throwing if there
 * isn't one.
 *
 * Shared by every mutation that writes a `*_id` column pinned to
 * `auth.uid()` by RLS (`favorites.user_id`, `messages.sender_id`,
 * `follows.follower_id`, ...): reading `supabase.auth.getSession()` costs
 * nothing per call (in-memory/AsyncStorage, no network), and resolving the
 * id here rather than accepting it as a caller-supplied parameter is a
 * deliberate API choice carried over from every call site this replaces — a
 * caller cannot pass someone else's id, so "never write another user's own
 * id" is enforced by the function signature, not by convention. RLS would
 * reject a mismatch anyway, but a rejected write is a bug report and an
 * impossible write is not.
 *
 * `action` names what the caller was trying to do, in a form that reads
 * naturally after "Cannot" and before "without a signed-in user" — e.g.
 * `requireUserId('change favorites')` throws "Cannot change favorites
 * without a signed-in user".
 */
export async function requireUserId(action: string): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const userId = data.session?.user.id;
  if (!userId) {
    throw new Error(`Cannot ${action} without a signed-in user`);
  }
  return userId;
}
