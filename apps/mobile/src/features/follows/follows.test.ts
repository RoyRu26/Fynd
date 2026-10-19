import { describe, expect, it } from 'vitest';

import { adjustFollowCounts, type FollowCounts } from '@/features/follows/follows';

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
