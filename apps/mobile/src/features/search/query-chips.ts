import { isolate } from '@/features/brands/brands';
import { ATTRIBUTE_KINDS, type AttributeKind, type AttributeVocabulary } from '@/features/listings/attributes';
import type { ExploreFilters } from '@/features/search/active-filters';
import {
  MAX_FILTER_IDS_PER_KIND,
  termAppliesToScope,
  toggleBrandFilter,
  toggleTermFilter,
  type CategoryScope,
} from '@/features/search/search';
import type { Database } from '@/types/database';

/**
 * Query chips (ROADMAP 7.5b, DESIGN.md §14.2): the words of a search query
 * that name a real filter ("black nike hoodie" -> Color: Black, Brand: Nike,
 * Item type: Hoodie), offered as chips that turn the word into a structured
 * filter. The server (`recognise_search_terms`) does the matching; this
 * module decides which of its rows are worth offering against the current
 * filter state, and what applying one does. Pure: no react-native, no
 * `@/lib/supabase`.
 */

/** The generated row type claims every column non-null; it isn't (see normalizeRecognisedRow). */
export type RecognisedTermRpcRow = Database['public']['Functions']['recognise_search_terms']['Returns'][number];

export type RecognisedTarget = { type: 'term'; kind: AttributeKind; id: string } | { type: 'brand'; id: string };

export type RecognisedTerm = {
  target: RecognisedTarget;
  /** Term label / brand name, as the server has it. */
  label: string;
  /** The query text that matched ("שחור", "trench coat"). */
  matchedText: string;
  /** The query without the matched words; null when they can't be removed cleanly ("black/white"). */
  queryWithoutMatch: string | null;
};

export type QueryChipOffer = {
  /** Stable and unique within the row — usable as a React key. */
  key: string;
  /** "Color: Black". */
  label: string;
  /** "Add Color Black filter. Matches “שחור”". */
  accessibilityLabel: string;
  /** Kind and value, for the announcement after applying ("Color Black"). */
  spokenName: string;
  recognised: RecognisedTerm;
};

/** At most this many chips show at once (Roy's D3). */
export const MAX_QUERY_CHIP_OFFERS = 3;

// Used only while the vocabulary hasn't loaded — and terms are never offered
// then anyway — so in practice this labels brands only. Mirrors
// active-filters.ts's fallback.
const FALLBACK_KIND_LABELS: Record<AttributeKind | 'brand', string> = {
  item_type: 'Item type',
  color: 'Color',
  style: 'Style',
  material: 'Material',
  pattern: 'Pattern',
  fit: 'Fit',
  brand: 'Brand',
};

function isAttributeKind(kind: string): kind is AttributeKind {
  return (ATTRIBUTE_KINDS as readonly string[]).includes(kind);
}

/**
 * Row -> domain. Returns null — the row is skipped, never the whole set — for
 * a kind this client doesn't know (a newer server taxonomy) and for a row that
 * breaks the RPC's own contract (not exactly one of term_id / brand_id, a kind
 * that disagrees with its id, no label): a chip is an optional hint, so a bad
 * row costs one chip, not the row of them. `onMalformed` hears about the
 * contract breaks only (api.ts warns in development).
 */
export function normalizeRecognisedRow(
  row: RecognisedTermRpcRow,
  onMalformed?: (reason: string) => void,
): RecognisedTerm | null {
  // Nullable at runtime despite the generated type.
  const termId = row.term_id as string | null;
  const brandId = row.brand_id as string | null;
  const label = row.label as string | null;
  const queryWithoutMatch = row.query_without_match as string | null;
  const matchedText = (row.matched_text as string | null) ?? '';

  const malformed = (reason: string): null => {
    onMalformed?.(`recognise_search_terms row (kind ${row.kind}): ${reason}`);
    return null;
  };

  if ((termId === null) === (brandId === null)) return malformed('must name exactly one of a term or a brand');
  if (!label) return malformed('has no label');

  if (row.kind === 'brand') {
    if (brandId === null) return malformed('brand row has no brand_id');
    return { target: { type: 'brand', id: brandId }, label, matchedText, queryWithoutMatch };
  }
  if (!isAttributeKind(row.kind)) return null;
  if (termId === null) return malformed('term row has no term_id');
  return { target: { type: 'term', kind: row.kind, id: termId }, label, matchedText, queryWithoutMatch };
}

function targetKey(target: RecognisedTarget): string {
  return target.type === 'brand' ? `brand:${target.id}` : `term:${target.kind}:${target.id}`;
}

function kindLabel(kind: AttributeKind | 'brand', vocab: AttributeVocabulary | undefined): string {
  if (kind === 'brand') return FALLBACK_KIND_LABELS.brand;
  return vocab?.kinds.find((info) => info.kind === kind)?.label ?? FALLBACK_KIND_LABELS[kind];
}

/** "Color: Black". Values are bidi-isolated: a brand or label may be Hebrew. */
export function queryChipLabel(kindName: string, valueLabel: string): string {
  return `${kindName}: ${isolate(valueLabel)}`;
}

