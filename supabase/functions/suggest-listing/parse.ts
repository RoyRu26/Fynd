// Validation and normalization of the model's tool-use response.
//
// Everything in `raw` is UNTRUSTED model output. Each field is validated on
// its own: a malformed or invalid field is dropped (and recorded as an issue
// code) without destroying the valid fields next to it. Only the validated,
// normalized result — taxonomy slugs mapped to database term ids, counts
// clamped, duplicates removed, keywords normalized — is ever stored or
// returned. The database still re-validates whatever the seller saves.
//
// Pure (no network, no Deno APIs); unit-tested in parse.test.ts.

import {
  BRAND_EVIDENCE,
  LISTING_CONDITIONS,
  MATERIAL_EVIDENCE,
  type BrandEvidence,
  type ListingCondition,
  type MaterialEvidence,
} from './constants.ts';
import type { Manifest } from './manifest.ts';
import { termAppliesToCategory, type AttributeKind, type Taxonomy, type TaxonomyTerm } from './taxonomy.ts';

export { LISTING_CONDITIONS };
export type { ListingCondition };

/** Version of the stored/returned suggestion shape (the mobile app checks it). */
export const SUGGESTION_VERSION = 1;

export const TITLE_MIN_LENGTH = 3;
export const TITLE_MAX_LENGTH = 120;
export const DESCRIPTION_MAX_LENGTH = 5000;
export const BRAND_MAX_LENGTH = 60;
export const MAX_KEYWORDS = 10;
/** ₪1,000,000 in agorot — far above any plausible second-hand price. */
export const PRICE_MAX_AMOUNT = 100_000_000;

export type ScoredTerm = { termId: string; slug: string; confidence: number };
export type ScoredMaterial = ScoredTerm & { evidence: MaterialEvidence };

export type ParsedSuggestion = {
  version: typeof SUGGESTION_VERSION;
  title: string | null;
  description: string | null;
  categoryId: string | null;
  price: { minAmount: number; maxAmount: number } | null;
  condition: { value: ListingCondition; confidence: number } | null;
  itemType: ScoredTerm | null;
  colors: ScoredTerm[];
  styles: ScoredTerm[];
  materials: ScoredMaterial[];
  pattern: ScoredTerm | null;
  fit: ScoredTerm | null;
  /** Brand as text; index.ts resolves it to a catalog brand id. */
  brand: { text: string; confidence: number; evidence: BrandEvidence } | null;
  keywords: string[];
};

export type ParseResult = {
  suggestion: ParsedSuggestion;
  /** Short codes like "colors.unknown_value", for debugging and evaluation. */
  issues: string[];
  /** How many fields carry a usable value; 0 means the response was useless. */
  usableFieldCount: number;
};

export type ParseContext = {
  manifest: Manifest;
  taxonomy: Taxonomy;
  categoryHintId: string | null;
};

const INVISIBLE_FORMATTING = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const KEYWORD_PATTERN = /^[a-z0-9א-ת]([a-z0-9א-ת -]*[a-z0-9א-ת])?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Same cleanup the database applies to brand text and the app applies to typed text. */
function cleanText(raw: string): string {
  return raw.replace(INVISIBLE_FORMATTING, '').replace(/\s+/g, ' ').replace(/\p{Cc}/gu, '').trim();
}

/** Mirrors set_listing_attributes / listing_keywords_valid. */
export function normalizeKeyword(raw: string): string | null {
  const keyword = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (keyword.length < 2 || keyword.length > 24 || !KEYWORD_PATTERN.test(keyword)) return null;
  return keyword;
}

