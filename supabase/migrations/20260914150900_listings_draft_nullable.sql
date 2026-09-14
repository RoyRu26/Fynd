-- Allow listings to exist as incomplete drafts.
--
-- title/price_amount/condition become nullable so a draft can be created
-- before the seller has filled in any fields -- required so photos, which
-- reference listing_id, can be attached before form completion. Safety is
-- restored by listings_complete_when_not_draft below: any row whose status
-- is not 'draft' must have all three set. status keeps its existing
-- 'draft' default, unchanged by this migration.

alter table public.listings alter column title drop not null;
alter table public.listings alter column price_amount drop not null;
alter table public.listings alter column condition drop not null;

-- Replaces the untrimmed original, which accepted a 3-space title as a
-- valid 3-character title. Trimmed length is what the publish validation
-- (a later phase) will also check, so the DB constraint and publish agree
-- exactly rather than silently diverging.
alter table public.listings drop constraint listings_title_length;
alter table public.listings add constraint listings_title_length
  check (title is null or char_length(btrim(title)) between 3 and 120);

-- Null-safe: price_amount > 0 must still hold whenever it is provided.
alter table public.listings drop constraint listings_positive_price;
alter table public.listings add constraint listings_positive_price
  check (price_amount is null or price_amount > 0);

-- listings_description_length (char_length(description) <= 5000) is left
-- untouched: description stays NOT NULL DEFAULT '', so it was already
-- null-safe and needs no change.

-- The invariant that keeps the relaxation above safe: any listing that has
-- left draft status must be complete. Enforced at the DB layer so no
-- client-side or server-side code path can accidentally publish an
-- incomplete listing.
alter table public.listings add constraint listings_complete_when_not_draft
  check (
    status = 'draft'
    or (title is not null and price_amount is not null and condition is not null)
  );
