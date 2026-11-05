import type { Database } from '@/types/database';

/**
 * Pure reviews-feature logic: RPC/row normalization, reviewer-profile
 * association, display fallbacks, and offset derivation.
 *
 * No react-native or `@/lib/supabase` import of any kind -- same split as
 * `follows/follows.ts`/`inbox/inbox.ts`/`listings/sold-buyer.ts`, and for
 * the identical reason (`@/lib/supabase` transitively pulls in
 * react-native's own Flow-syntax source the Vitest transform cannot parse).
 * Keeping this logic here, separate from `api.ts`, is what makes it
 * directly unit-testable.
 */

// ============================================================
// seller_review_summary
// ============================================================

/** The generated `seller_review_summary` RPC row shape, aliased for readability. */
export type SellerReviewSummaryRpcRow =
  Database['public']['Functions']['seller_review_summary']['Returns'][number];

export type SellerReviewSummary = {
  averageRating: number;
  reviewCount: number;
};

/**
 * Row -> domain. `seller_review_summary` is a non-grouped aggregate
 * (`avg`/`count` with no `group by`), which PostgreSQL always returns
 * exactly one row for, even over zero matching source rows (`coalesce(avg(
 * ...), 0)` is what keeps that row's `average_rating` from coming back
 * `null` for a seller with no reviews yet). `row` being undefined is
 * therefore not expected from the current RPC contract -- the `0/0`
 * fallback here is a defensive guard only, kept in case a future version
 * of the RPC starts returning an empty result set, mirroring
 * `fetchConversationDetail`'s identical defensive-null discipline for
 * `conversation_detail`.
 */
export function normalizeSellerReviewSummaryRow(row: SellerReviewSummaryRpcRow | undefined): SellerReviewSummary {
  if (!row) {
    return { averageRating: 0, reviewCount: 0 };
  }
  return {
    averageRating: row.average_rating,
    reviewCount: row.review_count,
  };
}

/**
 * The profile-header summary line: "No reviews yet" when there are none
 * (an average of exactly 0 is otherwise indistinguishable from a genuinely
 * terrible 0-star average, which can never actually occur -- `rating` is
 * CHECKed to 1-5 -- so 0 unambiguously means "no reviews" and is read that
 * way here), else the average to one decimal place with the count
 * alongside it, e.g. "4.8 (12)".
 */
export function formatAverageRatingLabel(averageRating: number, reviewCount: number): string {
  if (reviewCount === 0) {
    return 'No reviews yet';
  }
  return `${averageRating.toFixed(1)} (${reviewCount})`;
}

// ============================================================
// A seller's reviews list (reviews where `reviewee_id` is this seller)
// ============================================================

/** The `reviews` table columns this feature selects directly -- not an RPC row, see api.ts. */
export type SellerReviewRow = {
  id: number;
  listing_id: string;
  reviewer_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
};

export type NormalizedSellerReview = {
  reviewId: number;
  listingId: string;
  reviewerId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
};

