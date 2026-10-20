// Pure logic for StarRating -- no runtime react-native import, so this can
// be imported directly by star-rating.tsx and star-rating-state.test.ts.
// Mirrors chip.tsx/chip-state.ts's split: UI state logic lives here, the
// component only renders it (CLAUDE.md's "UI state logic lives in
// `*-state.ts` with tests").

/** One star position's visual fill. Shape (filled/half-filled/outline icon), never color alone, is what carries this (DESIGN.md §4/§12.4). */
export type StarFill = 'filled' | 'half' | 'empty';

export const STAR_COUNT = 5;

/**
 * Which fill the star at `index` (0-based, 0..4) should render for a given
 * `value` on a 0-5 scale. `value` can be fractional -- rendering a seller's
 * average rating (e.g. 4.3) as filled/half/empty stars is the whole reason
 * this is its own function rather than a simple `index < value` check: a
 * half-filled star only ever appears for the ONE position where `value`
 * lands between two whole stars, never for an interactive pick (`value` is
 * always a whole 1-5 integer there, so `remaining` is always either >= 1 or
 * <= 0 for every position, and 'half' is simply never reached).
 *
 * `value` is clamped to [0, 5] first -- defensive against a caller passing
 * an out-of-range average (this module has no way to enforce the server's
 * own 1-5 CHECK constraint, and a seller with zero reviews has
 * `average_rating = 0`, which must render as five empty stars, not throw).
 */
export function starFillForIndex(value: number, index: number): StarFill {
  const clamped = Math.max(0, Math.min(STAR_COUNT, value));
  const remaining = clamped - index;
  if (remaining >= 1) return 'filled';
  if (remaining >= 0.5) return 'half';
  return 'empty';
}

/** The rating an interactive tap on the star at `index` (0-based) sets -- stars are 1-indexed to the viewer, the array is not. */
export function ratingForStarIndex(index: number): number {
  return index + 1;
}
