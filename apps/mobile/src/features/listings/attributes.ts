/**
 * Structured listing attributes (AI listing metadata plan, Phase 1a): item
 * type, colors, style, material, pattern, fit, plus free-text keywords.
 *
 * Pure: no react-native and no `@/lib/supabase` imports, so every rule here
 * is unit-testable. The database is authoritative for all of it — see
 * supabase/migrations/..._listing_attribute_taxonomy.sql and
 * ..._listing_attributes.sql. These helpers mirror those rules so the editor
 * can prevent a rejection up front instead of relaying one:
 *
 *   * item type is valid in a category only if the compatibility table maps
 *     it there; every other kind applies per category leaf;
 *   * with no category yet, any active term is accepted;
 *   * a category change removes exactly the values that stop applying;
 *   * each kind has a `max_values` cap;
 *   * keywords follow `listing_keywords_valid()`.
 */

export const ATTRIBUTE_KINDS = ['item_type', 'color', 'style', 'material', 'pattern', 'fit'] as const;
export type AttributeKind = (typeof ATTRIBUTE_KINDS)[number];

export type AttributeKindInfo = {
  kind: AttributeKind;
  label: string;
  maxValues: number;
  position: number;
};

export type AttributeTerm = {
  id: string;
  kind: AttributeKind;
  slug: string;
  label: string;
  position: number;
  retired: boolean;
};

export type AttributeVocabulary = {
  /** Sorted by display position. */
  kinds: AttributeKindInfo[];
  termsById: ReadonlyMap<string, AttributeTerm>;
  /** Each kind's terms, sorted by display position; retired terms included. */
  termsByKind: ReadonlyMap<AttributeKind, AttributeTerm[]>;
  /** Non-item-type kind -> the category leaves it applies to. */
  kindCategoryIds: ReadonlyMap<AttributeKind, ReadonlySet<string>>;
  /** Item-type term id -> the category leaves it is compatible with. */
  itemTypeCategoryIds: ReadonlyMap<string, ReadonlySet<string>>;
};

// Raw row shapes, structurally matching the generated table types so the API
// layer can pass rows straight through.
export type AttributeKindRow = { kind: string; label: string; max_values: number; position: number };
export type AttributeTermRow = {
  id: string;
  kind: string;
  slug: string;
  label: string;
  position: number;
  retired_at: string | null;
};
export type AttributeKindCategoryRow = { kind: string; category_id: string };
export type ItemTypeCategoryRow = { term_id: string; category_id: string };
export type AttributeValueRow = { term_id: string; kind: string; position: number };

export function isAttributeKind(value: string): value is AttributeKind {
  return (ATTRIBUTE_KINDS as readonly string[]).includes(value);
}

function addToSetMap<K>(map: Map<K, Set<string>>, key: K, value: string): void {
  const existing = map.get(key);
  if (existing) {
    existing.add(value);
  } else {
    map.set(key, new Set([value]));
  }
}

/**
 * Builds the lookup structure from the four vocabulary tables. Rows of a kind
 * this client doesn't know are dropped rather than crashing the editor: a
 * future kind is invisible to an old build, never broken by it.
 */
export function normalizeVocabulary(rows: {
  kinds: AttributeKindRow[];
  terms: AttributeTermRow[];
  kindCategories: AttributeKindCategoryRow[];
  itemTypeCategories: ItemTypeCategoryRow[];
}): AttributeVocabulary {
  const kinds: AttributeKindInfo[] = rows.kinds
    .filter((row): row is AttributeKindRow & { kind: AttributeKind } => isAttributeKind(row.kind))
    .map((row) => ({ kind: row.kind, label: row.label, maxValues: row.max_values, position: row.position }))
    .sort((a, b) => a.position - b.position);

  const termsById = new Map<string, AttributeTerm>();
  const termsByKind = new Map<AttributeKind, AttributeTerm[]>();
  for (const row of rows.terms) {
    if (!isAttributeKind(row.kind)) continue;
    const term: AttributeTerm = {
      id: row.id,
      kind: row.kind,
      slug: row.slug,
      label: row.label,
      position: row.position,
      retired: row.retired_at !== null,
    };
    termsById.set(term.id, term);
    const list = termsByKind.get(term.kind) ?? [];
    list.push(term);
    termsByKind.set(term.kind, list);
  }
  for (const list of termsByKind.values()) {
    list.sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
  }

  const kindCategoryIds = new Map<AttributeKind, Set<string>>();
  for (const row of rows.kindCategories) {
    if (isAttributeKind(row.kind)) addToSetMap(kindCategoryIds, row.kind, row.category_id);
  }

  const itemTypeCategoryIds = new Map<string, Set<string>>();
  for (const row of rows.itemTypeCategories) {
    addToSetMap(itemTypeCategoryIds, row.term_id, row.category_id);
  }

  return { kinds, termsById, termsByKind, kindCategoryIds, itemTypeCategoryIds };
}

