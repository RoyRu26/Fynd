import { describe, expect, it } from 'vitest';

import {
  BRAND_TEXT_MAX_LENGTH,
  NO_BRAND,
  brandSelectionFromListing,
  brandSelectionLabel,
  brandSelectionToArgs,
  brandTextError,
  cleanBrandText,
  findExactSuggestion,
  isBlankBrandInput,
  isolate,
  resolveTypedBrand,
  sameBrandSelection,
  suggestionAliasHint,
  toBrandSuggestions,
  type BrandSuggestion,
} from '@/features/brands/brands';

const NIKE: BrandSuggestion = { id: 'nike-id', name: 'Nike', matchedAlias: 'Nike' };
const NIKE_HE: BrandSuggestion = { id: 'nike-id', name: 'Nike', matchedAlias: 'נייקי' };

describe('cleanBrandText', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanBrandText('  Tiny    Label  ')).toBe('Tiny Label');
  });

  it('treats a tab or newline between words as a space, like the server', () => {
    expect(cleanBrandText('Tiny\tLabel')).toBe('Tiny Label');
    expect(cleanBrandText('Tiny\nLabel')).toBe('Tiny Label');
  });

  it('drops invisible formatting characters instead of turning them into spaces', () => {
    expect(cleanBrandText('Ni\u200bke')).toBe('Nike');
    expect(cleanBrandText('\u202eNike')).toBe('Nike');
    expect(cleanBrandText('\ufeffNike')).toBe('Nike');
  });

  it('drops other control characters', () => {
    expect(cleanBrandText('Ti\u0001ny')).toBe('Tiny');
  });

  it('leaves Hebrew and accents alone', () => {
    expect(cleanBrandText(' נייקי ')).toBe('נייקי');
    expect(cleanBrandText('Hermès')).toBe('Hermès');
  });
});

describe('brandTextError', () => {
  it('accepts empty (no brand), ordinary names and non-Latin scripts', () => {
    expect(brandTextError('')).toBeNull();
    expect(brandTextError('Local Leather Workshop')).toBeNull();
    expect(brandTextError('נייקי')).toBeNull();
    expect(brandTextError('無印良品')).toBeNull();
    expect(brandTextError('7 For All Mankind')).toBeNull();
  });

  it('rejects symbol-only text and over-long text', () => {
    expect(brandTextError('???')).not.toBeNull();
    expect(brandTextError('a'.repeat(BRAND_TEXT_MAX_LENGTH + 1))).not.toBeNull();
    expect(brandTextError('a'.repeat(BRAND_TEXT_MAX_LENGTH))).toBeNull();
  });
});

describe('selection <-> listing and RPC arguments', () => {
  it('reads a known brand from the embedded row', () => {
    expect(
      brandSelectionFromListing({ brand_id: 'b1', brand_text: null, brand: { id: 'b1', name: 'Zara' } }),
    ).toEqual({ kind: 'brand', id: 'b1', name: 'Zara' });
  });

  it('reads free text, and none', () => {
    expect(brandSelectionFromListing({ brand_id: null, brand_text: 'Handmade', brand: null })).toEqual({
      kind: 'text',
      text: 'Handmade',
    });
    expect(brandSelectionFromListing({ brand_id: null, brand_text: null, brand: null })).toEqual(NO_BRAND);
  });

  it('sends at most one of id and text', () => {
    expect(brandSelectionToArgs({ kind: 'brand', id: 'b1', name: 'Zara' })).toEqual({ brandId: 'b1', brandText: null });
    expect(brandSelectionToArgs({ kind: 'text', text: 'Handmade' })).toEqual({ brandId: null, brandText: 'Handmade' });
    expect(brandSelectionToArgs(NO_BRAND)).toEqual({ brandId: null, brandText: null });
  });

  it('compares selections by what the server would store', () => {
    expect(sameBrandSelection(NO_BRAND, NO_BRAND)).toBe(true);
    expect(sameBrandSelection({ kind: 'brand', id: 'a', name: 'A' }, { kind: 'brand', id: 'a', name: 'Renamed' })).toBe(true);
    expect(sameBrandSelection({ kind: 'brand', id: 'a', name: 'A' }, { kind: 'brand', id: 'b', name: 'A' })).toBe(false);
    expect(sameBrandSelection({ kind: 'text', text: 'x1' }, { kind: 'text', text: 'x2' })).toBe(false);
    expect(sameBrandSelection({ kind: 'text', text: 'Zara' }, { kind: 'brand', id: 'z', name: 'Zara' })).toBe(false);
  });

  it('labels a selection for display', () => {
    expect(brandSelectionLabel({ kind: 'brand', id: 'b1', name: 'Zara' })).toBe('Zara');
    expect(brandSelectionLabel({ kind: 'text', text: 'Handmade' })).toBe('Handmade');
    expect(brandSelectionLabel(NO_BRAND)).toBeNull();
  });
});

