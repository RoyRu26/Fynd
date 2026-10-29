import {
  brandSelectionFromListing,
  brandSelectionToArgs,
  type BrandSelection,
} from '@/features/brands/brands';
import {
  normalizeVocabulary,
  type AttributeValueRow,
  type AttributeVocabulary,
} from '@/features/listings/attributes';
import { LISTING_IMAGES_BUCKET, LISTING_IMAGE_CONTENT_TYPE } from '@/features/listings/paths';
import { createAvatarUrls } from '@/features/profile/api';
import { groupLowestPositionCoverByListingId, type ListingImageCoverRow } from '@/features/listings/rack';
import type { DraftListingInput, PublishableListingInput } from '@/features/listings/schemas';
import {
  associateSoldBuyerAvatarUrls,
  normalizeSoldBuyerRow,
  type SoldBuyerCandidate,
} from '@/features/listings/sold-buyer';
import { createSignedStorageUrls } from '@/lib/storage';
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
 * prefix. A thin wrapper over the shared `createSignedStorageUrls` — see
 * that function's own header for why this isn't inlined (it used to be,
 * and a second inlined copy in `features/profile/api.ts` is what caused a
 * require cycle between these two features).
 */
export async function createListingImageUrls(
  storagePaths: string[],
  expiresInSeconds = 60 * 60,
): Promise<Record<string, string>> {
  return createSignedStorageUrls(LISTING_IMAGES_BUCKET, storagePaths, expiresInSeconds);
}

/**
 * Cover photo URL per listing id, for the Sell tab's "your rack" strip
 * (SCREENS.md Task 5) — one round trip for `listing_images` rows across every
 * listing in `listingIds`, ordered by `position` so
 * `groupLowestPositionCoverByListingId` can take the first row per id as that
 * listing's cover, plus one batched signed-URL call.
 *
 * Not the `listings -> listing_images` embedded-select `seller-profile/api.ts`
 * uses: that query filters to `status = 'active'`, where `publish_listing`'s
 * own photo requirement guarantees at least one image per row. The rack shows
 * every status, drafts included, and a draft can legitimately have zero
 * photos — so a listing simply has no entry in the returned map rather than
 * the strict "throw if missing" the seller-profile grid relies on.
 *
 * Direct `listing_images` access, not `listings`, is what RLS allows here too:
 * the table's SELECT policy "follows listing visibility", so a seller reading
 * their own non-active listings' images is already covered by the same rule
 * that lets them read the listings themselves.
 */
