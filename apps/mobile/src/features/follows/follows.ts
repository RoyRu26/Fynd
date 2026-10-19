/**
 * Pure logic for the follows feature. No react-native or `@/lib/supabase`
 * imports, so this is unit-testable without React, a QueryClient, or a
 * renderer.
 */

export type FollowCounts = {
  followersCount: number;
  followingCount: number;
};

/**
 * Derives the next `followersCount` for a profile after a follow/unfollow
 * toggle on it.
 *
 * `counts` must be the TARGET profile's own counts — the profile being
 * followed or unfollowed — never the viewer's. This function only ever
 * adjusts `followersCount`:
 *
 *   * Following (toggling from not-following to following) means one more
 *     person now follows this profile — `followersCount + 1`.
 *   * Unfollowing means one fewer — `followersCount - 1`.
 *
 * `followingCount` passes through UNCHANGED. That field counts how many
 * profiles the TARGET follows, which this toggle never changes — only the
 * VIEWER's own `followingCount` changes, and that is a different profile's
 * cache entry entirely (the viewer's, not the target's). Calling this on
 * the viewer's own counts object, expecting it to bump `followingCount`,
 * would silently adjust the wrong field and is exactly the easy-to-miss bug
 * this doc comment exists to head off — the caller is responsible for
 * patching the viewer's `followingCount` separately, at its own cache key.
 *
 * `isFollowing` is the state BEFORE the toggle: `false` means the toggle is
 * about to follow, `true` means it is about to unfollow.
 */
export function adjustFollowCounts(counts: FollowCounts, isFollowing: boolean): FollowCounts {
  return {
    ...counts,
    followersCount: counts.followersCount + (isFollowing ? -1 : 1),
  };
}
