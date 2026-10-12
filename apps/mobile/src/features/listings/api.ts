import { LISTING_IMAGES_BUCKET, LISTING_IMAGE_CONTENT_TYPE } from '@/features/listings/paths';
import type { DraftListingInput } from '@/features/listings/schemas';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';

/**
 * Database access for listings.
 *
 * The privilege model this layer has to respect, all enforced server-side:
 *
 *   * `status` has no client INSERT or UPDATE privilege. It is only ever
 *     changed by `publish_listing`. Sending it — even its own default value —
 *     fails with 42501.
 *   * `currency` likewise has no client write privilege; it relies on the
 *     `'ILS'` column default.
 *   * `created_at`/`updated_at` are server-owned.
 *   * `seller_id` may be sent on INSERT but never on UPDATE.
 *   * `listing_images` has no client INSERT or UPDATE privilege at all.
 *     Attaching goes through `attach_listing_image`, reordering through
 *     `set_listing_image_order`. Only DELETE is direct, and RLS limits it to
 *     images on an owned draft.
 *
 * So the write paths below are shaped by what the database will actually
 * accept, not by convention.
 */

export type ListingRow = Tables<'listings'>;
export type ListingImageRow = Tables<'listing_images'>;

/**
 * Whether the best-effort Storage cleanup that follows a successful database
 * deletion actually succeeded.
 *
 * A failure here is never an error: the database row is already gone, which is
 * the part that matters. The leftover object is an orphan, which is both
 * invisible to the app and — by the Storage DELETE policy's `not exists`
 * branch — still removable by its owner later.
 */
export type StorageCleanup = { storageCleanupFailed: boolean };

function logCleanupFailure(context: string, error: unknown): void {
  if (__DEV__) {
    console.warn(`[listings] best-effort storage cleanup failed: ${context}`, error);
  }
}

// ============================================================
// Reads
// ============================================================

