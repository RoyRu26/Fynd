import { describe, expect, it } from 'vitest';

import { NO_BRAND } from '@/features/brands/brands';
import {
  brandTier,
  confidenceTier,
  offersForField,
  pendingOffers,
  planPrefill,
  shortOfferLabel,
  prefilledKinds,
  type OfferContext,
  type SellerSnapshot,
} from '@/features/listings/ai-policy';
import { parseAiSuggestion, photoSetSignature, shouldAutoAnalyze, type AiSuggestion } from '@/features/listings/ai-suggestion';
import { normalizeVocabulary } from '@/features/listings/attributes';

const TOPS = 'c0000001-0000-4000-8000-000000000001';
const SHOES = 'c0000001-0000-4000-8000-000000000005';
const FURNITURE = 'c0000004-0000-4000-8000-000000000001';

const HOODIE = 'a1000001-0000-4000-8000-000000000008';
const SNEAKERS = 'a1000001-0000-4000-8000-000000000022';
const BLACK = 'a1000002-0000-4000-8000-000000000001';
const GREY = 'a1000002-0000-4000-8000-000000000003';
const NAVY = 'a1000002-0000-4000-8000-000000000007';
const VINTAGE = 'a1000003-0000-4000-8000-000000000002';
const COTTON = 'a1000004-0000-4000-8000-000000000001';
const SOLID = 'a1000005-0000-4000-8000-000000000001';
const REGULAR = 'a1000006-0000-4000-8000-000000000002';
const NIKE = 'b0000000-0000-4000-8000-000000000031';

const vocab = normalizeVocabulary({
  kinds: [
    { kind: 'item_type', label: 'Item type', max_values: 1, position: 0 },
    { kind: 'color', label: 'Color', max_values: 3, position: 1 },
    { kind: 'style', label: 'Style', max_values: 3, position: 2 },
    { kind: 'material', label: 'Material', max_values: 2, position: 3 },
    { kind: 'pattern', label: 'Pattern', max_values: 1, position: 4 },
    { kind: 'fit', label: 'Fit', max_values: 1, position: 5 },
  ],
  terms: [
    { id: HOODIE, kind: 'item_type', slug: 'hoodie', label: 'Hoodie', position: 0, retired_at: null },
    { id: SNEAKERS, kind: 'item_type', slug: 'sneakers', label: 'Sneakers', position: 1, retired_at: null },
    { id: BLACK, kind: 'color', slug: 'black', label: 'Black', position: 0, retired_at: null },
    { id: GREY, kind: 'color', slug: 'grey', label: 'Grey', position: 1, retired_at: null },
    { id: NAVY, kind: 'color', slug: 'navy', label: 'Navy', position: 2, retired_at: null },
    { id: VINTAGE, kind: 'style', slug: 'vintage', label: 'Vintage', position: 0, retired_at: null },
    { id: COTTON, kind: 'material', slug: 'cotton', label: 'Cotton', position: 0, retired_at: null },
    { id: SOLID, kind: 'pattern', slug: 'solid', label: 'Solid', position: 0, retired_at: null },
    { id: REGULAR, kind: 'fit', slug: 'regular', label: 'Regular', position: 0, retired_at: null },
  ],
  kindCategories: [
    ...['color', 'style', 'material', 'pattern'].flatMap((kind) => [
      { kind, category_id: TOPS },
      { kind, category_id: SHOES },
    ]),
    { kind: 'fit', category_id: TOPS },
  ],
  itemTypeCategories: [
    { term_id: HOODIE, category_id: TOPS },
    { term_id: SNEAKERS, category_id: SHOES },
  ],
});

const ctx: OfferContext = {
  vocab,
  isKnownCategory: (id) => [TOPS, SHOES, FURNITURE].includes(id),
  categoryLabel: (id) => ({ [TOPS]: 'Women › Tops', [SHOES]: 'Women › Shoes' })[id] ?? null,
  currency: 'ILS',
};

