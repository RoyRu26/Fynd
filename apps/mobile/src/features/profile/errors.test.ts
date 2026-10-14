import { StorageApiError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { mapProfileError } from '@/features/profile/errors';

const postgrest = (code: string, message = 'raw backend detail') => ({
  code,
  message,
  details: 'internal detail',
  hint: 'internal hint',
});

describe('mapProfileError', () => {
  it('maps Storage failures by HTTP status, not SQLSTATE', () => {
    expect(mapProfileError(new StorageApiError('too big', 413, '413')).message).toMatch(
      /too large/i,
    );
    expect(mapProfileError(new StorageApiError('bad type', 415, '415')).message).toMatch(/JPEG/i);
    expect(mapProfileError(new StorageApiError('exists', 409, '409')).message).toMatch(
      /already been added/i,
    );
    expect(mapProfileError(new StorageApiError('denied', 401, '401')).message).toBe(
      "You can't change that.",
    );
    expect(mapProfileError(new StorageApiError('denied', 403, '403')).message).toBe(
      "You can't change that.",
    );
    expect(mapProfileError(new StorageApiError('oops', 500, '500')).message).toMatch(
      /couldn't upload that photo/i,
    );
  });

  // Reaches the client from the same username-uniqueness constraint
  // mapAuthError already maps, repeated here so the username field/message
  // never differ between onboarding and profile editing.
  it('maps 23505 (username uniqueness) to a field-level username-taken message', () => {
    const mapped = mapProfileError(postgrest('23505'));
    expect(mapped.field).toBe('username');
    expect(mapped.message).toMatch(/already taken/i);
  });

  // Covers profiles_username_format, profiles_display_name_length, and the
  // new profiles_bio_length -- and now also profiles_avatar_path_owned --
  // all CHECK constraints under the same SQLSTATE. Like mapListingError,
  // this mapper does not distinguish between them by constraint name; every
  // 23514 gets the same generic validation copy regardless of which
  // constraint or column triggered it.
  it('maps 23514 (CHECK constraint) to a generic validation message, regardless of which constraint fired', () => {
    expect(mapProfileError(postgrest('23514', 'violates check constraint "profiles_bio_length"')).message).toMatch(
      /isn't allowed/i,
    );
    expect(
      mapProfileError(postgrest('23514', 'violates check constraint "profiles_username_format"'))
        .message,
    ).toMatch(/isn't allowed/i);
    expect(
      mapProfileError(postgrest('23514', 'violates check constraint "profiles_avatar_path_owned"'))
        .message,
    ).toMatch(/isn't allowed/i);
    expect(mapProfileError(postgrest('23514')).field).toBeUndefined();
  });

  // Reaches the client from two distinct sources: a column-privilege denial
  // (writing id/created_at/updated_at) and an RLS ownership rejection
  // (editing someone else's profile).
  it('maps 42501 for both privilege denial and RLS ownership rejection', () => {
    expect(mapProfileError(postgrest('42501', 'permission denied for column created_at')).message).toBe(
      "You can't change that.",
    );
    expect(mapProfileError(postgrest('42501', 'new row violates row-level security policy')).message).toBe(
      "You can't change that.",
    );
  });

  it('maps network failures', () => {
    expect(mapProfileError(new TypeError('Network request failed')).message).toMatch(/network/i);
    expect(mapProfileError(new Error('fetch failed')).message).toMatch(/network/i);
  });

  it('falls back for unknown errors', () => {
    expect(mapProfileError(postgrest('42P01')).message).toBe('Something went wrong. Please try again.');
    expect(mapProfileError(new Error('boom')).message).toBe('Something went wrong. Please try again.');
    expect(mapProfileError(null).message).toBe('Something went wrong. Please try again.');
    expect(mapProfileError(undefined).message).toBe('Something went wrong. Please try again.');
    expect(mapProfileError('a string').message).toBe('Something went wrong. Please try again.');
  });

  // The whole point of the mapping layer.
  it('never surfaces raw backend text', () => {
    const raw = 'permission denied for column created_at of relation profiles';
    const mapped = mapProfileError(postgrest('42501', raw));
    expect(mapped.message).not.toContain(raw);
    expect(mapped.message).not.toContain('internal detail');
    expect(mapped.message).not.toContain('internal hint');
  });
});
