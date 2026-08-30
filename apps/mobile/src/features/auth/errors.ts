import { isAuthError } from '@supabase/supabase-js';

import { MIN_PASSWORD_LENGTH } from '@/features/auth/schemas';

export type MappedAuthError = {
  field?: 'email' | 'password' | 'username';
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
  return (
    error instanceof Error && /network|fetch/i.test(error.message)
  );
}

/**
 * Maps a raw Supabase auth/Postgres/network error to a safe, user-facing
 * message. Pure and side-effect-free: callers are responsible for logging
 * the original error (dev-only) before calling this.
 */
export function mapAuthError(error: unknown): MappedAuthError {
  if (isAuthError(error)) {
    switch (error.code) {
      case 'invalid_credentials':
        return { message: 'Incorrect email or password.' };
      case 'user_already_exists':
        return {
          field: 'email',
          message: 'Unable to create an account with this email. Try signing in or use a different email.',
        };
      case 'email_address_invalid':
        return { field: 'email', message: 'Enter a valid email address.' };
      case 'weak_password':
        return {
          field: 'password',
          message: `Choose a stronger password (at least ${MIN_PASSWORD_LENGTH} characters).`,
        };
      case 'over_request_rate_limit':
        return { message: 'Too many attempts. Please wait a moment and try again.' };
      default:
        return { message: 'Something went wrong. Please try again.' };
    }
  }

  const pgCode = isPostgrestErrorLike(error) ? error.code : undefined;
  if (pgCode === '23505') {
    return { field: 'username', message: 'That username is already taken.' };
  }
  if (pgCode === '23514') {
    return { message: "That value isn't allowed. Please check the highlighted fields." };
  }

  if (isNetworkError(error)) {
    return { message: 'Network error. Check your connection and try again.' };
  }

  return { message: 'Something went wrong. Please try again.' };
}
