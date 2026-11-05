import { describe, expect, it } from 'vitest';

import { mapReviewError } from '@/features/reviews/errors';

const postgrest = (code: string, message = 'raw backend detail') => ({
  code,
  message,
  details: 'internal detail',
  hint: 'internal hint',
});

describe('mapReviewError', () => {
  it('maps P0001 (no completed sale, or an out-of-range rating)', () => {
    expect(mapReviewError(postgrest('P0001')).message).toBe("That review isn't allowed right now.");
  });

  it('maps P0002 (listing no longer exists)', () => {
    expect(mapReviewError(postgrest('P0002')).message).toBe('That listing no longer exists.');
  });

  it('maps 42501 (not part of this sale)', () => {
    expect(mapReviewError(postgrest('42501')).message).toBe("You can't review this.");
  });

  it('maps 23505 (already reviewed this sale)', () => {
    expect(mapReviewError(postgrest('23505')).message).toBe("You've already reviewed this sale.");
  });

  it('maps 23514 (rating or comment out of bounds)', () => {
    expect(mapReviewError(postgrest('23514')).message).toBe("That rating or comment isn't allowed.");
  });

  it('maps network failures', () => {
    expect(mapReviewError(new TypeError('Network request failed')).message).toMatch(/network/i);
    expect(mapReviewError(new Error('fetch failed')).message).toMatch(/network/i);
  });

  it('falls back for unknown errors', () => {
    expect(mapReviewError(postgrest('42P01')).message).toBe('Something went wrong. Please try again.');
    expect(mapReviewError(new Error('boom')).message).toBe('Something went wrong. Please try again.');
    expect(mapReviewError(null).message).toBe('Something went wrong. Please try again.');
    expect(mapReviewError(undefined).message).toBe('Something went wrong. Please try again.');
    expect(mapReviewError('a string').message).toBe('Something went wrong. Please try again.');
  });

  // The whole point of the mapping layer.
  it('never surfaces raw backend text', () => {
    const raw = 'new row violates row-level security policy for table "reviews"';
    const mapped = mapReviewError(postgrest('42501', raw));
    expect(mapped.message).not.toContain(raw);
    expect(mapped.message).not.toContain('internal detail');
    expect(mapped.message).not.toContain('internal hint');
  });
});
