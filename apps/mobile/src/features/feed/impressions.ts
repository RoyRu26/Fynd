import type { FeedListing } from '@/features/feed/pagination';

/**
 * Pure impression-tracking logic for the Home feed: per-session dedupe, a
 * feed session token, absolute feed position, and the state machine that
 * makes a failed send retryable while a successful one stays permanently
 * suppressed.
 *
 * No react-native or `@/lib/supabase` import, so this is directly
 * unit-testable — see pagination.ts's header for why that split matters
 * here specifically. The `FeedListing` import above is type-only and is
 * erased at compile time, so it cannot reintroduce that problem.
 */

/**
 * Flattens paginated feed pages into the single ordered list a FlatList
 * actually renders. The array index into the RESULT is already the
 * zero-based absolute feed position that `record_listing_impression`'s
 * `feed_position` expects — item 0 of page 2 (after a 10-item page 1) lands
 * at index 10, not 0. Nothing further needs to be computed once this is
 * called; do not recompute a position from a per-page index.
 */
export function flattenFeedPages(pages: FeedListing[][]): FeedListing[] {
  return pages.flat();
}

// ============================================================
// Feed session token
// ============================================================
// One opaque token per app process, not a security/auth boundary — purely
// a grouping key for the server's impression-dedupe unique index
// (user_id, listing_id, session_id). Switching tabs (Home -> Sell -> Home)
// must NOT create a new one, since NativeTabs keeps screens mounted rather
// than remounting them on every focus; a genuine app relaunch runs this
// module fresh and correctly starts a new session, because the cache below
// is plain module-scope state.

const SESSION_TOKEN_RANDOM_LENGTH = 10;

/**
 * Exported for its own shape/length test, independent of the process-life
 * caching `getFeedSessionId` adds on top. Mirrors `listings/paths.ts`'s
 * `createImageId` approach rather than importing it: uniqueness is all
 * that's required here too, not unguessability, but a session token and an
 * image filename are different enough concerns that duplicating six lines
 * beats an odd cross-feature import for it. Deliberately not `expo-crypto`
 * — the fallback keeps this dependency-free, matching that same decision.
 */
export function createOpaqueToken(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  const time = Date.now().toString(36);
  const random = Math.random()
    .toString(36)
    .slice(2, 2 + SESSION_TOKEN_RANDOM_LENGTH)
    .padEnd(SESSION_TOKEN_RANDOM_LENGTH, '0');
  return `${time}-${random}`;
}

let cachedSessionId: string | null = null;

/** The current feed session's token, created lazily on first access. */
export function getFeedSessionId(): string {
  if (cachedSessionId === null) {
    cachedSessionId = createOpaqueToken();
  }
  return cachedSessionId;
}

// ============================================================
// Impression dedupe / retry state
// ============================================================
// Two sets, not one, is what makes both halves of the requirement true at
// once:
//
//   * `pending` — an impression currently in flight. Checking it in
//     `selectNewlyViewableImpressions` is what stops a second
//     viewability-changed event from firing a concurrent duplicate send for
//     the same listing while the first request is still in the air.
//   * `confirmed` — an impression the RPC has actually acknowledged.
//     Permanent for the session: this is the client-side dedupe
//     optimization, never the source of truth (the server's partial unique
//     index is).
//
// A failed send is removed from `pending` and never added to `confirmed`
// — so it becomes eligible again the next time the listing is viewable,
// which is the entire retry mechanism. There is no separate "failed" set:
// "not pending and not confirmed" already means "eligible."

export type ImpressionTrackerState = {
  confirmed: ReadonlySet<string>;
  pending: ReadonlySet<string>;
};

export const EMPTY_IMPRESSION_TRACKER: ImpressionTrackerState = {
  confirmed: new Set(),
  pending: new Set(),
};

/**
 * From the listings currently meeting the viewability threshold, the subset
 * that genuinely need a new impression sent — i.e. neither already
 * confirmed this session nor already in flight.
 */
export function selectNewlyViewableImpressions(
  viewableListingIds: string[],
  state: ImpressionTrackerState,
): string[] {
  return viewableListingIds.filter(
    (id) => !state.confirmed.has(id) && !state.pending.has(id),
  );
}

/**
 * Marks listings as in-flight. Call this synchronously, before starting the
 * actual RPC calls — that is what closes the window a concurrent duplicate
 * send could otherwise fire through (a second viewability event arriving
 * while the first send for the same listing is still pending).
 */
export function markImpressionsPending(
  state: ImpressionTrackerState,
  listingIds: string[],
): ImpressionTrackerState {
  if (listingIds.length === 0) {
    return state;
  }
  const pending = new Set(state.pending);
  for (const id of listingIds) {
    pending.add(id);
  }
  return { ...state, pending };
}

/** The RPC acknowledged this impression: move it from pending to permanently confirmed. */
export function markImpressionConfirmed(
  state: ImpressionTrackerState,
  listingId: string,
): ImpressionTrackerState {
  const pending = new Set(state.pending);
  pending.delete(listingId);
  const confirmed = new Set(state.confirmed);
  confirmed.add(listingId);
  return { pending, confirmed };
}

/**
 * The RPC call failed: clear the pending mark WITHOUT confirming it, so the
 * listing is eligible again next time `selectNewlyViewableImpressions` sees
 * it. This is deliberately the only path back to "eligible" — a failure is
 * never silently treated as a permanent success.
 */
export function markImpressionFailed(
  state: ImpressionTrackerState,
  listingId: string,
): ImpressionTrackerState {
  const pending = new Set(state.pending);
  pending.delete(listingId);
  return { ...state, pending };
}
