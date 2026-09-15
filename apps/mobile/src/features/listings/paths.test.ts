import { describe, expect, it } from 'vitest';

import {
  buildListingImagePath,
  createImageId,
  MAX_IMAGE_EDGE_PX,
  resizeTargetForLongestEdge,
} from '@/features/listings/paths';

const SELLER = 'f2000000-0000-0000-0000-00000000000a';
const LISTING = 'aaaa0001-0000-0000-0000-000000000001';

describe('buildListingImagePath', () => {
  it('builds {seller}/{listing}/{image}.jpg', () => {
    expect(buildListingImagePath(SELLER, LISTING, 'img')).toBe(`${SELLER}/${LISTING}/img.jpg`);
  });

  // The Storage policies read segment 1 as the owner uid and segment 2 as the
  // listing id, so the first two segments must be exactly these values.
  it('puts the seller id first and the listing id second', () => {
    const segments = buildListingImagePath(SELLER, LISTING, 'img').split('/');
    expect(segments[0]).toBe(SELLER);
    expect(segments[1]).toBe(LISTING);
    expect(segments).toHaveLength(3);
  });

  it('rejects a segment containing a slash, which would shift every later segment', () => {
    expect(() => buildListingImagePath(SELLER, `${LISTING}/..`, 'img')).toThrow();
    expect(() => buildListingImagePath(`${SELLER}/x`, LISTING, 'img')).toThrow();
    expect(() => buildListingImagePath(SELLER, LISTING, 'a/b')).toThrow();
  });

  it('rejects an empty segment', () => {
    expect(() => buildListingImagePath('', LISTING, 'img')).toThrow();
    expect(() => buildListingImagePath(SELLER, LISTING, '')).toThrow();
  });
});

describe('resizeTargetForLongestEdge', () => {
  it('constrains the width when the image is landscape', () => {
    expect(resizeTargetForLongestEdge(4000, 3000)).toEqual({ width: MAX_IMAGE_EDGE_PX });
  });

  it('constrains the height when the image is portrait', () => {
    expect(resizeTargetForLongestEdge(3000, 4000)).toEqual({ height: MAX_IMAGE_EDGE_PX });
  });

  it('constrains one dimension only, so the aspect ratio is preserved by the resizer', () => {
    const target = resizeTargetForLongestEdge(4000, 3000);
    expect(Object.keys(target ?? {})).toHaveLength(1);
  });

  it('returns null when the image already fits', () => {
    expect(resizeTargetForLongestEdge(1600, 1200)).toBeNull();
    expect(resizeTargetForLongestEdge(800, 600)).toBeNull();
  });

  it('treats the boundary as fitting', () => {
    expect(resizeTargetForLongestEdge(MAX_IMAGE_EDGE_PX, MAX_IMAGE_EDGE_PX)).toBeNull();
    expect(resizeTargetForLongestEdge(MAX_IMAGE_EDGE_PX + 1, 10)).toEqual({
      width: MAX_IMAGE_EDGE_PX,
    });
  });

  it('constrains the width for a square image', () => {
    expect(resizeTargetForLongestEdge(3000, 3000)).toEqual({ width: MAX_IMAGE_EDGE_PX });
  });

  it('honours an explicit max edge', () => {
    expect(resizeTargetForLongestEdge(1000, 500, 400)).toEqual({ width: 400 });
  });

  it('returns null for unusable dimensions rather than producing a bad resize', () => {
    expect(resizeTargetForLongestEdge(0, 0)).toBeNull();
    expect(resizeTargetForLongestEdge(-1, 100)).toBeNull();
    expect(resizeTargetForLongestEdge(Number.NaN, 100)).toBeNull();
  });
});

describe('createImageId', () => {
  it('produces a slash-free id usable as a path segment', () => {
    const id = createImageId();
    expect(id.length).toBeGreaterThan(0);
    expect(id).not.toContain('/');
    expect(() => buildListingImagePath(SELLER, LISTING, id)).not.toThrow();
  });

  it('does not collide across rapid successive calls', () => {
    const ids = new Set(Array.from({ length: 500 }, () => createImageId()));
    expect(ids.size).toBe(500);
  });
});
