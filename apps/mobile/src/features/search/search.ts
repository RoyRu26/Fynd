import { findCategoryMatch, type CategoryGroup } from '@/features/categories/categories';
import {
  ATTRIBUTE_KINDS,
  termAppliesToCategory,
  type AttributeKind,
  type AttributeKindInfo,
  type AttributeTerm,
  type AttributeVocabulary,
} from '@/features/listings/attributes';
import type { Database, Enums } from '@/types/database';

/**
 * Pure search-page logic: RPC-row normalization, signed-URL association,
 * RPC-argument construction, and cursor derivation for ROADMAP 2.2.
 *
 * No react-native import of any kind — not even transitively through
 * `@/lib/supabase` — matching feed/pagination.ts and seller-profile/
 * profile.ts's identical split for the identical reason: it is what makes
 * this directly unit-testable.
 */

export type SearchSort = Enums<'search_sort'>;

/**
 * Display order for the sort menu. An explicit list, not `Object.keys` over
 * the labels below, so the menu's order is a decision rather than an artifact
 * of object literal ordering — and so adding an enum member is a compile
 * error here (via the exhaustive `SEARCH_SORT_LABELS`) rather than a silently
 * missing menu row.
 */
export const SEARCH_SORT_ORDER: readonly SearchSort[] = ['newest', 'price'];

/**
 * User-facing name for each sort mode.
 *
 * "Price: low to high" states the DIRECTION because the RPC only sorts one
 * way — `order by l.price_amount asc, l.id asc` — and its cursor is built for
 * that direction. A bare "Price" would imply a toggle that does not exist.
 */
export const SEARCH_SORT_LABELS: Record<SearchSort, string> = {
  newest: 'Newest',
  price: 'Price: low to high',
};

export type SearchFilters = {
  query: string | null;
  categoryId: string | null;
  condition: Enums<'listing_condition'> | null;
  size: Enums<'listing_size'> | null;
  priceMin: number | null;
  priceMax: number | null;
  sort: SearchSort;
  /** Catalog brand ids, OR'd. Sorted and deduped (see `normalizeFilterIds`) so the query key is stable. */
  brandIds: readonly string[];
  /** Attribute term ids per kind: OR within a kind, AND across kinds. Each list sorted and deduped. */
  termIds: AttributeTermFilters;
};

/**
 * Mirrors `search_listings`' own cap: more than this many ids in any one
 * `p_*_ids` array is rejected with 22023. The UI stops adding at the cap, so
 * reaching `buildSearchParams` over it is a bug — see `assertFilterIdsWithinCap`.
 */
export const MAX_FILTER_IDS_PER_KIND = 20;

/**
 * The search box's length cap. Mirrors the server: `search_listings` and
 * `recognise_search_terms` read only the first 200 characters of a query
 * (`fynd_search_tokens`), so text past it could never match anything.
 */
export const MAX_SEARCH_QUERY_LENGTH = 200;

export type AttributeTermFilters = Readonly<Record<AttributeKind, readonly string[]>>;

export const EMPTY_TERM_FILTERS: AttributeTermFilters = {
  item_type: [],
  color: [],
  style: [],
  material: [],
  pattern: [],
  fit: [],
};

type TermFilterParam =
  | 'p_item_type_ids'
  | 'p_color_ids'
  | 'p_style_ids'
  | 'p_material_ids'
  | 'p_pattern_ids'
  | 'p_fit_ids';

/** Exhaustive: a new attribute kind is a compile error here until it is mapped to its RPC argument. */
const TERM_FILTER_PARAM: Record<AttributeKind, TermFilterParam> = {
  item_type: 'p_item_type_ids',
  color: 'p_color_ids',
  style: 'p_style_ids',
  material: 'p_material_ids',
  pattern: 'p_pattern_ids',
  fit: 'p_fit_ids',
};

/** Dedupes and sorts, so two selections of the same ids in any order are one query key. */
export function normalizeFilterIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

