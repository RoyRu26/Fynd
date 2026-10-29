import { assertEquals } from 'jsr:@std/assert@1';

import { buildManifest } from './manifest.ts';
import { isValidStoredSuggestion, normalizeKeyword, parseSuggestion, type ParseContext } from './parse.ts';
import { fixtureTaxonomy, SHOES, TOPS } from './testing.ts';

function ctx(categoryHintId: string | null = null): ParseContext {
  const taxonomy = fixtureTaxonomy();
  return { taxonomy, manifest: buildManifest(taxonomy, categoryHintId), categoryHintId };
}

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Grey hoodie',
    description: 'Soft grey hoodie, lightly worn.',
    condition: { value: 'good', confidence: 0.7 },
    category_path: 'Women > Tops',
    price_min_amount: 4000,
    price_max_amount: 6000,
    item_type: { value: 'hoodie', confidence: 0.92 },
    brand: { value: 'Nike', confidence: 0.95, evidence: 'label' },
    colors: [{ value: 'grey', confidence: 0.9 }, { value: 'black', confidence: 0.4 }],
    styles: [{ value: 'streetwear', confidence: 0.7 }],
    materials: [{ value: 'cotton', confidence: 0.88, evidence: 'label' }],
    pattern: { value: 'solid', confidence: 0.8 },
    fit: { value: 'regular', confidence: 0.65 },
    keywords: ['Crewneck', 'zip up'],
    ...overrides,
  };
}

Deno.test('a fully valid response maps slugs to term ids and keeps everything', () => {
  const { suggestion, issues, usableFieldCount } = parseSuggestion(validInput(), ctx());
  assertEquals(issues, []);
  assertEquals(suggestion.categoryId, TOPS);
  assertEquals(suggestion.itemType, { termId: 't-hoodie', slug: 'hoodie', confidence: 0.92 });
  assertEquals(suggestion.colors.map((c) => c.termId), ['c-grey', 'c-black']);
  assertEquals(suggestion.materials, [{ termId: 'm-cotton', slug: 'cotton', confidence: 0.88, evidence: 'label' }]);
  assertEquals(suggestion.brand, { text: 'Nike', confidence: 0.95, evidence: 'label' });
  assertEquals(suggestion.keywords, ['crewneck', 'zip up']);
  assertEquals(suggestion.price, { minAmount: 4000, maxAmount: 6000 });
  assertEquals(suggestion.version, 1);
  assertEquals(usableFieldCount, 13);
});

Deno.test('one bad field does not destroy the others', () => {
  const { suggestion, issues } = parseSuggestion(
    validInput({ condition: { value: 'mint', confidence: 0.9 }, price_min_amount: 'cheap' }),
    ctx(),
  );
  assertEquals(suggestion.condition, null);
  assertEquals(suggestion.price, null);
  assertEquals(suggestion.title, 'Grey hoodie');
  assertEquals(suggestion.itemType?.slug, 'hoodie');
  assertEquals(issues.includes('condition.unknown_value'), true);
  assertEquals(issues.includes('price.invalid'), true);
});

Deno.test('unknown taxonomy values are rejected, and retired terms count as unknown', () => {
  const { suggestion, issues } = parseSuggestion(
    validInput({ colors: [{ value: 'teal', confidence: 0.9 }, { value: 'mauve', confidence: 0.9 }, { value: 'grey', confidence: 0.9 }] }),
    ctx(),
  );
  assertEquals(suggestion.colors.map((c) => c.slug), ['grey']);
  assertEquals(issues.includes('colors.unknown_value'), true);
});

Deno.test('an unknown category path is dropped without inventing an id', () => {
  const { suggestion, issues } = parseSuggestion(validInput({ category_path: 'Women > Capes' }), ctx());
  assertEquals(suggestion.categoryId, null);
  assertEquals(issues.includes('category.unknown_value'), true);
});

