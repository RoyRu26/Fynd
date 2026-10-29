import { brandSelectionLabel, type BrandSelection } from '@/features/brands/brands';
import type { AiSuggestion, ListingCondition } from '@/features/listings/ai-suggestion';
import {
  isKindFull,
  selectedInKind,
  termAppliesToCategory,
  type AttributeKind,
  type AttributeVocabulary,
} from '@/features/listings/attributes';
import { formatConditionLabel } from '@/features/listings/condition';
import { formatMinorUnitsForInput, formatMoney, parsePriceToMinorUnits } from '@/features/listings/price';

/**
 * What an AI suggestion is allowed to do (AI listing metadata plan, §8–9).
 *
 * Pure, so the whole policy is unit-tested. The rules:
 *
 *   * The seller is the source of truth. AI only ever fills a field that is
 *     EMPTY at the moment the result arrives; anything the seller entered is
 *     never overwritten. A different AI value becomes an optional offer
 *     ("AI suggests: Vintage") the seller can tap or dismiss.
 *   * Confidence: >= 0.85 may pre-fill an empty field; 0.60–0.85 is an offer
 *     only; < 0.60 is not shown.
 *   * Condition never pre-fills: always an offer the seller confirms.
 *   * Size is never suggested (the server has no size field at all).
 *   * Brand pre-fills only at >= 0.90 with `label` / `printed_text` evidence
 *     AND a match to a known Fynd brand. `logo` evidence is an offer at most;
 *     `style_inference` and `none` are never shown. Unknown brands can be
 *     offered as text.
 *   * Material pre-fills only with readable-label evidence; a visual guess is
 *     an offer at most.
 *   * Attribute values must apply to the listing's category (the database
 *     re-checks on save); with no category, none are pre-filled or offered,
 *     matching the Details UI, which shows attributes only after a category.
 *   * Title, description, category, price and keywords carry no confidence:
 *     they pre-fill an empty field, otherwise they are offers (also offered
 *     into a field the seller left or made blank, e.g. after a restore).
 *   * Prices: the model prices in ILS agorot, so a price is only pre-filled
 *     or offered for an ILS listing.
 */

export const PREFILL_CONFIDENCE = 0.85;
export const OFFER_CONFIDENCE = 0.6;
export const BRAND_PREFILL_CONFIDENCE = 0.9;
export const MAX_KEYWORDS = 10;

export type AiField =
  | 'title'
  | 'description'
  | 'price'
  | 'categoryId'
  | 'condition'
  | 'brand'
  | 'keywords'
  | AttributeKind;

/** What the seller has right now — read at the moment a result arrives, and on every render for offers. */
export type SellerSnapshot = {
  title: string;
  description: string;
  price: string;
  categoryId: string | null;
  condition: ListingCondition | null;
  selection: readonly string[];
  brand: BrandSelection;
  brandDraft: string;
  keywords: readonly string[];
  keywordDraft: string;
};

export type PolicyContext = {
  vocab: AttributeVocabulary | undefined;
  /** The listing's currency; the model only prices in ILS. */
  currency: string;
  /** Whether a category id is a real, loaded leaf (never apply one that isn't). */
  isKnownCategory: (categoryId: string) => boolean;
};

type Tier = 'prefill' | 'offer' | 'hide';

export function confidenceTier(confidence: number): Tier {
  if (confidence >= PREFILL_CONFIDENCE) return 'prefill';
  if (confidence >= OFFER_CONFIDENCE) return 'offer';
  return 'hide';
}

/** Brand has its own, stricter rules (see the module comment). */
export function brandTier(brand: NonNullable<AiSuggestion['brand']>): Tier {
  if (brand.evidence === 'style_inference' || brand.evidence === 'none') return 'hide';
  if (brand.confidence < OFFER_CONFIDENCE) return 'hide';
  if (
    (brand.evidence === 'label' || brand.evidence === 'printed_text') &&
    brand.confidence >= BRAND_PREFILL_CONFIDENCE &&
    brand.brandId !== null
  ) {
    return 'prefill';
  }
  return 'offer';
}

function brandSelectionOf(brand: NonNullable<AiSuggestion['brand']>): BrandSelection {
  return brand.brandId !== null
    ? { kind: 'brand', id: brand.brandId, name: brand.name }
    : { kind: 'text', text: brand.name };
}

function sameBrand(current: BrandSelection, suggested: NonNullable<AiSuggestion['brand']>): boolean {
  if (current.kind === 'brand' && suggested.brandId !== null) return current.id === suggested.brandId;
  return (brandSelectionLabel(current) ?? '').toLowerCase() === suggested.name.toLowerCase();
}

const blank = (value: string) => value.trim() === '';
const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

type ScoredTerm = { termId: string; confidence: number; evidence?: 'label' | 'visual' };

