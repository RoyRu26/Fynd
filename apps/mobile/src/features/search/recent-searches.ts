/**
 * Pure recent-searches logic for ROADMAP 2.4: a recent search is query TEXT
 * only (never a filter snapshot), capped at `RECENT_SEARCHES_MAX`, newest
 * first, case-insensitive-deduped so re-running a search (in any casing)
 * promotes the existing entry to the front with the newest casing rather
 * than creating a second entry.
 *
 * No react-native or `@/lib/supabase` import of any kind — the same split as
 * `active-filters.ts` and `search.ts` — so this is directly unit-testable.
 */

export const RECENT_SEARCHES_MAX = 10;

/** Adds `query` to the front of `list`, trimmed, deduped, and capped. A blank/whitespace-only query is a no-op. */
export function addRecentSearch(list: string[], query: string): string[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return list;
  }
  const withoutDuplicate = list.filter((existing) => existing.toLowerCase() !== trimmed.toLowerCase());
  return [trimmed, ...withoutDuplicate].slice(0, RECENT_SEARCHES_MAX);
}

/** Removes an exact match of `query` from `list`; a no-op if `query` is not present. */
export function removeRecentSearch(list: string[], query: string): string[] {
  return list.filter((existing) => existing !== query);
}
