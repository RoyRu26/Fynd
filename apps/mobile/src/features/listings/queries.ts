import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { BrandSelection } from '@/features/brands/brands';
import {
  attachListingImage,
  createDraft,
  createListingImageUrls,
  deleteDraft,
  fetchAttributeVocabulary,
  fetchListing,
  fetchListingAttributes,
  fetchListingConversationBuyers,
  fetchListingCovers,
  fetchListingImages,
  fetchMyListings,
  markListingActive,
  markListingReserved,
  markListingSold,
  publishListing,
  removeListing,
  removeListingImage,
  reorderListingImages,
  setListingAttributes,
  updateDraft,
  updateListingDetails,
  type ListingImageRow,
} from '@/features/listings/api';
import {
  fetchLatestListingAnalysis,
  suggestListingFromPhotos,
  type ListingAnalysis,
} from '@/features/listings/ai-suggestions';
import { uploadAndAttachListingImage } from '@/features/listings/images';
import type { DraftListingInput, PublishableListingInput } from '@/features/listings/schemas';
import { listingDetailKeys } from '@/features/listing-detail/queries';

export const listingKeys = {
  all: ['listings'] as const,
  mine: (sellerId: string | undefined) => [...listingKeys.all, 'mine', sellerId] as const,
  detail: (listingId: string | undefined) => [...listingKeys.all, 'detail', listingId] as const,
  images: (listingId: string | undefined) => [...listingKeys.all, 'images', listingId] as const,
  covers: (listingIds: string[]) => [...listingKeys.all, 'covers', listingIds] as const,
  conversationBuyers: (listingId: string | undefined) =>
    [...listingKeys.all, 'conversationBuyers', listingId] as const,
  attributeVocabulary: () => [...listingKeys.all, 'attributeVocabulary'] as const,
  attributes: (listingId: string | undefined) => [...listingKeys.all, 'attributes', listingId] as const,
  aiAnalysis: (listingId: string | undefined) => [...listingKeys.all, 'aiAnalysis', listingId] as const,
};

// ============================================================
// Structured attributes (AI listing metadata plan, Phase 1a)
// ============================================================

/** Reference data, changed only by migrations — same 24h staleTime as categories. */
export function useAttributeVocabulary() {
  return useQuery({
    queryKey: listingKeys.attributeVocabulary(),
    queryFn: fetchAttributeVocabulary,
    staleTime: 24 * 60 * 60 * 1000,
  });
}

export function useListingAttributes(listingId: string | undefined) {
  return useQuery({
    queryKey: listingKeys.attributes(listingId),
    queryFn: () => fetchListingAttributes(listingId as string),
    enabled: !!listingId,
  });
}

export function useSetListingAttributes(listingId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { termIds: string[]; keywords: string[]; brand: BrandSelection }) => {
      if (!listingId) {
        throw new Error('Cannot save attributes without a listing id');
      }
      await setListingAttributes(listingId, input);
      // Re-read what the server actually stored: typed brand text may have
      // been resolved to a catalog brand.
      return fetchListingAttributes(listingId);
    },
    // Written into the cache before mutateAsync resolves: an editor mounting
    // right after (the draft -> published swap on Publish) must never see the
    // pre-save values.
    onSuccess: (saved) => {
      queryClient.setQueryData(listingKeys.attributes(listingId), saved);
    },
  });
}

// Images are keyed separately from the listing detail on purpose: photo churn
// during editing must not invalidate the detail query and reset form state
// mid-edit.

export function useMyListings(sellerId: string | undefined) {
  return useQuery({
    queryKey: listingKeys.mine(sellerId),
    queryFn: () => fetchMyListings(sellerId as string),
    enabled: !!sellerId,
  });
}

export function useListing(listingId: string | undefined) {
  return useQuery({
    queryKey: listingKeys.detail(listingId),
    queryFn: () => fetchListing(listingId as string),
    enabled: !!listingId,
  });
}

export function useListingImages(listingId: string | undefined) {
  return useQuery({
    queryKey: listingKeys.images(listingId),
    queryFn: () => fetchListingImages(listingId as string),
    enabled: !!listingId,
  });
}

/**
 * Signed URLs for a private-bucket listing's photos. Kept as its own hook
 * (rather than folded into `useListingImages`) so a listing with no photos
 * yet never fires a Storage call, and so the cache key can be exactly the
 * paths in view.
 */