export async function fetchListingCovers(listingIds: string[]): Promise<Record<string, string>> {
  if (listingIds.length === 0) {
    return {};
  }
  const { data, error } = await supabase
    .from('listing_images')
    .select('listing_id, storage_path, position')
    .in('listing_id', listingIds)
    .order('position', { ascending: true });
  if (error) throw error;

  const storagePathByListingId = groupLowestPositionCoverByListingId(data as ListingImageCoverRow[]);
  const urlsByPath = await createListingImageUrls(Object.values(storagePathByListingId));

  const coverUrlByListingId: Record<string, string> = {};
  for (const [listingId, storagePath] of Object.entries(storagePathByListingId)) {
    const url = urlsByPath[storagePath];
    if (url) {
      coverUrlByListingId[listingId] = url;
    }
  }
  return coverUrlByListingId;
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
      category_id: input.categoryId,
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
// Post-publish lifecycle (ROADMAP 1.6 "Manage a listing")
// ============================================================
// Every status transition below goes through a SECURITY DEFINER RPC, never
// a direct client UPDATE: the direct-UPDATE RLS policy on listings stays
// locked to status = 'draft' only, so these RPCs are the entire edit/
// transition surface for an active or reserved listing. See
// supabase/migrations/..._listing_status_transitions.sql for the full
// transition matrix each one enforces.

/** active -> reserved. Freely reversible with markListingActive. */
export async function markListingReserved(listingId: string): Promise<ListingRow> {
  const { data, error } = await supabase.rpc('mark_listing_reserved', { p_listing_id: listingId });
  if (error) throw error;
  return data;
}

/** reserved -> active. A draft must use publishListing instead. */
export async function markListingActive(listingId: string): Promise<ListingRow> {
  const { data, error } = await supabase.rpc('mark_listing_active', { p_listing_id: listingId });
  if (error) throw error;
  return data;
}

/**
 * active|reserved -> sold. `buyerId` is `null` for "sold outside Fynd" --
 * the pre-5.3 behaviour, still fully supported -- or the id of someone who
 * actually messaged about THIS listing (enforced server-side; the RPC
 * rejects a buyer who never messaged about it, even one who messaged the
 * same seller about a different listing). See
 * supabase/migrations/20261020073200_listing_sold_buyer.sql for the full
 * validation this RPC performs, including why a since-blocked buyer may
 * still be selected.
 */
export async function markListingSold(
  listingId: string,
  buyerId: string | null,
): Promise<ListingRow> {
  const { data, error } = await supabase.rpc('mark_listing_sold', {
    p_listing_id: listingId,
    // The generated Args type is `string | undefined` -- RPC Args codegen
    // does not model a parameter's SQL `default null` as `| null` the way
    // table-column nullability is modelled -- so `null` (our own domain's
    // "no buyer" value) is converted at this one boundary. The server side
    // treats an omitted argument and an explicit `null` identically either
    // way (`p_buyer_id uuid default null`).
    p_buyer_id: buyerId ?? undefined,
  });
  if (error) throw error;
  return data;
}

/**
 * ROADMAP 5.3: the people who messaged about this listing, who may
 * therefore be picked as the sold-to buyer -- most-recent-conversation
 * first, exactly the order `listing_conversation_buyers` already returns.
 *
 * A SECURITY DEFINER RPC, not a direct client query, because of a
 * COLUMN-GRANT gap rather than an RLS gap: `conversations` only grants
 * `select (id, buyer_id, seller_id)` to `authenticated` (see
 * `20260929090000_chat_conversations_and_messages.sql`), so a client
 * cannot even NAME `listing_id` in a query, regardless of what RLS would
 * have allowed. See the RPC's own migration comment for the full
 * reasoning.
 *
 * Avatar URLs are resolved the same batched way `inbox/api.ts`'s
 * `fetchInboxPage` already does: one signed-URL round trip for every
 * non-null avatar path in the result, never one request per buyer.
 */
export async function fetchListingConversationBuyers(
  listingId: string,
): Promise<SoldBuyerCandidate[]> {
  const { data, error } = await supabase.rpc('listing_conversation_buyers', {
    p_listing_id: listingId,
  });
  if (error) throw error;

  const rows = data.map(normalizeSoldBuyerRow);
  if (rows.length === 0) {
    return [];
  }

  const avatarPaths = Array.from(
    new Set(rows.map((row) => row.avatarPath).filter((path): path is string => path !== null)),
  );
  const urlsByPath = await createAvatarUrls(avatarPaths);
  return associateSoldBuyerAvatarUrls(rows, urlsByPath);
}

/**
 * active|reserved -> removed. Sold is NOT removable through this path --
 * sold is treated as permanent history. A draft is removed via deleteDraft
 * instead.
 */
export async function removeListing(listingId: string): Promise<ListingRow> {
  const { data, error } = await supabase.rpc('remove_listing', { p_listing_id: listingId });
  if (error) throw error;
  return data;
}

/**
 * Edits an active or reserved listing's details. Reuses
 * `publishableListingSchema`'s inferred shape (the same completeness rules
 * `publish_listing` already enforces), since the RPC re-validates exactly
 * that: a trimmed title, a positive price, and condition/size/category all
 * set. Never touches status/seller_id/currency/images.
 */
export async function updateListingDetails(
  listingId: string,
  input: PublishableListingInput,
): Promise<ListingRow> {
  const { data, error } = await supabase.rpc('update_listing_details', {
    p_listing_id: listingId,
    p_title: input.title,
    p_description: input.description,
    p_price_amount: input.price,
    p_condition: input.condition,
    p_size: input.size,
    p_category_id: input.categoryId,
  });
  if (error) throw error;
  return data;
}

// ============================================================
// Structured attributes (AI listing metadata plan, Phases 1a + 1b)
// ============================================================
// The four vocabulary tables are authenticated-SELECT only, with no client
// writes. Values are written only through `set_listing_attributes` (no
// INSERT/UPDATE/DELETE grant on listing_attribute_values, no column grant on
// listings.keywords, brand_id or brand_text), which works for draft, active
// and reserved listings.

export async function fetchAttributeVocabulary(): Promise<AttributeVocabulary> {
  const [kinds, terms, kindCategories, itemTypeCategories] = await Promise.all([
    supabase.from('listing_attribute_kinds').select('kind, label, max_values, position'),
    supabase.from('listing_attribute_terms').select('id, kind, slug, label, position, retired_at'),
    supabase.from('listing_attribute_kind_categories').select('kind, category_id'),
    supabase.from('listing_item_type_categories').select('term_id, category_id'),
  ]);
  if (kinds.error) throw kinds.error;
  if (terms.error) throw terms.error;
  if (kindCategories.error) throw kindCategories.error;
  if (itemTypeCategories.error) throw itemTypeCategories.error;

  return normalizeVocabulary({
    kinds: kinds.data,
    terms: terms.data,
    kindCategories: kindCategories.data,
    itemTypeCategories: itemTypeCategories.data,
  });
}

export type ListingAttributes = {
  values: AttributeValueRow[];
  keywords: string[];
  brand: BrandSelection;
};

export async function fetchListingAttributes(listingId: string): Promise<ListingAttributes> {
  const [values, listing] = await Promise.all([
    supabase.from('listing_attribute_values').select('term_id, kind, position').eq('listing_id', listingId),
    // The brand name comes from an embedded read of the catalog row, so a
    // known brand never needs a second round trip to be displayed.
    supabase
      .from('listings')
      .select('keywords, brand_id, brand_text, brand:brands!listings_brand_id_fkey(id, name)')
      .eq('id', listingId)
      .single(),
  ]);
  if (values.error) throw values.error;
  if (listing.error) throw listing.error;
  return {
    values: values.data,
    keywords: listing.data.keywords,
    brand: brandSelectionFromListing(listing.data),
  };
}

/**
 * Replaces the whole set — values, keywords and brand. Order within a kind
 * becomes `position` (first color = primary). Free-text brand that exactly
 * matches a catalog alias is stored as that brand by the server, so callers
 * re-read the listing afterwards instead of assuming what was stored.
 */
export async function setListingAttributes(
  listingId: string,
  input: { termIds: string[]; keywords: string[]; brand: BrandSelection },
): Promise<void> {
  const { brandId, brandText } = brandSelectionToArgs(input.brand);
  const { error } = await supabase.rpc('set_listing_attributes', {
    p_listing_id: listingId,
    p_term_ids: input.termIds,
    p_keywords: input.keywords,
    // Omitted rather than null: the generated args type marks them optional.
    ...(brandId !== null ? { p_brand_id: brandId } : {}),
    ...(brandText !== null ? { p_brand_text: brandText } : {}),
  });
  if (error) throw error;
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
