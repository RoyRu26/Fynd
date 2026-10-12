import { z } from 'zod';

import { parsePriceToMinorUnits } from '@/features/listings/price';
import { LISTING_SIZES } from '@/features/listings/size';
import { Constants, type Enums, type Tables } from '@/types/database';

/**
 * Form-facing validation for the listing editor.
 *
 * Every bound below mirrors a database constraint exactly, so the client and
 * the server agree rather than silently diverging:
 *
 *   listings_title_length            char_length(btrim(title)) between 3 and 120
 *   listings_description_length      char_length(description) <= 5000
 *   listings_positive_price          price_amount is null or > 0
 *   listings_complete_when_not_draft a non-draft has title, price and condition
 *
 * The draft/publish split follows the same model: a draft may be incomplete
 * (M1 made those three columns nullable), and completeness is only required at
 * the draft -> active boundary, where `publish_listing` re-validates all of it
 * server-side. Nothing here is authoritative.
 */

export const TITLE_MIN_LENGTH = 3;
export const TITLE_MAX_LENGTH = 120;
export const DESCRIPTION_MAX_LENGTH = 5000;

/** Sourced from the generated types, so a new enum value cannot be missed. */
export const LISTING_CONDITIONS = Constants.public.Enums.listing_condition;

export const listingConditionSchema = z.enum(LISTING_CONDITIONS);

/**
 * Same discipline for size. `LISTING_SIZES` lives in size.ts alongside the
 * label/grouping helpers, and is itself derived from the generated enum, so
 * this schema cannot drift from what the database accepts.
 */
export const listingSizeSchema = z.enum(LISTING_SIZES);

const PRICE_MESSAGE = 'Enter a price like 24.50';
const TITLE_SHORT_MESSAGE = `Use at least ${TITLE_MIN_LENGTH} characters`;
const TITLE_LONG_MESSAGE = `Keep it under ${TITLE_MAX_LENGTH} characters`;
const DESCRIPTION_LONG_MESSAGE = `Keep it under ${DESCRIPTION_MAX_LENGTH} characters`;

/** Trimmed, because the DB constraint is trimmed and publish re-checks it. */
const description = z.string().trim().max(DESCRIPTION_MAX_LENGTH, DESCRIPTION_LONG_MESSAGE);

/**
 * The raw shape React Hook Form holds. Price stays a string here; it becomes
 * minor units only through the schemas below.
 */
export type ListingFormInput = {
  title: string;
  description: string;
  price: string;
  condition: Enums<'listing_condition'> | null;
  size: Enums<'listing_size'> | null;
};

/**
 * What may be saved to a draft. Blank fields become NULL rather than failing:
 * that is the whole point of M1. A field that is filled in must still be valid,
 * so a half-finished draft can never hold a value the DB would reject.
 */
export const draftListingSchema = z.object({
  title: z
    .string()
    .trim()
    .max(TITLE_MAX_LENGTH, TITLE_LONG_MESSAGE)
    .refine((value) => value === '' || value.length >= TITLE_MIN_LENGTH, TITLE_SHORT_MESSAGE)
    .transform((value) => (value === '' ? null : value)),
  description,
  price: z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === '') {
        return null;
      }
      const minorUnits = parsePriceToMinorUnits(value);
      if (minorUnits === null) {
        ctx.addIssue({ code: 'custom', message: PRICE_MESSAGE });
        return z.NEVER;
      }
      return minorUnits;
    }),
  condition: listingConditionSchema.nullable(),
  // Nullable for the same reason title/price/condition are: a draft may be
  // incomplete, and `listings_complete_when_not_draft` only requires size
  // once the listing stops being a draft.
  size: listingSizeSchema.nullable(),
});

export type DraftListingInput = z.infer<typeof draftListingSchema>;

/**
 * What publishing requires. Same bounds, nothing optional — this expresses the
 * completeness `publish_listing` will insist on, without contradicting the
 * draft model above.
 */
export const publishableListingSchema = z.object({
  title: z
    .string()
    .trim()
    .min(TITLE_MIN_LENGTH, TITLE_SHORT_MESSAGE)
    .max(TITLE_MAX_LENGTH, TITLE_LONG_MESSAGE),
  description,
  price: z
    .string()
    .trim()
    .transform((value, ctx) => {
      const minorUnits = parsePriceToMinorUnits(value);
      if (minorUnits === null) {
        ctx.addIssue({ code: 'custom', message: PRICE_MESSAGE });
        return z.NEVER;
      }
      return minorUnits;
    }),
  condition: listingConditionSchema,
  size: listingSizeSchema,
});

export type PublishableListingInput = z.infer<typeof publishableListingSchema>;

export type PublishBlocker = 'title' | 'price' | 'condition' | 'size' | 'photos' | 'status';

/**
 * The reasons a saved listing cannot be published yet, in the order
 * `publish_listing` checks them.
 *
 * Advisory: it lets the UI explain what is missing and disable the button
 * without a round trip. The RPC re-derives all of it and is the only authority
 * — in particular it also re-verifies that each attached photo's Storage object
 * still exists, which the client cannot check.
 */
export function publishBlockers(
  listing: Pick<Tables<'listings'>, 'title' | 'price_amount' | 'condition' | 'size' | 'status'>,
  imageCount: number,
): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];

  if (listing.status !== 'draft') {
    blockers.push('status');
  }
  if (listing.title === null || listing.title.trim().length < TITLE_MIN_LENGTH) {
    blockers.push('title');
  }
  if (listing.price_amount === null || listing.price_amount <= 0) {
    blockers.push('price');
  }
  if (listing.condition === null) {
    blockers.push('condition');
  }
  if (listing.size === null) {
    blockers.push('size');
  }
  if (imageCount < 1) {
    blockers.push('photos');
  }

  return blockers;
}