/** "Add Color Black filter. Matches “שחור”" — says what the tap does and which words it came from. */
export function queryChipAccessibilityLabel(kindName: string, valueLabel: string, matchedText: string): string {
  const base = `Add ${kindName} ${isolate(valueLabel)} filter`;
  return matchedText.length > 0 ? `${base}. Matches “${isolate(matchedText)}”` : base;
}

/** Spoken after a chip is applied. */
export function queryChipAnnouncement(offer: QueryChipOffer): string {
  return `Added ${offer.spokenName} filter`;
}

/**
 * The chips worth offering, in the server's order (query order), at most
 * `MAX_QUERY_CHIP_OFFERS`. A row is hidden when:
 *   - term: the vocabulary hasn't loaded or doesn't know it, it is retired,
 *     it is already selected, its kind is at `MAX_FILTER_IDS_PER_KIND`, or it
 *     doesn't apply to the committed category (no "Hoodie" under Shoes);
 *   - brand: it is already chosen, or the brand list is full;
 *   - another row already offers the same target.
 */
export function deriveQueryChipOffers(
  rows: readonly RecognisedTerm[],
  filters: ExploreFilters,
  vocab: AttributeVocabulary | undefined,
  scope: CategoryScope,
): QueryChipOffer[] {
  const offers: QueryChipOffer[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (offers.length >= MAX_QUERY_CHIP_OFFERS) break;
    const key = targetKey(row.target);
    if (seen.has(key)) continue;

    let kindName: string;
    let valueLabel: string;
    if (row.target.type === 'term') {
      if (!vocab) continue;
      const term = vocab.termsById.get(row.target.id);
      const selected = filters.termIds[row.target.kind];
      if (
        !term ||
        term.retired ||
        term.kind !== row.target.kind ||
        selected.includes(term.id) ||
        selected.length >= MAX_FILTER_IDS_PER_KIND ||
        !termAppliesToScope(vocab, term, scope)
      ) {
        continue;
      }
      kindName = kindLabel(term.kind, vocab);
      valueLabel = term.label;
    } else {
      const brandId = row.target.id;
      if (filters.brands.some((brand) => brand.id === brandId) || filters.brands.length >= MAX_FILTER_IDS_PER_KIND) {
        continue;
      }
      kindName = kindLabel('brand', vocab);
      valueLabel = row.label;
    }

    seen.add(key);
    offers.push({
      key,
      label: queryChipLabel(kindName, valueLabel),
      accessibilityLabel: queryChipAccessibilityLabel(kindName, valueLabel, row.matchedText),
      spokenName: `${kindName} ${isolate(valueLabel)}`,
      recognised: row,
    });
  }

  return offers;
}

/**
 * What the Explore screen shows: the offers for `rows`, but only while the
 * search field has settled on the query those rows answer
 * (`input.trim() === effectiveQuery`). Mid-typing, the rows are for older
 * text, and applying one would overwrite what was typed since with that
 * text's "query without the match". Nothing while the rows are loading or
 * recognition failed (`rows` undefined) — a hint shows no error.
 */
export function visibleQueryChipOffers(
  input: string,
  effectiveQuery: string,
  rows: readonly RecognisedTerm[] | undefined,
  filters: ExploreFilters,
  vocab: AttributeVocabulary | undefined,
  scope: CategoryScope,
): QueryChipOffer[] {
  if (!rows || effectiveQuery.length === 0 || input.trim() !== effectiveQuery) return [];
  return deriveQueryChipOffers(rows, filters, vocab, scope);
}

/**
 * Applying a chip ADDS its filter (never toggles one off) and, when the
 * server could remove the matched words cleanly, replaces the query with the
 * rest (Roy's D2) — "black nike hoodie" + Color: Black -> "nike hoodie".
 * When nothing was added (already selected, kind full, unknown term), the
 * filters and the query are returned unchanged.
 */
export function applyQueryChip(
  offer: QueryChipOffer,
  filters: ExploreFilters,
  currentQuery: string,
  vocab: AttributeVocabulary | undefined,
): { filters: ExploreFilters; query: string } {
  const unchanged = { filters, query: currentQuery };
  const { target } = offer.recognised;

  let next: ExploreFilters;
  if (target.type === 'term') {
    if (!vocab || filters.termIds[target.kind].includes(target.id)) return unchanged;
    const termIds = toggleTermFilter(vocab, filters.termIds, target.id);
    if (termIds === filters.termIds) return unchanged;
    next = { ...filters, termIds };
  } else {
    if (filters.brands.some((brand) => brand.id === target.id)) return unchanged;
    const brands = toggleBrandFilter(filters.brands, { id: target.id, name: offer.recognised.label });
    if (brands === filters.brands) return unchanged;
    next = { ...filters, brands };
  }

  return { filters: next, query: offer.recognised.queryWithoutMatch ?? currentQuery };
}