/**
 * Throws past the RPC's per-kind cap. Never trims: silently dropping ids
 * would run a different search than the one the user built, with nothing on
 * screen saying so. The UI never lets a kind exceed the cap, so this is a bug
 * guard, not a validation message.
 */
export function assertFilterIdsWithinCap(ids: readonly string[], what: string): void {
  if (ids.length > MAX_FILTER_IDS_PER_KIND) {
    throw new Error(`Too many ${what} filters: ${ids.length} (max ${MAX_FILTER_IDS_PER_KIND})`);
  }
}

/**
 * Tagged with the sort mode it was derived under, so a cursor can never be
 * replayed against the wrong mode's pagination scheme by accident — see
 * `buildSearchParams`, which refuses to spread a mismatched cursor's fields
 * into the RPC call at all.
 */
export type SearchCursor =
  | { sort: 'newest'; createdAt: string; id: string }
  | { sort: 'price'; price: number; id: string }
  | null;

/** The generated search_listings RPC row shape, aliased for readability. */
export type SearchListingRpcRow = Database['public']['Functions']['search_listings']['Returns'][number];

/**
 * A search result tile, resolved and ready to render: camelCase, and with
 * the cover photo's signed URL already attached. `coverUrl` is never
 * optional — see `associateSearchCoverUrls`.
 */
export type NormalizedSearchListing = {
  listingId: string;
  title: string;
  priceAmount: number;
  currency: string;
  condition: Enums<'listing_condition'>;
  size: Enums<'listing_size'>;
  categoryId: string;
  createdAt: string;
  coverStoragePath: string;
};

export type SearchListing = NormalizedSearchListing & { coverUrl: string };

/**
 * Row -> domain normalization.
 *
 * Every field below stays non-null in the domain type because
 * `search_listings` only ever returns `status = 'active'` rows (enforced
 * server-side, not trusted here) — and `listings_complete_when_not_draft`
 * guarantees title/price_amount/condition/size/category_id are all set on
 * every non-draft listing. There is no `profiles` join here the way
 * feed_listings has, so there is no analogous "generated type claims
 * non-null but the real column is nullable" correction to make.
 */
export function normalizeSearchRow(row: SearchListingRpcRow): NormalizedSearchListing {
  return {
    listingId: row.listing_id,
    title: row.title,
    priceAmount: row.price_amount,
    currency: row.currency,
    condition: row.condition,
    size: row.size,
    categoryId: row.category_id,
    createdAt: row.created_at,
    coverStoragePath: row.cover_storage_path,
  };
}

/**
 * Attaches each row's signed cover URL, keyed by storage path.
 *
 * Throws if any row's URL is missing, rather than returning a tile with no
 * cover — same reasoning as feed/pagination.ts's `associateCoverUrls` and
 * seller-profile/profile.ts's `associateSellerListingCoverUrls`: a search
 * result tile has no legitimate "no cover" state (every active listing
 * that reaches this far has at least one image, by construction of the
 * RPC's own `cross join lateral`), so a missing URL is a signing bug worth
 * surfacing loudly, not a state worth rendering around.
 */
export function associateSearchCoverUrls(
  rows: NormalizedSearchListing[],
  urlsByPath: Record<string, string>,
): SearchListing[] {
  return rows.map((row) => {
    const coverUrl = urlsByPath[row.coverStoragePath];
    if (!coverUrl) {
      throw new Error(`Could not resolve a cover image URL for listing ${row.listingId}`);
    }
    return { ...row, coverUrl };
  });
}

/**
 * Maps filter/cursor state to the `search_listings` RPC's argument shape.
 *
 * The cursor is only ever spread in when it is tagged for the SAME sort
 * mode as `filters.sort` — a cursor left over from a different sort (e.g.
 * the user just switched from "newest" to "price") is dropped entirely
 * rather than sent, which lands the call on page 1 of the new mode instead
 * of sending a half-meaningless mix of fields. This is defense in depth:
 * the RPC itself independently rejects a cross-mode cursor with P0001, so a
 * bug here would be caught server-side too, but a client that never sends
 * the mismatched fields in the first place never has to handle that error
 * at all.
 */
