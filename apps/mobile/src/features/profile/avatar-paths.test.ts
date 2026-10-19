import { describe, expect, it } from 'vitest';

import { buildAvatarPath } from '@/features/profile/avatar-paths';

describe('buildAvatarPath', () => {
  it('builds a two-segment path from user id and image id', () => {
    expect(buildAvatarPath('user-1', 'image-1')).toBe('user-1/image-1.jpg');
  });

  it('throws when the user id segment is empty', () => {
    expect(() => buildAvatarPath('', 'image-1')).toThrow();
  });

  it('throws when the image id segment is empty', () => {
    expect(() => buildAvatarPath('user-1', '')).toThrow();
  });

  it('throws when the user id segment contains a slash', () => {
    expect(() => buildAvatarPath('user/1', 'image-1')).toThrow();
  });

  it('throws when the image id segment contains a slash', () => {
    expect(() => buildAvatarPath('user-1', 'image/1')).toThrow();
  });
});
