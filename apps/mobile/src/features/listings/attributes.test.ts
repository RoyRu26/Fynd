import { describe, expect, it } from 'vitest';

import {
  addKeyword,
  addTermsToEmptyKinds,
  applyOfferedTerm,
  attributeBadgeTerms,
  canonicalSelection,
  applicableKinds,
  describeRemovedTerms,
  isKindFull,
  keywordError,
  normalizeKeyword,
  normalizeVocabulary,
  pruneSelectionForCategory,
  removeKeyword,
  sameIdList,
  selectableTerms,
  selectedTermsByKind,
  selectionFromValues,
  toggleTerm,
  type AttributeVocabulary,
} from '@/features/listings/attributes';

const TOPS = 'cat-women-tops';
const SHOES = 'cat-women-shoes';
const FURNITURE = 'cat-home-furniture';

function vocab(): AttributeVocabulary {
  return normalizeVocabulary({
    kinds: [
      { kind: 'color', label: 'Color', max_values: 3, position: 1 },
      { kind: 'item_type', label: 'Item type', max_values: 1, position: 0 },
      { kind: 'fit', label: 'Fit', max_values: 1, position: 5 },
      { kind: 'future_kind', label: 'Future', max_values: 1, position: 9 },
    ],
    terms: [
      { id: 'hoodie', kind: 'item_type', slug: 'hoodie', label: 'Hoodie', position: 1, retired_at: null },
      { id: 'tee', kind: 'item_type', slug: 't_shirt', label: 'T-shirt', position: 0, retired_at: null },
      { id: 'sneakers', kind: 'item_type', slug: 'sneakers', label: 'Sneakers', position: 2, retired_at: null },
      { id: 'black', kind: 'color', slug: 'black', label: 'Black', position: 0, retired_at: null },
      { id: 'white', kind: 'color', slug: 'white', label: 'White', position: 1, retired_at: null },
      { id: 'grey', kind: 'color', slug: 'grey', label: 'Grey', position: 2, retired_at: null },
      { id: 'red', kind: 'color', slug: 'red', label: 'Red', position: 3, retired_at: null },
      { id: 'teal', kind: 'color', slug: 'teal', label: 'Teal', position: 4, retired_at: '2026-10-01T00:00:00Z' },
      { id: 'slim', kind: 'fit', slug: 'slim', label: 'Slim', position: 0, retired_at: null },
      { id: 'oversized', kind: 'fit', slug: 'oversized', label: 'Oversized', position: 1, retired_at: null },
      { id: 'mystery', kind: 'future_kind', slug: 'x', label: 'X', position: 0, retired_at: null },
    ],
    kindCategories: [
      { kind: 'color', category_id: TOPS },
      { kind: 'color', category_id: SHOES },
      { kind: 'fit', category_id: TOPS },
    ],
    itemTypeCategories: [
      { term_id: 'hoodie', category_id: TOPS },
      { term_id: 'tee', category_id: TOPS },
      { term_id: 'sneakers', category_id: SHOES },
    ],
  });
}

describe('normalizeVocabulary', () => {
  it('sorts kinds by position and drops kinds this build does not know', () => {
    expect(vocab().kinds.map((k) => k.kind)).toEqual(['item_type', 'color', 'fit']);
    expect(vocab().termsById.has('mystery')).toBe(false);
  });

  it('sorts terms within a kind and marks retired ones', () => {
    const v = vocab();
    expect(v.termsByKind.get('item_type')?.map((t) => t.id)).toEqual(['tee', 'hoodie', 'sneakers']);
    expect(v.termsById.get('teal')?.retired).toBe(true);
  });
});

describe('applicableKinds', () => {
  it('offers item type, color and fit for a clothing leaf', () => {
    expect(applicableKinds(vocab(), TOPS).map((k) => k.kind)).toEqual(['item_type', 'color', 'fit']);
  });

  it('offers no fit for shoes', () => {
    expect(applicableKinds(vocab(), SHOES).map((k) => k.kind)).toEqual(['item_type', 'color']);
  });

  it('offers nothing outside fashion, and nothing before a category is chosen', () => {
    expect(applicableKinds(vocab(), FURNITURE)).toEqual([]);
    expect(applicableKinds(vocab(), null)).toEqual([]);
  });
});

