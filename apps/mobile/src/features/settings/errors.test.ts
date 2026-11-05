import { describe, expect, it } from 'vitest';

import { mapDeleteAccountError, mapNotificationPreferenceError } from '@/features/settings/errors';

const postgrest = (code: string, message = 'raw backend detail') => ({
  code,
  message,
  details: 'internal detail',
  hint: 'internal hint',
});

describe('mapNotificationPreferenceError', () => {
  // Reaches the client from two distinct sources: a column-privilege denial
  // and an RLS ownership rejection -- same shape as mapProfileError's 42501
  // case.
  it('maps 42501 for both privilege denial and RLS ownership rejection', () => {
    expect(
      mapNotificationPreferenceError(postgrest('42501', 'permission denied for column notify_new_message')).message,
    ).toBe("You can't change that.");
    expect(
      mapNotificationPreferenceError(postgrest('42501', 'new row violates row-level security policy')).message,
    ).toBe("You can't change that.");
  });

  it('maps network failures', () => {
    expect(mapNotificationPreferenceError(new TypeError('Network request failed')).message).toMatch(/network/i);
    expect(mapNotificationPreferenceError(new Error('fetch failed')).message).toMatch(/network/i);
  });

  it('falls back for unknown errors', () => {
    expect(mapNotificationPreferenceError(postgrest('42P01')).message).toBe(
      "Couldn't save that preference. Please try again.",
    );
    expect(mapNotificationPreferenceError(new Error('boom')).message).toBe(
      "Couldn't save that preference. Please try again.",
    );
    expect(mapNotificationPreferenceError(null).message).toBe(
      "Couldn't save that preference. Please try again.",
    );
    expect(mapNotificationPreferenceError(undefined).message).toBe(
      "Couldn't save that preference. Please try again.",
    );
    expect(mapNotificationPreferenceError('a string').message).toBe(
      "Couldn't save that preference. Please try again.",
    );
  });

  // The whole point of the mapping layer.
  it('never surfaces raw backend text', () => {
    const raw = 'permission denied for column notify_new_message of relation profiles';
    const mapped = mapNotificationPreferenceError(postgrest('42501', raw));
    expect(mapped.message).not.toContain(raw);
    expect(mapped.message).not.toContain('internal detail');
    expect(mapped.message).not.toContain('internal hint');
  });
});

const deleteAccountFailure = (reason: string, message = 'server-written detail') => ({
  ok: false,
  reason,
  message,
});

describe('mapDeleteAccountError', () => {
  it('maps unauthorized', () => {
    expect(mapDeleteAccountError(deleteAccountFailure('unauthorized')).message).toMatch(/session has expired/i);
  });

  it('maps invalid_request and deletion_failed to the same retry copy', () => {
    expect(mapDeleteAccountError(deleteAccountFailure('invalid_request')).message).toBe(
      "Couldn't delete your account right now. Please try again.",
    );
    expect(mapDeleteAccountError(deleteAccountFailure('deletion_failed')).message).toBe(
      "Couldn't delete your account right now. Please try again.",
    );
  });

  it('falls back for an unrecognized reason rather than throwing', () => {
    expect(mapDeleteAccountError(deleteAccountFailure('some_future_reason')).message).toBe(
      "Couldn't delete your account right now. Please try again.",
    );
  });

  it('maps a thrown transport/network failure', () => {
    expect(mapDeleteAccountError(new TypeError('Network request failed')).message).toMatch(/network/i);
    expect(mapDeleteAccountError(new Error('fetch failed')).message).toMatch(/network/i);
  });

  it('falls back for every other unknown error shape', () => {
    expect(mapDeleteAccountError(new Error('boom')).message).toBe(
      "Couldn't delete your account right now. Please try again.",
    );
    expect(mapDeleteAccountError(null).message).toBe("Couldn't delete your account right now. Please try again.");
    expect(mapDeleteAccountError(undefined).message).toBe(
      "Couldn't delete your account right now. Please try again.",
    );
  });

  // The whole point of the mapping layer -- the Edge Function's own
  // `message` is written for THIS mapper to choose from, never surfaced
  // verbatim to the user.
  it('never surfaces the Edge Function response body message text verbatim', () => {
    const raw = 'admin deleteUser failed: some internal detail';
    const mapped = mapDeleteAccountError(deleteAccountFailure('deletion_failed', raw));
    expect(mapped.message).not.toContain(raw);
  });
});
