import { describe, expect, it } from 'vitest';

import { getInitials } from '@/components/ui/avatar-state';

describe('getInitials', () => {
  it('returns empty string for an empty name', () => {
    expect(getInitials('')).toBe('');
  });

  it('returns empty string for a whitespace-only name', () => {
    expect(getInitials('   ')).toBe('');
  });

  it('returns one uppercase letter for a single word', () => {
    expect(getInitials('Roy')).toBe('R');
  });

  it('returns first+last initials for two words', () => {
    expect(getInitials('Roy Rutzky')).toBe('RR');
  });

  it('uses first and last word for three or more words, ignoring the middle', () => {
    expect(getInitials('Roy Middle Rutzky')).toBe('RR');
  });

  it('handles extra internal whitespace', () => {
    expect(getInitials('  Roy    Rutzky  ')).toBe('RR');
  });

  it('uppercases lowercase input', () => {
    expect(getInitials('roy rutzky')).toBe('RR');
  });
});
