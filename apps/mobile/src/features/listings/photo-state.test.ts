import { describe, expect, it } from 'vitest';

import {
  addLocalPhotos,
  clampToRemainingSlots,
  moveId,
  remainingPhotoSlots,
  removeLocalPhoto,
  setLocalPhotoStatus,
  type LocalPhotoItem,
} from '@/features/listings/photo-state';
import { MAX_LISTING_PHOTOS } from '@/features/listings/paths';

describe('remainingPhotoSlots', () => {
  it('returns the full cap when nothing exists yet', () => {
    expect(remainingPhotoSlots(0)).toBe(MAX_LISTING_PHOTOS);
  });

  it('subtracts existing photos, across both persisted and local', () => {
    expect(remainingPhotoSlots(3)).toBe(MAX_LISTING_PHOTOS - 3);
  });

  it('never goes negative once the cap is reached or exceeded', () => {
    expect(remainingPhotoSlots(MAX_LISTING_PHOTOS)).toBe(0);
    expect(remainingPhotoSlots(MAX_LISTING_PHOTOS + 4)).toBe(0);
  });
});

describe('clampToRemainingSlots', () => {
  it('passes a batch through unchanged when it fits', () => {
    expect(clampToRemainingSlots(['a', 'b'], 5)).toEqual(['a', 'b']);
  });

  it('trims a batch that exceeds the remaining slots', () => {
    expect(clampToRemainingSlots(['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b']);
  });

  it('returns nothing when no slots remain', () => {
    expect(clampToRemainingSlots(['a', 'b'], 0)).toEqual([]);
  });

  it('treats a negative remaining count the same as zero', () => {
    expect(clampToRemainingSlots(['a'], -1)).toEqual([]);
  });

  it('is exact at the boundary', () => {
    expect(clampToRemainingSlots(['a', 'b', 'c'], 3)).toEqual(['a', 'b', 'c']);
  });
});

function item(localId: string, status: LocalPhotoItem['status'] = 'uploading'): LocalPhotoItem {
  return { localId, sourceUri: `file://${localId}.jpg`, status };
}

describe('addLocalPhotos / removeLocalPhoto', () => {
  it('appends new items after existing ones', () => {
    const result = addLocalPhotos([item('a')], [item('b'), item('c')]);
    expect(result.map((i) => i.localId)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const existing = [item('a')];
    addLocalPhotos(existing, [item('b')]);
    expect(existing).toHaveLength(1);
  });

  it('removes exactly the matching item', () => {
    const result = removeLocalPhoto([item('a'), item('b'), item('c')], 'b');
    expect(result.map((i) => i.localId)).toEqual(['a', 'c']);
  });

  it('is a no-op when the id is not present', () => {
    const existing = [item('a')];
    expect(removeLocalPhoto(existing, 'missing')).toEqual(existing);
  });
});

describe('setLocalPhotoStatus', () => {
  it('updates only the matching item', () => {
    const result = setLocalPhotoStatus([item('a'), item('b')], 'a', 'failed', 'Network error.');
    expect(result[0]).toEqual({ ...item('a'), status: 'failed', errorMessage: 'Network error.' });
    expect(result[1]).toEqual(item('b'));
  });

  it('clears errorMessage when transitioning back to uploading (retry)', () => {
    const failed = [{ ...item('a'), status: 'failed' as const, errorMessage: 'boom' }];
    const result = setLocalPhotoStatus(failed, 'a', 'uploading');
    expect(result[0].status).toBe('uploading');
    expect(result[0].errorMessage).toBeUndefined();
  });
});

describe('moveId', () => {
  it('swaps an item with its earlier neighbor', () => {
    expect(moveId(['a', 'b', 'c'], 'b', 'earlier')).toEqual(['b', 'a', 'c']);
  });

  it('swaps an item with its later neighbor', () => {
    expect(moveId(['a', 'b', 'c'], 'b', 'later')).toEqual(['a', 'c', 'b']);
  });

  // The cover photo is whichever id sits first, so moving it earlier must
  // be a genuine no-op, not a wrap-around.
  it('is a no-op moving the first item earlier', () => {
    const ids = ['a', 'b', 'c'];
    expect(moveId(ids, 'a', 'earlier')).toBe(ids);
  });

  it('is a no-op moving the last item later', () => {
    const ids = ['a', 'b', 'c'];
    expect(moveId(ids, 'c', 'later')).toBe(ids);
  });

  it('is a no-op for an id that is not in the list', () => {
    const ids = ['a', 'b', 'c'];
    expect(moveId(ids, 'z', 'earlier')).toBe(ids);
  });

  it('does not mutate the input array', () => {
    const ids = ['a', 'b', 'c'];
    moveId(ids, 'b', 'earlier');
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('round-trips: earlier then later restores the original order', () => {
    const ids = ['a', 'b', 'c'];
    const moved = moveId(ids, 'b', 'earlier');
    expect(moveId(moved, 'b', 'later')).toEqual(ids);
  });
});