export function useListingImageUrls(storagePaths: string[]) {
  return useQuery({
    queryKey: [...listingKeys.all, 'signedUrls', storagePaths],
    queryFn: () => createListingImageUrls(storagePaths),
    enabled: storagePaths.length > 0,
    // Signed URLs are minted for 1 hour (see createListingImageUrls); staying
    // well under that avoids ever rendering with one that expired mid-session.
    staleTime: 45 * 60 * 1000,
  });
}

/**
 * Cover photo URLs for the Sell tab's "your rack" strip (SCREENS.md Task 5),
 * keyed by listing id. Mirrors `useListingImageUrls`'s own staleTime
 * reasoning: signed URLs are minted for 1 hour, so 45 minutes keeps every
 * render well clear of one expiring mid-session.
 */
export function useListingCovers(listingIds: string[]) {
  return useQuery({
    queryKey: listingKeys.covers(listingIds),
    queryFn: () => fetchListingCovers(listingIds),
    enabled: listingIds.length > 0,
    staleTime: 45 * 60 * 1000,
  });
}

export function useCreateDraft(sellerId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!sellerId) {
        throw new Error('Cannot create a listing without a signed-in user');
      }
      return createDraft(sellerId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listingKeys.mine(sellerId) });
    },
  });
}

export function useUpdateDraft(listingId: string | undefined, sellerId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: DraftListingInput) => {
      if (!listingId) {
        throw new Error('Cannot update a listing without an id');
      }
      return updateDraft(listingId, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listingKeys.detail(listingId) });
      queryClient.invalidateQueries({ queryKey: listingKeys.mine(sellerId) });
    },
  });
}

export function useDeleteDraft(sellerId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (listingId: string) => deleteDraft(listingId),
    onSuccess: (_result, listingId) => {
      queryClient.removeQueries({ queryKey: listingKeys.detail(listingId) });
      queryClient.removeQueries({ queryKey: listingKeys.images(listingId) });
      queryClient.invalidateQueries({ queryKey: listingKeys.mine(sellerId) });
    },
  });
}

/**
 * The whole per-photo pipeline (prepare, upload, attach). The editor drives one
 * of these per selected photo so a single failure never blocks the others.
 */
export function useUploadListingImage(
  listingId: string | undefined,
  sellerId: string | undefined,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sourceUri: string) => {
      if (!listingId || !sellerId) {
        throw new Error('Cannot upload a photo without a listing and a signed-in user');
      }
      return uploadAndAttachListingImage({ sellerId, listingId, sourceUri });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listingKeys.images(listingId) });
    },
  });
}

/** Attaches an object that is already uploaded — the retry path for a failed attach. */
export function useAttachListingImage(listingId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (storagePath: string) => {
      if (!listingId) {
        throw new Error('Cannot attach a photo without a listing');
      }
      return attachListingImage(listingId, storagePath);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listingKeys.images(listingId) });
    },
  });
}

export function useRemoveListingImage(listingId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (image: Pick<ListingImageRow, 'id' | 'storage_path'>) =>
      removeListingImage(image),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listingKeys.images(listingId) });
    },
  });
}

export function useReorderListingImages(listingId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (imageIds: string[]) => {
      if (!listingId) {
        throw new Error('Cannot reorder photos without a listing');
      }
      return reorderListingImages(listingId, imageIds);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listingKeys.images(listingId) });
    },
  });
}

export function usePublishListing(sellerId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (listingId: string) => publishListing(listingId),
    onSuccess: (_listing, listingId) => {
      queryClient.invalidateQueries({ queryKey: listingKeys.detail(listingId) });
      queryClient.invalidateQueries({ queryKey: listingKeys.mine(sellerId) });
    },
  });
}

/**
 * AI listing metadata, Phase 2. Runs (or re-uses, from the server's cache) an
 * analysis of the draft's photos. `suggestListingFromPhotos` never throws —
 * it maps every failure into an `{ok:false}` result — so callers branch on
 * `result.ok`. A successful result also becomes the cached "latest
 * analysis", which is what restores suggestions when the draft reopens.
 */
