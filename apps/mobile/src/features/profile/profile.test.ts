import { describe, expect, it } from 'vitest';

import { formatClosetShareMessage, formatProfileSummaryLine, normalizeBio } from '@/features/profile/profile';

describe('normalizeBio', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeBio('  Selling gently loved clothes.  ')).toBe('Selling gently loved clothes.');
  });

  it('returns null for an empty string', () => {
    expect(normalizeBio('')).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(normalizeBio('   ')).toBeNull();
  });

  it('leaves an already-trimmed non-empty string unchanged', () => {
    expect(normalizeBio('Vintage finds only.')).toBe('Vintage finds only.');
  });
});

describe('formatProfileSummaryLine', () => {
  it('joins all three counts with the separator, pluralized', () => {
    expect(
      formatProfileSummaryLine({ listingCount: 24, followersCount: 318, followingCount: 96 }),
    ).toBe('24 listings · 318 followers · 96 following');
  });

  it('singularizes a count of exactly 1', () => {
    expect(formatProfileSummaryLine({ listingCount: 1, followersCount: 1, followingCount: 1 })).toBe(
      '1 listing · 1 follower · 1 following',
    );
  });

  it('omits a null count rather than printing it', () => {
    expect(
      formatProfileSummaryLine({ listingCount: 24, followersCount: null, followingCount: null }),
    ).toBe('24 listings');
  });

  it('returns null when every count is null, rather than an empty string', () => {
    expect(
      formatProfileSummaryLine({ listingCount: null, followersCount: null, followingCount: null }),
    ).toBeNull();
  });

  it('treats a genuine 0 differently from null -- still prints it', () => {
    expect(formatProfileSummaryLine({ listingCount: 0, followersCount: null, followingCount: null })).toBe(
      '0 listings',
    );
  });
});

describe('formatClosetShareMessage', () => {
  it('includes the name', () => {
    expect(formatClosetShareMessage('Noa Levi')).toBe("Check out Noa Levi's closet on Fynd!");
  });
});