Deno.test('an item type incompatible with the category hint is dropped (DB stays authoritative too)', () => {
  const { suggestion, issues } = parseSuggestion(
    validInput({ category_path: 'Women > Shoes', item_type: { value: 'hoodie', confidence: 0.99 } }),
    ctx(SHOES),
  );
  assertEquals(suggestion.itemType, null);
  assertEquals(issues.includes('item_type.not_allowed_for_category'), true);
});

Deno.test('without a hint, item type and kinds are checked against the category the model chose', () => {
  const { suggestion, issues } = parseSuggestion(
    validInput({ category_path: 'Women > Shoes', item_type: { value: 'hoodie', confidence: 0.99 } }),
    ctx(null),
  );
  assertEquals(suggestion.itemType, null);
  assertEquals(issues.includes('item_type.not_applicable_to_category'), true);
  // fit does not apply to shoes
  assertEquals(suggestion.fit, null);
  assertEquals(issues.includes('fit.not_applicable_to_category'), true);
});

Deno.test('lists are de-duplicated and clamped to max_values', () => {
  const { suggestion, issues } = parseSuggestion(
    validInput({
      colors: [
        { value: 'grey', confidence: 0.9 },
        { value: 'grey', confidence: 0.8 },
        { value: 'black', confidence: 0.7 },
        { value: 'white', confidence: 0.7 },
        { value: 'red', confidence: 0.7 },
      ],
    }),
    ctx(),
  );
  assertEquals(suggestion.colors.map((c) => c.slug), ['grey', 'black', 'white']);
  assertEquals(issues.includes('colors.duplicate'), true);
  assertEquals(issues.includes('colors.clamped'), true);
});

Deno.test('a confidence outside 0..1 or not a number drops that value', () => {
  const { suggestion, issues } = parseSuggestion(
    validInput({ item_type: { value: 'hoodie', confidence: 1.4 }, pattern: { value: 'solid', confidence: 'high' } }),
    ctx(),
  );
  assertEquals(suggestion.itemType, null);
  assertEquals(suggestion.pattern, null);
  assertEquals(issues.includes('item_type.bad_confidence'), true);
});

Deno.test('a material needs valid evidence', () => {
  const { suggestion, issues } = parseSuggestion(
    validInput({ materials: [{ value: 'cotton', confidence: 0.9, evidence: 'vibes' }, { value: 'leather', confidence: 0.6, evidence: 'visual' }] }),
    ctx(),
  );
  assertEquals(suggestion.materials.map((m) => m.slug), ['leather']);
  assertEquals(issues.includes('materials.bad_evidence'), true);
});

Deno.test('brand: cleaned text with evidence; bad evidence or symbol-only text is dropped', () => {
  assertEquals(
    parseSuggestion(validInput({ brand: { value: ' Ni​ke ', confidence: 0.9, evidence: 'logo' } }), ctx()).suggestion.brand,
    { text: 'Nike', confidence: 0.9, evidence: 'logo' },
  );
  assertEquals(
    parseSuggestion(validInput({ brand: { value: 'Nike', confidence: 0.9, evidence: 'gut' } }), ctx()).suggestion.brand,
    null,
  );
  assertEquals(
    parseSuggestion(validInput({ brand: { value: '???', confidence: 0.9, evidence: 'label' } }), ctx()).suggestion.brand,
    null,
  );
  assertEquals(parseSuggestion(validInput({ brand: null }), ctx()).suggestion.brand, null);
});

Deno.test('keywords are normalized like the database does, invalid ones dropped, max 10', () => {
  const many = Array.from({ length: 14 }, (_, i) => `word${i}`);
  const { suggestion, issues } = parseSuggestion(validInput({ keywords: ['  Zip   UP ', 'zip up', 'x', 'wow!!', 'טרנינג', ...many] }), ctx());
  assertEquals(suggestion.keywords.slice(0, 2), ['zip up', 'טרנינג']);
  assertEquals(suggestion.keywords.length, 10);
  assertEquals(issues.includes('keywords.invalid'), true);
  assertEquals(issues.includes('keywords.clamped'), true);
  assertEquals(normalizeKeyword('-edge'), null);
});

