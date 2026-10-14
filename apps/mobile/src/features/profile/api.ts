import { AVATAR_CONTENT_TYPE, AVATARS_BUCKET } from '@/features/profile/avatar-paths';
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
    .select('id, username, display_name, bio, avatar_path, created_at, updated_at')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

/**
 * The bucket is private, so rendering an avatar needs a signed URL.
 * Structurally identical to `createListingImageUrls` — one batched call,
 * no N+1 — but against the `avatars` bucket. Callers dedupe/filter empty
 * paths themselves, same contract as `createListingImageUrls`.
 */
export async function createAvatarUrls(
  storagePaths: string[],
  expiresInSeconds = 60 * 60,
): Promise<Record<string, string>> {
  if (storagePaths.length === 0) {
    return {};
  }
  const { data, error } = await supabase.storage
    .from(AVATARS_BUCKET)
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
