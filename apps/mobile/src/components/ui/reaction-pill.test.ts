import { describe, expect, it } from 'vitest';

import { getReactionPillLabel } from '@/components/ui/reaction-pill-state';

describe('getReactionPillLabel', () => {
  it('pluralises every count except one', () => {
    expect(getReactionPillLabel(0)).toBe('0 saves');
    expect(getReactionPillLabel(2)).toBe('2 saves');
    expect(getReactionPillLabel(312)).toBe('312 saves');
  });

  // The whole reason this is a tested function: the heart glyph is decorative,
  // so this string is the entire announcement, and "1 saves" ships easily.
  it('singularises exactly one', () => {
    expect(getReactionPillLabel(1)).toBe('1 save');
  });

  it('always leads with the number, so the count is heard first', () => {
    expect(getReactionPillLabel(7).startsWith('7 ')).toBe(true);
  });
});