/** Mirrors `listing_attribute_value_applies()`: a null category accepts anything. */
export function termAppliesToCategory(
  vocab: AttributeVocabulary,
  term: AttributeTerm,
  categoryId: string | null,
): boolean {
  if (categoryId === null) return true;
  if (term.kind === 'item_type') {
    return vocab.itemTypeCategoryIds.get(term.id)?.has(categoryId) ?? false;
  }
  return vocab.kindCategoryIds.get(term.kind)?.has(categoryId) ?? false;
}

/**
 * The kinds the editor offers for a category. Item type is offered only when
 * at least one item type maps to the category (none do for Home, Electronics,
 * Toys, …).
 *
 * With no category the database would accept any term, but the editor offers
 * none: asking for the category first keeps sellers from building a selection
 * that the category they then pick prunes away.
 */
export function applicableKinds(vocab: AttributeVocabulary, categoryId: string | null): AttributeKindInfo[] {
  if (categoryId === null) return [];
  return vocab.kinds.filter((info) =>
    (vocab.termsByKind.get(info.kind) ?? []).some(
      (term) => !term.retired && termAppliesToCategory(vocab, term, categoryId),
    ),
  );
}

/**
 * The terms to show as chips for one kind: active terms that apply to the
 * category, plus any retired term already selected — so the seller can still
 * see it, and deselect it. Retired terms can't be newly added, so once
 * deselected a retired term's chip disappears for good (even before saving,
 * when the RPC would still accept it back): retiring a value means sellers
 * stop choosing it.
 */
export function selectableTerms(
  vocab: AttributeVocabulary,
  kind: AttributeKind,
  categoryId: string | null,
  selection: readonly string[],
): AttributeTerm[] {
  return (vocab.termsByKind.get(kind) ?? []).filter((term) =>
    term.retired ? selection.includes(term.id) : termAppliesToCategory(vocab, term, categoryId),
  );
}

export function selectedInKind(
  vocab: AttributeVocabulary,
  selection: readonly string[],
  kind: AttributeKind,
): string[] {
  return selection.filter((id) => vocab.termsById.get(id)?.kind === kind);
}

/**
 * Toggles one term. Selection is a flat id list whose order within a kind is
 * meaningful (the first color is the primary one) and is exactly what the RPC
 * stores as `position`.
 *
 *   * Selected -> removed.
 *   * Single-value kind -> replaces the current value.
 *   * Multi-value kind at its cap -> unchanged; the editor disables those chips.
 */
export function toggleTerm(vocab: AttributeVocabulary, selection: readonly string[], termId: string): string[] {
  if (selection.includes(termId)) {
    return selection.filter((id) => id !== termId);
  }
  const term = vocab.termsById.get(termId);
  if (!term || term.retired) return [...selection];

  const maxValues = vocab.kinds.find((info) => info.kind === term.kind)?.maxValues ?? 1;
  const inKind = selectedInKind(vocab, selection, term.kind);
  if (maxValues === 1) {
    return [...selection.filter((id) => !inKind.includes(id)), termId];
  }
  if (inKind.length >= maxValues) return [...selection];
  return [...selection, termId];
}

/**
 * AI pre-fill (Phase 2): adds each candidate term only if its kind is still
 * EMPTY in `selection` — never next to or instead of a value the seller
 * chose. Respects max_values and skips unknown or retired terms.
 */
export function addTermsToEmptyKinds(
  vocab: AttributeVocabulary,
  selection: readonly string[],
  termIds: readonly string[],
): string[] {
  const emptyKinds = new Set(
    vocab.kinds.filter((info) => selectedInKind(vocab, selection, info.kind).length === 0).map((info) => info.kind),
  );
  let next = [...selection];
  for (const termId of termIds) {
    const term = vocab.termsById.get(termId);
    if (!term || term.retired || !emptyKinds.has(term.kind) || next.includes(termId)) continue;
    const maxValues = vocab.kinds.find((info) => info.kind === term.kind)?.maxValues ?? 1;
    if (selectedInKind(vocab, next, term.kind).length >= maxValues) continue;
    next = [...next, termId];
  }
  return next;
}

/**
 * The seller accepted an AI offer for one term: a single-value kind takes it
 * instead of its current value, a multi-value kind adds it if there is room.
 * Never removes anything else, and never adds a retired term.
 */
export function applyOfferedTerm(vocab: AttributeVocabulary, selection: readonly string[], termId: string): string[] {
  if (selection.includes(termId)) return [...selection];
  const term = vocab.termsById.get(termId);
  if (!term || term.retired) return [...selection];
  return toggleTerm(vocab, selection, termId);
}

export function isKindFull(vocab: AttributeVocabulary, selection: readonly string[], kind: AttributeKind): boolean {
  const maxValues = vocab.kinds.find((info) => info.kind === kind)?.maxValues ?? 1;
  return maxValues > 1 && selectedInKind(vocab, selection, kind).length >= maxValues;
}

/**
 * Decision 12: on a category change keep everything still valid, drop only
 * what isn't. Mirrors `listings_prune_attribute_values_on_category_change()`,
 * which does the same server-side on save. A null category keeps everything.
 */
