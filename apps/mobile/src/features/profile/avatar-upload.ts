import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { uploadAvatarObject } from '@/features/profile/api';
import {
  AVATAR_COMPRESS_QUALITY,
  AVATAR_MAX_EDGE_PX,
  buildAvatarPath,
  createImageId,
} from '@/features/profile/avatar-paths';
import { resizeTargetForLongestEdge } from '@/features/listings/paths';

/**
 * Client-side avatar preparation and upload.
 *
 * This is the only module in the feature that touches native APIs, which is
 * why every arithmetic decision it makes lives in avatar-paths.ts instead —
 * same split as listings/images.ts for the same reason.
 */

export type PreparedAvatar = {
  uri: string;
  width: number;
  height: number;
};

/**
 * Resizes to at most `AVATAR_MAX_EDGE_PX` on the longest edge and re-encodes
 * as JPEG (the bucket only accepts `image/jpeg`).
 *
 * Uses the contextual ImageManipulator API, same as
 * listings/images.ts's `prepareListingImage` — `manipulateAsync` is
 * deprecated in SDK 57. The source is rendered once first because the
 * resize needs real dimensions and the caller only has a URI; that
 * reference is then reused for the resize, so the image is decoded once,
 * not twice.
 */
export async function prepareAvatarImage(sourceUri: string): Promise<PreparedAvatar> {
  const source = await ImageManipulator.manipulate(sourceUri).renderAsync();
  const target = resizeTargetForLongestEdge(source.width, source.height, AVATAR_MAX_EDGE_PX);

  const rendered = target
    ? await ImageManipulator.manipulate(source).resize(target).renderAsync()
    : source;

  const result = await rendered.saveAsync({
    compress: AVATAR_COMPRESS_QUALITY,
    format: SaveFormat.JPEG,
  });

  return { uri: result.uri, width: result.width, height: result.height };
}

/**
 * Reads a local file as bytes. Same approach as listings/images.ts's
 * `readFileBytes` — SDK 57's `File` exposes `arrayBuffer()` directly, so
 * there is no base64 round trip.
 */
export async function readAvatarFileBytes(uri: string): Promise<ArrayBuffer> {
  return new File(uri).arrayBuffer();
}

/**
 * The full prepare -> upload pipeline. Deliberately does NOT update
 * `profiles.avatar_path` itself — that is the mutation hook's job
 * (`useUpdateAvatar` in queries.ts), mirroring `uploadAndAttachListingImage`
 * / `attachListingImage`'s separation of "upload the object" from "commit
 * the reference." Returns the new storage path so the caller can commit it
 * and, on success, clean up whatever the old path was.
 */
export async function uploadAvatar(params: { userId: string; sourceUri: string }): Promise<string> {
  const { userId, sourceUri } = params;

  const prepared = await prepareAvatarImage(sourceUri);
  const storagePath = buildAvatarPath(userId, createImageId());
  const bytes = await readAvatarFileBytes(prepared.uri);

  await uploadAvatarObject(storagePath, bytes);

  return storagePath;
}
