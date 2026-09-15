/**
 * Storage path construction and image-preparation arithmetic.
 *
 * Kept free of native module imports so it stays unit-testable: the code that
 * actually touches expo-image-manipulator / expo-file-system lives in
 * images.ts and delegates every decision here.
 */

export const LISTING_IMAGES_BUCKET = 'listing-images';

/**
 * Advisory only. `attach_listing_image` enforces the real cap server-side and
 * is the sole authority; this exists so the UI can disable the picker before
 * the user hits a rejection.
 */
export const MAX_LISTING_PHOTOS = 10;

/** DESIGN.md §11.3 — longest edge after resize. */
export const MAX_IMAGE_EDGE_PX = 1600;

/** JPEG quality, 0-1. */
export const IMAGE_COMPRESS_QUALITY = 0.8;

export const LISTING_IMAGE_CONTENT_TYPE = 'image/jpeg';

/**
 * Builds `{seller_id}/{listing_id}/{image_id}.jpg`.
 *
 * Both write policies on storage.objects read this layout directly: segment 1
 * must equal `auth.uid()`, and segment 2 must name a live owned draft.
 * `attach_listing_image` re-checks the same prefix. A segment containing a
 * slash would silently shift every later segment, so it is rejected outright.
 */
export function buildListingImagePath(
  sellerId: string,
  listingId: string,
  imageId: string,
): string {
  for (const segment of [sellerId, listingId, imageId]) {
    if (segment.length === 0 || segment.includes('/')) {
      throw new Error('Listing image path segments must be non-empty and slash-free');
    }
  }
  return `${sellerId}/${listingId}/${imageId}.jpg`;
}

/**
 * The resize to apply so the longest edge is at most `maxEdge`, or `null` when
 * the image is already small enough and should be re-encoded untouched.
 *
 * Exactly one dimension is returned; expo-image-manipulator derives the other
 * from the aspect ratio, which avoids rounding the two independently and
 * distorting the image.
 */
export function resizeTargetForLongestEdge(
  width: number,
  height: number,
  maxEdge: number = MAX_IMAGE_EDGE_PX,
): { width: number } | { height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  if (Math.max(width, height) <= maxEdge) {
    return null;
  }
  return width >= height ? { width: maxEdge } : { height: maxEdge };
}

/**
 * An id for the filename segment.
 *
 * Uniqueness is all that is required here: the path is already scoped by uid
 * and listing id, read access is gated on segment 1, and the filename is never
 * a security boundary — so this does not need to be unguessable. Uses
 * `crypto.randomUUID` where the runtime provides it and otherwise falls back
 * to time plus randomness, rather than pulling in a UUID dependency.
 */
export function createImageId(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 12).padEnd(10, '0');
  return `${time}-${random}`;
}
