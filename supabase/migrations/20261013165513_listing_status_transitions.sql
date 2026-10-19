-- ROADMAP 1.6 "Manage a listing": the post-publish lifecycle transitions.
--
-- Until now the listing_status enum (draft | active | reserved | sold |
-- removed) only ever held draft or active -- publish_listing is the sole
-- transition, and the direct-UPDATE RLS policy on listings is already
-- locked to status = 'draft' only (20260914151000). This migration adds
-- the five RPCs that activate the remaining three statuses, closing the
-- rest of the transition matrix:
--
--   draft    -> active            publish_listing (unchanged, elsewhere)
--   active   -> reserved          mark_listing_reserved
--   active   -> sold              mark_listing_sold
--   active   -> removed           remove_listing
--   reserved -> active            mark_listing_active
--   reserved -> sold              mark_listing_sold
--   reserved -> removed           remove_listing
--   sold     -> *                 terminal, nothing reaches it
--   removed  -> *                 terminal, nothing reaches it
--
-- `update_listing_details` is the sixth RPC: the edit path for an
-- active/reserved listing, now that the direct client UPDATE is closed for
-- anything but a draft. It re-validates the same completeness rules
-- publish_listing already enforces (trimmed title >= 3 chars, price > 0,
-- condition and size both set) so a successful edit can never put the row
-- in a state listings_complete_when_not_draft would have refused.
--
-- Deliberately NOT built here (see ROADMAP 1.6 scope notes):
--   * No buyer_id on mark_listing_sold -- that is ROADMAP 5.3, later.
--   * remove_listing never accepts 'sold' -- sold is permanent history.
--   * listing_images stays untouched: photos remain draft-only, so editing
--     an active/reserved listing is read-only for photos in the UI.
--
-- Every function below copies publish_listing's hardening pattern exactly
-- (see 20260914160100_listing_rpcs.sql's header comment for the full
-- rationale): SECURITY DEFINER, `set search_path = ''`, every name fully
-- qualified, a caller identity taken only from auth.uid() (never a
-- parameter), `for update` row lock so concurrent calls serialise,
-- ownership compared with IS DISTINCT FROM (never <>, which silently skips
-- the check when auth.uid() is NULL), not-found -> P0002, wrong-source-
-- status -> P0001 with a descriptive message, and EXECUTE revoked from
-- PUBLIC and anon separately before granting to authenticated only.

-- ============================================================
-- mark_listing_reserved
-- ============================================================
-- active -> reserved only. Freely reversible with mark_listing_active, so
-- the client fires this with no confirmation step.

create or replace function public.mark_listing_reserved(p_listing_id uuid)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing public.listings;
begin
  select * into v_listing from public.listings
   where id = p_listing_id
   for update;

  if not found then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;

  if v_listing.seller_id is distinct from (select auth.uid()) then
    raise exception 'Not your listing' using errcode = '42501';
  end if;

  -- `for update` above serialises concurrent calls, so a second caller (or
  -- a retry) reaches this check after the first has committed.
  if v_listing.status <> 'active' then
    raise exception 'Only an active listing can be marked as reserved' using errcode = 'P0001';
  end if;

  update public.listings set status = 'reserved'
   where id = p_listing_id
   returning * into v_listing;

  return v_listing;
end;
$$;

revoke all    on function public.mark_listing_reserved(uuid) from public;
revoke all    on function public.mark_listing_reserved(uuid) from anon;
grant execute on function public.mark_listing_reserved(uuid) to authenticated;

-- ============================================================
-- mark_listing_active
-- ============================================================
-- reserved -> active only. A draft is rejected with a distinct, more useful
-- message pointing at publish_listing, rather than the generic
-- wrong-source-status message -- "reserved only" would otherwise read as a
-- confusing non-sequitur to a seller tapping this from a draft row (which
-- cannot happen from the UI today, but the RPC is still the only authority).

create or replace function public.mark_listing_active(p_listing_id uuid)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing public.listings;
begin
  select * into v_listing from public.listings
   where id = p_listing_id
   for update;

  if not found then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;

  if v_listing.seller_id is distinct from (select auth.uid()) then
    raise exception 'Not your listing' using errcode = '42501';
  end if;

  if v_listing.status = 'draft' then
    raise exception 'A draft must be published with publish_listing, not mark_listing_active'
      using errcode = 'P0001';
  end if;

  if v_listing.status <> 'reserved' then
    raise exception 'Only a reserved listing can be marked as active' using errcode = 'P0001';
  end if;

  update public.listings set status = 'active'
   where id = p_listing_id
   returning * into v_listing;

  return v_listing;
end;
$$;

revoke all    on function public.mark_listing_active(uuid) from public;
revoke all    on function public.mark_listing_active(uuid) from anon;
grant execute on function public.mark_listing_active(uuid) to authenticated;