export function parseSuggestion(raw: unknown, ctx: ParseContext): ParseResult {
  const issues: string[] = [];
  const input = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) issues.push('response.not_an_object');

  const termsByKindSlug = new Map<string, TaxonomyTerm>();
  for (const term of ctx.manifest.terms) termsByKindSlug.set(`${term.kind}:${term.slug}`, term);
  const allowedItemTypeIds = new Set(ctx.manifest.item_type_ids_allowed);
  const categoryIdByPath = new Map(ctx.manifest.categories.map((entry) => [entry.path, entry.id]));

  // ---- title ----
  let title: string | null = null;
  if (typeof input.title === 'string') {
    const trimmed = cleanText(input.title);
    if (trimmed.length >= TITLE_MIN_LENGTH && trimmed.length <= TITLE_MAX_LENGTH) title = trimmed;
    else if (trimmed !== '') issues.push('title.bad_length');
  } else if (input.title !== undefined && input.title !== null) {
    issues.push('title.bad_type');
  }

  // ---- description ----
  let description: string | null = null;
  if (typeof input.description === 'string') {
    const trimmed = input.description.replace(INVISIBLE_FORMATTING, '').trim();
    if (trimmed.length <= DESCRIPTION_MAX_LENGTH) description = trimmed === '' ? null : trimmed;
    else issues.push('description.too_long');
  } else if (input.description !== undefined && input.description !== null) {
    issues.push('description.bad_type');
  }

  // ---- category ----
  let categoryId: string | null = null;
  if (typeof input.category_path === 'string') {
    categoryId = categoryIdByPath.get(input.category_path) ?? null;
    if (categoryId === null) issues.push('category.unknown_value');
  } else if (input.category_path !== undefined && input.category_path !== null) {
    issues.push('category.bad_type');
  }
  // Attribute applicability follows the seller's category when they set one,
  // otherwise the category the model chose.
  const effectiveCategoryId = ctx.categoryHintId ?? categoryId;

  // ---- price range ----
  let price: ParsedSuggestion['price'] = null;
  const min = input.price_min_amount;
  const max = input.price_max_amount;
  if (min !== undefined && min !== null && max !== undefined && max !== null) {
    if (
      typeof min === 'number' && typeof max === 'number' &&
      Number.isInteger(min) && Number.isInteger(max) &&
      min >= 0 && max >= 1 && max >= min && max <= PRICE_MAX_AMOUNT
    ) {
      price = { minAmount: min, maxAmount: max };
    } else {
      issues.push('price.invalid');
    }
  }

  // ---- condition (confirm-only on the client, but validated the same) ----
  let condition: ParsedSuggestion['condition'] = null;
  if (isRecord(input.condition) && input.condition.value !== null && input.condition.value !== undefined) {
    const { value, confidence } = input.condition;
    if (typeof value !== 'string' || !(LISTING_CONDITIONS as readonly string[]).includes(value)) {
      issues.push('condition.unknown_value');
    } else if (!isConfidence(confidence)) {
      issues.push('condition.bad_confidence');
    } else {
      condition = { value: value as ListingCondition, confidence };
    }
  } else if (input.condition !== undefined && input.condition !== null && !isRecord(input.condition)) {
    issues.push('condition.bad_type');
  }

  // ---- attribute terms ----
  function scoredTerm(kind: AttributeKind, field: string, entry: unknown): ScoredTerm | null {
    if (!isRecord(entry)) {
      issues.push(`${field}.bad_type`);
      return null;
    }
    if (entry.value === null || entry.value === undefined) return null;
    if (typeof entry.value !== 'string') {
      issues.push(`${field}.bad_type`);
      return null;
    }
    const term = termsByKindSlug.get(`${kind}:${entry.value}`);
    if (!term) {
      issues.push(`${field}.unknown_value`);
      return null;
    }
    if (kind === 'item_type' && !allowedItemTypeIds.has(term.id)) {
      issues.push(`${field}.not_allowed_for_category`);
      return null;
    }
    if (!termAppliesToCategory(ctx.taxonomy, term, effectiveCategoryId)) {
      issues.push(`${field}.not_applicable_to_category`);
      return null;
    }
    if (!isConfidence(entry.confidence)) {
      issues.push(`${field}.bad_confidence`);
      return null;
    }
    return { termId: term.id, slug: term.slug, confidence: entry.confidence };
  }

  function single(kind: AttributeKind, field: string): ScoredTerm | null {
    const entry = input[field];
    if (entry === undefined || entry === null) return null;
    return scoredTerm(kind, field, entry);
  }

  function many<T extends ScoredTerm>(
    kind: AttributeKind,
    field: string,
    extra?: (entry: Record<string, unknown>, term: ScoredTerm) => T | null,
  ): T[] {
    const entries = input[field];
    if (entries === undefined || entries === null) return [];
    if (!Array.isArray(entries)) {
      issues.push(`${field}.bad_type`);
      return [];
    }
    const out: T[] = [];
    const seen = new Set<string>();
    for (const entry of entries.slice(0, 20)) {
      const term = scoredTerm(kind, field, entry);
      if (!term) continue;
      if (seen.has(term.termId)) {
        issues.push(`${field}.duplicate`);
        continue;
      }
      const full = extra ? extra(entry as Record<string, unknown>, term) : (term as T);
      if (!full) continue;
      seen.add(term.termId);
      out.push(full);
    }
    const limit = ctx.taxonomy.maxValues[kind];
    if (out.length > limit) issues.push(`${field}.clamped`);
    return out.slice(0, limit);
  }

  const itemType = single('item_type', 'item_type');
  const colors = many<ScoredTerm>('color', 'colors');
  const styles = many<ScoredTerm>('style', 'styles');
  const materials = many<ScoredMaterial>('material', 'materials', (entry, term) => {
    if (typeof entry.evidence !== 'string' || !(MATERIAL_EVIDENCE as readonly string[]).includes(entry.evidence)) {
      issues.push('materials.bad_evidence');
      return null;
    }
    return { ...term, evidence: entry.evidence as MaterialEvidence };
  });
  const pattern = single('pattern', 'pattern');
  const fit = single('fit', 'fit');

  // ---- brand (text; resolved to a catalog brand by index.ts) ----
  let brand: ParsedSuggestion['brand'] = null;
  if (isRecord(input.brand) && input.brand.value !== null && input.brand.value !== undefined) {
    const { value, confidence, evidence } = input.brand;
    const text = typeof value === 'string' ? cleanText(value) : '';
    if (typeof value !== 'string') {
      issues.push('brand.bad_type');
    } else if (text === '' || !/[\p{L}\p{N}]/u.test(text) || [...text].length > BRAND_MAX_LENGTH) {
      issues.push('brand.bad_value');
    } else if (typeof evidence !== 'string' || !(BRAND_EVIDENCE as readonly string[]).includes(evidence)) {
      issues.push('brand.bad_evidence');
    } else if (!isConfidence(confidence)) {
      issues.push('brand.bad_confidence');
    } else {
      brand = { text, confidence, evidence: evidence as BrandEvidence };
    }
  } else if (input.brand !== undefined && input.brand !== null && !isRecord(input.brand)) {
    issues.push('brand.bad_type');
  }

  // ---- keywords ----
  const keywords: string[] = [];
  if (Array.isArray(input.keywords)) {
    for (const entry of input.keywords.slice(0, 30)) {
      const keyword = typeof entry === 'string' ? normalizeKeyword(entry) : null;
      if (keyword === null) {
        issues.push('keywords.invalid');
        continue;
      }
      if (!keywords.includes(keyword)) keywords.push(keyword);
    }
    if (keywords.length > MAX_KEYWORDS) issues.push('keywords.clamped');
  } else if (input.keywords !== undefined && input.keywords !== null) {
    issues.push('keywords.bad_type');
  }

  const suggestion: ParsedSuggestion = {
    version: SUGGESTION_VERSION,
    title,
    description,
    categoryId,
    price,
    condition,
    itemType,
    colors,
    styles,
    materials,
    pattern,
    fit,
    brand,
    keywords: keywords.slice(0, MAX_KEYWORDS),
  };

  const usableFieldCount = [
    title, description, categoryId, price, condition, itemType, pattern, fit, brand,
  ].filter((value) => value !== null).length +
    [colors, styles, materials, suggestion.keywords].filter((list) => list.length > 0).length;

  // De-duplicated, bounded issue list (the DB accepts at most 50).
  return { suggestion, issues: [...new Set(issues)].slice(0, 50), usableFieldCount };
}

