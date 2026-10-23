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
};

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

  return {
    p_query: filters.query ?? undefined,
    p_category_id: filters.categoryId ?? undefined,
    p_condition: filters.condition ?? undefined,
    p_size: filters.size ?? undefined,
    p_price_min: filters.priceMin ?? undefined,
    p_price_max: filters.priceMax ?? undefined,
    p_sort: filters.sort,
    p_limit: limit,
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
