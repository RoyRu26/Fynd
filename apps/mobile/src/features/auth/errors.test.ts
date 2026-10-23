import { AuthApiError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { mapAuthError } from '@/features/auth/errors';
import { MIN_PASSWORD_LENGTH } from '@/features/auth/schemas';

function authError(code: string) {
  return new AuthApiError('raw supabase message', 400, code);
}

function postgrestError(code: string) {
  return { message: 'raw pg message', details: '', hint: '', code };
}

describe('mapAuthError — auth errors', () => {
  it('maps invalid_credentials to one generic message, not distinguishing bad email from bad password', () => {
    const mapped = mapAuthError(authError('invalid_credentials'));
    expect(mapped.message).toBe('Incorrect email or password.');
    // Deliberately no field: pointing at 'email' or 'password' specifically
    // would imply which one was wrong, i.e. that the account exists.
    expect(mapped.field).toBeUndefined();
    expect(mapped.message.toLowerCase()).not.toMatch(/no account|not found|does(n't| not) exist/);
  });

  it('maps user_already_exists to a soft field-level email message with no account-exists assertion', () => {
    const mapped = mapAuthError(authError('user_already_exists'));
    expect(mapped.field).toBe('email');
    expect(mapped.message).toBe(
      'Unable to create an account with this email. Try signing in or use a different email.',
    );
  });

  it('maps email_address_invalid to a field-level email message', () => {
    const mapped = mapAuthError(authError('email_address_invalid'));
    expect(mapped.field).toBe('email');
  });

  it('maps weak_password using the shared MIN_PASSWORD_LENGTH constant', () => {
    const mapped = mapAuthError(authError('weak_password'));
    expect(mapped.field).toBe('password');
    expect(mapped.message).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it('maps over_request_rate_limit to a rate-limit message', () => {
    const mapped = mapAuthError(authError('over_request_rate_limit'));
    expect(mapped.message).toMatch(/too many attempts/i);
  });

  it('maps over_email_send_rate_limit to its own message, distinct from the request limit', () => {
    const mapped = mapAuthError(authError('over_email_send_rate_limit'));
    expect(mapped.message).toMatch(/too many emails/i);
    // The point of the separate branch: it must not land on the generic
    // fallback, which reads as a bug and invites retry hammering.
    expect(mapped.message).not.toBe('Something went wrong. Please try again.');
    expect(mapped.message).not.toBe(mapAuthError(authError('over_request_rate_limit')).message);
  });

  it('maps email_not_confirmed to a field-level email message pointing at the inbox', () => {
    const mapped = mapAuthError(authError('email_not_confirmed'));
    expect(mapped.field).toBe('email');
    expect(mapped.message).toMatch(/confirm/i);
    // Must not read as a credential failure — that sends the user off to
    // reset a password that is perfectly fine.
    expect(mapped.message).not.toMatch(/password/i);
  });

  it('maps an unrecognized auth error code to a generic fallback', () => {
    const mapped = mapAuthError(authError('some_future_code'));
    expect(mapped.message).toBe('Something went wrong. Please try again.');
  });
});

describe('mapAuthError — database errors', () => {
  it('maps 23505 (unique violation) to a field-level username-taken message', () => {
    const mapped = mapAuthError(postgrestError('23505'));
    expect(mapped.field).toBe('username');
    expect(mapped.message).toMatch(/already taken/i);
  });

  it('maps 23514 (check violation) to a generic validation message', () => {
    const mapped = mapAuthError(postgrestError('23514'));
    expect(mapped.field).toBeUndefined();
  });
});

describe('mapAuthError — network and unknown errors', () => {
  it('maps a TypeError (typical fetch failure) to a network message', () => {
    const mapped = mapAuthError(new TypeError('Failed to fetch'));
    expect(mapped.message).toMatch(/network/i);
  });

  it('maps a completely unrecognized error to the generic fallback', () => {
    const mapped = mapAuthError('a plain string, not even an Error');
    expect(mapped.message).toBe('Something went wrong. Please try again.');
  });
});