/**
 * Re-validates a suggestion read back from listing_ai_analyses before the
 * cache path returns it. Rows are written by an RPC the user can also call
 * directly, so a stored suggestion is not trusted just because it is in the
 * table: it must have exactly this module's output shape, and every id in it
 * must exist (with the right kind) in the CURRENT manifest. Anything else is
 * treated as a cache miss.
 */
export function isValidStoredSuggestion(value: unknown, manifest: Manifest): boolean {
  if (!isRecord(value) || value.version !== SUGGESTION_VERSION) return false;
  const termKinds = new Map(manifest.terms.map((term) => [term.id, term.kind]));
  const categoryIds = new Set(manifest.categories.map((entry) => entry.id));

  const isText = (v: unknown, max: number) => v === null || (typeof v === 'string' && v.length >= 1 && v.length <= max);
  const isTerm = (v: unknown, kind: AttributeKind, extra?: (r: Record<string, unknown>) => boolean): boolean =>
    isRecord(v) &&
    typeof v.termId === 'string' &&
    termKinds.get(v.termId) === kind &&
    typeof v.slug === 'string' &&
    isConfidence(v.confidence) &&
    (extra ? extra(v) : true);
  const isTermOrNull = (v: unknown, kind: AttributeKind) => v === null || isTerm(v, kind);
  const isTermList = (v: unknown, kind: AttributeKind, extra?: (r: Record<string, unknown>) => boolean) =>
    Array.isArray(v) && v.length <= 10 && v.every((entry) => isTerm(entry, kind, extra));

  const price = value.price;
  const condition = value.condition;
  const brand = value.brand;
  return (
    isText(value.title, TITLE_MAX_LENGTH) &&
    isText(value.description, DESCRIPTION_MAX_LENGTH) &&
    (value.categoryId === null || (typeof value.categoryId === 'string' && categoryIds.has(value.categoryId))) &&
    (price === null ||
      (isRecord(price) &&
        Number.isInteger(price.minAmount) &&
        Number.isInteger(price.maxAmount) &&
        (price.minAmount as number) >= 0 &&
        (price.maxAmount as number) >= Math.max(1, price.minAmount as number) &&
        (price.maxAmount as number) <= PRICE_MAX_AMOUNT)) &&
    (condition === null ||
      (isRecord(condition) &&
        (LISTING_CONDITIONS as readonly unknown[]).includes(condition.value) &&
        isConfidence(condition.confidence))) &&
    isTermOrNull(value.itemType, 'item_type') &&
    isTermList(value.colors, 'color') &&
    isTermList(value.styles, 'style') &&
    isTermList(value.materials, 'material', (r) => (MATERIAL_EVIDENCE as readonly unknown[]).includes(r.evidence)) &&
    isTermOrNull(value.pattern, 'pattern') &&
    isTermOrNull(value.fit, 'fit') &&
    (brand === null ||
      (isRecord(brand) &&
        (brand.brandId === null || typeof brand.brandId === 'string') &&
        typeof brand.name === 'string' &&
        brand.name.length >= 1 &&
        [...brand.name].length <= BRAND_MAX_LENGTH &&
        isConfidence(brand.confidence) &&
        (BRAND_EVIDENCE as readonly unknown[]).includes(brand.evidence))) &&
    Array.isArray(value.keywords) &&
    value.keywords.length <= MAX_KEYWORDS &&
    value.keywords.every((keyword) => typeof keyword === 'string' && normalizeKeyword(keyword) === keyword)
  );
}