/** Every suggested term with its kind, in a stable order. */
function suggestedTerms(s: AiSuggestion): { kind: AttributeKind; term: ScoredTerm }[] {
  const single = (kind: AttributeKind, term: ScoredTerm | null) => (term ? [{ kind, term }] : []);
  return [
    ...single('item_type', s.itemType),
    ...s.colors.map((term) => ({ kind: 'color' as const, term })),
    ...s.styles.map((term) => ({ kind: 'style' as const, term })),
    ...s.materials.map((term) => ({ kind: 'material' as const, term })),
    ...single('pattern', s.pattern),
    ...single('fit', s.fit),
  ];
}

/** The term exists, is active, and applies to the category (which must be set). */
function usableTerm(ctx: PolicyContext, termId: string, categoryId: string | null): boolean {
  if (!ctx.vocab || categoryId === null) return false;
  const term = ctx.vocab.termsById.get(termId);
  return !!term && !term.retired && termAppliesToCategory(ctx.vocab, term, categoryId);
}

function termTier(kind: AttributeKind, term: ScoredTerm): Tier {
  const tier = confidenceTier(term.confidence);
  // Material pre-fills only from a readable label.
  if (kind === 'material' && tier === 'prefill' && term.evidence !== 'label') return 'offer';
  return tier;
}

function priceMidpoint(range: { minAmount: number; maxAmount: number }): number {
  return Math.max(1, Math.round((range.minAmount + range.maxAmount) / 2));
}

// ============================================================
// Pre-fill (applied once, when a fresh result arrives)
// ============================================================

export type AiPrefill = {
  /** Form fields to set; only ones that are empty in the snapshot. */
  form: Partial<{ title: string; description: string; price: string; categoryId: string }>;
  /**
   * Attribute terms to add. Candidates only: the attribute editor adds a term
   * only if its kind is STILL empty when it applies them, so a value the
   * seller picked a moment earlier always wins.
   */
  termIds: string[];
  /** Brand to set if the seller still has none, else null. */
  brand: BrandSelection | null;
  /** Keywords to set if the seller still has none, else null. */
  keywords: string[] | null;
};

export function planPrefill(s: AiSuggestion, seller: SellerSnapshot, ctx: PolicyContext): AiPrefill {
  const form: AiPrefill['form'] = {};
  if (s.title && blank(seller.title)) form.title = s.title;
  if (s.description && blank(seller.description)) form.description = s.description;
  if (s.price && ctx.currency === 'ILS' && blank(seller.price)) {
    form.price = formatMinorUnitsForInput(priceMidpoint(s.price));
  }
  if (s.categoryId && seller.categoryId === null && ctx.isKnownCategory(s.categoryId)) form.categoryId = s.categoryId;

  const categoryId = seller.categoryId ?? form.categoryId ?? null;
  const termIds: string[] = [];
  const addedPerKind = new Map<AttributeKind, number>();
  for (const { kind, term } of suggestedTerms(s)) {
    if (termTier(kind, term) !== 'prefill' || !usableTerm(ctx, term.termId, categoryId)) continue;
    if (selectedInKind(ctx.vocab!, seller.selection, kind).length > 0) continue;
    const maxValues = ctx.vocab!.kinds.find((info) => info.kind === kind)?.maxValues ?? 1;
    const added = addedPerKind.get(kind) ?? 0;
    if (added >= maxValues) continue;
    addedPerKind.set(kind, added + 1);
    termIds.push(term.termId);
  }

  const brand =
    s.brand && brandTier(s.brand) === 'prefill' && seller.brand.kind === 'none' && blank(seller.brandDraft)
      ? brandSelectionOf(s.brand)
      : null;

  const keywords =
    s.keywords.length > 0 && seller.keywords.length === 0 && blank(seller.keywordDraft)
      ? s.keywords.slice(0, MAX_KEYWORDS)
      : null;

  return { form, termIds, brand, keywords };
}

/** Kinds whose current values are exactly what AI pre-filled — they show a "Suggested" mark until edited. */
export function prefilledKinds(
  prefill: AiPrefill | null,
  selection: readonly string[],
  vocab: AttributeVocabulary | undefined,
): Set<AttributeKind> {
  const kinds = new Set<AttributeKind>();
  if (!prefill || !vocab) return kinds;
  for (const info of vocab.kinds) {
    const prefilled = prefill.termIds.filter((id) => vocab.termsById.get(id)?.kind === info.kind);
    if (prefilled.length === 0) continue;
    const current = selectedInKind(vocab, selection, info.kind);
    if (current.length === prefilled.length && current.every((id, index) => id === prefilled[index])) {
      kinds.add(info.kind);
    }
  }
  return kinds;
}

// ============================================================
// Offers ("AI suggests: …"), derived on every render
// ============================================================