function suggestion(overrides: Partial<AiSuggestion> = {}): AiSuggestion {
  return {
    version: 1,
    title: 'Grey cotton hoodie',
    description: 'Soft grey hoodie.',
    categoryId: TOPS,
    price: { minAmount: 4000, maxAmount: 6000 },
    condition: { value: 'good', confidence: 0.95 },
    itemType: { termId: HOODIE, slug: 'hoodie', confidence: 0.9 },
    colors: [
      { termId: GREY, slug: 'grey', confidence: 0.92 },
      { termId: BLACK, slug: 'black', confidence: 0.7 },
      { termId: NAVY, slug: 'navy', confidence: 0.3 },
    ],
    styles: [{ termId: VINTAGE, slug: 'vintage', confidence: 0.7 }],
    materials: [{ termId: COTTON, slug: 'cotton', confidence: 0.9, evidence: 'label' }],
    pattern: { termId: SOLID, slug: 'solid', confidence: 0.88 },
    fit: { termId: REGULAR, slug: 'regular', confidence: 0.86 },
    brand: { brandId: NIKE, name: 'Nike', confidence: 0.95, evidence: 'label' },
    keywords: ['crewneck', 'zip up'],
    ...overrides,
  };
}

function empty(overrides: Partial<SellerSnapshot> = {}): SellerSnapshot {
  return {
    title: '',
    description: '',
    price: '',
    categoryId: null,
    condition: null,
    selection: [],
    brand: NO_BRAND,
    brandDraft: '',
    keywords: [],
    keywordDraft: '',
    ...overrides,
  };
}

describe('confidence tiers', () => {
  it('>= 0.85 may pre-fill, 0.60–0.85 is an offer, < 0.60 is hidden', () => {
    expect(confidenceTier(0.85)).toBe('prefill');
    expect(confidenceTier(0.84)).toBe('offer');
    expect(confidenceTier(0.6)).toBe('offer');
    expect(confidenceTier(0.59)).toBe('hide');
  });
});

describe('planPrefill: fills only empty fields', () => {
  it('fills an empty draft: text, price midpoint, category and high-confidence attributes', () => {
    const plan = planPrefill(suggestion(), empty(), ctx);
    expect(plan.form).toEqual({
      title: 'Grey cotton hoodie',
      description: 'Soft grey hoodie.',
      price: '50.00',
      categoryId: TOPS,
    });
    // grey (0.92) yes; black (0.7) and navy (0.3) no; vintage (0.7) no; cotton has label evidence.
    expect(plan.termIds).toEqual([HOODIE, GREY, COTTON, SOLID, REGULAR]);
    expect(plan.brand).toEqual({ kind: 'brand', id: NIKE, name: 'Nike' });
    expect(plan.keywords).toEqual(['crewneck', 'zip up']);
  });

  it('never overwrites anything the seller entered', () => {
    const plan = planPrefill(
      suggestion(),
      empty({
        title: 'My hoodie',
        description: 'Mine.',
        price: '30',
        categoryId: TOPS,
        selection: [SNEAKERS, BLACK],
        brand: { kind: 'text', text: 'Handmade' },
        keywords: ['mine'],
      }),
      ctx,
    );
    expect(plan.form).toEqual({});
    // item type and color are taken; the empty kinds can still be filled.
    expect(plan.termIds).toEqual([COTTON, SOLID, REGULAR]);
    expect(plan.brand).toBeNull();
    expect(plan.keywords).toBeNull();
  });

  it('never pre-fills condition, whatever the confidence', () => {
    const plan = planPrefill(suggestion({ condition: { value: 'new', confidence: 1 } }), empty(), ctx);
    expect(JSON.stringify(plan)).not.toContain('"new"');
  });

  it('does not fill brand or keywords while the seller is typing one', () => {
    const plan = planPrefill(suggestion(), empty({ brandDraft: 'Adi', keywordDraft: 'vin' }), ctx);
    expect(plan.brand).toBeNull();
    expect(plan.keywords).toBeNull();
  });

  it('pre-fills no attributes without a category, and only applicable ones with one', () => {
    expect(planPrefill(suggestion({ categoryId: null }), empty(), ctx).termIds).toEqual([]);
    // Seller chose Shoes: hoodie and fit don't apply there.
    const shoes = planPrefill(suggestion(), empty({ categoryId: SHOES }), ctx);
    expect(shoes.termIds).toEqual([GREY, COTTON, SOLID]);
    expect(planPrefill(suggestion(), empty({ categoryId: FURNITURE }), ctx).termIds).toEqual([]);
  });

  it('never applies an unknown category id', () => {
    const plan = planPrefill(suggestion({ categoryId: 'c9999999-0000-4000-8000-000000000001' }), empty(), ctx);
    expect(plan.form.categoryId).toBeUndefined();
    expect(plan.termIds).toEqual([]);
  });

  it('material pre-fills only from a readable label', () => {
    const visual = suggestion({ materials: [{ termId: COTTON, slug: 'cotton', confidence: 0.99, evidence: 'visual' }] });
    expect(planPrefill(visual, empty(), ctx).termIds).not.toContain(COTTON);
    expect(offersForField(pendingOffers(visual, empty({ categoryId: TOPS }), ctx, new Set()), 'material')).toHaveLength(1);
  });
});