export function buildSearchParams(
  filters: SearchFilters,
  cursor: SearchCursor,
  limit: number,
): Database['public']['Functions']['search_listings']['Args'] {
  const cursorArgs =
    cursor !== null && cursor.sort === filters.sort
      ? cursor.sort === 'newest'
        ? { p_cursor_created_at: cursor.createdAt, p_cursor_id: cursor.id }
        : { p_cursor_price: cursor.price, p_cursor_id: cursor.id }
      : {};

  // Empty lists are omitted rather than sent as `[]`: the RPC treats both as
  // "no filter", and omitting keeps the call identical to the pre-7.4 shape.
  const idArgs: Partial<Record<TermFilterParam | 'p_brand_ids', string[]>> = {};
  assertFilterIdsWithinCap(filters.brandIds, 'brand');
  if (filters.brandIds.length > 0) idArgs.p_brand_ids = [...filters.brandIds];
  for (const kind of ATTRIBUTE_KINDS) {
    const ids = filters.termIds[kind];
    assertFilterIdsWithinCap(ids, kind);
    if (ids.length > 0) idArgs[TERM_FILTER_PARAM[kind]] = [...ids];
  }

  return {
    p_query: filters.query ?? undefined,
    p_category_id: filters.categoryId ?? undefined,
    p_condition: filters.condition ?? undefined,
    p_size: filters.size ?? undefined,
    p_price_min: filters.priceMin ?? undefined,
    p_price_max: filters.priceMax ?? undefined,
    p_sort: filters.sort,
    p_limit: limit,
    ...idArgs,
    ...cursorArgs,
  };
}

/**
 * The next page's cursor, or `null` when there is no next page.
 *
 * Derived from the LAST row of the page just fetched, tagged with `sort` so
 * the result is a `SearchCursor` that can only ever be replayed against the
 * same mode it was derived under. A page shorter than what was requested is
 * the signal that the result set is exhausted — same discipline as
 * feed/pagination.ts's `deriveNextCursor`.
 */
export function deriveNextSearchCursor(
  page: Pick<SearchListing, 'createdAt' | 'priceAmount' | 'listingId'>[],
  pageSize: number,
  sort: SearchSort,
): SearchCursor {
  if (page.length < pageSize) {
    return null;
  }
  const last = page[page.length - 1];
  return sort === 'newest'
    ? { sort: 'newest', createdAt: last.createdAt, id: last.listingId }
    : { sort: 'price', price: last.priceAmount, id: last.listingId };
}

// ============================================================
// Attribute filters (ROADMAP 7.4)
// ============================================================

/**
 * The category leaves a category filter covers, mirroring `search_listings`'
 * `cat.id = p OR cat.parent_id = p`: a leaf is itself, a group is all of its
 * leaves. `null` means unrestricted — no category, or an id that has not
 * resolved yet (categories still loading), where guessing would hide filters
 * that may well apply.
 */
export type CategoryScope = readonly string[] | null;

export function categoryScope(groups: readonly CategoryGroup[], categoryId: string | null): CategoryScope {
  const match = findCategoryMatch([...groups], categoryId);
  if (match === null) return null;
  return match.kind === 'leaf' ? [match.leaf.id] : match.group.subcategories.map((leaf) => leaf.id);
}

/** True when the term applies to at least one leaf in scope (vocabulary rows only ever reference leaves). */
export function termAppliesToScope(vocab: AttributeVocabulary, term: AttributeTerm, scope: CategoryScope): boolean {
  if (scope === null) return true;
  return scope.some((leafId) => termAppliesToCategory(vocab, term, leafId));
}

/**
 * The kinds worth offering: those with at least one active term that applies
 * in scope, plus any kind with a selected term of its own (e.g. only a
 * retired term is selected) so that selection can still be removed.
 */
