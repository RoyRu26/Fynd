import { supabase } from '@/lib/supabase';
import { requireUserId } from '@/lib/session';
import type { FollowCounts } from '@/features/follows/follows';

/**
 * Database access for the follows feature.
 *
 * The server-side shape these functions are written against:
 *
 *   * `follows` is `(follower_id, followed_id, created_at)` with a
 *     composite primary key, so following twice is a `23505` rather than
 *     two rows.
 *   * RLS pins `follower_id` to `auth.uid()` on insert and delete — a
 *     caller can only act as themselves.
 *   * READ is PUBLIC (`using (true)`), unlike `favorites`' owner-scoped
 *     read — mirroring `profiles`' own public-read policy. Anyone can count
 *     anyone else's followers/following, or check whether A follows B. See
 *     the migration's header comment for why.
 *   * The column allowlist grants INSERT on `(follower_id, followed_id)`
 *     only: `created_at` is server-controlled. There is no UPDATE grant at
 *     all — a follow is created or deleted, never edited.
 *
 * The viewer's own id is resolved via the shared `requireUserId`
 * (`@/lib/session`) rather than accepted as a parameter, for the same
 * reason `feed/favorites.ts` does: a caller cannot pass someone else's id,
 * so "never write another user's follower_id" is enforced by the function
 * signature, not by convention.
 */

/**
 * Follows `followedId` as the signed-in user.
 *
 * Following someone already followed raises `23505` from the composite
 * primary key. The mutation hook avoids reaching that by deriving the
 * toggle direction from the query cache and refusing to fire while a toggle
 * for the same profile is already in flight — but the constraint is what
 * guarantees it, not the client.
 */
export async function followSeller(followedId: string): Promise<void> {
  const followerId = await requireUserId('change follows');

  const { error } = await supabase
    .from('follows')
    .insert({ follower_id: followerId, followed_id: followedId });
  if (error) throw error;
}

/**
 * Unfollows `followedId` as the signed-in user.
 *
 * Both columns are filtered explicitly so this is a primary-key lookup. RLS
 * would scope it to the caller's own rows regardless, but relying on the
 * policy to supply half the key would make the query's cost depend on a
 * policy definition elsewhere.
 */
export async function unfollowSeller(followedId: string): Promise<void> {
  const followerId = await requireUserId('change follows');

  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('followed_id', followedId);
  if (error) throw error;
}

/**
 * Follower/following counts for one profile.
 *
 * Two `head: true, count: 'exact'` selects run in parallel — each asks
 * Postgres for a row count only, no rows transferred — rather than one
 * round trip doing both directions, since there is no single table scan
 * that serves both `follower_id = profileId` and `followed_id = profileId`
 * at once without a UNION. `follows_followed_id_idx` backs the followers
 * side; the primary key backs the following side.
 */
export async function fetchFollowCounts(profileId: string): Promise<FollowCounts> {
  const [followers, following] = await Promise.all([
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followed_id', profileId),
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', profileId),
  ]);
  if (followers.error) throw followers.error;
  if (following.error) throw following.error;

  return {
    followersCount: followers.count ?? 0,
    followingCount: following.count ?? 0,
  };
}

/**
 * Whether `viewerId` currently follows `profileId`.
 *
 * `head: true` again asks only for existence/count, not the row itself —
 * all this needs is whether the composite-PK lookup matches zero or one
 * rows.
 */
export async function fetchIsFollowing(viewerId: string, profileId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('follower_id', viewerId)
    .eq('followed_id', profileId);
  if (error) throw error;

  return (count ?? 0) > 0;
}