export function useSuggestListingFromPhotos(listingId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!listingId) {
        throw new Error('Cannot analyze a listing without an id');
      }
      return suggestListingFromPhotos(listingId);
    },
    onSuccess: (result) => {
      if (result.ok) {
        const latest: ListingAnalysis = {
          analysisId: result.analysisId,
          imagePaths: result.imagePaths,
          suggestion: result.suggestion,
        };
        queryClient.setQueryData(listingKeys.aiAnalysis(listingId), latest);
      }
    },
  });
}

/**
 * The draft's latest succeeded analysis (owner-only via RLS). Read once when
 * the editor opens so suggestions survive closing the app; it never calls
 * the model. Kept fresh by useSuggestListingFromPhotos's cache write.
 */
export function useLatestListingAnalysis(listingId: string | undefined) {
  return useQuery({
    queryKey: listingKeys.aiAnalysis(listingId),
    queryFn: () => fetchLatestListingAnalysis(listingId as string),
    enabled: !!listingId,
    staleTime: Infinity,
  });
}

// ============================================================
// Post-publish lifecycle (ROADMAP 1.6 "Manage a listing")
// ============================================================
// Same invalidation shape as usePublishListing: the detail query and the
// seller's "mine" list both need to reflect the new status. Also invalidates
// listingDetailKeys.byId -- a separate cache namespace (features/listing-detail/
// queries.ts) that the listing-detail screen reads from, so it never shows a
// stale status/description if it's mounted for this same listing.

export function useMarkListingReserved(sellerId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (listingId: string) => markListingReserved(listingId),
    onSuccess: (_listing, listingId) => {
      queryClient.invalidateQueries({ queryKey: listingKeys.detail(listingId) });
      queryClient.invalidateQueries({ queryKey: listingKeys.mine(sellerId) });
      queryClient.invalidateQueries({ queryKey: listingDetailKeys.byId(listingId) });
    },
  });
}

export function useMarkListingActive(sellerId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (listingId: string) => markListingActive(listingId),
    onSuccess: (_listing, listingId) => {
      queryClient.invalidateQueries({ queryKey: listingKeys.detail(listingId) });
      queryClient.invalidateQueries({ queryKey: listingKeys.mine(sellerId) });
      queryClient.invalidateQueries({ queryKey: listingDetailKeys.byId(listingId) });
    },
  });
}

export function useMarkListingSold(sellerId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ listingId, buyerId }: { listingId: string; buyerId: string | null }) =>
      markListingSold(listingId, buyerId),
    onSuccess: (_listing, { listingId }) => {
      queryClient.invalidateQueries({ queryKey: listingKeys.detail(listingId) });
      queryClient.invalidateQueries({ queryKey: listingKeys.mine(sellerId) });
      queryClient.invalidateQueries({ queryKey: listingDetailKeys.byId(listingId) });
    },
  });
}

/**
 * ROADMAP 5.3: the candidate buyers for the "Mark as sold" picker --
 * everyone who messaged about this listing, most-recent-first. `enabled:
 * !!listingId` mirrors every other listing-scoped query in this file
 * (`useListing`, `useListingImages`).
 */
export function useListingConversationBuyers(listingId: string | undefined) {
  return useQuery({
    queryKey: listingKeys.conversationBuyers(listingId),
    queryFn: () => fetchListingConversationBuyers(listingId as string),
    enabled: !!listingId,
  });
}

export function useRemoveListing(sellerId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (listingId: string) => removeListing(listingId),
    onSuccess: (_listing, listingId) => {
      queryClient.invalidateQueries({ queryKey: listingKeys.detail(listingId) });
      queryClient.invalidateQueries({ queryKey: listingKeys.mine(sellerId) });
      queryClient.invalidateQueries({ queryKey: listingDetailKeys.byId(listingId) });
    },
  });
}

/** Mirrors useUpdateDraft's shape, for the active/reserved edit path. */
export function useUpdateListingDetails(listingId: string | undefined, sellerId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: PublishableListingInput) => {
      if (!listingId) {
        throw new Error('Cannot update a listing without an id');
      }
      return updateListingDetails(listingId, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listingKeys.detail(listingId) });
      queryClient.invalidateQueries({ queryKey: listingKeys.mine(sellerId) });
      if (listingId) {
        queryClient.invalidateQueries({ queryKey: listingDetailKeys.byId(listingId) });
      }
    },
  });
}