export function pruneSelectionForCategory(
  vocab: AttributeVocabulary,
  selection: readonly string[],
  categoryId: string | null,
): { kept: string[]; removed: AttributeTerm[] } {
  const kept: string[] = [];
  const removed: AttributeTerm[] = [];
  for (const id of selection) {
    const term = vocab.termsById.get(id);
    if (!term) continue;
    if (termAppliesToCategory(vocab, term, categoryId)) {
      kept.push(id);
    } else {
      removed.push(term);
    }
  }
  return { kept, removed };
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * The notice shown after a category change clears values, e.g. "Removed
 * Hoodie — it doesn't fit Women › Shoes." Falls back to "this category" while
 * the category names haven't loaded.
 */
export function describeRemovedTerms(
  removed: readonly AttributeTerm[],
  categoryLabel: string | null,
): string | null {
  if (removed.length === 0) return null;
  const pronoun = removed.length === 1 ? "it doesn't" : "they don't";
  return `Removed ${joinLabels(removed.map((term) => term.label))} — ${pronoun} fit ${categoryLabel ?? 'this category'}.`;
}

/**
 * Restores the editor's selection from stored rows, in kind display order and
 * then stored position — the same order the editor would have produced.
 */
export function selectionFromValues(vocab: AttributeVocabulary, values: readonly AttributeValueRow[]): string[] {
  const kindOrder = new Map(vocab.kinds.map((info) => [info.kind, info.position]));
  return [...values]
    .filter((row) => vocab.termsById.has(row.term_id))
    .sort(
      (a, b) =>
        (kindOrder.get(a.kind as AttributeKind) ?? 0) - (kindOrder.get(b.kind as AttributeKind) ?? 0) ||
        a.position - b.position,
    )
    .map((row) => row.term_id);
}

/** Selected terms grouped by kind, in display order — for read-only badges. */
export function selectedTermsByKind(
  vocab: AttributeVocabulary,
  selection: readonly string[],
): { kind: AttributeKindInfo; terms: AttributeTerm[] }[] {
  return vocab.kinds
    .map((kind) => ({
      kind,
      terms: selection
        .map((id) => vocab.termsById.get(id))
        .filter((term): term is AttributeTerm => term?.kind === kind.kind),
    }))
    .filter((group) => group.terms.length > 0);
}

/**
 * Flat, display-ordered terms for a listing's read-only badges (item type
 * first, then colors in primary-first order, …). Retired terms still show:
 * the listing really has that value.
 */
export function attributeBadgeTerms(
  vocab: AttributeVocabulary,
  values: readonly AttributeValueRow[],
): AttributeTerm[] {
  return selectedTermsByKind(vocab, selectionFromValues(vocab, values)).flatMap((group) => group.terms);
}

/**
 * Kinds in display order, each kind's ids in their own order. Order across
 * kinds is meaningless (toggling appends to the end); order within a kind is
 * real (the first color is primary). Compare canonical forms for dirtiness.
 */
export function canonicalSelection(vocab: AttributeVocabulary, selection: readonly string[]): string[] {
  return vocab.kinds.flatMap((info) => selectedInKind(vocab, selection, info.kind));
}

/** Order-sensitive: reordering colors changes which one is primary. */
export function sameIdList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// ============================================================
// Keywords
// ============================================================
// Mirrors listing_keywords_valid() and the normalization set_listing_attributes
// applies: trim, lowercase, collapse whitespace; 2–24 characters of Latin
// lowercase letters, digits, Hebrew letters, inner spaces and hyphens; no
// duplicates; at most 10.

export const MAX_KEYWORDS = 10;
export const KEYWORD_MIN_LENGTH = 2;
export const KEYWORD_MAX_LENGTH = 24;

const KEYWORD_PATTERN = /^[a-z0-9א-ת]([a-z0-9א-ת -]*[a-z0-9א-ת])?$/;

export function normalizeKeyword(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Why a (normalized) keyword can't be added, or null if it can. */
export function keywordError(keyword: string, existing: readonly string[]): string | null {
  if (existing.length >= MAX_KEYWORDS) return `Up to ${MAX_KEYWORDS} keywords.`;
  if (keyword.length < KEYWORD_MIN_LENGTH || keyword.length > KEYWORD_MAX_LENGTH) {
    return `Keywords are ${KEYWORD_MIN_LENGTH}–${KEYWORD_MAX_LENGTH} characters.`;
  }
  if (!KEYWORD_PATTERN.test(keyword)) return 'Use letters, numbers, spaces or hyphens only.';
  if (existing.includes(keyword)) return 'Already added.';
  return null;
}

/** Adds one keyword from raw input. A blank entry is a no-op, not an error. */
export function addKeyword(
  existing: readonly string[],
  raw: string,
): { keywords: string[]; error: string | null } {
  const keyword = normalizeKeyword(raw);
  if (keyword === '') return { keywords: [...existing], error: null };
  const error = keywordError(keyword, existing);
  if (error) return { keywords: [...existing], error };
  return { keywords: [...existing, keyword], error: null };
}

export function removeKeyword(existing: readonly string[], keyword: string): string[] {
  return existing.filter((value) => value !== keyword);
}
