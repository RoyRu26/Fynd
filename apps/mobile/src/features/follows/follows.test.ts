import { describe, expect, it } from 'vitest';

import {
  adjustFollowCounts,
  associateFollowListAvatarUrls,
  deriveNextFollowListOffset,
  normalizeFollowListRow,
  parseFollowListMode,
  reorderFollowListRows,
  type FollowCounts,
  type FollowListPage,
  type FollowListProfileRow,
} from '@/features/follows/follows';

function makeCounts(overrides: Partial<FollowCounts> = {}): FollowCounts {
  return { followersCount: 3, followingCount: 12, ...overrides };
}

describe('adjustFollowCounts', () => {
  it('increments followersCount when following (isFollowing was false)', () => {
    const counts = makeCounts({ followersCount: 3, followingCount: 12 });

    expect(adjustFollowCounts(counts, false)).toEqual({
      followersCount: 4,
      followingCount: 12,
    });
  });

  it('decrements followersCount when unfollowing (isFollowing was true)', () => {
    const counts = makeCounts({ followersCount: 3, followingCount: 12 });

    expect(adjustFollowCounts(counts, true)).toEqual({
      followersCount: 2,
      followingCount: 12,
    });
  });

  it('never touches followingCount in either direction', () => {
    const counts = makeCounts({ followersCount: 0, followingCount: 7 });

    expect(adjustFollowCounts(counts, false).followingCount).toBe(7);
    expect(adjustFollowCounts(counts, true).followingCount).toBe(7);
  });
});

describe('parseFollowListMode', () => {
  it('returns "following" only for the exact literal', () => {
    expect(parseFollowListMode('following')).toBe('following');
  });

  it('falls back to "followers" for anything else, including missing/invalid values', () => {
    expect(parseFollowListMode('followers')).toBe('followers');
    expect(parseFollowListMode(undefined)).toBe('followers');
    expect(parseFollowListMode('bogus')).toBe('followers');
    expect(parseFollowListMode(['following'])).toBe('followers');
  });
});

function makeFollowListRow(overrides: Partial<FollowListProfileRow> = {}): FollowListProfileRow {
  return {
    id: 'profile-1',
    username: 'rae',
    display_name: 'Rae Fynd',
    avatar_path: 'avatars/profile-1.jpg',
    ...overrides,
  };
}

describe('reorderFollowListRows', () => {
  it('reorders rows from an unordered .in() response to match the id list order', () => {
    const a = makeFollowListRow({ id: 'a' });
    const b = makeFollowListRow({ id: 'b' });
    const c = makeFollowListRow({ id: 'c' });

    expect(reorderFollowListRows(['c', 'a', 'b'], [a, b, c])).toEqual([c, a, b]);
  });

  it('drops an id with no matching row instead of inserting a gap', () => {
    const a = makeFollowListRow({ id: 'a' });
    const c = makeFollowListRow({ id: 'c' });

    expect(reorderFollowListRows(['a', 'b', 'c'], [a, c])).toEqual([a, c]);
  });

  it('returns an empty array for an empty id list', () => {
    expect(reorderFollowListRows([], [makeFollowListRow()])).toEqual([]);
  });
});

describe('normalizeFollowListRow', () => {
  it('maps snake_case row fields to the domain shape', () => {
    expect(normalizeFollowListRow(makeFollowListRow())).toEqual({
      profileId: 'profile-1',
      username: 'rae',
      displayName: 'Rae Fynd',
      avatarPath: 'avatars/profile-1.jpg',
    });
  });
});

describe('associateFollowListAvatarUrls', () => {
  it('resolves a profile with an avatar path against the urlsByPath map', () => {
    const rows = [normalizeFollowListRow(makeFollowListRow({ avatar_path: 'avatars/profile-1.jpg' }))];

    const result = associateFollowListAvatarUrls(rows, { 'avatars/profile-1.jpg': 'https://example.com/signed' });

    expect(result[0]?.avatarUrl).toBe('https://example.com/signed');
  });

  it('is null-tolerant: a profile with no avatar path gets a null avatarUrl, not a throw', () => {
    const rows = [normalizeFollowListRow(makeFollowListRow({ avatar_path: null }))];

    const result = associateFollowListAvatarUrls(rows, {});

    expect(result[0]?.avatarUrl).toBeNull();
  });

  it('is also null-tolerant when an avatar path fails to resolve a signed URL', () => {
    const rows = [normalizeFollowListRow(makeFollowListRow({ avatar_path: 'avatars/missing.jpg' }))];

    const result = associateFollowListAvatarUrls(rows, {});

    expect(result[0]?.avatarUrl).toBeNull();
  });
});

function makePage(overrides: Partial<FollowListPage> = {}): FollowListPage {
  return { profiles: [], totalCount: 0, ...overrides };
}

describe('deriveNextFollowListOffset', () => {
  it('returns the next offset when the page is full and more remain', () => {
    const page = makePage({ profiles: Array.from({ length: 20 }, () => ({} as never)), totalCount: 50 });

    expect(deriveNextFollowListOffset(0, page, 20)).toBe(20);
  });

  it('returns null when the page is shorter than the page size (exhausted early)', () => {
    const page = makePage({ profiles: Array.from({ length: 5 }, () => ({} as never)), totalCount: 25 });

    expect(deriveNextFollowListOffset(20, page, 20)).toBeNull();
  });

  it('returns null once the running total reaches totalCount, even on a full page', () => {
    const page = makePage({ profiles: Array.from({ length: 20 }, () => ({} as never)), totalCount: 40 });

    expect(deriveNextFollowListOffset(20, page, 20)).toBeNull();
  });
});
