import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  attachListingImage,
  createDraft,
  createListingImageUrls,
  deleteDraft,
  fetchListing,
  fetchListingImages,
  fetchMyListings,
  markListingActive,
  markListingReserved,
  markListingSold,
  publishListing,
  removeListing,
  removeListingImage,
  reorderListingImages,
  updateDraft,
  updateListingDetails,
  type ListingImageRow,
} from '@/features/listings/api';
import { suggestListingFromPhotos } from '@/features/listings/ai-suggestions';
import { uploadAndAttachListingImage } from '@/features/listings/images';
import type { DraftListingInput, PublishableListingInput } from '@/features/listings/schemas';
import { listingDetailKeys } from '@/features/listing-detail/queries';

export const listingKeys = {
  all: ['listings'] as const,
  mine: (sellerId: string | undefined) => [...listingKeys.all, 'mine', sellerId] as const,
  detail: (listingId: string | undefined) => [...listingKeys.all, 'detail', listingId] as const,
  images: (listingId: string | undefined) => [...listingKeys.all, 'images', listingId] as const,
};

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
 * ROADMAP 4.3 "Suggestions in the sell flow". Deliberately plain: no
 * `onSuccess` cache write and no query key of its own — the result only
 * ever seeds local form state in the draft editor (see
 * ai-suggestion-apply.ts) and is never persisted or cached.
 * `suggestListingFromPhotos` does not throw in normal operation (it maps
 * its own transport failures into an `{ok:false}` result), so callers
 * branch on `mutation.data?.ok` rather than `mutation.isError`.
 */
export function useSuggestListingFromPhotos() {
  return useMutation({
    mutationFn: (listingId: string) => suggestListingFromPhotos(listingId),
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
    mutationFn: (listingId: string) => markListingSold(listingId),
    onSuccess: (_listing, listingId) => {
      queryClient.invalidateQueries({ queryKey: listingKeys.detail(listingId) });
      queryClient.invalidateQueries({ queryKey: listingKeys.mine(sellerId) });
      queryClient.invalidateQueries({ queryKey: listingDetailKeys.byId(listingId) });
    },
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