describe('selectableTerms', () => {
  it('filters item types by category compatibility', () => {
    expect(selectableTerms(vocab(), 'item_type', TOPS, []).map((t) => t.id)).toEqual(['tee', 'hoodie']);
    expect(selectableTerms(vocab(), 'item_type', SHOES, []).map((t) => t.id)).toEqual(['sneakers']);
  });

  it('hides retired terms unless already selected', () => {
    expect(selectableTerms(vocab(), 'color', TOPS, []).map((t) => t.id)).not.toContain('teal');
    expect(selectableTerms(vocab(), 'color', TOPS, ['teal']).map((t) => t.id)).toContain('teal');
  });
});

describe('toggleTerm', () => {
  it('replaces the value of a single-value kind', () => {
    expect(toggleTerm(vocab(), ['tee', 'black'], 'hoodie')).toEqual(['black', 'hoodie']);
  });

  it('appends to a multi-value kind in tap order, so the first color stays primary', () => {
    expect(toggleTerm(vocab(), ['grey'], 'black')).toEqual(['grey', 'black']);
  });

  it('deselects a selected term', () => {
    expect(toggleTerm(vocab(), ['grey', 'black'], 'grey')).toEqual(['black']);
  });

  it('refuses a fourth color and reports the kind as full', () => {
    const three = ['black', 'white', 'grey'];
    expect(toggleTerm(vocab(), three, 'red')).toEqual(three);
    expect(isKindFull(vocab(), three, 'color')).toBe(true);
    expect(isKindFull(vocab(), ['tee'], 'item_type')).toBe(false);
  });

  it('never newly adds a retired term', () => {
    expect(toggleTerm(vocab(), [], 'teal')).toEqual([]);
  });
});

describe('pruneSelectionForCategory', () => {
  it('Tops -> Shoes removes the hoodie and the fit, keeps the color', () => {
    const result = pruneSelectionForCategory(vocab(), ['hoodie', 'grey', 'oversized'], SHOES);
    expect(result.kept).toEqual(['grey']);
    expect(result.removed.map((t) => t.id)).toEqual(['hoodie', 'oversized']);
  });

  it('keeps an item type that is valid in both categories', () => {
    expect(pruneSelectionForCategory(vocab(), ['hoodie'], TOPS).removed).toEqual([]);
  });

  it('keeps everything when the category is cleared', () => {
    expect(pruneSelectionForCategory(vocab(), ['hoodie', 'oversized'], null).kept).toEqual(['hoodie', 'oversized']);
  });

  it('removes everything for a non-fashion category', () => {
    expect(pruneSelectionForCategory(vocab(), ['hoodie', 'grey'], FURNITURE).kept).toEqual([]);
  });
});

describe('describeRemovedTerms', () => {
  it('names a single removed value', () => {
    const removed = pruneSelectionForCategory(vocab(), ['hoodie'], SHOES).removed;
    expect(describeRemovedTerms(removed, 'Women › Shoes')).toBe("Removed Hoodie — it doesn't fit Women › Shoes.");
  });

  it('names several removed values', () => {
    const removed = pruneSelectionForCategory(vocab(), ['hoodie', 'oversized', 'grey'], FURNITURE).removed;
    expect(describeRemovedTerms(removed, 'Home › Furniture')).toBe(
      "Removed Hoodie, Oversized and Grey — they don't fit Home › Furniture.",
    );
  });

  it('falls back to "this category" before category names load', () => {
    const removed = pruneSelectionForCategory(vocab(), ['hoodie'], SHOES).removed;
    expect(describeRemovedTerms(removed, null)).toBe("Removed Hoodie — it doesn't fit this category.");
  });

  it('returns null when nothing was removed', () => {
    expect(describeRemovedTerms([], 'Women › Tops')).toBeNull();
  });
});

describe('selectionFromValues / selectedTermsByKind', () => {
  it('restores kind order, then stored position, and drops unknown terms', () => {
    const selection = selectionFromValues(vocab(), [
      { term_id: 'black', kind: 'color', position: 1 },
      { term_id: 'oversized', kind: 'fit', position: 0 },
      { term_id: 'grey', kind: 'color', position: 0 },
      { term_id: 'hoodie', kind: 'item_type', position: 0 },
      { term_id: 'gone', kind: 'color', position: 2 },
    ]);
    expect(selection).toEqual(['hoodie', 'grey', 'black', 'oversized']);
  });

  it('groups a selection by kind for display', () => {
    const groups = selectedTermsByKind(vocab(), ['grey', 'hoodie', 'black']);
    expect(groups.map((g) => [g.kind.kind, g.terms.map((t) => t.id)])).toEqual([
      ['item_type', ['hoodie']],
      ['color', ['grey', 'black']],
    ]);
  });
});

