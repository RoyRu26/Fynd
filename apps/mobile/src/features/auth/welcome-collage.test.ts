import { describe, expect, it } from 'vitest';

import { getCollagePhotoSlots } from '@/features/auth/welcome-collage';

describe('getCollagePhotoSlots', () => {
  it('fills 4/5/4 columns row by row across columns with 13 unique slots', () => {
    const slots = getCollagePhotoSlots([4, 5, 4]);
    expect(slots).toEqual([
      [0, 3, 6, 9],
      [1, 4, 7, 10, 12],
      [2, 5, 8, 11],
    ]);
    const all = slots.flat().sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 13 }, (_, i) => i));
  });

  it('returns one empty list per empty column and nothing for no columns', () => {
    expect(getCollagePhotoSlots([0, 0])).toEqual([[], []]);
    expect(getCollagePhotoSlots([])).toEqual([]);
  });
});