export type AiOfferAction =
  | { type: 'setTitle'; value: string }
  | { type: 'setDescription'; value: string }
  | { type: 'setPrice'; value: string }
  | { type: 'setCategory'; categoryId: string }
  | { type: 'setCondition'; value: ListingCondition }
  | { type: 'addTerm'; termId: string }
  | { type: 'setBrand'; brand: BrandSelection }
  | { type: 'addKeyword'; keyword: string };

export type AiOffer = {
  /** Stable identity, used to remember a dismissal. */
  key: string;
  field: AiField;
  label: string;
  action: AiOfferAction;
};

export type OfferContext = PolicyContext & {
  categoryLabel: (categoryId: string) => string | null;
};

/**
 * Every suggestion that differs from what the seller has now and that policy
 * allows showing, minus dismissed ones. Re-derived from current state, so an
 * offer disappears as soon as the seller's value matches it (by applying it or
 * by typing the same thing).
 */
export function pendingOffers(
  s: AiSuggestion,
  seller: SellerSnapshot,
  ctx: OfferContext,
  dismissed: ReadonlySet<string>,
): AiOffer[] {
  const offers: AiOffer[] = [];
  const offer = (o: AiOffer) => {
    if (!dismissed.has(o.key)) offers.push(o);
  };

  if (s.title && !sameText(seller.title, s.title)) {
    offer({ key: `title:${s.title}`, field: 'title', label: s.title, action: { type: 'setTitle', value: s.title } });
  }
  if (s.description && !sameText(seller.description, s.description)) {
    offer({
      key: `description:${s.description}`,
      field: 'description',
      label: s.description,
      action: { type: 'setDescription', value: s.description },
    });
  }
  if (s.price && ctx.currency === 'ILS') {
    const current = blank(seller.price) ? null : parsePriceToMinorUnits(seller.price);
    if (current === null || current < s.price.minAmount || current > s.price.maxAmount) {
      const label = `${formatMoney(s.price.minAmount, ctx.currency)}–${formatMoney(s.price.maxAmount, ctx.currency)}`;
      offer({
        key: `price:${s.price.minAmount}-${s.price.maxAmount}`,
        field: 'price',
        label,
        action: { type: 'setPrice', value: formatMinorUnitsForInput(priceMidpoint(s.price)) },
      });
    }
  }
  if (s.categoryId && seller.categoryId !== s.categoryId && ctx.isKnownCategory(s.categoryId)) {
    const label = ctx.categoryLabel(s.categoryId);
    if (label) {
      offer({
        key: `categoryId:${s.categoryId}`,
        field: 'categoryId',
        label,
        action: { type: 'setCategory', categoryId: s.categoryId },
      });
    }
  }
  // Condition: always an offer, never pre-filled.
  if (s.condition && confidenceTier(s.condition.confidence) !== 'hide' && seller.condition !== s.condition.value) {
    offer({
      key: `condition:${s.condition.value}`,
      field: 'condition',
      label: formatConditionLabel(s.condition.value),
      action: { type: 'setCondition', value: s.condition.value },
    });
  }

  if (ctx.vocab) {
    for (const { kind, term } of suggestedTerms(s)) {
      if (termTier(kind, term) === 'hide' || !usableTerm(ctx, term.termId, seller.categoryId)) continue;
      if (seller.selection.includes(term.termId)) continue;
      if (isKindFull(ctx.vocab, seller.selection, kind)) continue;
      const label = ctx.vocab.termsById.get(term.termId)?.label ?? '';
      offer({ key: `${kind}:${term.termId}`, field: kind, label, action: { type: 'addTerm', termId: term.termId } });
    }
  }

  if (s.brand && brandTier(s.brand) !== 'hide' && !sameBrand(seller.brand, s.brand)) {
    offer({
      key: `brand:${s.brand.brandId ?? s.brand.name.toLowerCase()}`,
      field: 'brand',
      label: s.brand.name,
      action: { type: 'setBrand', brand: brandSelectionOf(s.brand) },
    });
  }

  if (seller.keywords.length < MAX_KEYWORDS) {
    for (const keyword of s.keywords) {
      if (seller.keywords.includes(keyword)) continue;
      offer({ key: `keywords:${keyword}`, field: 'keywords', label: keyword, action: { type: 'addKeyword', keyword } });
    }
  }

  return offers;
}

const OFFER_LABEL_MAX = 48;

/** A long suggestion (a description) shown as a short chip label; the full text is spoken. */
export function shortOfferLabel(label: string): string {
  const chars = [...label.replace(/\s+/g, ' ').trim()];
  return chars.length <= OFFER_LABEL_MAX ? chars.join('') : `${chars.slice(0, OFFER_LABEL_MAX - 1).join('').trimEnd()}…`;
}

export function offersForField(offers: readonly AiOffer[], field: AiField): AiOffer[] {
  return offers.filter((o) => o.field === field);
}
