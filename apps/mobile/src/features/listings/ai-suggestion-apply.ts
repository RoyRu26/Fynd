import { findCategorySelection, type CategoryGroup } from '@/features/categories/categories';
import type { ListingSuggestion } from '@/features/listings/ai-suggestions';
import { formatMinorUnitsForInput } from '@/features/listings/price';
import type { Enums } from '@/types/database';

/**
 * Pure glue between a ROADMAP 4.2 `ListingSuggestion` and the draft editor's
 * React Hook Form state (ROADMAP 4.3).
 *
 * Same discipline as this feature's other pure modules (price.ts,
 * condition.ts, photo-state.ts): no react-native import, no `@/lib/supabase`
 * import, directly unit-testable. The screen component owns the actual
 * `form.setValue(...)` calls and the "which field is currently marked
 * suggested" state — this module only computes what those calls and that
 * state should be.
 */

export type SuggestedFieldName = 'title' | 'description' | 'price' | 'condition' | 'categoryId';

/** `Math.round((minAmount + maxAmount) / 2)` — the single price the editor pre-fills. */
export function suggestedPriceMidpoint(minAmount: number, maxAmount: number): number {
  return Math.round((minAmount + maxAmount) / 2);
}

/**
 * Resolves a suggested `categoryId` against the live taxonomy, collapsing
 * two distinct "don't touch the field" cases into the same `null`:
 *   - the model didn't pick a category at all (`categoryId === null`)
 *   - the model picked an id that doesn't resolve to a real leaf in `groups`
 *     (a stale/hallucinated id, or the categories query hasn't loaded yet)
 *
 * The caller never needs to distinguish these — both mean "leave the
 * category field exactly as it was."
 */
export function resolveSuggestedCategoryId(categoryId: string | null, groups: CategoryGroup[]): string | null {
  if (categoryId === null) {
    return null;
  }
  return findCategorySelection(groups, categoryId) !== null ? categoryId : null;
}

/** The subset of `ListingFormInput` this feature ever writes. */
export type SuggestedFormValues = {
  title: string;
  description: string;
  condition: Enums<'listing_condition'>;
  price: string;
  categoryId?: string;
};

/**
 * Turns a model suggestion into form values plus the set of field names to
 * mark "Suggested". title/description/condition/price are always included —
 * the Edge Function always returns all four. `categoryId` is included only
 * when `resolveSuggestedCategoryId` resolves it against the live taxonomy;
 * otherwise the category field is left completely untouched.
 */
export function applySuggestionToForm(
  suggestion: ListingSuggestion,
  categoryGroups: CategoryGroup[],
): { values: SuggestedFormValues; suggestedFields: SuggestedFieldName[] } {
  const values: SuggestedFormValues = {
    title: suggestion.title,
    description: suggestion.description,
    condition: suggestion.condition,
    price: formatMinorUnitsForInput(suggestedPriceMidpoint(suggestion.priceMinAmount, suggestion.priceMaxAmount)),
  };
  const suggestedFields: SuggestedFieldName[] = ['title', 'description', 'condition', 'price'];

  const resolvedCategoryId = resolveSuggestedCategoryId(suggestion.categoryId, categoryGroups);
  if (resolvedCategoryId !== null) {
    values.categoryId = resolvedCategoryId;
    suggestedFields.push('categoryId');
  }

  return { values, suggestedFields };
}

/**
 * Trivial immutable removal — used whenever the seller edits a field that is
 * currently marked "Suggested", so its own chip disappears while every other
 * marked field stays untouched. Returns the same `Set` reference when the
 * field isn't present, so callers can skip a re-render for a no-op edit.
 */
export function clearSuggestedField(
  current: Set<SuggestedFieldName>,
  field: SuggestedFieldName,
): Set<SuggestedFieldName> {
  if (!current.has(field)) {
    return current;
  }
  const next = new Set(current);
  next.delete(field);
  return next;
}
