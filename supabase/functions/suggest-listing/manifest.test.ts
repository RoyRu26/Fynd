import { assertEquals, assertNotEquals, assertThrows } from 'jsr:@std/assert@1';

import { SUGGESTION_MODEL } from './anthropic.ts';
import {
  analysisInputHash,
  buildManifest,
  canonicalJson,
  metadataSchemaVersion,
  normalizeSellerText,
  PROMPT_VERSION,
  type AnalysisInputs,
} from './manifest.ts';
import { buildTaxonomy } from './taxonomy.ts';
import { fixtureTaxonomy, FURNITURE, SHOES, TOPS } from './testing.ts';

// ---------------- canonical JSON ----------------

Deno.test('canonicalJson sorts object keys at every level, keeps array order, no whitespace', () => {
  assertEquals(canonicalJson({ b: 1, a: { d: [3, 1], c: null } }), '{"a":{"c":null,"d":[3,1]},"b":1}');
});

Deno.test('canonicalJson: key order in the input never changes the output', () => {
  assertEquals(canonicalJson({ x: 1, y: 2 }), canonicalJson({ y: 2, x: 1 }));
});

Deno.test('canonicalJson refuses values that would serialize ambiguously', () => {
  assertThrows(() => canonicalJson({ a: undefined }));
  assertThrows(() => canonicalJson({ a: Number.NaN }));
});

// ---------------- manifest ----------------

Deno.test('the manifest offers only active terms (a retired color is never offered)', () => {
  const manifest = buildManifest(fixtureTaxonomy(), null);
  assertEquals(manifest.terms.some((term) => term.slug === 'teal'), false);
  assertEquals(manifest.terms.some((term) => term.slug === 'black'), true);
});

Deno.test('a category hint restricts the allowed item types and the kinds offered', () => {
  const taxonomy = fixtureTaxonomy();
  assertEquals(buildManifest(taxonomy, null).item_type_ids_allowed, ['t-hoodie', 't-sneakers']);
  assertEquals(buildManifest(taxonomy, TOPS).item_type_ids_allowed, ['t-hoodie']);
  assertEquals(buildManifest(taxonomy, SHOES).item_type_ids_allowed, ['t-sneakers']);
  assertEquals(buildManifest(taxonomy, SHOES).attribute_kinds_offered.includes('fit'), false);
  assertEquals(buildManifest(taxonomy, TOPS).attribute_kinds_offered.includes('fit'), true);
  assertEquals(buildManifest(taxonomy, FURNITURE).attribute_kinds_offered, []);
});

Deno.test('metadata_schema_version is stable for the same vocabulary', async () => {
  assertEquals(
    await metadataSchemaVersion(buildManifest(fixtureTaxonomy(), TOPS)),
    await metadataSchemaVersion(buildManifest(fixtureTaxonomy(), TOPS)),
  );
});

Deno.test('metadata_schema_version changes when a term, a mapping, a category or the hint changes', async () => {
  const base = await metadataSchemaVersion(buildManifest(fixtureTaxonomy(), null));

  const withHint = await metadataSchemaVersion(buildManifest(fixtureTaxonomy(), TOPS));
  assertNotEquals(withHint, base, 'category hint (allowed item types)');

  const taxonomy = fixtureTaxonomy();
  const renamed = { ...taxonomy, terms: taxonomy.terms.map((t) => (t.slug === 'grey' ? { ...t, slug: 'gray' } : t)) };
  assertNotEquals(await metadataSchemaVersion(buildManifest(renamed, null)), base, 'term slug');

  const retired = { ...taxonomy, terms: taxonomy.terms.filter((t) => t.slug !== 'red') };
  assertNotEquals(await metadataSchemaVersion(buildManifest(retired, null)), base, 'a term retired');

  const remapped = { ...taxonomy, itemTypeCategoryIds: { ...taxonomy.itemTypeCategoryIds, 't-hoodie': [TOPS, SHOES] } };
  assertNotEquals(await metadataSchemaVersion(buildManifest(remapped, null)), base, 'item-type mapping');

  const recategorized = {
    ...taxonomy,
    categoryPaths: taxonomy.categoryPaths.map((p) => (p.categoryId === TOPS ? { ...p, path: 'Women > Tops & tees' } : p)),
  };
  assertNotEquals(await metadataSchemaVersion(buildManifest(recategorized, null)), base, 'category path');

  const fewerColors = { ...taxonomy, maxValues: { ...taxonomy.maxValues, color: 2 } };
  assertNotEquals(await metadataSchemaVersion(buildManifest(fewerColors, null)), base, 'max values');
});

