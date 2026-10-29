// The cache identity of an analysis (AI listing metadata plan §5).
//
//   * The MANIFEST is the single object every controlled value offered to
//     the model comes from: category ids/paths, conditions, active attribute
//     terms, which kinds apply to which categories, the item-type/category
//     mapping, the item types allowed for this request (after the category
//     hint), the max counts, the evidence values and the tool schema
//     version. buildSuggestionTool() (anthropic.ts) builds every enum from it
//     and nothing else, so the request and the version can't drift apart.
//   * metadata_schema_version = sha256(canonical JSON of the manifest).
//   * analysis_input_hash = sha256(canonical JSON of every model-relevant
//     input): hash format, exact model id, prompt version, metadata schema
//     version, the ordered analyzed images (row id, storage path, position —
//     the row id changes when a photo is removed and re-attached, even at the
//     same path), the trimmed title/description and the category hint.
//
// Canonical JSON: object keys sorted (recursively), arrays kept in order
// (the builders sort them deterministically first), no whitespace, UTF-8.
//
// Pure; unit-tested in manifest.test.ts.

import { BRAND_EVIDENCE, LISTING_CONDITIONS, MATERIAL_EVIDENCE } from './constants.ts';
import { allowedItemTypes, ATTRIBUTE_KINDS, type AttributeKind, type Taxonomy } from './taxonomy.ts';

export const HASH_FORMAT = 1;
/** Bump whenever the tool's response shape changes. */
export const TOOL_SCHEMA_VERSION = 2;
/** Bump whenever the prompt text changes. */
export const PROMPT_VERSION = 2;

export type Manifest = {
  categories: { id: string; path: string }[];
  conditions: string[];
  terms: { id: string; kind: AttributeKind; slug: string }[];
  kind_category_ids: { kind: AttributeKind; category_ids: string[] }[];
  item_type_category_ids: { term_id: string; category_ids: string[] }[];
  item_type_ids_allowed: string[];
  /** Kinds offered to the model for this request (those that apply to the category hint). */
  attribute_kinds_offered: AttributeKind[];
  max_values: Record<AttributeKind, number>;
  brand_evidence: string[];
  material_evidence: string[];
  tool_schema_version: number;
};

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildManifest(taxonomy: Taxonomy, categoryHintId: string | null): Manifest {
  const itemTypeIdsAllowed = allowedItemTypes(taxonomy, categoryHintId)
    .map((term) => term.id)
    .sort(byString);
  // With a category hint, only kinds that apply to it are offered (no "fit"
  // for shoes, nothing for furniture); without one, every kind is.
  const kindsOffered = [...ATTRIBUTE_KINDS]
    .filter((kind) =>
      kind === 'item_type'
        ? itemTypeIdsAllowed.length > 0
        : categoryHintId === null || taxonomy.kindCategoryIds[kind].includes(categoryHintId),
    )
    .sort(byString);

  return {
    categories: taxonomy.categoryPaths
      .map((entry) => ({ id: entry.categoryId, path: entry.path }))
      .sort((a, b) => byString(a.id, b.id)),
    conditions: [...LISTING_CONDITIONS],
    terms: [...taxonomy.terms]
      .sort((a, b) => byString(a.kind, b.kind) || byString(a.slug, b.slug))
      .map((term) => ({ id: term.id, kind: term.kind, slug: term.slug })),
    kind_category_ids: [...ATTRIBUTE_KINDS]
      .sort(byString)
      .map((kind) => ({ kind, category_ids: [...taxonomy.kindCategoryIds[kind]].sort(byString) })),
    item_type_category_ids: Object.keys(taxonomy.itemTypeCategoryIds)
      .sort(byString)
      .map((termId) => ({ term_id: termId, category_ids: [...taxonomy.itemTypeCategoryIds[termId]].sort(byString) })),
    item_type_ids_allowed: itemTypeIdsAllowed,
    attribute_kinds_offered: kindsOffered,
    max_values: { ...taxonomy.maxValues },
    brand_evidence: [...BRAND_EVIDENCE],
    material_evidence: [...MATERIAL_EVIDENCE],
    tool_schema_version: TOOL_SCHEMA_VERSION,
  };
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Deterministic JSON: sorted keys at every level, arrays in order, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): Json {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalJson: non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(value as object).sort(byString)) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) throw new Error(`canonicalJson: undefined at "${key}"`);
      out[key] = canonicalize(child);
    }
    return out;
  }
  throw new Error(`canonicalJson: unsupported ${typeof value}`);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function metadataSchemaVersion(manifest: Manifest): Promise<string> {
  return sha256Hex(canonicalJson(manifest));
}

export type AnalysisInputs = {
  model: string;
  promptVersion: number;
  metadataSchemaVersion: string;
  /** The analyzed images, in the order they are sent (cover first). */
  images: { imageId: string; storagePath: string; position: number }[];
  title: string | null;
  description: string | null;
  categoryHintId: string | null;
};

/** Trimmed text, or null when empty — the exact form the prompt receives. */
export function normalizeSellerText(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

export function analysisInputHash(inputs: AnalysisInputs): Promise<string> {
  return sha256Hex(
    canonicalJson({
      hash_format: HASH_FORMAT,
      model: inputs.model,
      prompt_version: inputs.promptVersion,
      metadata_schema_version: inputs.metadataSchemaVersion,
      images: inputs.images.map((image) => ({
        image_id: image.imageId,
        storage_path: image.storagePath,
        position: image.position,
      })),
      title: inputs.title,
      description: inputs.description,
      category_hint_id: inputs.categoryHintId,
    }),
  );
}
