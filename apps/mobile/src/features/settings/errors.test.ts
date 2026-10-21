import { describe, expect, it } from 'vitest';

import { mapNotificationPreferenceError } from '@/features/settings/errors';

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
