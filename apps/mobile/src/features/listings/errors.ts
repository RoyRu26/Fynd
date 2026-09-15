import { StorageApiError } from '@supabase/supabase-js';

export type MappedListingError = {
  message: string;
};

function isPostgrestErrorLike(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  return error instanceof Error && /network|fetch/i.test(error.message);
}

/**
 * Maps a listing/Storage/Postgres error to a safe, user-facing message.
 *
 * Deliberately separate from `mapAuthError`: the SQLSTATEs overlap (`42501`
 * especially) but mean different things here, and the copy is different.
 *
 * Backend message text is never surfaced. The RPCs do raise readable messages,
 * but they are written for developers, are not localised, and the same SQLSTATE
 * covers several distinct causes — so the UI should prevent the common cases up
 * front (see `publishBlockers`) rather than relay whatever the server said.
 * Pure and side-effect-free; callers log the original error themselves.
 */
export function mapListingError(error: unknown): MappedListingError {
  // Storage failures arrive as StorageApiError, not PostgrestError, and carry
  // an HTTP status rather than a SQLSTATE.
  if (error instanceof StorageApiError) {
    switch (error.status) {
      case 413:
        return { message: 'That photo is too large. Try a different one.' };
      case 415:
        return { message: "That file type isn't supported. Photos must be JPEG." };
      case 409:
        return { message: 'That photo has already been added.' };
      case 401:
      case 403:
        return { message: "You can't change that." };
      default:
        return { message: "Couldn't upload that photo. Please try again." };
    }
  }

  const code = isPostgrestErrorLike(error) ? error.code : undefined;

  switch (code) {
    // Raised by every RPC for a validation failure: incomplete listing, no
    // photos, a photo whose file is gone, a non-draft, the 10-photo cap, a
    // malformed image order.
    case 'P0001':
      return {
        message:
          "That change isn't allowed right now. Check the listing details and photos, then try again.",
      };
    // Raised when the listing id does not resolve.
    case 'P0002':
      return { message: 'That listing no longer exists.' };
    // Two distinct sources, both meaning the same thing to a user: a
    // column-privilege denial (writing status, currency, seller_id, a
    // timestamp) and an RPC ownership rejection.
    case '42501':
      return { message: "You can't change that." };
    // listing_images_storage_path_key, from attaching an object already
    // attached elsewhere.
    case '23505':
      return { message: 'That photo has already been added.' };
    // A CHECK constraint: title length, positive price, completeness.
    case '23514':
      return { message: "That value isn't allowed. Please check the highlighted fields." };
    default:
      break;
  }

  if (isNetworkError(error)) {
    return { message: 'Network error. Check your connection and try again.' };
  }

  return { message: 'Something went wrong. Please try again.' };
}
