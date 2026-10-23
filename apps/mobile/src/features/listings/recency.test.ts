import { describe, expect, it } from 'vitest';

import { JUST_DROPPED_WINDOW_MS, isJustDropped } from '@/features/listings/recency';

// Fixed clock so every case is deterministic without fake timers — the whole
// reason `isJustDropped` takes `now` explicitly.
const NOW = Date.parse('2026-10-22T12:00:00.000Z');

describe('JUST_DROPPED_WINDOW_MS', () => {
  // Pinned, not recomputed: retuning the window should fail here loudly rather
  // than slip through as a one-character diff.
  it('is 48 hours', () => {
    expect(JUST_DROPPED_WINDOW_MS).toBe(172_800_000);
  });
});

describe('isJustDropped', () => {
  it('is true for a listing created right now', () => {
    expect(isJustDropped('2026-10-22T12:00:00.000Z', NOW)).toBe(true);
  });

  it('is true 1ms inside the window', () => {
    expect(isJustDropped('2026-10-20T12:00:00.001Z', NOW)).toBe(true);
  });

  // The boundary is strict `<`, matching formatReviewAge's own convention.
  it('is false exactly at the window', () => {
    expect(isJustDropped('2026-10-20T12:00:00.000Z', NOW)).toBe(false);
  });

  it('is false 1ms past the window', () => {
    expect(isJustDropped('2026-10-20T11:59:59.999Z', NOW)).toBe(false);
  });

  it('is false for a week-old listing', () => {
    expect(isJustDropped('2026-10-15T12:00:00.000Z', NOW)).toBe(false);
  });

  // Clock skew: the server's timestamp can be ahead of the device clock. The
  // elapsed clamp is what stops that reading as "old" instead of "new".
  it('is true for a future timestamp rather than flipping to old', () => {
    expect(isJustDropped('2026-10-22T12:05:00.000Z', NOW)).toBe(true);
  });

  it('is true even for a wildly future timestamp', () => {
    expect(isJustDropped('2027-01-01T00:00:00.000Z', NOW)).toBe(true);
  });

  // NaN never badges. Guards against a future refactor inverting the
  // comparison, which would silently tag every malformed row.
  it('is false for unparseable input', () => {
    expect(isJustDropped('', NOW)).toBe(false);
    expect(isJustDropped('not-a-date', NOW)).toBe(false);
  });

  // PostgREST serializes `timestamptz` with an offset, not always a literal Z,
  // so the offset has to be honored rather than ignored. 15:00+03:00 is
  // 2026-10-20T12:00:00Z, so the window expires at 2026-10-22T12:00:00Z —
  // the two assertions straddle it by a minute either side.
  it('honors a non-UTC offset in the timestamp', () => {
    expect(isJustDropped('2026-10-20T15:00:00.000+03:00', Date.parse('2026-10-22T11:59:00.000Z'))).toBe(
      true,
    );
    expect(isJustDropped('2026-10-20T15:00:00.000+03:00', Date.parse('2026-10-22T12:01:00.000Z'))).toBe(
      false,
    );
  });

  // Proves the default parameter is actually wired, not just declared.
  it('defaults `now` to the current clock when omitted', () => {
    expect(isJustDropped(new Date().toISOString())).toBe(true);
    expect(isJustDropped('2020-01-01T00:00:00.000Z')).toBe(false);
  });
});
