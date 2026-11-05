import { describe, expect, it } from 'vitest';

import {
  PASSWORD_HELPER_TEXT,
  PASSWORD_METER_SEGMENTS,
  getPasswordLengthScore,
} from '@/features/auth/password-strength';
import { MIN_PASSWORD_LENGTH } from '@/features/auth/schemas';

const repeat = (length: number) => 'a'.repeat(length);

describe('getPasswordLengthScore', () => {
  it('scores nothing for an empty password', () => {
    expect(getPasswordLengthScore('')).toBe(0);
  });

  // The alignment that matters to a user: the bar must not sit empty while
  // the form happily submits, nor show progress on a password zod rejects.
  it('fills its first segment exactly when the password becomes valid', () => {
    expect(getPasswordLengthScore(repeat(MIN_PASSWORD_LENGTH - 1))).toBe(0);
    expect(getPasswordLengthScore(repeat(MIN_PASSWORD_LENGTH))).toBe(1);
  });

  it('fills a further segment every two characters', () => {
    expect(getPasswordLengthScore(repeat(MIN_PASSWORD_LENGTH + 2))).toBe(2);
    expect(getPasswordLengthScore(repeat(MIN_PASSWORD_LENGTH + 4))).toBe(3);
    expect(getPasswordLengthScore(repeat(MIN_PASSWORD_LENGTH + 6))).toBe(4);
  });

  it('never exceeds the number of segments the meter can draw', () => {
    expect(getPasswordLengthScore(repeat(200))).toBe(PASSWORD_METER_SEGMENTS);
  });

  // The meter and the scorer must agree on how many segments exist, or the bar
  // either caps silently or draws one it can never fill.
  it('can fill exactly as many segments as the meter draws', () => {
    expect(PASSWORD_METER_SEGMENTS).toBe(4);
    expect(getPasswordLengthScore(repeat(MIN_PASSWORD_LENGTH + 6))).toBe(PASSWORD_METER_SEGMENTS);
  });

  it('increases monotonically with length', () => {
    let previous = 0;
    for (let length = 0; length <= MIN_PASSWORD_LENGTH + 10; length += 1) {
      const score = getPasswordLengthScore(repeat(length));
      expect(score).toBeGreaterThanOrEqual(previous);
      previous = score;
    }
  });

  // Documents the limitation rather than hiding it: this is a length meter,
  // so a long repeated string scores full marks. Anyone who makes this
  // entropy-aware should see this expectation fail and update the doc comment.
  it('scores purely on length — a repeated character fills the bar', () => {
    expect(getPasswordLengthScore(repeat(MIN_PASSWORD_LENGTH + 6))).toBe(PASSWORD_METER_SEGMENTS);
    expect(getPasswordLengthScore('aaaaaaaaaaaa')).toBe(getPasswordLengthScore('Tr0ub4dor&3x'));
  });
});

describe('PASSWORD_HELPER_TEXT', () => {
  it('states the actual rule, not a hardcoded number', () => {
    expect(PASSWORD_HELPER_TEXT).toBe(`At least ${MIN_PASSWORD_LENGTH} characters`);
    expect(PASSWORD_HELPER_TEXT).toContain(String(MIN_PASSWORD_LENGTH));
  });
});
