// Pure validation/normalization of the Claude tool-use response.
//
// No Deno-specific or network imports here (categories.ts's own import is
// pure too -- see its header), so this is unit-testable with
// `deno test supabase/functions/suggest-listing/` without any mocking
// layer.
//
// Everything in `rawToolInput` is treated as UNTRUSTED model output, not
// just untrusted client input -- CLAUDE.md's "treat all client input as
// untrusted" extends one hop further here: the model can return the wrong
// type, an out-of-range number, or a category_path that is not actually
// one of the enum values it was constrained to.

import { resolveCategoryPath, type CategoryPath } from './categories.ts';

/**
 * Mirrors apps/mobile/src/features/listings/condition.ts's real
 * `Enums<'listing_condition'>` values exactly. Kept as a manual literal
 * list rather than an import -- this Deno runtime cannot import the mobile
 * app's generated TypeScript types -- so if the database enum ever grows a
 * value, this list and condition.ts must be updated together.
 */
export const LISTING_CONDITIONS = ['new', 'like_new', 'very_good', 'good', 'fair'] as const;

export type ListingCondition = (typeof LISTING_CONDITIONS)[number];

export type ParsedSuggestion = {
  title: string;
  description: string;
  condition: ListingCondition;
  categoryId: string | null;
  priceMinAmount: number;
  priceMaxAmount: number;
};

/** Thrown for any shape the model returned that cannot become a suggestion. */
export class SuggestionValidationError extends Error {}

function isListingCondition(value: unknown): value is ListingCondition {
  return typeof value === 'string' && (LISTING_CONDITIONS as readonly string[]).includes(value);
}

/**
 * Validates and normalizes the raw `tool_use.input` Claude returned into a
 * `ParsedSuggestion`, or throws `SuggestionValidationError`. Never returns
 * a half-valid shape -- the caller maps any failure uniformly to the
 * `ai_unavailable` response reason, without needing to know which field
 * was wrong.
 */
export function parseAndValidateSuggestion(
  rawToolInput: unknown,
  categoryPaths: CategoryPath[],
): ParsedSuggestion {
  if (typeof rawToolInput !== 'object' || rawToolInput === null) {
    throw new SuggestionValidationError('Tool input is not an object');
  }
  const input = rawToolInput as Record<string, unknown>;

  const title = input.title;
  if (typeof title !== 'string') {
    throw new SuggestionValidationError('title must be a string');
  }
  const trimmedTitle = title.trim();
  if (trimmedTitle.length === 0 || trimmedTitle.length > 120) {
    throw new SuggestionValidationError('title must be 1-120 characters');
  }

  const description = input.description;
  if (typeof description !== 'string' || description.length > 5000) {
    throw new SuggestionValidationError('description must be a string of 5000 characters or fewer');
  }

  const condition = input.condition;
  if (!isListingCondition(condition)) {
    throw new SuggestionValidationError('condition must be one of the real listing_condition values');
  }

  const categoryPath = input.category_path;
  if (typeof categoryPath !== 'string') {
    throw new SuggestionValidationError('category_path must be a string');
  }
  // Never trust a model-supplied id directly -- there isn't one on the
  // tool schema. Resolution failure is not fatal: categoryId becomes null
  // rather than fabricating one (e.g. if the model ignored its enum
  // constraint and invented a path).
  const categoryId = resolveCategoryPath(categoryPath, categoryPaths);

  const priceMinAmount = input.price_min_amount;
  if (typeof priceMinAmount !== 'number' || !Number.isInteger(priceMinAmount) || priceMinAmount < 0) {
    throw new SuggestionValidationError('price_min_amount must be a non-negative integer');
  }

  const priceMaxAmount = input.price_max_amount;
  if (typeof priceMaxAmount !== 'number' || !Number.isInteger(priceMaxAmount) || priceMaxAmount < 0) {
    throw new SuggestionValidationError('price_max_amount must be a non-negative integer');
  }

  if (priceMaxAmount < priceMinAmount) {
    throw new SuggestionValidationError('price_max_amount must be >= price_min_amount');
  }

  return {
    title: trimmedTitle,
    description,
    condition,
    categoryId,
    priceMinAmount,
    priceMaxAmount,
  };
}
