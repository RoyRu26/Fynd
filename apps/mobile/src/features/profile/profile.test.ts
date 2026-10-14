import { describe, expect, it } from 'vitest';

import { normalizeBio } from '@/features/profile/profile';

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
