// Listing recency, as pure data. No react-native and no `@/lib/supabase`
// import, so the feed card's "Just dropped" rule is unit-testable on its own.

/**
 * How long after listing a row still counts as "just dropped".
 *
 * 48h, not 24h and not a week. 24h punishes evening listers — list at 11pm and
 * the flag expires before most of the audience is awake the following evening.
 * A week means that on a marketplace this young nearly every row carries it,
 * which destroys the signal: a flag that is always on is chrome, not
 * information. 48h is also computed on absolute milliseconds, so it needs no
 * calendar or DST reasoning the way "two days" would.
 *
 * Exported so the test pins the number rather than recomputing it — a silent
 * retune should fail CI, not pass as a diff nobody reads.
 */
export const JUST_DROPPED_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Whether a listing is recent enough for the feed card's "Just dropped" tag
 * (DESIGN.md §14.1 — the one derived recency flag the feed is allowed).
 *
 * `now` is an explicit, defaulted parameter rather than an internal
 * `Date.now()` call, matching `formatReviewAge`'s own signature — that is what
 * makes every case below deterministic without fake timers.
 *
 * Two behaviours fall out of this one line and are each locked by a test,
 * because the obvious tidy-ups break them silently:
 *
 *   * Clock skew. If the server's `created_at` is ahead of the device clock,
 *     `now - created` is negative; `Math.max(0, …)` clamps it to 0 so a
 *     listing never reads as OLD because a phone is slow. `Math.abs` looks
 *     equivalent and is not: it would measure the DISTANCE from now, so a
 *     timestamp far enough in the future would exceed the window and badge as
 *     old — the very case the clamp exists to prevent. The "wildly future"
 *     test is what pins this; a few minutes of skew passes either way.
 *   * Unparseable input. `new Date('nonsense').getTime()` is `NaN`;
 *     `Math.max(0, NaN)` is `NaN` (it propagates rather than returning the 0),
 *     and `NaN < WINDOW` is `false` — so garbage never badges. That
 *     propagation is the load-bearing step. Reordering to `WINDOW > elapsed`
 *     keeps the property, but flipping to `!(elapsed >= WINDOW)` would
 *     quietly badge every malformed timestamp.
 */
export function isJustDropped(createdAt: string, now: number = Date.now()): boolean {
  return Math.max(0, now - new Date(createdAt).getTime()) < JUST_DROPPED_WINDOW_MS;
}
