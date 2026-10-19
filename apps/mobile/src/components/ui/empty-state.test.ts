import { describe, expect, it } from 'vitest';

import {
  getEmptyStateAccessibilityLiveRegion,
  getEmptyStateIconColor,
} from '@/components/ui/empty-state-state';

describe('getEmptyStateIconColor', () => {
  it('is textSecondary for the empty variant', () => {
    expect(getEmptyStateIconColor('empty')).toBe('textSecondary');
  });

  it('is danger for the error variant', () => {
    expect(getEmptyStateIconColor('error')).toBe('danger');
  });
});

describe('getEmptyStateAccessibilityLiveRegion', () => {
  it('is none for the empty variant', () => {
    expect(getEmptyStateAccessibilityLiveRegion('empty')).toBe('none');
  });

  it('is polite for the error variant', () => {
    expect(getEmptyStateAccessibilityLiveRegion('error')).toBe('polite');
  });
});