Deno.test('null and missing fields are "no suggestion", not errors', () => {
  const { suggestion, issues } = parseSuggestion(
    { title: null, description: null, condition: null, category_path: null, price_min_amount: null, price_max_amount: null,
      item_type: null, brand: null, colors: [], styles: [], materials: [], pattern: null, fit: null, keywords: [],
      title_extra: 'ignored' },
    ctx(),
  );
  assertEquals(issues, []);
  assertEquals(suggestion.title, null);
});

Deno.test('a useless response has zero usable fields', () => {
  assertEquals(parseSuggestion('not even an object', ctx()).usableFieldCount, 0);
  assertEquals(parseSuggestion({}, ctx()).usableFieldCount, 0);
});

Deno.test('prices: integer agorot, max >= min, max > 0, bounded', () => {
  assertEquals(parseSuggestion(validInput({ price_min_amount: 5000, price_max_amount: 4000 }), ctx()).suggestion.price, null);
  assertEquals(parseSuggestion(validInput({ price_min_amount: 0, price_max_amount: 0 }), ctx()).suggestion.price, null);
  assertEquals(parseSuggestion(validInput({ price_min_amount: 10.5, price_max_amount: 20 }), ctx()).suggestion.price, null);
  assertEquals(parseSuggestion(validInput({ price_min_amount: 0, price_max_amount: 1 }), ctx()).suggestion.price, { minAmount: 0, maxAmount: 1 });
});

Deno.test('title must be 3..120 characters after cleanup', () => {
  assertEquals(parseSuggestion(validInput({ title: 'ok' }), ctx()).suggestion.title, null);
  assertEquals(parseSuggestion(validInput({ title: 'x'.repeat(121) }), ctx()).suggestion.title, null);
});

// ---------------- stored suggestions (cache path) ----------------

Deno.test('a suggestion this module produced is a valid stored suggestion', () => {
  const c = ctx();
  const { suggestion } = parseSuggestion(validInput(), c);
  const stored = { ...suggestion, brand: { brandId: null, name: 'Nike', confidence: 0.95, evidence: 'label' } };
  assertEquals(isValidStoredSuggestion(stored, c.manifest), true);
});

Deno.test('a forged or stale stored suggestion is not served from the cache', () => {
  const c = ctx();
  const { suggestion } = parseSuggestion(validInput(), c);
  const stored = { ...suggestion, brand: null };
  const variants: [string, unknown][] = [
    ['not an object', 'hello'],
    ['unknown version', { ...stored, version: 2 }],
    ['unknown term id', { ...stored, colors: [{ termId: 'c-mauve', slug: 'mauve', confidence: 0.9 }] }],
    ['term of the wrong kind', { ...stored, colors: [{ termId: 't-hoodie', slug: 'hoodie', confidence: 0.9 }] }],
    ['retired term (no longer in the manifest)', { ...stored, colors: [{ termId: 'c-teal', slug: 'teal', confidence: 0.9 }] }],
    ['unknown category', { ...stored, categoryId: 'cat-nowhere' }],
    ['bad confidence', { ...stored, pattern: { termId: 'p-solid', slug: 'solid', confidence: 3 } }],
    ['bad condition', { ...stored, condition: { value: 'mint', confidence: 0.9 } }],
    ['non-normalized keyword', { ...stored, keywords: ['NOT NORMAL!'] }],
    ['too many keywords', { ...stored, keywords: Array.from({ length: 11 }, (_, i) => `kw${i}`) }],
    ['bad price', { ...stored, price: { minAmount: 5, maxAmount: 1 } }],
    ['missing field', { ...stored, keywords: undefined }],
  ];
  for (const [label, value] of variants) {
    assertEquals(isValidStoredSuggestion(value, c.manifest), false, label);
  }
});