describe('brand rules', () => {
  const brand = (over: Partial<NonNullable<AiSuggestion['brand']>>) => ({
    brandId: NIKE,
    name: 'Nike',
    confidence: 0.95,
    evidence: 'label' as const,
    ...over,
  });

  it('pre-fills only with >= 0.90, label/printed_text evidence and a known brand', () => {
    expect(brandTier(brand({}))).toBe('prefill');
    expect(brandTier(brand({ evidence: 'printed_text' }))).toBe('prefill');
    expect(brandTier(brand({ confidence: 0.89 }))).toBe('offer');
    expect(brandTier(brand({ brandId: null, name: 'Tiny Label' }))).toBe('offer');
  });

  it('logo evidence is an offer at most', () => {
    expect(brandTier(brand({ evidence: 'logo', confidence: 0.99 }))).toBe('offer');
  });

  it('style inference and no evidence are never shown', () => {
    expect(brandTier(brand({ evidence: 'style_inference', confidence: 0.99 }))).toBe('hide');
    expect(brandTier(brand({ evidence: 'none', confidence: 0.99 }))).toBe('hide');
    const offers = pendingOffers(
      suggestion({ brand: brand({ evidence: 'style_inference' }) }),
      empty({ categoryId: TOPS }),
      ctx,
      new Set(),
    );
    expect(offersForField(offers, 'brand')).toEqual([]);
  });

  it('an unknown brand is offered as text', () => {
    const offers = pendingOffers(
      suggestion({ brand: brand({ brandId: null, name: 'Tiny Label', confidence: 0.7 }) }),
      empty(),
      ctx,
      new Set(),
    );
    expect(offersForField(offers, 'brand')[0].action).toEqual({ type: 'setBrand', brand: { kind: 'text', text: 'Tiny Label' } });
  });

  it('a seller brand that disagrees gets an offer, the same brand does not', () => {
    const different = pendingOffers(suggestion(), empty({ brand: { kind: 'text', text: 'Adidas' } }), ctx, new Set());
    expect(offersForField(different, 'brand').map((o) => o.label)).toEqual(['Nike']);
    const same = pendingOffers(suggestion(), empty({ brand: { kind: 'brand', id: NIKE, name: 'Nike' } }), ctx, new Set());
    expect(offersForField(same, 'brand')).toEqual([]);
  });
});

