import { describe, expect, it } from 'vitest';

import { onboardingSchema } from '@/features/profile/schemas';

function parse(username: string, displayName: string) {
  return onboardingSchema.safeParse({ username, displayName });
}

describe('onboardingSchema username', () => {
  it('accepts a simple valid username', () => {
    expect(parse('abc', 'Roy').success).toBe(true);
  });

  it('accepts underscores and digits', () => {
    expect(parse('abc_123', 'Roy').success).toBe(true);
  });

  it('accepts the 30-character upper bound', () => {
    expect(parse('a'.repeat(30), 'Roy').success).toBe(true);
  });

  it('rejects a username shorter than 3 characters', () => {
    expect(parse('ab', 'Roy').success).toBe(false);
  });

  it('rejects a username containing spaces', () => {
    expect(parse('a b c', 'Roy').success).toBe(false);
  });

  it('rejects a username containing path-like punctuation', () => {
    expect(parse('../admin', 'Roy').success).toBe(false);
  });
});

describe('onboardingSchema displayName', () => {
  it('accepts a normal display name', () => {
    expect(parse('roy', 'Roy').success).toBe(true);
  });

  it('trims the display name and stores the trimmed value', () => {
    const result = parse('roy', '  Roy  ');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBe('Roy');
    }
  });

  it('accepts exactly 50 trimmed characters', () => {
    expect(parse('roy', 'A'.repeat(50)).success).toBe(true);
  });

  it('rejects an empty display name', () => {
    expect(parse('roy', '').success).toBe(false);
  });

  it('rejects a whitespace-only display name', () => {
    expect(parse('roy', '   ').success).toBe(false);
  });

  it('rejects more than 50 trimmed characters', () => {
    expect(parse('roy', 'A'.repeat(51)).success).toBe(false);
  });
});