export function normalizeSellerReviewRow(row: SellerReviewRow): NormalizedSellerReview {
  return {
    reviewId: row.id,
    listingId: row.listing_id,
    reviewerId: row.reviewer_id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

/** The `profiles` row shape batch-fetched for a page of reviewers -- same shape as `FollowListProfileRow`. */
export type ReviewerProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_path: string | null;
};

export type ReviewerProfile = {
  displayName: string | null;
  username: string | null;
  avatarPath: string | null;
};

export type SellerReviewWithReviewer = NormalizedSellerReview & { reviewer: ReviewerProfile };
export type SellerReview = NormalizedSellerReview & { reviewer: ReviewerProfile & { avatarUrl: string | null } };

/**
 * Attaches each review's reviewer profile, looked up by `reviewerId`.
 *
 * Deliberately a lookup, not a re-walk of `reorderFollowListRows`'s own
 * "reconstruct the list's order from the id array" shape: in `follows`,
 * the PROFILES ARE the list being paginated, so their order has to be
 * rebuilt from the original `follows` page's id order (`.in()` returns no
 * guaranteed order). Here, the list being paginated is `reviews` itself --
 * already correctly ordered by the `reviews` query in api.ts -- and
 * `profiles` is purely per-row ENRICHMENT data, attached by id, never
 * reordering anything. A `Map` lookup is the correct tool for enrichment;
 * reusing `reorderFollowListRows`'s reconstruct-the-order logic here would
 * solve a problem this call site doesn't have.
 *
 * A reviewer id with no matching profile row (a deleted account --
 * `reviews.reviewer_id` is `on delete cascade`, so in practice this should
 * never happen, but the lookup is null-tolerant rather than throwing) falls
 * back to nulls, which `resolveReviewerName` already turns into "Fynd
 * user".
 */
export function associateReviewerProfiles(
  reviews: NormalizedSellerReview[],
  profileRows: ReviewerProfileRow[],
): SellerReviewWithReviewer[] {
  const profilesById = new Map(profileRows.map((row) => [row.id, row]));
  return reviews.map((review) => {
    const profile = profilesById.get(review.reviewerId);
    return {
      ...review,
      reviewer: {
        displayName: profile?.display_name ?? null,
        username: profile?.username ?? null,
        avatarPath: profile?.avatar_path ?? null,
      },
    };
  });
}

/**
 * Attaches each reviewer's resolved avatar URL. Null-tolerant, never
 * throw-on-missing -- same contract as `associateFollowListAvatarUrls`/
 * `associateSoldBuyerAvatarUrls`: a missing avatar is a legitimate
 * permanent state, not an invariant violation.
 */
export function associateSellerReviewAvatarUrls(
  reviews: SellerReviewWithReviewer[],
  urlsByPath: Record<string, string>,
): SellerReview[] {
  return reviews.map((review) => ({
    ...review,
    reviewer: {
      ...review.reviewer,
      avatarUrl: review.reviewer.avatarPath ? urlsByPath[review.reviewer.avatarPath] ?? null : null,
    },
  }));
}

/**
 * The review row's reviewer name, falling back through the same chain as
 * every other profile rendering in this app (display name, then username,
 * then "Fynd user") -- mirrors `resolveSoldBuyerName`/`resolveOtherPartyName`
 * exactly, reusing the identical fallback string for consistency rather
 * than inventing a fourth variant of the same chain.
 */
export function resolveReviewerName(reviewer: { displayName: string | null; username: string | null }): string {
  return reviewer.displayName ?? reviewer.username ?? 'Fynd user';
}

export type SellerReviewsPage = {
  reviews: SellerReview[];
  totalCount: number;
};

/**
 * The next page's offset, or `null` when there is no next page. Copies
 * `deriveNextSellerListingsOffset`/`deriveNextFollowListOffset`'s identical
 * logic: offset-based, not a keyset cursor -- a single seller's reviews are
 * far smaller and far less concurrently-written than the global feed, so
 * the simpler mechanism is right-sized here too.
 */
export function deriveNextSellerReviewsOffset(
  currentOffset: number,
  page: SellerReviewsPage,
  pageSize: number,
): number | null {
  const nextOffset = currentOffset + page.reviews.length;
  if (page.reviews.length < pageSize || nextOffset >= page.totalCount) {
    return null;
  }
  return nextOffset;
}

// ============================================================
// Relative review age -- the review row's date line.
// ============================================================
// No existing relative-time formatter anywhere in this codebase to mirror
// (message-bubble.tsx shows no timestamp at all -- DESIGN.md has no chat
// visual spec yet, see that component's own header) -- this is the first.
// Deliberately NOT `Intl`/`toLocaleDateString`-based: that output depends
// on the host's locale/ICU data, which differs between this Vitest/Node
// test environment and Hermes at runtime, making it an unreliable thing to
// assert on in a unit test. Plain millisecond-bucket arithmetic is fully
// deterministic and injectable (`now`), at the cost of no localization --
// an acceptable trade for a short, low-stakes "how long ago" label.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const YEAR_WEEKS = 52;

/**
 * A short "how long ago" label for a review's `createdAt`. `now` defaults
 * to the real current time but is an explicit parameter so this stays a
 * pure function of its inputs for testing, the same reason `isOtherReasonMissingNote`-
 * style validators in this codebase take every input explicitly rather than
 * reaching for an ambient clock.
 */
export function formatReviewAge(createdAt: string, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - new Date(createdAt).getTime());

  if (elapsed < MINUTE_MS) return 'Just now';
  if (elapsed < HOUR_MS) {
    const minutes = Math.floor(elapsed / MINUTE_MS);
    return `${minutes}m ago`;
  }
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS);
    return `${hours}h ago`;
  }
  if (elapsed < WEEK_MS) {
    const days = Math.floor(elapsed / DAY_MS);
    return `${days}d ago`;
  }
  const weeks = Math.floor(elapsed / WEEK_MS);
  if (weeks < YEAR_WEEKS) {
    return `${weeks}w ago`;
  }
  const years = Math.floor(weeks / YEAR_WEEKS);
  return `${years}y ago`;
}
