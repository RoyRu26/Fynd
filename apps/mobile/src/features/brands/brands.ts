/**
 * Listing brands (AI listing metadata plan, Phase 1b).
 *
 * Pure: no react-native and no `@/lib/supabase` imports, so every rule here is
 * unit-testable. The database is authoritative —
 * supabase/migrations/..._brands.sql and ..._listing_brand.sql. A listing has
 * AT MOST ONE of:
 *
 *   * a known brand (`brand_id`, from the catalog), or
 *   * free text (`brand_text`) for a brand that isn't in it.
 *
 * Never both, and unknown text is always acceptable. `set_listing_attributes`
 * also resolves typed text that EXACTLY matches a catalog alias (after the
 * server's normalization) to that brand, so the client never has to decide
 * what a spelling means: it sends what the seller chose or typed and adopts
 * whatever the server stored.
 */

export const BRAND_TEXT_MAX_LENGTH = 60;
export const BRAND_SEARCH_LIMIT = 6;

export type BrandSelection =
  | { kind: 'none' }
  | { kind: 'brand'; id: string; name: string }
  | { kind: 'text'; text: string };

export const NO_BRAND: BrandSelection = { kind: 'none' };

export type BrandSuggestion = {
  id: string;
  name: string;
  /** The alias that matched the query; equals `name` when the name itself matched. */
  matchedAlias: string;
};

type SearchBrandRow = { id: string; name: string; matched_alias: string };

export function toBrandSuggestions(rows: readonly SearchBrandRow[]): BrandSuggestion[] {
  return rows.map((row) => ({ id: row.id, name: row.name, matchedAlias: row.matched_alias }));
}

/**
 * Mirrors the server's cleanup of typed brand text: invisible formatting
 * characters (zero-width spaces/joiners, bidi marks and overrides, word
 * joiner, BOM) are dropped, whitespace runs (tabs and newlines included)
 * become one space, remaining control characters are dropped, edges are
 * trimmed.
 */
export function cleanBrandText(raw: string): string {
  return raw
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\p{Cc}/gu, '')
    .trim();
}

/** True when the input holds nothing a brand could be made of (empty, whitespace, control characters). */
export function isBlankBrandInput(raw: string): boolean {
  return cleanBrandText(raw) === '';
}

/**
 * Wraps user-supplied text in Unicode bidi isolates, so Hebrew (or any RTL
 * text) interpolated into an English label keeps its own direction and the
 * surrounding punctuation lands on the right side, on screen and in screen
 * readers: "Nike (⁨נייקי⁩)", not a scrambled string.
 */
export function isolate(text: string): string {
  return `\u2068${text}\u2069`;
}

/** Why cleaned brand text can't be used, or null if it can. Empty is not an error: it means "no brand". */
export function brandTextError(cleaned: string): string | null {
  if (cleaned === '') return null;
  // Code points, like the server's char_length: an emoji is one, not two.
  if ([...cleaned].length > BRAND_TEXT_MAX_LENGTH) {
    return `Brand names are up to ${BRAND_TEXT_MAX_LENGTH} characters.`;
  }
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return 'A brand name needs letters or numbers.';
  return null;
}

type ListingBrandFields = {
  brand_id: string | null;
  brand_text: string | null;
  /** The embedded brands row for `brand_id`, when it was selected with the listing. */
  brand: { id: string; name: string } | null;
};

/** The stored brand as editor state. A brand id whose row isn't embedded is treated as no brand. */
export function brandSelectionFromListing(row: ListingBrandFields): BrandSelection {
  if (row.brand_id !== null && row.brand !== null) {
    return { kind: 'brand', id: row.brand.id, name: row.brand.name };
  }
  if (row.brand_text !== null) return { kind: 'text', text: row.brand_text };
  return NO_BRAND;
}

/** The two RPC arguments; at most one is non-null by construction. */
export function brandSelectionToArgs(selection: BrandSelection): {
  brandId: string | null;
  brandText: string | null;
} {
  switch (selection.kind) {
    case 'brand':
      return { brandId: selection.id, brandText: null };
    case 'text':
      return { brandId: null, brandText: selection.text };
    case 'none':
      return { brandId: null, brandText: null };
  }
}

export function sameBrandSelection(a: BrandSelection, b: BrandSelection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'brand' && b.kind === 'brand') return a.id === b.id;
  if (a.kind === 'text' && b.kind === 'text') return a.text === b.text;
  return true;
}

/** The brand as shown to people: the catalog name, or the seller's own text. */
export function brandSelectionLabel(selection: BrandSelection): string | null {
  switch (selection.kind) {
    case 'brand':
      return selection.name;
    case 'text':
      return selection.text;
    case 'none':
      return null;
  }
}

/** "Also matched as …" text for a suggestion, only when the match came through a different spelling. */
export function suggestionAliasHint(suggestion: BrandSuggestion): string | null {
  return suggestion.matchedAlias.toLowerCase() === suggestion.name.toLowerCase() ? null : suggestion.matchedAlias;
}

/**
 * The suggestion the typed text names exactly — its name or the alias that
 * matched — ignoring case and edge whitespace. Never fuzzy: "Nikee" matches
 * nothing. The one place this rule lives; the field uses it to decide whether
 * to offer "Use …" and resolveTypedBrand uses it to decide what Return means.
 */
export function findExactSuggestion(
  typed: string,
  suggestions: readonly BrandSuggestion[],
): BrandSuggestion | null {
  const lower = cleanBrandText(typed).toLowerCase();
  if (lower === '') return null;
  return (
    suggestions.find(
      (suggestion) => suggestion.name.toLowerCase() === lower || suggestion.matchedAlias.toLowerCase() === lower,
    ) ?? null
  );
}

/**
 * What the seller's typed text means right now. If it exactly names a
 * suggestion it IS that brand; otherwise it's custom text. The server applies
 * the same exact-alias rule when saving, so this only decides what the editor
 * shows before then — and a typed name whose suggestions haven't loaded is
 * sent as text and linked to the brand by the server.
 */
export function resolveTypedBrand(
  typed: string,
  suggestions: readonly BrandSuggestion[],
): { selection: BrandSelection; error: string | null } {
  const cleaned = cleanBrandText(typed);
  if (cleaned === '') return { selection: NO_BRAND, error: null };

  const error = brandTextError(cleaned);
  if (error) return { selection: NO_BRAND, error };

  const exact = findExactSuggestion(cleaned, suggestions);
  if (exact) return { selection: { kind: 'brand', id: exact.id, name: exact.name }, error: null };
  return { selection: { kind: 'text', text: cleaned }, error: null };
}
