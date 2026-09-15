import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  attachListingImage,
  createDraft,
  deleteDraft,
  fetchListing,
  fetchListingImages,
  fetchMyListings,
  publishListing,
  removeListingImage,
  reorderListingImages,
  updateDraft,
  type ListingImageRow,
} from '@/features/listings/api';
import { uploadAndAttachListingImage } from '@/features/listings/images';
import type { DraftListingInput } from '@/features/listings/schemas';

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
