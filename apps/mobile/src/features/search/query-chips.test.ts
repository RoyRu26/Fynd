import { describe, expect, it, vi } from 'vitest';

import { isolate } from '@/features/brands/brands';
import { normalizeVocabulary, type AttributeVocabulary } from '@/features/listings/attributes';
import { EMPTY_EXPLORE_FILTERS, type ExploreFilters } from '@/features/search/active-filters';
import {
  applyQueryChip,
  deriveQueryChipOffers,
  MAX_QUERY_CHIP_OFFERS,
  normalizeRecognisedRow,
  queryChipAccessibilityLabel,
  queryChipAnnouncement,
  queryChipLabel,
  type QueryChipOffer,
  type RecognisedTerm,
  type RecognisedTermRpcRow,
  visibleQueryChipOffers,
} from '@/features/search/query-chips';
import { EMPTY_TERM_FILTERS, MAX_FILTER_IDS_PER_KIND } from '@/features/search/search';

const TOPS = 'cat-women-tops';
const SHOES = 'cat-women-shoes';

function vocab(): AttributeVocabulary {
  return normalizeVocabulary({
    kinds: [
      { kind: 'item_type', label: 'Item type', max_values: 1, position: 0 },
      { kind: 'color', label: 'Color', max_values: 3, position: 1 },
    ],
    terms: [
      { id: 'hoodie', kind: 'item_type', slug: 'hoodie', label: 'Hoodie', position: 0, retired_at: null },
      { id: 'sneakers', kind: 'item_type', slug: 'sneakers', label: 'Sneakers', position: 1, retired_at: null },
      { id: 'black', kind: 'color', slug: 'black', label: 'Black', position: 0, retired_at: null },
      { id: 'white', kind: 'color', slug: 'white', label: 'White', position: 1, retired_at: null },
      { id: 'teal', kind: 'color', slug: 'teal', label: 'Teal', position: 2, retired_at: '2026-10-01T00:00:00Z' },
    ],
    kindCategories: [
      { kind: 'color', category_id: TOPS },
      { kind: 'color', category_id: SHOES },
    ],
    itemTypeCategories: [
      { term_id: 'hoodie', category_id: TOPS },
      { term_id: 'sneakers', category_id: SHOES },
    ],
  });
}

function rpcRow(overrides: Partial<Record<keyof RecognisedTermRpcRow, string | null>> = {}): RecognisedTermRpcRow {
  return {
    kind: 'color',
    term_id: 'black',
    brand_id: null,
    label: 'Black',
    matched_text: 'black',
    query_without_match: 'nike hoodie',
    ...overrides,
  } as RecognisedTermRpcRow;
}

function term(kind: 'color' | 'item_type', id: string, overrides: Partial<RecognisedTerm> = {}): RecognisedTerm {
  return {
    target: { type: 'term', kind, id },
    label: id,
    matchedText: id,
    queryWithoutMatch: `rest without ${id}`,
    ...overrides,
  };
}

function brand(id: string, label: string, overrides: Partial<RecognisedTerm> = {}): RecognisedTerm {
  return {
    target: { type: 'brand', id },
    label,
    matchedText: label.toLowerCase(),
    queryWithoutMatch: `rest without ${label}`,
    ...overrides,
  };
}

function filters(overrides: Partial<ExploreFilters> = {}): ExploreFilters {
  return { ...EMPTY_EXPLORE_FILTERS, ...overrides };
}

function ids(n: number, prefix: string): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
}

