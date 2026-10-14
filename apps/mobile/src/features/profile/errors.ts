import { StorageApiError } from '@supabase/supabase-js';

export type MappedProfileError = {
  field?: 'username';
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
 * Maps a profile/avatar Storage/Postgres error to a safe, user-facing
 * message.
 *
 * Deliberately a separate mapper from both `mapAuthError` and
 * `mapListingError`: the SQLSTATEs overlap (42501, 23505, 23514 all recur)
 * but the surface and copy differ here — this is the only one of the three
 * that has to cover an avatar upload failure (`StorageApiError`) AND the
 * profiles column-privilege allowlist AND `profiles_bio_length` under the
 * same `23514`. Pure and side-effect-free; callers log the original error
 * themselves.
 */
export function mapProfileError(error: unknown): MappedProfileError {
  // Storage failures arrive as StorageApiError, not PostgrestError, and
  // carry an HTTP status rather than a SQLSTATE — same shape mapListingError
  // handles for listing photos, repeated here with avatar-specific copy.
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
    // Username uniqueness (profiles_username_lower_idx), same shape
    // mapAuthError already uses for onboarding, reused here so the two
    // screens never show different copy for the same failure.
    case '23505':
      return { field: 'username', message: 'That username is already taken.' };
    // Covers profiles_username_format, profiles_display_name_length, and
    // the new profiles_bio_length — all three are CHECK constraints with
    // the same user-facing meaning: something didn't fit the rules.
    case '23514':
      return { message: "That value isn't allowed. Please check the highlighted fields." };
    // A column-privilege denial (writing id/created_at/updated_at) or an
    // RLS ownership rejection (editing someone else's profile, which the
    // UI never offers but is still possible to hit directly).
    case '42501':
      return { message: "You can't change that." };
    default:
      break;
  }

  if (isNetworkError(error)) {
    return { message: 'Network error. Check your connection and try again.' };
  }

  return { message: 'Something went wrong. Please try again.' };
}
