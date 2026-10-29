// The controlled vocabularies offered to the model, read at request time
// from the database through the CALLER-scoped client (never hand-copied into
// this function, never the service role). Every table here is
// authenticated-SELECT, so a signed-in caller can read all of it.
//
// `buildTaxonomy` is pure and unit-tested; `fetchTaxonomy` does the I/O.

import { buildCategoryPaths, type CategoryPath, type CategoryRow } from './categories.ts';

export const ATTRIBUTE_KINDS = ['item_type', 'color', 'style', 'material', 'pattern', 'fit'] as const;
export type AttributeKind = (typeof ATTRIBUTE_KINDS)[number];

export type TaxonomyTerm = { id: string; kind: AttributeKind; slug: string };

export type Taxonomy = {
  categoryPaths: CategoryPath[];
  /** Active terms only: retired terms are never offered to the model. */
  terms: TaxonomyTerm[];
  maxValues: Record<AttributeKind, number>;
  /** Non-item-type kind -> leaf categories it applies to. */
  kindCategoryIds: Record<AttributeKind, string[]>;
  /** Item-type term id -> leaf categories it is compatible with. */
  itemTypeCategoryIds: Record<string, string[]>;
};

type KindRow = { kind: string; max_values: number };
type TermRow = { id: string; kind: string; slug: string; retired_at: string | null };
type KindCategoryRow = { kind: string; category_id: string };
type ItemTypeCategoryRow = { term_id: string; category_id: string };

function isKind(value: string): value is AttributeKind {
  return (ATTRIBUTE_KINDS as readonly string[]).includes(value);
}

export function buildTaxonomy(rows: {
  categories: CategoryRow[];
  kinds: KindRow[];
  terms: TermRow[];
  kindCategories: KindCategoryRow[];
  itemTypeCategories: ItemTypeCategoryRow[];
}): Taxonomy {
  const maxValues = Object.fromEntries(ATTRIBUTE_KINDS.map((kind) => [kind, 0])) as Record<AttributeKind, number>;
  for (const row of rows.kinds) {
    if (isKind(row.kind)) maxValues[row.kind] = row.max_values;
  }

  const terms: TaxonomyTerm[] = rows.terms
    .filter((row) => row.retired_at === null && isKind(row.kind))
    .map((row) => ({ id: row.id, kind: row.kind as AttributeKind, slug: row.slug }));
  const activeTermIds = new Set(terms.map((term) => term.id));

  const kindCategoryIds = Object.fromEntries(ATTRIBUTE_KINDS.map((kind) => [kind, [] as string[]])) as Record<
    AttributeKind,
    string[]
  >;
  for (const row of rows.kindCategories) {
    if (isKind(row.kind)) kindCategoryIds[row.kind].push(row.category_id);
  }

  const itemTypeCategoryIds: Record<string, string[]> = {};
  for (const row of rows.itemTypeCategories) {
    if (!activeTermIds.has(row.term_id)) continue;
    (itemTypeCategoryIds[row.term_id] ??= []).push(row.category_id);
  }

  return {
    categoryPaths: buildCategoryPaths(rows.categories),
    terms,
    maxValues,
    kindCategoryIds,
    itemTypeCategoryIds,
  };
}

/** Minimal shape of the subset of the supabase-js client this file uses. */
export type TaxonomyReadClient = {
  from: (table: string) => {
    select: (columns: string) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
  };
};

export async function fetchTaxonomy(client: TaxonomyReadClient): Promise<Taxonomy> {
  const [categories, kinds, terms, kindCategories, itemTypeCategories] = await Promise.all([
    client.from('categories').select('id, name, parent_id'),
    client.from('listing_attribute_kinds').select('kind, max_values'),
    client.from('listing_attribute_terms').select('id, kind, slug, retired_at'),
    client.from('listing_attribute_kind_categories').select('kind, category_id'),
    client.from('listing_item_type_categories').select('term_id, category_id'),
  ]);
  for (const result of [categories, kinds, terms, kindCategories, itemTypeCategories]) {
    if (result.error) throw new Error(`Failed to read taxonomy: ${result.error.message}`);
  }
  return buildTaxonomy({
    categories: (categories.data ?? []) as CategoryRow[],
    kinds: (kinds.data ?? []) as KindRow[],
    terms: (terms.data ?? []) as TermRow[],
    kindCategories: (kindCategories.data ?? []) as KindCategoryRow[],
    itemTypeCategories: (itemTypeCategories.data ?? []) as ItemTypeCategoryRow[],
  });
}

/** Item types the model may choose: the ones compatible with the category hint, or all active ones without a hint. */
export function allowedItemTypes(taxonomy: Taxonomy, categoryHintId: string | null): TaxonomyTerm[] {
  const itemTypes = taxonomy.terms.filter((term) => term.kind === 'item_type');
  if (categoryHintId === null) return itemTypes;
  return itemTypes.filter((term) => (taxonomy.itemTypeCategoryIds[term.id] ?? []).includes(categoryHintId));
}

/** Mirrors listing_attribute_value_applies(): a null category accepts anything. */
export function termAppliesToCategory(taxonomy: Taxonomy, term: TaxonomyTerm, categoryId: string | null): boolean {
  if (categoryId === null) return true;
  if (term.kind === 'item_type') return (taxonomy.itemTypeCategoryIds[term.id] ?? []).includes(categoryId);
  return taxonomy.kindCategoryIds[term.kind].includes(categoryId);
}