Deno.test('metadata_schema_version does not depend on the order rows come back from the database', async () => {
  const forward = fixtureTaxonomy();
  const shuffled = buildTaxonomy({
    categories: [
      { id: FURNITURE, name: 'Furniture', parent_id: 'grp-home' },
      { id: SHOES, name: 'Shoes', parent_id: 'grp-women' },
      { id: TOPS, name: 'Tops', parent_id: 'grp-women' },
      { id: 'grp-home', name: 'Home', parent_id: null },
      { id: 'grp-women', name: 'Women', parent_id: null },
    ],
    kinds: [
      { kind: 'fit', max_values: 1 },
      { kind: 'pattern', max_values: 1 },
      { kind: 'material', max_values: 2 },
      { kind: 'style', max_values: 3 },
      { kind: 'color', max_values: 3 },
      { kind: 'item_type', max_values: 1 },
    ],
    terms: [...forward.terms].reverse().map((t) => ({ ...t, retired_at: null })),
    kindCategories: [
      { kind: 'fit', category_id: TOPS },
      ...['pattern', 'material', 'style', 'color'].flatMap((kind) => [
        { kind, category_id: SHOES },
        { kind, category_id: TOPS },
      ]),
    ],
    itemTypeCategories: [
      { term_id: 't-sneakers', category_id: SHOES },
      { term_id: 't-hoodie', category_id: TOPS },
    ],
  });
  assertEquals(
    await metadataSchemaVersion(buildManifest(shuffled, TOPS)),
    await metadataSchemaVersion(buildManifest(forward, TOPS)),
  );
});

// ---------------- analysis_input_hash ----------------

function inputs(overrides: Partial<AnalysisInputs> = {}): AnalysisInputs {
  return {
    model: SUGGESTION_MODEL,
    promptVersion: PROMPT_VERSION,
    metadataSchemaVersion: 'a'.repeat(64),
    images: [
      { imageId: 'img-1', storagePath: 'u/l/one.jpg', position: 0 },
      { imageId: 'img-2', storagePath: 'u/l/two.jpg', position: 1 },
    ],
    title: 'Grey hoodie',
    description: null,
    categoryHintId: TOPS,
    ...overrides,
  };
}

Deno.test('the input hash is a 64-character hex digest and is deterministic', async () => {
  const hash = await analysisInputHash(inputs());
  assertEquals(/^[0-9a-f]{64}$/.test(hash), true);
  assertEquals(await analysisInputHash(inputs()), hash);
});

Deno.test('every model-relevant input changes the hash', async () => {
  const base = await analysisInputHash(inputs());
  const variants: [string, Partial<AnalysisInputs>][] = [
    ['model id', { model: 'claude-haiku-4-5-20990101' }],
    ['prompt version', { promptVersion: PROMPT_VERSION + 1 }],
    ['metadata schema version', { metadataSchemaVersion: 'b'.repeat(64) }],
    ['image order', {
      images: [
        { imageId: 'img-2', storagePath: 'u/l/two.jpg', position: 0 },
        { imageId: 'img-1', storagePath: 'u/l/one.jpg', position: 1 },
      ],
    }],
    ['an added image', { images: [...inputs().images, { imageId: 'img-3', storagePath: 'u/l/three.jpg', position: 2 }] }],
    ['a removed image', { images: [{ imageId: 'img-1', storagePath: 'u/l/one.jpg', position: 0 }] }],
    ['a different path', {
      images: [
        { imageId: 'img-1', storagePath: 'u/l/other.jpg', position: 0 },
        { imageId: 'img-2', storagePath: 'u/l/two.jpg', position: 1 },
      ],
    }],
    ['a photo re-attached at the same path (new row id)', {
      images: [
        { imageId: 'img-9', storagePath: 'u/l/one.jpg', position: 0 },
        { imageId: 'img-2', storagePath: 'u/l/two.jpg', position: 1 },
      ],
    }],
    ['title', { title: 'Black hoodie' }],
    ['title cleared', { title: null }],
    ['description', { description: 'Soft cotton' }],
    ['category hint', { categoryHintId: SHOES }],
    ['category hint cleared', { categoryHintId: null }],
  ];
  for (const [label, override] of variants) {
    assertNotEquals(await analysisInputHash(inputs(override)), base, label);
  }
});

Deno.test('seller text is trimmed, and empty text is the same as none', () => {
  assertEquals(normalizeSellerText('  Grey hoodie  '), 'Grey hoodie');
  assertEquals(normalizeSellerText('   '), null);
  assertEquals(normalizeSellerText(null), null);
});