export async function fetchMyListings(sellerId: string): Promise<ListingRow[]> {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('seller_id', sellerId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function fetchListing(listingId: string): Promise<ListingRow> {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('id', listingId)
    .single();
  if (error) throw error;
  return data;
}

export async function fetchListingImages(listingId: string): Promise<ListingImageRow[]> {
  const { data, error } = await supabase
    .from('listing_images')
    .select('*')
    .eq('listing_id', listingId)
    .order('position', { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * The bucket is private, so rendering a photo needs a signed URL. Owner-
 * generated: the Storage SELECT policy only grants the caller their own uid
 * prefix.
 */
export async function createListingImageUrls(
  storagePaths: string[],
  expiresInSeconds = 60 * 60,
): Promise<Record<string, string>> {
  if (storagePaths.length === 0) {
    return {};
  }
  const { data, error } = await supabase.storage
    .from(LISTING_IMAGES_BUCKET)
    .createSignedUrls(storagePaths, expiresInSeconds);
  if (error) throw error;

  const urls: Record<string, string> = {};
  for (const entry of data) {
    if (entry.signedUrl && entry.path) {
      urls[entry.path] = entry.signedUrl;
    }
  }
  return urls;
}

// ============================================================
// Draft lifecycle
// ============================================================

/**
 * Creates an empty draft. Nothing but `seller_id` is sent: `status` takes its
 * `'draft'` default (and could not be sent anyway), and title/price/condition
 * are left NULL, which M1 made legal so photos can be attached before the form
 * is filled in.
 */
export async function createDraft(sellerId: string): Promise<ListingRow> {
  const { data, error } = await supabase
    .from('listings')
    .insert({ seller_id: sellerId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Saves editor fields. RLS restricts this to owned drafts, so an active
 * listing silently matches zero rows rather than erroring — hence `.select()`
 * and the explicit empty check, which turns that into a real failure instead of
 * a silent no-op the user would read as success.
 */
export async function updateDraft(
  listingId: string,
  input: DraftListingInput,
): Promise<ListingRow> {
  const { data, error } = await supabase
    .from('listings')
    // `status` is deliberately absent, as is `currency`: neither has a client
    // column grant, so sending either fails with 42501 even when the value
    // matches the column's own default. status only ever changes through
    // publish_listing; currency relies entirely on its 'ILS' default.
    .update({
      title: input.title,
      description: input.description,
      price_amount: input.price,
      condition: input.condition,
      size: input.size,
    })
    .eq('id', listingId)
    .select();
  if (error) throw error;
  if (data.length === 0) {
    throw new Error('Draft not found, or it is no longer editable');
  }
  return data[0];
}

/**
 * Deletes a whole draft, then best-effort removes its Storage objects.
 *
 * The paths are read first and cached, because `listings -> listing_images`
 * cascades: once the listing is gone the rows that named those objects are
 * gone too. If that read fails we still proceed — refusing to delete the draft
 * because we could not enumerate its photos would be worse, and the orphans
 * stay removable later through the DELETE policy's `not exists` branch.
 */
export async function deleteDraft(listingId: string): Promise<StorageCleanup> {
  let storagePaths: string[] = [];
  try {
    storagePaths = (await fetchListingImages(listingId)).map((image) => image.storage_path);
  } catch (error) {
    logCleanupFailure(`could not read image paths for listing ${listingId} before delete`, error);
  }

  const { error } = await supabase.from('listings').delete().eq('id', listingId);
  if (error) throw error;

  return removeStorageObjects(storagePaths, `listing ${listingId}`);
}

export async function publishListing(listingId: string): Promise<ListingRow> {
  const { data, error } = await supabase.rpc('publish_listing', { p_listing_id: listingId });
  if (error) throw error;
  return data;
}

// ============================================================
// Images
// ============================================================

/** Raw object upload. Attaching is a separate, server-controlled step. */
export async function uploadListingImageObject(
  storagePath: string,
  bytes: ArrayBuffer,
): Promise<void> {
  const { error } = await supabase.storage
    .from(LISTING_IMAGES_BUCKET)
    .upload(storagePath, bytes, { contentType: LISTING_IMAGE_CONTENT_TYPE });
  if (error) throw error;
}

/**
 * Claims an already-uploaded object for a listing. The RPC allocates
 * `position` server-side, enforces the 10-photo cap, verifies the object
 * really exists, and returns the existing row unchanged if this path was
 * already attached — so retrying an interrupted upload is safe.
 */
export async function attachListingImage(
  listingId: string,
  storagePath: string,
): Promise<ListingImageRow> {
  const { data, error } = await supabase.rpc('attach_listing_image', {
    p_listing_id: listingId,
    p_storage_path: storagePath,
  });
  if (error) throw error;
  return data;
}

/**
 * Removes one photo: database association first, Storage object second.
 *
 * The ordering is deliberate. A failed object delete leaves an orphan, which is
 * invisible and cleanable. The reverse ordering would risk a row pointing at a
 * file that is gone — which breaks rendering, and which `publish_listing` would
 * then reject at the worst possible moment.
 */
export async function removeListingImage(image: {
  id: string;
  storage_path: string;
}): Promise<StorageCleanup> {
  const { error } = await supabase.from('listing_images').delete().eq('id', image.id);
  if (error) throw error;

  return removeStorageObjects([image.storage_path], `image ${image.id}`);
}

/**
 * Rewrites every position in one transaction. The complete set of image ids is
 * required — a partial array cannot express a total order — and the RPC rejects
 * duplicates, foreign ids, and non-drafts.
 */
export async function reorderListingImages(
  listingId: string,
  imageIds: string[],
): Promise<void> {
  const { error } = await supabase.rpc('set_listing_image_order', {
    p_listing_id: listingId,
    p_image_ids: imageIds,
  });
  if (error) throw error;
}

/**
 * Best effort by construction: it reports failure rather than throwing, so a
 * caller can surface a quiet warning without misreporting the database work
 * that already succeeded.
 */
async function removeStorageObjects(
  storagePaths: string[],
  context: string,
): Promise<StorageCleanup> {
  if (storagePaths.length === 0) {
    return { storageCleanupFailed: false };
  }
  try {
    const { error } = await supabase.storage.from(LISTING_IMAGES_BUCKET).remove(storagePaths);
    if (error) {
      logCleanupFailure(context, error);
      return { storageCleanupFailed: true };
    }
  } catch (error) {
    logCleanupFailure(context, error);
    return { storageCleanupFailed: true };
  }
  return { storageCleanupFailed: false };
}
