import { StorageApiError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { mapListingError } from '@/features/listings/errors';

const postgrest = (code: string, message = 'raw backend detail') => ({
  code,
  message,
  details: 'internal detail',
  hint: 'internal hint',
});

describe('mapListingError', () => {
  it('maps P0001 (RPC validation) to a safe message', () => {
    expect(mapListingError(postgrest('P0001')).message).toMatch(/isn't allowed right now/i);
  });

  it('maps P0002 (listing not found)', () => {
    expect(mapListingError(postgrest('P0002')).message).toMatch(/no longer exists/i);
  });

  // Reaches the client from two distinct sources: a column-privilege denial
  // (status, currency, seller_id, timestamps) and an RPC ownership rejection.
  it('maps 42501 for both privilege denial and RPC ownership rejection', () => {
    expect(mapListingError(postgrest('42501', 'permission denied for column status')).message).toBe(
      "You can't change that.",
    );
    expect(mapListingError(postgrest('42501', 'Not your listing')).message).toBe(
      "You can't change that.",
    );
  });

  it('maps 23505 (storage_path already attached)', () => {
    expect(mapListingError(postgrest('23505')).message).toMatch(/already been added/i);
  });

  it('maps 23514 (CHECK constraint)', () => {
    expect(mapListingError(postgrest('23514')).message).toMatch(/isn't allowed/i);
  });

  it('maps network failures', () => {
    expect(mapListingError(new TypeError('Network request failed')).message).toMatch(/network/i);
    expect(mapListingError(new Error('fetch failed')).message).toMatch(/network/i);
  });

  it('falls back for unknown errors', () => {
    expect(mapListingError(postgrest('42P01')).message).toBe('Something went wrong. Please try again.');
    expect(mapListingError(new Error('boom')).message).toBe('Something went wrong. Please try again.');
    expect(mapListingError(null).message).toBe('Something went wrong. Please try again.');
    expect(mapListingError(undefined).message).toBe('Something went wrong. Please try again.');
    expect(mapListingError('a string').message).toBe('Something went wrong. Please try again.');
  });

  it('maps Storage failures by HTTP status, not SQLSTATE', () => {
    expect(mapListingError(new StorageApiError('too big', 413, '413')).message).toMatch(/too large/i);
    expect(mapListingError(new StorageApiError('bad type', 415, '415')).message).toMatch(/JPEG/i);
    expect(mapListingError(new StorageApiError('exists', 409, '409')).message).toMatch(
      /already been added/i,
    );
    expect(mapListingError(new StorageApiError('denied', 403, '403')).message).toBe(
      "You can't change that.",
    );
    expect(mapListingError(new StorageApiError('oops', 500, '500')).message).toMatch(
      /couldn't upload that photo/i,
    );
  });

  // The whole point of the mapping layer.
  it('never surfaces raw backend text', () => {
    const raw = 'permission denied for column status of relation listings';
    const mapped = mapListingError(postgrest('42501', raw));
    expect(mapped.message).not.toContain(raw);
    expect(mapped.message).not.toContain('internal detail');
    expect(mapped.message).not.toContain('internal hint');
  });
});
