import { createImageId } from '@/features/listings/paths';

export { createImageId };

/**
 * Storage path construction for avatars.
 *
 * Kept free of native module imports so it stays unit-testable, same split
 * as listings/paths.ts for the same reason: avatar-upload.ts is the only
 * module here that touches native APIs, and it delegates every decision to
 * this file.
 */

export const AVATARS_BUCKET = 'avatars';

/** DESIGN.md §11.3-equivalent for avatars — longest edge after resize. */
export const AVATAR_MAX_EDGE_PX = 512;

/** JPEG quality, 0-1. */
export const AVATAR_COMPRESS_QUALITY = 0.8;

export const AVATAR_CONTENT_TYPE = 'image/jpeg';

/**
 * Builds `{user_id}/{image_id}.jpg`.
 *
 * Two segments, not three like listing images — an avatar has no parent
 * listing to scope against. Both write policies on storage.objects read
 * this layout directly: segment 1 must equal `auth.uid()`. A segment
 * containing a slash would silently shift the other segment, so it is
 * rejected outright — same discipline as `buildListingImagePath`.
 */
export function buildAvatarPath(userId: string, imageId: string): string {
  for (const segment of [userId, imageId]) {
    if (segment.length === 0 || segment.includes('/')) {
      throw new Error('Avatar path segments must be non-empty and slash-free');
    }
  }
  return `${userId}/${imageId}.jpg`;
}