-- ============================================================
-- mark_listing_sold
-- ============================================================
-- active|reserved -> sold. Deliberately the simple no-buyer-tracking
-- version: no buyer_id parameter. ROADMAP 5.3 adds buyer selection later as
-- its own, separate change -- not widening this signature retroactively.
-- Sold is terminal: nothing in this migration (or earlier) can leave it.

create or replace function public.mark_listing_sold(p_listing_id uuid)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing public.listings;
begin
  select * into v_listing from public.listings
   where id = p_listing_id
   for update;

  if not found then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;

  if v_listing.seller_id is distinct from (select auth.uid()) then
    raise exception 'Not your listing' using errcode = '42501';
  end if;

  if v_listing.status not in ('active', 'reserved') then
    raise exception 'Only an active or reserved listing can be marked as sold' using errcode = 'P0001';
  end if;

  update public.listings set status = 'sold'
   where id = p_listing_id
   returning * into v_listing;

  return v_listing;
end;
$$;

revoke all    on function public.mark_listing_sold(uuid) from public;
revoke all    on function public.mark_listing_sold(uuid) from anon;
grant execute on function public.mark_listing_sold(uuid) to authenticated;

-- ============================================================
-- remove_listing
-- ============================================================
-- active|reserved -> removed. Sold is NOT removable through this path --
-- scope decision: a sold listing is permanent history, consistent with the
-- rest of the schema's treatment of sold as terminal. A draft is removed
-- through deleteDraft's hard DELETE instead, never through this RPC.

create or replace function public.remove_listing(p_listing_id uuid)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing public.listings;
begin
  select * into v_listing from public.listings
   where id = p_listing_id
   for update;

  if not found then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;

  if v_listing.seller_id is distinct from (select auth.uid()) then
    raise exception 'Not your listing' using errcode = '42501';
  end if;

  if v_listing.status not in ('active', 'reserved') then
    raise exception 'Only an active or reserved listing can be removed' using errcode = 'P0001';
  end if;

  update public.listings set status = 'removed'
   where id = p_listing_id
   returning * into v_listing;

  return v_listing;
end;
$$;

revoke all    on function public.remove_listing(uuid) from public;
revoke all    on function public.remove_listing(uuid) from anon;
grant execute on function public.remove_listing(uuid) to authenticated;

-- ============================================================
-- update_listing_details
-- ============================================================
-- The edit path for an active or reserved listing. The direct-UPDATE RLS
-- policy on listings is locked to status = 'draft' only, so this RPC is the
-- entire edit surface for a published listing -- deliberately narrow:
--
--   * Only title/description/price_amount/condition/size move. status,
--     seller_id, currency and images are never touched here.
--   * Re-validates the same completeness rules publish_listing already
--     enforces (trimmed title >= 3 chars, price > 0, condition and size
--     both set), with a friendly P0001 rather than letting a bad value
--     fall through to the bare listings_complete_when_not_draft CHECK
--     (23514) -- same reasoning, mirrored rather than reinvented.
--   * Photos are untouched by design: listing_images stays draft-scoped
--     (RLS and the attach/reorder RPCs alike), so editing a live listing is
--     photo-read-only in the UI. Nothing here widens that.

create or replace function public.update_listing_details(
  p_listing_id   uuid,
  p_title        text,
  p_description  text,
  p_price_amount bigint,
  p_condition    public.listing_condition,
  p_size         public.listing_size
)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing public.listings;
begin
  select * into v_listing from public.listings
   where id = p_listing_id
   for update;

  if not found then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;

  if v_listing.seller_id is distinct from (select auth.uid()) then
    raise exception 'Not your listing' using errcode = '42501';
  end if;

  if v_listing.status not in ('active', 'reserved') then
    raise exception 'Only an active or reserved listing can be edited this way' using errcode = 'P0001';
  end if;

  -- Trimmed, matching listings_title_length and publish_listing's own
  -- check exactly, so the constraint and this validation agree.
  if p_title is null or char_length(btrim(p_title)) < 3 then
    raise exception 'A title of at least 3 characters is required' using errcode = 'P0001';
  end if;

  if p_price_amount is null or p_price_amount <= 0 then
    raise exception 'A price greater than zero is required' using errcode = 'P0001';
  end if;

  if p_condition is null then
    raise exception 'A condition is required' using errcode = 'P0001';
  end if;

  if p_size is null then
    raise exception 'A size is required' using errcode = 'P0001';
  end if;

  update public.listings
     set title        = p_title,
         description  = coalesce(p_description, ''),
         price_amount = p_price_amount,
         condition    = p_condition,
         size         = p_size
   where id = p_listing_id
   returning * into v_listing;

  return v_listing;
end;
$$;

revoke all    on function public.update_listing_details(uuid, text, text, bigint, public.listing_condition, public.listing_size) from public;
revoke all    on function public.update_listing_details(uuid, text, text, bigint, public.listing_condition, public.listing_size) from anon;
grant execute on function public.update_listing_details(uuid, text, text, bigint, public.listing_condition, public.listing_size) to authenticated;