describe('suggestions', () => {
  it('maps search rows', () => {
    expect(toBrandSuggestions([{ id: 'nike-id', name: 'Nike', matched_alias: 'נייקי' }])).toEqual([NIKE_HE]);
  });

  it('shows an alias hint only when the match came through another spelling', () => {
    expect(suggestionAliasHint(NIKE)).toBeNull();
    expect(suggestionAliasHint({ id: 'n', name: 'Nike', matchedAlias: 'NIKE' })).toBeNull();
    expect(suggestionAliasHint(NIKE_HE)).toBe('נייקי');
  });
});

describe('resolveTypedBrand', () => {
  it('is no brand for blank input', () => {
    expect(resolveTypedBrand('   ', [NIKE])).toEqual({ selection: NO_BRAND, error: null });
  });

  it('picks the brand when the text equals a suggestion name, ignoring case', () => {
    expect(resolveTypedBrand(' nike ', [NIKE]).selection).toEqual({ kind: 'brand', id: 'nike-id', name: 'Nike' });
  });

  it('picks the brand when the text equals the matched alias', () => {
    expect(resolveTypedBrand('נייקי', [NIKE_HE]).selection).toEqual({ kind: 'brand', id: 'nike-id', name: 'Nike' });
  });

  it('does not fuzzy match: a near miss stays custom text', () => {
    expect(resolveTypedBrand('Nikee', [NIKE]).selection).toEqual({ kind: 'text', text: 'Nikee' });
  });

  it('keeps unknown text as custom text, cleaned', () => {
    expect(resolveTypedBrand('  Local   Workshop ', []).selection).toEqual({ kind: 'text', text: 'Local Workshop' });
  });

  it('reports an error for unusable text', () => {
    expect(resolveTypedBrand('???', []).error).not.toBeNull();
    expect(resolveTypedBrand('a'.repeat(61), []).error).not.toBeNull();
  });
});

describe('findExactSuggestion', () => {
  it('matches by name or matched alias, ignoring case and edge whitespace', () => {
    expect(findExactSuggestion(' NIKE ', [NIKE])).toBe(NIKE);
    expect(findExactSuggestion('נייקי', [NIKE_HE])).toBe(NIKE_HE);
  });

  it('never matches a near miss, an empty input or no suggestions', () => {
    expect(findExactSuggestion('Nikee', [NIKE])).toBeNull();
    expect(findExactSuggestion('   ', [NIKE])).toBeNull();
    expect(findExactSuggestion('nike', [])).toBeNull();
  });
});

describe('isBlankBrandInput', () => {
  it('is true for empty, whitespace and control-character-only input', () => {
    expect(isBlankBrandInput('')).toBe(true);
    expect(isBlankBrandInput('  \t ')).toBe(true);
    expect(isBlankBrandInput('\u0001\u0002')).toBe(true);
    expect(isBlankBrandInput(' a ')).toBe(false);
  });
});

describe('isolate', () => {
  it('wraps text in first-strong isolate and pop-directional-isolate marks', () => {
    expect(isolate('נייקי')).toBe('\u2068נייקי\u2069');
  });
});

describe('length is counted in code points, like the server', () => {
  it('accepts 60 emoji-bearing characters that are 80 UTF-16 units', () => {
    const name = `${'a'.repeat(40)}${'😀'.repeat(20)}`;
    expect([...name].length).toBe(60);
    expect(name.length).toBe(80);
    expect(brandTextError(name)).toBeNull();
  });

  it('rejects 61 code points', () => {
    expect(brandTextError('a'.repeat(61))).not.toBeNull();
  });
});