describe('pendingOffers: disagreements become "AI suggests" offers', () => {
  const filled = empty({
    title: 'Old hoodie',
    description: 'Mine.',
    price: '30',
    categoryId: SHOES,
    condition: 'fair',
    selection: [SNEAKERS],
  });

  it('offers a different title, description and category instead of replacing them', () => {
    const offers = pendingOffers(suggestion(), filled, ctx, new Set());
    expect(offersForField(offers, 'title')[0].action).toEqual({ type: 'setTitle', value: 'Grey cotton hoodie' });
    expect(offersForField(offers, 'description')).toHaveLength(1);
    expect(offersForField(offers, 'categoryId')[0].label).toBe('Women › Tops');
  });

  it('offers a price range only when the seller price is outside it', () => {
    expect(offersForField(pendingOffers(suggestion(), filled, ctx, new Set()), 'price')[0]).toMatchObject({
      label: '₪40–₪60',
      action: { type: 'setPrice', value: '50.00' },
    });
    expect(offersForField(pendingOffers(suggestion(), { ...filled, price: '45' }, ctx, new Set()), 'price')).toEqual([]);
  });

  it('condition is always an offer, even for an empty field and very high confidence', () => {
    const offers = pendingOffers(suggestion(), empty(), ctx, new Set());
    expect(offersForField(offers, 'condition')[0].action).toEqual({ type: 'setCondition', value: 'good' });
  });

  it('hides values below 0.60 and anything that already matches', () => {
    const offers = pendingOffers(suggestion(), empty({ categoryId: TOPS, selection: [GREY] }), ctx, new Set());
    const colors = offersForField(offers, 'color').map((o) => o.label);
    expect(colors).toEqual(['Black']); // grey already chosen, navy is 0.3
  });

  it('only offers attributes that apply to the current category', () => {
    const offers = pendingOffers(suggestion(), filled, ctx, new Set()); // Shoes
    expect(offersForField(offers, 'item_type')).toEqual([]); // hoodie doesn't fit shoes
    expect(offersForField(offers, 'fit')).toEqual([]);
  });

  it('respects dismissals', () => {
    const all = pendingOffers(suggestion(), filled, ctx, new Set());
    const titleKey = offersForField(all, 'title')[0].key;
    expect(offersForField(pendingOffers(suggestion(), filled, ctx, new Set([titleKey])), 'title')).toEqual([]);
  });

  it('offers missing keywords while there is room', () => {
    const offers = pendingOffers(suggestion(), empty({ keywords: ['crewneck'] }), ctx, new Set());
    expect(offersForField(offers, 'keywords').map((o) => o.label)).toEqual(['zip up']);
    const full = Array.from({ length: 10 }, (_, i) => `k${i}x`);
    expect(offersForField(pendingOffers(suggestion(), empty({ keywords: full }), ctx, new Set()), 'keywords')).toEqual([]);
  });

  it('an offer disappears once the seller value matches it (race-safe: always derived from current state)', () => {
    const before = pendingOffers(suggestion(), filled, ctx, new Set());
    expect(offersForField(before, 'title')).toHaveLength(1);
    const after = pendingOffers(suggestion(), { ...filled, title: ' grey COTTON hoodie ' }, ctx, new Set());
    expect(offersForField(after, 'title')).toEqual([]);
  });
});

describe('prefilledKinds', () => {
  it('marks a kind while it still holds exactly what AI filled', () => {
    const plan = planPrefill(suggestion(), empty(), ctx);
    expect([...prefilledKinds(plan, [HOODIE, GREY, COTTON], vocab)].sort()).toEqual(['color', 'item_type', 'material']);
    // The seller changed the color: no longer marked.
    expect(prefilledKinds(plan, [HOODIE, BLACK], vocab).has('color')).toBe(false);
  });
});

