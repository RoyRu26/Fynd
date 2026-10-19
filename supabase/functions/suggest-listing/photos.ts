// Photo retrieval for the suggestion request. Not unit-tested (see the
// repo-wide note in index.ts's header comment) -- both functions here do
// real network I/O through the caller-scoped client, which this repo has
// no mocking layer for. Verified manually instead.

/** Cover-first, and capped so a draft with many photos still sends a bounded request. */
export const MAX_SUGGESTION_PHOTOS = 4;

type ListingImageRow = { storage_path: string };

/** Minimal shape of the subset of the supabase-js client this file uses. */
export type PhotosReadClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        order: (
          column: string,
          opts: { ascending: boolean },
        ) => {
          limit: (
            n: number,
          ) => Promise<{ data: ListingImageRow[] | null; error: { message: string } | null }>;
        };
      };
    };
  };
  storage: {
    from: (bucket: string) => {
      download: (path: string) => Promise<{ data: Blob | null; error: { message: string } | null }>;
    };
  };
};

/**
 * Fetches up to `MAX_SUGGESTION_PHOTOS` storage paths for a listing's
 * images, ordered by `position` ascending so the cover photo comes first.
 */
export async function fetchListingPhotoPaths(
  client: PhotosReadClient,
  listingId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from('listing_images')
    .select('storage_path')
    .eq('listing_id', listingId)
    .order('position', { ascending: true })
    .limit(MAX_SUGGESTION_PHOTOS);

  if (error) {
    throw new Error(`Failed to fetch listing photos: ${error.message}`);
  }
  return (data ?? []).map((row) => row.storage_path);
}

/**
 * Downloads one Storage object and returns it as a base64 string, for
 * sending as an inline image content block to the Messages API.
 *
 * One round trip via `.download()`, not a signed URL followed by a
 * `fetch()` -- this stays entirely within the existing Storage RLS
 * boundary (defense in depth) and avoids a second network hop per photo.
 */
export async function downloadPhotoAsBase64(
  client: PhotosReadClient,
  bucket: string,
  storagePath: string,
): Promise<string> {
  const { data, error } = await client.storage.from(bucket).download(storagePath);
  if (error || !data) {
    throw new Error(`Failed to download ${storagePath}: ${error?.message ?? 'no data returned'}`);
  }
  const arrayBuffer = await data.arrayBuffer();
  return encodeBase64(arrayBuffer);
}

/**
 * Chunked to avoid `String.fromCharCode(...bytes)` blowing the call stack
 * on a multi-megabyte image -- spreading a large typed array as arguments
 * can throw "Maximum call stack size exceeded".
 */
function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
