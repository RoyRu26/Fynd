import { describe, expect, it } from 'vitest';

import { mapBlockError } from '@/features/blocks/errors';

const postgrest = (code: string, message = 'raw backend detail') => ({
  code,
  message,
  details: 'internal detail',
  hint: 'internal hint',
});

describe('mapBlockError', () => {
  it('maps 23505 (already blocked)', () => {
    expect(mapBlockError(postgrest('23505')).message).toBe("You've already blocked this user.");
  });

  it('maps 23514 (blocks_not_self)', () => {
    expect(mapBlockError(postgrest('23514')).message).toBe("You can't block yourself.");
  });

  it('maps 42501 (forged blocker_id, or unblocking a row the caller does not own)', () => {
    expect(mapBlockError(postgrest('42501', 'new row violates row-level security policy')).message).toBe(
      "You can't do that.",
    );
  });

  it('maps network failures', () => {
    expect(mapBlockError(new TypeError('Network request failed')).message).toMatch(/network/i);
    expect(mapBlockError(new Error('fetch failed')).message).toMatch(/network/i);
  });

  it('falls back for unknown errors', () => {
    expect(mapBlockError(postgrest('42P01')).message).toBe('Something went wrong. Please try again.');
    expect(mapBlockError(new Error('boom')).message).toBe('Something went wrong. Please try again.');
    expect(mapBlockError(null).message).toBe('Something went wrong. Please try again.');
    expect(mapBlockError(undefined).message).toBe('Something went wrong. Please try again.');
    expect(mapBlockError('a string').message).toBe('Something went wrong. Please try again.');
  });

  // The whole point of the mapping layer.
  it('never surfaces raw backend text', () => {
    const raw = 'new row violates row-level security policy for table "blocks"';
    const mapped = mapBlockError(postgrest('42501', raw));
    expect(mapped.message).not.toContain(raw);
    expect(mapped.message).not.toContain('internal detail');
    expect(mapped.message).not.toContain('internal hint');
  });
});
