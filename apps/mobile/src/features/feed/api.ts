import { Image } from 'expo-image';

import { createListingImageUrls } from '@/features/listings/api';
import { createAvatarUrls } from '@/features/profile/api';
import { supabase } from '@/lib/supabase';
import {
  associateAvatarUrls,
  associateCoverUrls,
  normalizeFeedRow,
  type FeedCursor,
  type FeedListing,
} from '@/features/feed/pagination';

export type { FeedCursor, FeedListing } from '@/features/feed/pagination';

/**
 * Database access for the Home discovery feed.
 *
 * The privilege model this layer respects, enforced server-side:
 *
 *   * `feed_listings` is `SECURITY INVOKER` — it only ever returns rows RLS
 *     already lets the caller see, as a second, independent guarantee that
 *     a draft can never leak through it.
 *   * Cover images come back as a `storage_path`, never a public URL — the
 *     bucket is private, so rendering one requires a signed URL, scoped by
 *     the Storage SELECT policy to the caller's own objects plus objects
 *     actually attached to an active listing.
 *   * `record_listing_impression` (events.ts) is the only writer of
 *     `listing_events`; there is no direct client INSERT privilege on it.
 */

/**
 * One feed page: the `feed_listings` RPC, then exactly one batched
 * signed-URL request covering every cover photo in the page. Never N+1 — a
 * page of 10 listings costs 2 network round trips, not 11.
 */
export async function fetchFeedPage(params: {
  limit: number;
  cursor: FeedCursor;
  includeOwn: boolean;
  followingOnly: boolean;
}): Promise<FeedListing[]> {
  const { limit, cursor, includeOwn, followingOnly } = params;

  const { data, error } = await supabase.rpc('feed_listings', {
    p_limit: limit,
    p_cursor_created_at: cursor?.createdAt,
    p_cursor_id: cursor?.id,
    p_include_own: includeOwn,
    p_following_only: followingOnly,
  });
  if (error) throw error;

  const rows = data.map(normalizeFeedRow);
  if (rows.length === 0) {
    return [];
  }

  // Deduped: many cards on a page can share the same seller (and therefore
  // the same avatar path), so signing the same path twice would be wasted
  // work, not a correctness issue — same dedup discipline as the inbox
  // page's own avatar resolution.
  const avatarPaths = Array.from(
    new Set(rows.map((row) => row.sellerAvatarPath).filter((path): path is string => path !== null)),
  );

  const [coverUrlsByPath, avatarUrlsByPath] = await Promise.all([
    createListingImageUrls(rows.map((row) => row.coverStoragePath)),
    createAvatarUrls(avatarPaths),
  ]);

  const withCovers = associateCoverUrls(rows, coverUrlsByPath);
  return associateAvatarUrls(withCovers, avatarUrlsByPath);
}

/**
 * Warms expo-image's cache for a set of already-resolved cover URLs.
 *
 * Takes URLs, not storage paths or listings: deciding WHICH upcoming cards
 * are worth prefetching is a rendering-position decision (how many pages
 * ahead, how close to the viewport) that belongs to the screen, not this
 * data layer. Deliberately not wired into `fetchFeedPage` or `useFeed` —
 * prefetching every page the instant it loads would couple networking to
 * data-fetching rather than to what the user is actually about to scroll
 * to. Phase 3 calls this explicitly for whichever upcoming covers it
 * decides are worth warming.
 *
 * Best-effort: a prefetch failure must never surface anywhere or block
 * anything, since the same cover still loads normally, just uncached, the
 * moment its card actually scrolls into view.
 */
export async function prefetchFeedCoverImages(urls: string[]): Promise<void> {
  if (urls.length === 0) {
    return;
  }
  try {
    await Image.prefetch(urls, 'memory-disk');
  } catch {
    // Intentionally swallowed — see the doc comment above.
  }
}
