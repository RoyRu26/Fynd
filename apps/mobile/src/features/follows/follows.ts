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

// ============================================================
// Follower / following lists (ROADMAP 3.3)
// ============================================================

export type FollowListMode = 'followers' | 'following';

/**
 * Validates a client-controlled `mode` route param. Anything other than
 * the two known literals (missing, mistyped, or someone hand-editing the
 * URL) falls back to `'followers'` rather than throwing — this is route
 * state, not a server response, so it is treated as untrusted input per
 * CLAUDE.md rather than trusted to already be one of the two literals.
 */
export function parseFollowListMode(value: string | string[] | undefined): FollowListMode {
  return value === 'following' ? 'following' : 'followers';
}

/** One row of a follower/following list — the "other party" profile. */
export type FollowListProfile = {
  profileId: string;
  username: string | null;
  displayName: string | null;
  avatarPath: string | null;
  avatarUrl: string | null;
};

export type FollowListPage = {
  profiles: FollowListProfile[];
  totalCount: number;
};

/** The `profiles` row shape selected for a follow-list page — see api.ts. */
export type FollowListProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_path: string | null;
};

/**
 * Puts `profiles` rows (which `.in('id', ids)` returns in no particular
 * order) back into `ids`' own order, dropping any id with no matching row
 * (e.g. a deleted account the `follows` row hasn't been cascaded away from
 * yet). Pulled out as its own pure function specifically so this
 * order-dependent step — easy to get subtly wrong in a future refactor of
 * `api.ts` — has a direct unit test rather than only being correct by
 * inspection of the caller.
 */
export function reorderFollowListRows(
  ids: string[],
  rows: FollowListProfileRow[],
): FollowListProfileRow[] {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = rowsById.get(id);
    return row ? [row] : [];
  });
}

/**
 * Row -> domain, avatar URL not yet resolved. Mirrors
 * `seller-profile/profile.ts`'s `normalizeSellerProfileRow` exactly — same
 * shape of source row, same fields.
 */
export function normalizeFollowListRow(row: FollowListProfileRow): Omit<FollowListProfile, 'avatarUrl'> {
  return {
    profileId: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
  };
}

/**
 * Attaches each profile's resolved avatar URL. Null-tolerant, NOT
 * throw-on-missing — same precedent as `seller-profile/profile.ts`'s
 * `associateSellerAvatarUrl`: a missing avatar is a legitimate permanent
 * state (onboarding never sets one), not an invariant violation like a
 * listing's missing cover image.
 */
export function associateFollowListAvatarUrls(
  rows: Omit<FollowListProfile, 'avatarUrl'>[],
  urlsByPath: Record<string, string>,
): FollowListProfile[] {
  return rows.map((row) => ({
    ...row,
    avatarUrl: row.avatarPath ? urlsByPath[row.avatarPath] ?? null : null,
  }));
}

/**
 * The next page's offset, or `null` when there is no next page. Copies
 * `seller-profile/profile.ts`'s `deriveNextSellerListingsOffset` logic
 * verbatim: offset-based, not a keyset cursor, because a single profile's
 * follower/following list is far smaller and far less concurrently-written
 * than the global feed — the simpler mechanism is right-sized here too. A
 * page shorter than requested, or a running total that has already reached
 * `totalCount`, signals the list is exhausted.
 */
export function deriveNextFollowListOffset(
  currentOffset: number,
  page: FollowListPage,
  pageSize: number,
): number | null {
  const nextOffset = currentOffset + page.profiles.length;
  if (page.profiles.length < pageSize || nextOffset >= page.totalCount) {
    return null;
  }
  return nextOffset;
}
