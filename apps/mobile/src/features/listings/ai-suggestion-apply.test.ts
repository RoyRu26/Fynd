import { describe, expect, it } from 'vitest';

import type { CategoryGroup } from '@/features/categories/categories';
import {
  applySuggestionToForm,
  clearSuggestedField,
  resolveSuggestedCategoryId,
  suggestedPriceMidpoint,
  type SuggestedFieldName,
} from '@/features/listings/ai-suggestion-apply';
import type { ListingSuggestion } from '@/features/listings/ai-suggestions';

const KNOWN_LEAF_ID = 'a1a1a1a1-0000-0000-0000-000000000001';
const UNKNOWN_LEAF_ID = 'ffffffff-0000-0000-0000-000000000099';

const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    id: 'group-women',
    name: 'Women',
    subcategories: [
      { id: KNOWN_LEAF_ID, name: 'Shoes', parentId: 'group-women', position: 0 },
    ],
  },
];

function suggestion(overrides: Partial<ListingSuggestion> = {}): ListingSuggestion {
  return {
    title: 'Vintage denim jacket',
    description: 'Lightly worn, no stains.',
    condition: 'good',
    categoryId: KNOWN_LEAF_ID,
    priceMinAmount: 4000,
    priceMaxAmount: 6000,
    ...overrides,
  };
}

describe('suggestedPriceMidpoint', () => {
  it('rounds down an even-sum midpoint exactly', () => {
    expect(suggestedPriceMidpoint(4000, 6000)).toBe(5000);
  });

  it('rounds an odd-sum midpoint to the nearest integer', () => {
    // (4001 + 6000) / 2 = 5000.5 -> Math.round rounds half up.
    expect(suggestedPriceMidpoint(4001, 6000)).toBe(5001);
    // (4000 + 6001) / 2 = 5000.5 as well -> same rounding direction.
    expect(suggestedPriceMidpoint(4000, 6001)).toBe(5001);
  });

  it('handles a zero-width range as that single amount', () => {
    expect(suggestedPriceMidpoint(5000, 5000)).toBe(5000);
  });
});

describe('resolveSuggestedCategoryId', () => {
  it('returns null when the model picked no category', () => {
    expect(resolveSuggestedCategoryId(null, CATEGORY_GROUPS)).toBeNull();
  });

  it('returns the id when it resolves to a real leaf', () => {
    expect(resolveSuggestedCategoryId(KNOWN_LEAF_ID, CATEGORY_GROUPS)).toBe(KNOWN_LEAF_ID);
  });

  it('collapses an unresolvable id to null, same as "no category"', () => {
    expect(resolveSuggestedCategoryId(UNKNOWN_LEAF_ID, CATEGORY_GROUPS)).toBeNull();
  });
});

describe('applySuggestionToForm', () => {
  it('always marks title, description, condition and price', () => {
    const { suggestedFields } = applySuggestionToForm(suggestion(), CATEGORY_GROUPS);
    expect(suggestedFields).toEqual(
      expect.arrayContaining<SuggestedFieldName>(['title', 'description', 'condition', 'price']),
    );
  });

  it('includes and marks categoryId when it resolves against the live taxonomy', () => {
    const { values, suggestedFields } = applySuggestionToForm(
      suggestion({ categoryId: KNOWN_LEAF_ID }),
      CATEGORY_GROUPS,
    );
    expect(values.categoryId).toBe(KNOWN_LEAF_ID);
    expect(suggestedFields).toContain('categoryId');
  });

  it('omits categoryId entirely when the model id does not resolve', () => {
    const { values, suggestedFields } = applySuggestionToForm(
      suggestion({ categoryId: UNKNOWN_LEAF_ID }),
      CATEGORY_GROUPS,
    );
    expect(values.categoryId).toBeUndefined();
    expect(suggestedFields).not.toContain('categoryId');
  });

  it('omits categoryId when the model picked none at all', () => {
    const { values, suggestedFields } = applySuggestionToForm(suggestion({ categoryId: null }), CATEGORY_GROUPS);
    expect(values.categoryId).toBeUndefined();
    expect(suggestedFields).not.toContain('categoryId');
  });

  it('formats the price as the midpoint in input-string form', () => {
    const { values } = applySuggestionToForm(suggestion({ priceMinAmount: 4000, priceMaxAmount: 6000 }), CATEGORY_GROUPS);
    expect(values.price).toBe('50.00');
  });

  it('passes title/description/condition through unchanged', () => {
    const { values } = applySuggestionToForm(
      suggestion({ title: 'Red coat', description: 'Barely used', condition: 'like_new' }),
      CATEGORY_GROUPS,
    );
    expect(values.title).toBe('Red coat');
    expect(values.description).toBe('Barely used');
    expect(values.condition).toBe('like_new');
  });
});

describe('clearSuggestedField', () => {
  it('removes exactly the named field, leaving the rest marked', () => {
    const current = new Set<SuggestedFieldName>(['title', 'description', 'price']);
    const next = clearSuggestedField(current, 'description');
    expect(next.has('description')).toBe(false);
    expect(next.has('title')).toBe(true);
    expect(next.has('price')).toBe(true);
  });

  it('no-ops and returns the same reference when the field is absent', () => {
    const current = new Set<SuggestedFieldName>(['title']);
    const next = clearSuggestedField(current, 'price');
    expect(next).toBe(current);
  });
});