describe('parseAiSuggestion (untrusted input)', () => {
  it('accepts a valid suggestion', () => {
    expect(parseAiSuggestion(suggestion())).not.toBeNull();
  });

  it('rejects an unknown version, a bad confidence or a malformed field', () => {
    expect(parseAiSuggestion({ ...suggestion(), version: 2 })).toBeNull();
    expect(parseAiSuggestion({ ...suggestion(), condition: { value: 'good', confidence: 1.5 } })).toBeNull();
    expect(parseAiSuggestion({ ...suggestion(), colors: 'grey' })).toBeNull();
    expect(parseAiSuggestion(null)).toBeNull();
  });
});

describe('photoSetSignature', () => {
  it('covers the first four paths, in order', () => {
    expect(photoSetSignature(['a', 'b', 'c', 'd', 'e'])).toBe(photoSetSignature(['a', 'b', 'c', 'd', 'z']));
    expect(photoSetSignature(['a', 'b'])).not.toBe(photoSetSignature(['b', 'a']));
    expect(photoSetSignature([])).toBe('');
  });
});

describe('shortOfferLabel', () => {
  it('keeps short labels and shortens long ones on a character boundary', () => {
    expect(shortOfferLabel('Vintage')).toBe('Vintage');
    const long = shortOfferLabel('Soft grey cotton hoodie with a kangaroo pocket and ribbed cuffs, barely worn');
    expect([...long].length).toBeLessThanOrEqual(48);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('review fixes', () => {
  it('prices are only pre-filled or offered for ILS listings (the model prices in agorot)', () => {
    const usd = { ...ctx, currency: 'USD' };
    expect(planPrefill(suggestion(), empty(), usd).form.price).toBeUndefined();
    expect(offersForField(pendingOffers(suggestion(), empty({ price: '30' }), usd, new Set()), 'price')).toEqual([]);
  });

  it('offers a title, description and price into blank fields too (e.g. after a restore)', () => {
    const offers = pendingOffers(suggestion(), empty(), ctx, new Set());
    expect(offersForField(offers, 'title')).toHaveLength(1);
    expect(offersForField(offers, 'description')).toHaveLength(1);
    expect(offersForField(offers, 'price')).toHaveLength(1);
  });

  it('a brand of 60 code points with emoji parses (counted like the server)', () => {
    const name = `${'a'.repeat(40)}${'😀'.repeat(20)}`;
    const brand = { brandId: null, name, confidence: 0.7, evidence: 'printed_text' as const };
    expect(parseAiSuggestion({ ...suggestion(), brand })).not.toBeNull();
    expect(parseAiSuggestion({ ...suggestion(), brand: { ...brand, name: `${name}x` } })).toBeNull();
  });
});

describe('shouldAutoAnalyze', () => {
  const base = { baseline: 'a', signature: 'a\nb', lastRequested: null, photosInFlight: 0, ready: true };

  it('runs when the analyzed photo set changed during the session and the batch settled', () => {
    expect(shouldAutoAnalyze(base)).toBe(true);
  });

  it('never runs just because the editor opened (signature equals the baseline)', () => {
    expect(shouldAutoAnalyze({ ...base, signature: 'a' })).toBe(false);
  });

  it('waits while photos are uploading', () => {
    expect(shouldAutoAnalyze({ ...base, photosInFlight: 1 })).toBe(false);
  });

  it('never re-sends the set it last requested', () => {
    expect(shouldAutoAnalyze({ ...base, lastRequested: 'a\nb' })).toBe(false);
  });

  it('does nothing with no photos, before loading, or before the editor is ready', () => {
    expect(shouldAutoAnalyze({ ...base, signature: '' })).toBe(false);
    expect(shouldAutoAnalyze({ ...base, signature: null })).toBe(false);
    expect(shouldAutoAnalyze({ ...base, baseline: null })).toBe(false);
    expect(shouldAutoAnalyze({ ...base, ready: false })).toBe(false);
  });

  it('a new draft that starts with no photos analyzes its first batch', () => {
    expect(shouldAutoAnalyze({ ...base, baseline: '', signature: 'a' })).toBe(true);
  });
});
