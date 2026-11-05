import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';

import { buildPrompt, buildSuggestionTool, isRetryableProviderError } from './anthropic.ts';
import { buildManifest, type Manifest } from './manifest.ts';
import { fixtureTaxonomy, FURNITURE, SHOES, TOPS } from './testing.ts';

type Schema = Record<string, unknown>;

/** Every enum value anywhere in a JSON schema (null excluded). */
function collectEnumValues(schema: unknown, out: string[] = []): string[] {
  if (Array.isArray(schema)) {
    for (const item of schema) collectEnumValues(item, out);
  } else if (schema && typeof schema === 'object') {
    for (const [key, value] of Object.entries(schema)) {
      if (key === 'enum' && Array.isArray(value)) {
        for (const v of value) if (v !== null) out.push(String(v));
      } else {
        collectEnumValues(value, out);
      }
    }
  }
  return out;
}

function allowedValues(manifest: Manifest): Set<string> {
  return new Set([
    ...manifest.categories.map((c) => c.path),
    ...manifest.conditions,
    ...manifest.terms.map((t) => t.slug),
    ...manifest.brand_evidence,
    ...manifest.material_evidence,
  ]);
}

function props(manifest: Manifest): Record<string, Schema> {
  return (buildSuggestionTool(manifest).input_schema as { properties: Record<string, Schema> }).properties;
}

Deno.test('every enum value in the tool comes from the manifest', () => {
  for (const hint of [null, TOPS, SHOES, FURNITURE]) {
    const manifest = buildManifest(fixtureTaxonomy(), hint);
    const allowed = allowedValues(manifest);
    for (const value of collectEnumValues(buildSuggestionTool(manifest).input_schema)) {
      assertEquals(allowed.has(value), true, `"${value}" (hint ${hint}) is not in the manifest`);
    }
  }
});

Deno.test('the item-type enum is restricted to types compatible with the category hint', () => {
  const tops = props(buildManifest(fixtureTaxonomy(), TOPS));
  const itemTypeValues = ((tops.item_type.properties as Record<string, Schema>).value.enum as string[]);
  assertEquals(itemTypeValues, ['hoodie']);

  const anyCategory = props(buildManifest(fixtureTaxonomy(), null));
  assertEquals(
    ((anyCategory.item_type.properties as Record<string, Schema>).value.enum as string[]).sort(),
    ['hoodie', 'sneakers'],
  );
});

Deno.test('a kind that does not apply to the hint is never offered (no fit for shoes, nothing for furniture)', () => {
  const shoes = props(buildManifest(fixtureTaxonomy(), SHOES));
  assertEquals(shoes.fit.type, 'null');

  const furniture = props(buildManifest(fixtureTaxonomy(), FURNITURE));
  assertEquals(furniture.item_type.type, 'null');
  assertEquals(furniture.colors.maxItems, 0);
  assertEquals(furniture.pattern.type, 'null');
});

Deno.test('list maxima come from the database max_values', () => {
  const p = props(buildManifest(fixtureTaxonomy(), TOPS));
  assertEquals(p.colors.maxItems, 3);
  assertEquals(p.styles.maxItems, 3);
  assertEquals(p.materials.maxItems, 2);
});

Deno.test('the tool has no size field, and brand/material carry evidence', () => {
  const p = props(buildManifest(fixtureTaxonomy(), TOPS));
  assertEquals('size' in p, false);
  const brandEvidence = (p.brand.properties as Record<string, Schema>).evidence.enum as string[];
  assertEquals(brandEvidence, ['label', 'printed_text', 'logo', 'style_inference', 'none']);
  const materialItem = (p.materials.items as Schema).properties as Record<string, Schema>;
  assertEquals(materialItem.evidence.enum, ['label', 'visual']);
});

Deno.test('the prompt no longer says "always guess", and wraps the seller text as context', () => {
  const prompt = buildPrompt({ title: 'Grey hoodie', description: null, categoryPath: 'Women > Tops' });
  assertEquals(/always (call|make|guess)|best-guess|best reasonable estimate/i.test(prompt), false);
  assertStringIncludes(prompt, 'use null');
  assertStringIncludes(prompt, 'Do not suggest a size');
  assertStringIncludes(prompt, '<seller_input>');
  assertStringIncludes(prompt, '"Grey hoodie"');
  assertStringIncludes(prompt, '"Women > Tops"');
});

Deno.test('only temporary overload is retryable', () => {
  assertEquals(isRetryableProviderError(429, undefined), true);
  assertEquals(isRetryableProviderError(529, undefined), true);
  assertEquals(isRetryableProviderError(500, 'overloaded_error'), true);
  assertEquals(isRetryableProviderError(400, 'invalid_request_error'), false);
  assertEquals(isRetryableProviderError(401, 'authentication_error'), false);
  assertEquals(isRetryableProviderError(500, 'api_error'), false);
  assertEquals(isRetryableProviderError(undefined, undefined), false);
});
