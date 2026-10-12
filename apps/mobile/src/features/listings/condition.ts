import type { Enums } from '@/types/database';

/**
 * Condition label helper — same shape as size.ts's label half, for the same
 * reason: `CONDITION_LABELS` was independently duplicated across
 * sell/[id].tsx, feed-card.tsx, and the listing detail screen, which is
 * exactly the drift risk a single source avoids.
 *
 * `LISTING_CONDITIONS` (the enum values themselves) stays in schemas.ts,
 * where it already lived as part of `listingConditionSchema` — this file
 * only adds the label mapping, not a second copy of the enum constant.
 */

export type ListingCondition = Enums<'listing_condition'>;

/** The user-facing label. Raw enum strings must never reach the UI. */
export const CONDITION_LABELS: Record<ListingCondition, string> = {
  new: 'New',
  like_new: 'Like new',
  very_good: 'Very good',
  good: 'Good',
  fair: 'Fair',
};

export function formatConditionLabel(condition: ListingCondition): string {
  return CONDITION_LABELS[condition];
}
