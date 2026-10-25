import { supabase } from '@/lib/supabase';

/**
 * Signs a batch of private-bucket storage paths to temporary URLs — one
 * network round trip for the whole batch, never N+1.
 *
 * Shared by every feature that reads from a private bucket (listing photos,
 * avatars) specifically so that none of them has to import another
 * feature's `api.ts` just to reuse this one call shape. Before this was
 * extracted, `features/listings/api.ts` and `features/profile/api.ts` each
 * carried their own byte-identical copy, and `features/profile/api.ts`'s
 * Task 7 addition (`fetchMyCloset`, needing a listing-image signing call)
 * started importing the listings copy directly — which, combined with
 * `features/listings/api.ts` already importing `createAvatarUrls` from
 * `features/profile/api.ts` for `fetchListingConversationBuyers`, created a
 * real require cycle (`profile/api.ts -> listings/api.ts -> profile/api.ts`)
 * that broke the app at startup. This file is a neutral leaf both features
 * can depend on without depending on each other.
 *
 * Deliberately generic over `bucket`: this file has no opinion about which
 * bucket means what — that stays in each feature's own `..._BUCKET`
 * constant (`listings/paths.ts`'s `LISTING_IMAGES_BUCKET`,
 * `profile/avatar-paths.ts`'s `AVATARS_BUCKET`).
 */
export async function createSignedStorageUrls(
  bucket: string,
  storagePaths: string[],
  expiresInSeconds = 60 * 60,
): Promise<Record<string, string>> {
  if (storagePaths.length === 0) {
    return {};
  }
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(storagePaths, expiresInSeconds);
  if (error) throw error;

  const urls: Record<string, string> = {};
  for (const entry of data) {
    if (entry.signedUrl && entry.path) {
      urls[entry.path] = entry.signedUrl;
    }
  }
  return urls;
}