export function filterableKinds(
  vocab: AttributeVocabulary,
  scope: CategoryScope,
  selected: AttributeTermFilters,
): AttributeKindInfo[] {
  return vocab.kinds.filter(
    (info) =>
      selected[info.kind].some((id) => vocab.termsById.get(id)?.kind === info.kind) ||
      (vocab.termsByKind.get(info.kind) ?? []).some((term) => !term.retired && termAppliesToScope(vocab, term, scope)),
  );
}

/**
 * The chips for one kind: active terms that apply in scope, plus any retired
 * term that is already selected, so it can still be seen and removed.
 */
export function filterableTerms(
  vocab: AttributeVocabulary,
  kind: AttributeKind,
  scope: CategoryScope,
  selected: readonly string[],
): AttributeTerm[] {
  return (vocab.termsByKind.get(kind) ?? []).filter((term) =>
    term.retired ? selected.includes(term.id) : termAppliesToScope(vocab, term, scope),
  );
}

/**
 * Multi-select toggle — unlike the Sell editor's `toggleTerm`, a filter has
 * no per-kind `max_values` (a buyer may want Black OR Navy jeans even though
 * a listing has one item type). Removes a selected term; otherwise adds it,
 * except that an unknown or retired term is never added and a kind at
 * `MAX_FILTER_IDS_PER_KIND` stays as it is.
 */
export function toggleTermFilter(
  vocab: AttributeVocabulary,
  filters: AttributeTermFilters,
  termId: string,
): AttributeTermFilters {
  const term = vocab.termsById.get(termId);
  if (!term) return filters;
  const current = filters[term.kind];
  if (current.includes(termId)) {
    return { ...filters, [term.kind]: current.filter((id) => id !== termId) };
  }
  if (term.retired || current.length >= MAX_FILTER_IDS_PER_KIND) return filters;
  return { ...filters, [term.kind]: [...current, termId] };
}

export function clearTermKind(filters: AttributeTermFilters, kind: AttributeKind): AttributeTermFilters {
  return { ...filters, [kind]: [] };
}

export function isTermKindFull(filters: AttributeTermFilters, kind: AttributeKind): boolean {
  return filters[kind].length >= MAX_FILTER_IDS_PER_KIND;
}

/**
 * Drops the selected terms that stop applying when the category scope
 * changes. Ids the vocabulary does not know are kept (they cannot be judged,
 * and the active-filter row still shows them as removable). Without a
 * vocabulary yet, nothing is pruned.
 */
export function pruneTermFiltersForScope(
  vocab: AttributeVocabulary | undefined,
  filters: AttributeTermFilters,
  scope: CategoryScope,
): { kept: AttributeTermFilters; removed: AttributeTerm[] } {
  if (!vocab) return { kept: filters, removed: [] };
  const removed: AttributeTerm[] = [];
  const kept: Record<AttributeKind, readonly string[]> = { ...filters };
  for (const kind of ATTRIBUTE_KINDS) {
    kept[kind] = filters[kind].filter((id) => {
      const term = vocab.termsById.get(id);
      if (!term || termAppliesToScope(vocab, term, scope)) return true;
      removed.push(term);
      return false;
    });
  }
  return removed.length === 0 ? { kept: filters, removed } : { kept, removed };
}

export type BrandFilterValue = { id: string; name: string };

/** Adds or removes one brand; adding past `MAX_FILTER_IDS_PER_KIND` is a no-op. */
export function toggleBrandFilter(
  brands: readonly BrandFilterValue[],
  brand: BrandFilterValue,
): readonly BrandFilterValue[] {
  if (brands.some((existing) => existing.id === brand.id)) {
    return brands.filter((existing) => existing.id !== brand.id);
  }
  if (brands.length >= MAX_FILTER_IDS_PER_KIND) return brands;
  return [...brands, brand];
}

/** The "clear this kind" chip's label, e.g. "Any color", "Any item type". */
export function anyKindLabel(kind: AttributeKindInfo): string {
  return `Any ${kind.label.toLowerCase()}`;
}
