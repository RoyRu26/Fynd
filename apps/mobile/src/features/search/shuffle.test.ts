import { describe, expect, it } from 'vitest';

import { shuffleWithSeed } from '@/features/search/shuffle';

const items = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('shuffleWithSeed', () => {
  it('returns the same order for the same seed', () => {
    expect(shuffleWithSeed(items(20), 7)).toEqual(shuffleWithSeed(items(20), 7));
  });

  // Without determinism the collage would reorder on every unrelated
  // re-render, reading as a glitch rather than as the user's own action.
  it('is stable across repeated calls, not just equal once', () => {
    const source = items(30);
    const first = shuffleWithSeed(source, 42);
    for (let i = 0; i < 5; i += 1) {
      expect(shuffleWithSeed(source, 42)).toEqual(first);
    }
  });

  it('gives different orders for different seeds', () => {
    expect(shuffleWithSeed(items(30), 1)).not.toEqual(shuffleWithSeed(items(30), 2));
  });

  it('treats seed 0 as "not shuffled"', () => {
    expect(shuffleWithSeed(items(10), 0)).toEqual(items(10));
  });

  it('keeps every element exactly once — nothing lost or duplicated', () => {
    const shuffled = shuffleWithSeed(items(50), 99);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items(50));
  });

  it('does not mutate its input', () => {
    const source = items(10);
    shuffleWithSeed(source, 5);
    expect(source).toEqual(items(10));
  });

  it('handles empty and single-item lists', () => {
    expect(shuffleWithSeed([], 3)).toEqual([]);
    expect(shuffleWithSeed(['only'], 3)).toEqual(['only']);
  });

  it('actually reorders a reasonable list rather than returning it unchanged', () => {
    expect(shuffleWithSeed(items(40), 13)).not.toEqual(items(40));
  });

  // Fisher-Yates reaches every permutation; a biased shuffle tends to leave
  // elements near where they started. Over many seeds the first element
  // should land in many different positions.
  it('moves elements widely across seeds, not just locally', () => {
    const positions = new Set<number>();
    for (let seed = 1; seed <= 40; seed += 1) {
      positions.add(shuffleWithSeed(items(20), seed).indexOf(0));
    }
    expect(positions.size).toBeGreaterThan(8);
  });
});
