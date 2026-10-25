// Pure ordering logic for Explore's "Shuffle". No react-native and no
// `@/lib/supabase` import, so it is unit-testable.

/**
 * Deterministic pseudo-random source (mulberry32).
 *
 * Seeded rather than `Math.random()` so a given seed always produces the same
 * order. That is what makes the shuffle stable across re-renders — with
 * `Math.random()` the collage would reshuffle itself on every state change,
 * which reads as the screen glitching rather than as the user's own action.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns a shuffled copy, ordered by `seed`.
 *
 * Fisher-Yates, so every permutation is equally likely — the naive
 * `sort(() => Math.random() - 0.5)` is biased and, worse, feeds an
 * inconsistent comparator to a sort, which is undefined behaviour.
 *
 * **Scope worth being honest about:** this reorders what the client has
 * ALREADY loaded, not the catalogue. `search_listings` sorts by `newest` or
 * `price` and paginates on a keyset cursor, so there is no server-side random
 * order to page through; shuffling server-side would need a seeded ordering in
 * the RPC. A user who shuffles and keeps scrolling therefore gets newly
 * appended pages in their natural order until the next shuffle.
 *
 * Seed `0` is the identity case: callers use it to mean "not shuffled".
 */
export function shuffleWithSeed<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];
  if (seed === 0 || result.length < 2) {
    return result;
  }

  const random = createRandom(seed);
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}
