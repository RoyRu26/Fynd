import {
  associateClosetCoverUrls,
  normalizeClosetListingRow,
  type ClosetListingRow,
  type ClosetPage,
} from '@/features/profile/closet';
import { AVATAR_CONTENT_TYPE, AVATARS_BUCKET } from '@/features/profile/avatar-paths';
import { LISTING_IMAGES_BUCKET } from '@/features/listings/paths';
import { createSignedStorageUrls } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';

/**
 * Database access for profile editing and avatars.
 *
 * The privilege model this layer respects, enforced server-side (see
 * `..._profile_bio_and_avatars.sql`):
 *
 *   * `profiles` has a column-level UPDATE allowlist: only
 *     `username`/`display_name`/`bio`/`avatar_path` are writable by the
 *     client. `id`/`created_at`/`updated_at` have no UPDATE privilege at
 *     all, so sending any of them fails with 42501 regardless of RLS.
 *   * There is no client INSERT privilege on `profiles` — rows are created
 *     exclusively by `handle_new_user`'s trigger.
 *   * The `avatars` Storage bucket is private. SELECT is deliberately
 *     unscoped (any authenticated user may read any avatar object — see
 *     the migration's own comment), but INSERT/DELETE are scoped to the
 *     caller's own uid prefix. There is no UPDATE policy: an avatar is
 *     replaced by delete + upload to a fresh path, same convention as
 *     listing images.
 */

export type ProfileRow = Tables<'profiles'>;

function logCleanupFailure(context: string, error: unknown): void {
  if (__DEV__) {
    console.warn(`[profile] best-effort storage cleanup failed: ${context}`, error);
  }
}

// ============================================================
// Reads
// ============================================================

export async function fetchProfile(userId: string): Promise<ProfileRow> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      // notify_new_message/notify_new_review/notify_new_follower
      // (20261021062550_profile_notification_preferences.sql) are included
      // here so the Settings screen's switches (ROADMAP 6.1a) can read this
      // same cached row rather than issuing a second fetch for them.
      'id, username, display_name, bio, avatar_path, notify_new_message, notify_new_review, notify_new_follower, created_at, updated_at',
    )
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

/**
 * The bucket is private, so rendering an avatar needs a signed URL. A thin
 * wrapper over the shared `createSignedStorageUrls` — see that function's
 * own header for why this isn't inlined (it used to be, identically, in
 * both this file and `features/listings/api.ts`, and the duplication is
 * what led to a require cycle between the two features).
 */
export async function createAvatarUrls(
  storagePaths: string[],
  expiresInSeconds = 60 * 60,
): Promise<Record<string, string>> {
  return createSignedStorageUrls(AVATARS_BUCKET, storagePaths, expiresInSeconds);
}

/**
 * One page of the viewer's own "closet" (SCREENS.md Task 7) — active,
 * reserved, and sold listings, newest first. Deliberately NOT the same
 * `status = 'active'`-only query `seller-profile/api.ts`'s
 * `fetchSellerListingsPage` uses: that one is the PUBLIC, buyer-facing
 * profile grid and excludes a seller's own sold/reserved inventory on
 * purpose (see its own header comment); this one is the Profile tab, never
 * shown to anyone but the owner, where a sold item is exactly what the
 * handoff's own stamp treatment exists to show. Drafts and removed listings
 * are excluded either way — a draft has no guaranteed photo, and removed is
 * the seller's own "took it down."
 *
 * Same embedded-select + single batched signed-URL shape as
 * `fetchSellerListingsPage`: one round trip for the page's rows (with each
 * listing's lowest-`position` cover riding along), one more for every cover
 * URL in it — never N+1. No price/currency in the select at all: the
 * handoff is explicit that this grid carries no price tags.
 */
export async function fetchMyCloset(params: {
  sellerId: string;
  limit: number;
  offset: number;
}): Promise<ClosetPage> {
  const { sellerId, limit, offset } = params;

  const { data, error, count } = await supabase
    .from('listings')
    .select(
      `
      id,
      title,
      status,
      category_id,
      listing_images (
        storage_path,
        position
      )
    `,
      { count: 'exact' },
    )
    .eq('seller_id', sellerId)
    .in('status', ['active', 'reserved', 'sold'])
    .order('created_at', { ascending: false })
    .order('position', { referencedTable: 'listing_images', ascending: true })
    .limit(1, { referencedTable: 'listing_images' })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  const normalized = (data as ClosetListingRow[]).map(normalizeClosetListingRow);
  if (normalized.length === 0) {
    return { listings: [], totalCount: count ?? 0 };
  }

  const urlsByPath = await createSignedStorageUrls(
    LISTING_IMAGES_BUCKET,
    normalized.map((listing) => listing.coverStoragePath),
  );
  const listings = associateClosetCoverUrls(normalized, urlsByPath);
  return { listings, totalCount: count ?? listings.length };
}

// ============================================================
// Writes
// ============================================================

/**
 * Updates allowlisted profile fields. RLS restricts this to the caller's
 * own row, so an id that fails to match (shouldn't happen for a signed-in
 * user editing their own profile, but defensive the same way
 * `updateDraft` is for listings) silently matches zero rows rather than
 * erroring — hence the explicit empty check turning that into a real
 * failure instead of a silent no-op the user would read as success.
 */
export async function updateProfile(
  userId: string,
  patch: Partial<{
    username: string;
    display_name: string;
    bio: string | null;
    avatar_path: string | null;
  }>,
): Promise<ProfileRow> {
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', userId).select();
  if (error) throw error;
  if (data.length === 0) {
    throw new Error('Profile not found, or it is no longer editable');
  }
  return data[0];
}

/**
 * Raw object upload. Committing the new `avatar_path` onto the profile is a
 * separate step (`updateProfile`, driven by `useUpdateAvatar` in
 * queries.ts) — same "upload" vs "commit" separation as
 * `uploadListingImageObject` vs `attachListingImage`.
 */
export async function uploadAvatarObject(storagePath: string, bytes: ArrayBuffer): Promise<void> {
  const { error } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(storagePath, bytes, { contentType: AVATAR_CONTENT_TYPE });
  if (error) throw error;
}

/**
 * Best-effort removal of a single avatar object. Never throws — mirrors
 * `removeStorageObjects`'s swallow-and-dev-warn pattern in
 * listings/api.ts, so a caller replacing their avatar never fails the whole
 * operation over a leftover orphan object (which stays invisible and
 * removable later).
 */
export async function removeAvatarObject(storagePath: string): Promise<void> {
  try {
    const { error } = await supabase.storage.from(AVATARS_BUCKET).remove([storagePath]);
    if (error) {
      logCleanupFailure(storagePath, error);
    }
  } catch (error) {
    logCleanupFailure(storagePath, error);
  }
}
