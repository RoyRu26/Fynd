import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import {
  attachListingImage,
  uploadListingImageObject,
  type ListingImageRow,
} from '@/features/listings/api';
import {
  buildListingImagePath,
  createImageId,
  IMAGE_COMPRESS_QUALITY,
  MAX_IMAGE_EDGE_PX,
  resizeTargetForLongestEdge,
} from '@/features/listings/paths';

/**
 * Client-side photo preparation and upload.
 *
 * This is the only module in the feature that touches native APIs, which is why
 * every decision it makes lives in paths.ts instead: the arithmetic is unit
 * tested there, and what remains here is orchestration.
 */

export type PreparedImage = {
  uri: string;
  width: number;
  height: number;
};

/**
 * Resizes to at most `MAX_IMAGE_EDGE_PX` on the longest edge and re-encodes as
 * JPEG (DESIGN.md §11.3 makes upload-time resizing mandatory, and the bucket
 * only accepts `image/jpeg`).
 *
 * Uses the contextual ImageManipulator API. The `manipulateAsync` function the
 * original plan assumed is deprecated in SDK 57.
 *
 * The source is rendered once first because the resize needs real dimensions
 * and the caller only has a URI. That reference is then reused for the resize,
 * so the image is decoded once, not twice.
 */
export async function prepareListingImage(sourceUri: string): Promise<PreparedImage> {
  const source = await ImageManipulator.manipulate(sourceUri).renderAsync();
  const target = resizeTargetForLongestEdge(source.width, source.height, MAX_IMAGE_EDGE_PX);

  const rendered = target
    ? await ImageManipulator.manipulate(source).resize(target).renderAsync()
    : source;

  const result = await rendered.saveAsync({
    compress: IMAGE_COMPRESS_QUALITY,
    format: SaveFormat.JPEG,
  });

  return { uri: result.uri, width: result.width, height: result.height };
}

/**
 * Reads a local file as bytes.
 *
 * SDK 57's `File` exposes `arrayBuffer()` directly, so there is no base64
 * round trip and no need for a decoding dependency. `supabase-js` accepts an
 * `ArrayBuffer` as an upload body.
 */
export async function readFileBytes(uri: string): Promise<ArrayBuffer> {
  return new File(uri).arrayBuffer();
}

/**
 * The full per-photo pipeline: prepare, upload, then attach.
 *
 * Attaching is deliberately last and deliberately not compensated. If it fails
 * after a successful upload, the object is left as an orphan rather than being
 * deleted — an orphan is invisible and cleanable, whereas rolling back would
 * risk the reverse (a row with no file). Retrying the whole pipeline is safe:
 * the path is freshly generated each time, and `attach_listing_image` returns
 * the existing row rather than duplicating if the same path is re-sent.
 */
export async function uploadAndAttachListingImage(params: {
  sellerId: string;
  listingId: string;
  sourceUri: string;
}): Promise<ListingImageRow> {
  const { sellerId, listingId, sourceUri } = params;

  const prepared = await prepareListingImage(sourceUri);
  const storagePath = buildListingImagePath(sellerId, listingId, createImageId());
  const bytes = await readFileBytes(prepared.uri);

  await uploadListingImageObject(storagePath, bytes);

  return attachListingImage(listingId, storagePath);
}