describe('normalizeRecognisedRow', () => {
  it('maps a term row', () => {
    expect(normalizeRecognisedRow(rpcRow())).toEqual({
      target: { type: 'term', kind: 'color', id: 'black' },
      label: 'Black',
      matchedText: 'black',
      queryWithoutMatch: 'nike hoodie',
    });
  });

  it('maps a brand row', () => {
    expect(
      normalizeRecognisedRow(rpcRow({ kind: 'brand', term_id: null, brand_id: 'nike', label: 'Nike' })),
    ).toMatchObject({ target: { type: 'brand', id: 'nike' }, label: 'Nike' });
  });

  it('keeps a NULL query_without_match as null', () => {
    expect(normalizeRecognisedRow(rpcRow({ query_without_match: null }))?.queryWithoutMatch).toBeNull();
  });

  it('keeps an empty query_without_match as the empty string', () => {
    expect(normalizeRecognisedRow(rpcRow({ query_without_match: '' }))?.queryWithoutMatch).toBe('');
  });

  it('skips a kind this client does not know', () => {
    expect(normalizeRecognisedRow(rpcRow({ kind: 'season' }))).toBeNull();
  });

  it('skips (null) and reports a row naming both or neither id', () => {
    const reasons: string[] = [];
    const report = (reason: string) => reasons.push(reason);
    expect(normalizeRecognisedRow(rpcRow({ brand_id: 'nike' }), report)).toBeNull();
    expect(normalizeRecognisedRow(rpcRow({ term_id: null }), report)).toBeNull();
    expect(reasons).toHaveLength(2);
  });

  it('skips a row whose kind and id disagree', () => {
    const report = vi.fn();
    expect(normalizeRecognisedRow(rpcRow({ kind: 'brand' }), report)).toBeNull();
    expect(normalizeRecognisedRow(rpcRow({ term_id: null, brand_id: 'nike' }), report)).toBeNull();
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('skips a row with no label', () => {
    const report = vi.fn();
    expect(normalizeRecognisedRow(rpcRow({ label: null }), report)).toBeNull();
    expect(normalizeRecognisedRow(rpcRow({ label: '' }), report)).toBeNull();
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('does not report an unknown kind (a newer taxonomy is not a contract break)', () => {
    const report = vi.fn();
    expect(normalizeRecognisedRow(rpcRow({ kind: 'season' }), report)).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it('never throws without a reporter', () => {
    expect(normalizeRecognisedRow(rpcRow({ label: null }))).toBeNull();
  });
});

describe('labels', () => {
  it('reads "Kind: Value" with the value isolated', () => {
    expect(queryChipLabel('Color', 'Black')).toBe(`Color: ${isolate('Black')}`);
  });

  it('names the action, the filter and the matched words', () => {
    expect(queryChipAccessibilityLabel('Color', 'Black', 'שחור')).toBe(
      `Add Color ${isolate('Black')} filter. Matches “${isolate('שחור')}”`,
    );
  });

  it('omits the match clause when there is no matched text', () => {
    expect(queryChipAccessibilityLabel('Color', 'Black', '')).toBe(`Add Color ${isolate('Black')} filter`);
  });
});

describe('deriveQueryChipOffers', () => {
  it('offers terms and brands in server order with kind labels from the vocabulary', () => {
    const offers = deriveQueryChipOffers(
      [term('color', 'black'), brand('nike', 'Nike'), term('item_type', 'hoodie')],
      filters(),
      vocab(),
      null,
    );
    expect(offers.map((o) => o.label)).toEqual([
      queryChipLabel('Color', 'Black'),
      queryChipLabel('Brand', 'Nike'),
      queryChipLabel('Item type', 'Hoodie'),
    ]);
    expect(offers.map((o) => o.key)).toEqual(['term:color:black', 'brand:nike', 'term:item_type:hoodie']);
  });

  it('uses the vocabulary label for a term, the server label for a brand', () => {
    const [offer] = deriveQueryChipOffers([term('color', 'black', { label: 'BLACK?' })], filters(), vocab(), null);
    expect(offer.label).toBe(queryChipLabel('Color', 'Black'));
  });

  it('caps the row at MAX_QUERY_CHIP_OFFERS, keeping the earliest', () => {
    const offers = deriveQueryChipOffers(
      [term('color', 'black'), term('color', 'white'), brand('nike', 'Nike'), term('item_type', 'hoodie')],
      filters(),
      vocab(),
      null,
    );
    expect(offers).toHaveLength(MAX_QUERY_CHIP_OFFERS);
    expect(offers.map((o) => o.key)).toEqual(['term:color:black', 'term:color:white', 'brand:nike']);
  });

  it('a hidden row does not use up a slot', () => {
    const offers = deriveQueryChipOffers(
      [term('color', 'unknown'), term('color', 'black'), term('color', 'white'), brand('nike', 'Nike')],
      filters(),
      vocab(),
      null,
    );
    expect(offers.map((o) => o.key)).toEqual(['term:color:black', 'term:color:white', 'brand:nike']);
  });

  it('hides terms until the vocabulary loads, but still offers brands', () => {
    const offers = deriveQueryChipOffers([term('color', 'black'), brand('nike', 'Nike')], filters(), undefined, null);
    expect(offers.map((o) => o.key)).toEqual(['brand:nike']);
  });

  it('hides an unknown or retired term', () => {
    expect(deriveQueryChipOffers([term('color', 'nope'), term('color', 'teal')], filters(), vocab(), null)).toEqual([]);
  });

  it('hides a term whose kind disagrees with the vocabulary', () => {
    expect(deriveQueryChipOffers([term('item_type', 'black')], filters(), vocab(), null)).toEqual([]);
  });

  it('hides a term that is already selected', () => {
    const selected = filters({ termIds: { ...EMPTY_TERM_FILTERS, color: ['black'] } });
    expect(deriveQueryChipOffers([term('color', 'black')], selected, vocab(), null)).toEqual([]);
  });

  it('hides a term whose kind is full', () => {
    const full = filters({ termIds: { ...EMPTY_TERM_FILTERS, color: ids(MAX_FILTER_IDS_PER_KIND, 'c') } });
    expect(deriveQueryChipOffers([term('color', 'black')], full, vocab(), null)).toEqual([]);
  });

  it('hides a term that does not apply to the committed category', () => {
    expect(deriveQueryChipOffers([term('item_type', 'hoodie')], filters(), vocab(), [SHOES])).toEqual([]);
    expect(deriveQueryChipOffers([term('item_type', 'sneakers')], filters(), vocab(), [SHOES])).toHaveLength(1);
  });

  it('hides a brand that is already chosen, or when brands are full', () => {
    const chosen = filters({ brands: [{ id: 'nike', name: 'Nike' }] });
    expect(deriveQueryChipOffers([brand('nike', 'Nike')], chosen, vocab(), null)).toEqual([]);
    const full = filters({ brands: ids(MAX_FILTER_IDS_PER_KIND, 'b').map((id) => ({ id, name: id })) });
    expect(deriveQueryChipOffers([brand('nike', 'Nike')], full, vocab(), null)).toEqual([]);
  });

  it('dedupes rows naming the same target', () => {
    const offers = deriveQueryChipOffers(
      [brand('nike', 'Nike'), brand('nike', 'Nike', { matchedText: 'נייקי' })],
      filters(),
      vocab(),
      null,
    );
    expect(offers).toHaveLength(1);
  });

  it('builds the accessibility label and spoken name from the matched text', () => {
    const [offer] = deriveQueryChipOffers([term('color', 'black', { matchedText: 'שחור' })], filters(), vocab(), null);
    expect(offer.accessibilityLabel).toBe(queryChipAccessibilityLabel('Color', 'Black', 'שחור'));
    expect(queryChipAnnouncement(offer)).toBe(`Added Color ${isolate('Black')} filter`);
  });
});

function offerFor(row: RecognisedTerm): QueryChipOffer {
  const [offer] = deriveQueryChipOffers([row], filters(), vocab(), null);
  if (!offer) throw new Error('fixture row was not offered');
  return offer;
}

describe('applyQueryChip', () => {
  it('adds a term and replaces the query with the server text', () => {
    const offer = offerFor(term('color', 'black', { queryWithoutMatch: 'Nike hoodie' }));
    const result = applyQueryChip(offer, filters(), 'Black Nike hoodie', vocab());
    expect(result.filters.termIds.color).toEqual(['black']);
    expect(result.query).toBe('Nike hoodie');
  });

  it('adds a brand with its name', () => {
    const offer = offerFor(brand('nike', 'Nike', { queryWithoutMatch: 'black hoodie' }));
    const result = applyQueryChip(offer, filters(), 'black nike hoodie', vocab());
    expect(result.filters.brands).toEqual([{ id: 'nike', name: 'Nike' }]);
    expect(result.query).toBe('black hoodie');
  });

  it('keeps the current query when the match cannot be removed cleanly', () => {
    const offer = offerFor(term('color', 'black', { queryWithoutMatch: null }));
    expect(applyQueryChip(offer, filters(), 'black/white tee', vocab()).query).toBe('black/white tee');
  });

  it('can empty the query', () => {
    const offer = offerFor(term('item_type', 'hoodie', { queryWithoutMatch: '' }));
    expect(applyQueryChip(offer, filters(), 'hoodie', vocab()).query).toBe('');
  });

  it('keeps the other filters', () => {
    const offer = offerFor(term('color', 'black'));
    const start = filters({ categoryId: TOPS, termIds: { ...EMPTY_TERM_FILTERS, color: ['white'] } });
    const result = applyQueryChip(offer, start, 'q', vocab()).filters;
    expect(result.categoryId).toBe(TOPS);
    expect(result.termIds.color).toEqual(['white', 'black']);
  });

  it('never toggles a selected term or brand off; nothing changes', () => {
    const termOffer = offerFor(term('color', 'black'));
    const withTerm = filters({ termIds: { ...EMPTY_TERM_FILTERS, color: ['black'] } });
    expect(applyQueryChip(termOffer, withTerm, 'black', vocab())).toEqual({ filters: withTerm, query: 'black' });
    expect(applyQueryChip(termOffer, withTerm, 'black', vocab()).filters).toBe(withTerm);

    const brandOffer = offerFor(brand('nike', 'Nike'));
    const withBrand = filters({ brands: [{ id: 'nike', name: 'Nike' }] });
    expect(applyQueryChip(brandOffer, withBrand, 'nike', vocab()).filters).toBe(withBrand);
  });

  it('changes nothing when the kind or the brands are full', () => {
    const full = filters({
      termIds: { ...EMPTY_TERM_FILTERS, color: ids(MAX_FILTER_IDS_PER_KIND, 'c') },
      brands: ids(MAX_FILTER_IDS_PER_KIND, 'b').map((id) => ({ id, name: id })),
    });
    expect(applyQueryChip(offerFor(term('color', 'black')), full, 'black', vocab())).toEqual({
      filters: full,
      query: 'black',
    });
    expect(applyQueryChip(offerFor(brand('nike', 'Nike')), full, 'nike', vocab()).filters).toBe(full);
  });

  it('changes nothing for a term without a vocabulary', () => {
    const offer = offerFor(term('color', 'black'));
    const start = filters();
    expect(applyQueryChip(offer, start, 'black', undefined).filters).toBe(start);
  });
});

describe('visibleQueryChipOffers', () => {
  const rows = [term('color', 'black'), brand('nike', 'Nike')];

  it('offers once the input has settled on the effective query', () => {
    expect(visibleQueryChipOffers('black nike', 'black nike', rows, filters(), vocab(), null)).toHaveLength(2);
  });

  it('ignores surrounding whitespace in the input', () => {
    expect(visibleQueryChipOffers('  black nike ', 'black nike', rows, filters(), vocab(), null)).toHaveLength(2);
  });

  it('shows nothing mid-typing (the rows are for older text)', () => {
    expect(visibleQueryChipOffers('black nike h', 'black nike', rows, filters(), vocab(), null)).toEqual([]);
  });

  it('shows nothing while loading or after a failed recognition', () => {
    expect(visibleQueryChipOffers('black nike', 'black nike', undefined, filters(), vocab(), null)).toEqual([]);
  });

  it('shows nothing for an empty query', () => {
    expect(visibleQueryChipOffers('', '', rows, filters(), vocab(), null)).toEqual([]);
  });

  it('applies the same hiding rules as deriveQueryChipOffers', () => {
    const chosen = filters({ brands: [{ id: 'nike', name: 'Nike' }] });
    expect(visibleQueryChipOffers('black nike', 'black nike', rows, chosen, vocab(), null).map((o) => o.key)).toEqual([
      'term:color:black',
    ]);
  });
});