describe('attributeBadgeTerms', () => {
  it('lists terms in kind order then position, retired ones included', () => {
    const terms = attributeBadgeTerms(vocab(), [
      { term_id: 'teal', kind: 'color', position: 1 },
      { term_id: 'slim', kind: 'fit', position: 0 },
      { term_id: 'black', kind: 'color', position: 0 },
      { term_id: 'tee', kind: 'item_type', position: 0 },
    ]);
    expect(terms.map((t) => t.label)).toEqual(['T-shirt', 'Black', 'Teal', 'Slim']);
  });
});

describe('canonicalSelection', () => {
  it('ignores order across kinds but keeps order within a kind', () => {
    const v = vocab();
    // Deselecting and reselecting the item type moves it to the end of the raw list.
    expect(canonicalSelection(v, ['grey', 'black', 'hoodie'])).toEqual(['hoodie', 'grey', 'black']);
    expect(sameIdList(canonicalSelection(v, ['grey', 'hoodie']), canonicalSelection(v, ['hoodie', 'grey']))).toBe(true);
    expect(sameIdList(canonicalSelection(v, ['grey', 'black']), canonicalSelection(v, ['black', 'grey']))).toBe(false);
  });
});

describe('sameIdList', () => {
  it('is order-sensitive', () => {
    expect(sameIdList(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameIdList(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameIdList(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('keywords', () => {
  it('normalizes like the server: trim, lowercase, collapse spaces', () => {
    expect(normalizeKeyword('  Zip   UP ')).toBe('zip up');
  });

  it('accepts Hebrew, digits and hyphens', () => {
    expect(keywordError('טרנינג', [])).toBeNull();
    expect(keywordError('zip-up', [])).toBeNull();
    expect(keywordError('90s', [])).toBeNull();
  });

  it('rejects bad lengths, punctuation, duplicates and an eleventh keyword', () => {
    expect(keywordError('x', [])).not.toBeNull();
    expect(keywordError('a'.repeat(25), [])).not.toBeNull();
    expect(keywordError('wow!!', [])).not.toBeNull();
    expect(keywordError('-edge', [])).not.toBeNull();
    expect(keywordError('logo', ['logo'])).toBe('Already added.');
    const ten = Array.from({ length: 10 }, (_, i) => `k${i}x`);
    expect(keywordError('more', ten)).not.toBeNull();
  });

  it('adds a normalized keyword; a blank entry is a silent no-op', () => {
    expect(addKeyword(['logo'], ' Crew Neck ')).toEqual({ keywords: ['logo', 'crew neck'], error: null });
    expect(addKeyword(['logo'], '   ')).toEqual({ keywords: ['logo'], error: null });
    expect(addKeyword(['logo'], 'LOGO')).toEqual({ keywords: ['logo'], error: 'Already added.' });
  });

  it('removes a keyword', () => {
    expect(removeKeyword(['a1', 'b2'], 'a1')).toEqual(['b2']);
  });
});

describe('AI entry points', () => {
  it('addTermsToEmptyKinds fills only kinds the seller left empty', () => {
    // item type already chosen (tee): the hoodie candidate is ignored; colors are empty.
    expect(addTermsToEmptyKinds(vocab(), ['tee'], ['hoodie', 'grey', 'black'])).toEqual(['tee', 'grey', 'black']);
  });

  it('addTermsToEmptyKinds never touches a kind with a seller value', () => {
    expect(addTermsToEmptyKinds(vocab(), ['white'], ['grey'])).toEqual(['white']);
  });

  it('addTermsToEmptyKinds respects max_values and skips retired or unknown terms', () => {
    expect(addTermsToEmptyKinds(vocab(), [], ['black', 'white', 'grey', 'red'])).toEqual(['black', 'white', 'grey']);
    expect(addTermsToEmptyKinds(vocab(), [], ['teal', 'nope'])).toEqual([]);
  });

  it('applyOfferedTerm replaces a single-value kind and adds to a multi-value one', () => {
    expect(applyOfferedTerm(vocab(), ['tee', 'black'], 'hoodie')).toEqual(['black', 'hoodie']);
    expect(applyOfferedTerm(vocab(), ['black'], 'grey')).toEqual(['black', 'grey']);
  });

  it('applyOfferedTerm never deselects and never adds a retired term', () => {
    expect(applyOfferedTerm(vocab(), ['black'], 'black')).toEqual(['black']);
    expect(applyOfferedTerm(vocab(), [], 'teal')).toEqual([]);
  });
});
