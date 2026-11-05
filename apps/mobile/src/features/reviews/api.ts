import { createAvatarUrls } from '@/features/profile/api';
import {
  associateReviewerProfiles,
  associateSellerReviewAvatarUrls,
  normalizeSellerReviewRow,
  normalizeSellerReviewSummaryRow,
  type ReviewerProfileRow,
  type SellerReviewRow,
  type SellerReviewsPage,
  type SellerReviewSummary,
} from '@/features/reviews/reviews';
import { supabase } from '@/lib/supabase';

/**
 * Database access for the reviews feature (ROADMAP 5.4).
 *
 * The server-side shape this layer is written against
 * (`20261020113819_reviews.sql`):
 *
 *   * `submit_review` is the SOLE writer of `reviews` -- there is no client
 *     INSERT/UPDATE/DELETE grant on the table at all, so there is
 *     deliberately no `updateReview`/`deleteReview` here to call. It
 *     derives `reviewee_id` itself from the sale's own listing row; the
 *     client never sends one.
 *   * `reviews` is fully PUBLIC read (`using (true)`, granted to both
 *     `anon` and `authenticated`) -- unlike `reports`/`blocks`, so
 *     `fetchSellerReviewsPage` needs no auth to run.
 *   * `seller_review_summary` is SECURITY INVOKER -- there is no privilege
 *     boundary it needs to cross, since the table it reads is already
 *     fully public.
 */

export async function submitReview(params: { listingId: string; rating: number; comment?: string }): Promise<void> {
  const { listingId, rating, comment } = params;
  const trimmed = comment?.trim();

  const { error } = await supabase.rpc('submit_review', {
    p_listing_id: listingId,
    p_rating: rating,
    p_comment: trimmed ? trimmed : undefined,
  });
  if (error) throw error;
}

export async function fetchSellerReviewSummary(sellerId: string): Promise<SellerReviewSummary> {
  const { data, error } = await supabase.rpc('seller_review_summary', { p_seller_id: sellerId });
  if (error) throw error;

  return normalizeSellerReviewSummaryRow(data[0]);
}

/**
 * One page of `sellerId`'s reviews (as reviewee), newest first.
 *
 * Two small, explicit queries, not one clever embedded one -- same
 * reasoning as `follows/api.ts`'s `fetchFollowListPage`: `reviews.
 * reviewer_id` references `auth.users(id)`, not `public.profiles(id)`, so
 * there is no FK edge for PostgREST to embed across. Step 1 pages `reviews`
 * (ordered `created_at desc, id desc`, matching `reviews_reviewee_id_idx`);
 * step 2 batch-fetches the page's distinct reviewer ids from `profiles` via
 * `.in(...)` and attaches each by id (see `associateReviewerProfiles`'s own
 * doc comment for why this is a lookup, not a reorder -- the review order
 * already comes from step 1).
 */
export async function fetchSellerReviewsPage(params: {
  sellerId: string;
  limit: number;
  offset: number;
}): Promise<SellerReviewsPage> {
  const { sellerId, limit, offset } = params;

  const { data, error, count } = await supabase
    .from('reviews')
    .select('id, listing_id, reviewer_id, rating, comment, created_at', { count: 'exact' })
    .eq('reviewee_id', sellerId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  const normalized = (data as SellerReviewRow[]).map(normalizeSellerReviewRow);
  if (normalized.length === 0) {
    return { reviews: [], totalCount: count ?? 0 };
  }

  // Deduped: several reviews on this page can share the same reviewer,
  // unlikely to be common in practice (one review per sale) but cheap to
  // guard regardless.
  const reviewerIds = Array.from(new Set(normalized.map((row) => row.reviewerId)));
  const { data: profileRows, error: profilesError } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_path')
    .in('id', reviewerIds);
  if (profilesError) throw profilesError;

  const withReviewers = associateReviewerProfiles(normalized, profileRows as ReviewerProfileRow[]);

  const avatarPaths = Array.from(
    new Set(withReviewers.flatMap((row) => (row.reviewer.avatarPath ? [row.reviewer.avatarPath] : []))),
  );
  const urlsByPath = await createAvatarUrls(avatarPaths);

  const reviews = associateSellerReviewAvatarUrls(withReviewers, urlsByPath);
  return { reviews, totalCount: count ?? reviews.length };
}
