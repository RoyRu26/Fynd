import { describe, expect, it } from 'vitest';

import {
  RESEND_COOLDOWN_SECONDS,
  canResend,
  cooldownSecondsLeft,
  formatCooldown,
  secondsRemaining,
} from '@/features/auth/resend';

describe('secondsRemaining', () => {
  it('returns the whole seconds left', () => {
    expect(secondsRemaining(60_000, 0)).toBe(60);
    expect(secondsRemaining(60_000, 18_000)).toBe(42);
  });

  // The reason this rounds up rather than down: with floor, a 400ms remainder
  // reads "0:00" while the button is still disabled, which looks broken.
  it('rounds up so the last partial second still displays', () => {
    expect(secondsRemaining(1_400, 1_000)).toBe(1);
    expect(secondsRemaining(1_001, 1_000)).toBe(1);
  });

  it('clamps at zero instead of going negative', () => {
    expect(secondsRemaining(1_000, 1_000)).toBe(0);
    expect(secondsRemaining(1_000, 99_000)).toBe(0);
  });

  // Backgrounding the app throttles JS timers, so the first render after
  // foregrounding can be long past the deadline. It must read ready, not
  // a large negative number.
  it('reads ready after an arbitrarily long gap, as when the app was backgrounded', () => {
    expect(canResend(secondsRemaining(Date.now(), Date.now() + 10 * 60 * 1000))).toBe(true);
  });
});

describe('formatCooldown', () => {
  it('formats as M:SS with unpadded minutes and padded seconds', () => {
    expect(formatCooldown(42)).toBe('0:42');
    expect(formatCooldown(65)).toBe('1:05');
    expect(formatCooldown(60)).toBe('1:00');
    expect(formatCooldown(0)).toBe('0:00');
  });

  it('pads single-digit seconds', () => {
    expect(formatCooldown(9)).toBe('0:09');
    expect(formatCooldown(601)).toBe('10:01');
  });

  it('treats negative input as zero rather than rendering a negative clock', () => {
    expect(formatCooldown(-5)).toBe('0:00');
  });

  it('formats the full cooldown the screen starts from', () => {
    expect(formatCooldown(RESEND_COOLDOWN_SECONDS)).toBe('1:00');
  });
});

describe('cooldownSecondsLeft', () => {
  it('reads ready when no cooldown is armed', () => {
    expect(cooldownSecondsLeft(null, Date.now())).toBe(0);
  });

  it('counts down from a live deadline', () => {
    expect(cooldownSecondsLeft(60_000, 18_000)).toBe(42);
  });

  // The gap this clamp exists for, at its real magnitude. `useCountdown`'s
  // interval self-clears when a deadline passes, freezing its clock there — so
  // a user who waits five minutes before tapping Resend re-arms a 60s cooldown
  // against a five-minute-old clock. Unclamped that renders "6:00".
  it('never exceeds the cooldown length, however stale the clock is', () => {
    const firstDeadlinePassedAt = 100_000;
    const frozenClock = firstDeadlinePassedAt;
    const reArmedFiveMinutesLater = firstDeadlinePassedAt + 5 * 60_000 + RESEND_COOLDOWN_SECONDS * 1000;

    expect(secondsRemaining(reArmedFiveMinutesLater, frozenClock)).toBe(360);
    expect(cooldownSecondsLeft(reArmedFiveMinutesLater, frozenClock)).toBe(RESEND_COOLDOWN_SECONDS);
  });

  it('clamps a clock only slightly behind the deadline too', () => {
    const armedAt = 100_000;
    const deadline = armedAt + RESEND_COOLDOWN_SECONDS * 1000;

    expect(cooldownSecondsLeft(deadline, armedAt - 900)).toBe(RESEND_COOLDOWN_SECONDS);
  });

  it('still clamps at zero once the deadline has passed', () => {
    expect(cooldownSecondsLeft(1_000, 99_000)).toBe(0);
  });
});

describe('canResend', () => {
  it('is ready only once nothing is left to wait for', () => {
    expect(canResend(0)).toBe(true);
    expect(canResend(1)).toBe(false);
    expect(canResend(RESEND_COOLDOWN_SECONDS)).toBe(false);
  });

  it('is ready for a remainder that somehow went negative', () => {
    expect(canResend(-1)).toBe(true);
  });
});
