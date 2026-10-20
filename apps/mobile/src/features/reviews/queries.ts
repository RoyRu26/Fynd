import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchSellerReviewSummary, fetchSellerReviewsPage, submitReview } from '@/features/reviews/api';
import { deriveNextSellerReviewsOffset } from '@/features/reviews/reviews';
import { inboxKeys } from '@/features/inbox/queries';

/**
 * Mirrors `SELLER_LISTINGS_PAGE_SIZE`/`FOLLOW_LIST_PAGE_SIZE`'s identical
 * reasoning: large enough that most sellers' review lists never page at
 * all, small enough that a heavily-reviewed seller's list isn't chatty.
 */
export const SELLER_REVIEWS_PAGE_SIZE = 20;

export const reviewKeys = {
  summary: (sellerId: string) => ['reviews', sellerId, 'summary'] as const,
  list: (sellerId: string) => ['reviews', sellerId, 'list'] as const,
};

export function useSellerReviewSummary(sellerId: string) {
  return useQuery({
    queryKey: reviewKeys.summary(sellerId),
    queryFn: () => fetchSellerReviewSummary(sellerId),
  });
}

/**
 * A paginated page of `sellerId`'s reviews. Mirrors `useSellerListings`'s
 * exact shape: offset page params, `getNextPageParam` via the shared
 * offset-deriver.
 */
export function useSellerReviews(sellerId: string) {
  return useInfiniteQuery({
    queryKey: reviewKeys.list(sellerId),
    queryFn: ({ pageParam }: { pageParam: number }) =>
      fetchSellerReviewsPage({ sellerId, limit: SELLER_REVIEWS_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      deriveNextSellerReviewsOffset(lastPageParam, lastPage, SELLER_REVIEWS_PAGE_SIZE),
  });
}

type SubmitReviewVariables = {
  listingId: string;
  rating: number;
  comment?: string;
  /**
   * NOT sent to the server -- `submit_review` derives the reviewee itself
   * from the sale's own listing row (see api.ts's doc comment). This is
   * carried only so `onSuccess` below knows which seller's cached summary
   * and list to invalidate, without this hook needing to re-fetch
   * `conversation_detail` just to learn whose cache to touch.
   */
  revieweeId: string;
};

/**
 * Submits a review as the signed-in user. `conversationId` is the thread
 * this submission was opened from -- its own `conversation_detail` cache
 * entry is invalidated on success too, so the thread's "Leave a review"
 * CTA (driven by that RPC's `can_review` column) disappears on its own
 * once the invalidated query refetches, with no manual UI state to flip.
 */
export function useSubmitReview(conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ listingId, rating, comment }: SubmitReviewVariables) =>
      submitReview({ listingId, rating, comment }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: reviewKeys.summary(variables.revieweeId) });
      queryClient.invalidateQueries({ queryKey: reviewKeys.list(variables.revieweeId) });
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(conversationId) });
    },
  });
}
