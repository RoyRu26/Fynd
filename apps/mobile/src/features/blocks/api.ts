import { supabase } from '@/lib/supabase';
import { requireUserId } from '@/lib/session';

/**
 * Database access for the blocks feature (ROADMAP 5.2).
 *
 * The server-side shape these functions are written against
 * (`public.blocks`, 20261020065007_blocks.sql):
 *
 *   * `blocks` is `(blocker_id, blocked_id, created_at)` with a composite
 *     primary key, so blocking twice is a `23505` rather than two rows —
 *     mirrors `follows` exactly.
 *   * RLS pins `blocker_id` to `auth.uid()` on insert and delete — a
 *     caller can only act as themselves.
 *   * READ is OWNER-SCOPED, and in ONE direction only: a caller sees rows
 *     where THEY are the blocker, never rows where they are the
 *     `blocked_id`. This is the opposite shape from `follows`' public
 *     read — see the migration's own header for why a block must never be
 *     confirmable by the party it targets. `fetchIsBlockedByMe` below is
 *     the only reader this policy shape allows; checking "is there a
 *     block between us, from EITHER side" goes through the
 *     `is_blocked_with` RPC instead (`fetchIsBlockedEitherWay`), which
 *     answers only a boolean and never reveals which side blocked which.
 *   * There is no UPDATE grant at all — a block is created or deleted,
 *     never edited.
 *
 * The viewer's own id is resolved via the shared `requireUserId`
 * (`@/lib/session`) for `blockUser`/`unblockUser`, same reasoning as
 * `follows/api.ts`: a caller cannot pass someone else's id, so "never
 * write another user's blocker_id" is enforced by the function signature,
 * not by convention.
 */

/**
 * Blocks `blockedId` as the signed-in user.
 *
 * Blocking someone already blocked raises `23505` from the composite
 * primary key. Blocking yourself raises `23514` (`blocks_not_self`).
 * Server-side, this also severs any pre-existing mutual follow between the
 * two parties and closes the door on re-following while the block stands
 * — see the migration's own header for that scope, added beyond the
 * literal ROADMAP wording.
 */
export async function blockUser(blockedId: string): Promise<void> {
  const blockerId = await requireUserId('block a user');

  const { error } = await supabase.from('blocks').insert({ blocker_id: blockerId, blocked_id: blockedId });
  if (error) throw error;
}

/**
 * Unblocks `blockedId` as the signed-in user.
 *
 * Both columns are filtered explicitly so this is a primary-key lookup —
 * mirrors `unfollowSeller`'s identical reasoning: RLS would scope it to
 * the caller's own rows regardless, but relying on the policy to supply
 * half the key would make the query's cost depend on a policy definition
 * elsewhere.
 */
export async function unblockUser(blockedId: string): Promise<void> {
  const blockerId = await requireUserId('unblock a user');

  const { error } = await supabase
    .from('blocks')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);
  if (error) throw error;
}

/**
 * Whether `viewerId` has blocked `targetId` — ONE direction, resolved via
 * a direct read under the owner-scoped SELECT policy. `viewerId` must be
 * the signed-in user's own id (the policy scopes reads to
 * `blocker_id = auth.uid()` regardless, so passing anyone else's id here
 * can only ever read back `false`, never another user's blocklist) —
 * accepted as a parameter rather than resolved internally, mirroring
 * `fetchIsFollowing`'s exact shape, so this stays a plain query hook
 * `queries.ts` can gate on a resolved viewer id.
 */
export async function fetchIsBlockedByMe(viewerId: string, targetId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('blocks')
    .select('*', { count: 'exact', head: true })
    .eq('blocker_id', viewerId)
    .eq('blocked_id', targetId);
  if (error) throw error;

  return (count ?? 0) > 0;
}

/**
 * Whether a block exists between the signed-in user and `targetId`, in
 * EITHER direction — via `public.is_blocked_with`, not a direct table
 * read. This is the only way to learn "is the viewer blocked" without
 * violating the one-direction-only SELECT policy: the RPC answers a
 * boolean, never which side blocked which. Used to proactively hide
 * "Message seller" — the server-side RLS/RPC enforcement (not this check)
 * is what actually prevents messaging either way.
 */
export async function fetchIsBlockedEitherWay(targetId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_blocked_with', { p_other_user_id: targetId });
  if (error) throw error;

  return data;
}
