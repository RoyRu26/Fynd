-- ROADMAP 1.6 "Manage a listing" follow-up: update_listing_details
-- (20261013165513_listing_status_transitions.sql) re-validates title/price/
-- condition/size with a friendly P0001 before writing, but never revalidated
-- description length -- an over-5000-char description (bypassing the
-- client's Zod cap via a direct RPC call) fell through to the bare
-- listings_description_length CHECK (23514) instead of this function's own
-- consistent P0001 style. This re-creates the function (never edit an
-- already-applied migration) with that one added check, mirrored from the
-- same constraint's limit, inserted alongside the existing validation in the
-- same style.
--
-- Everything else about the function (signature, security definer, search
-- path, ownership/status checks, grants) is unchanged from
-- 20261013165513_listing_status_transitions.sql.

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

  -- Matches listings_description_length's own limit, so an over-long
  -- description (e.g. a direct RPC call bypassing the client's Zod cap)
  -- surfaces this function's friendly P0001 instead of the bare CHECK's
  -- raw 23514.
  if p_description is not null and char_length(p_description) > 5000 then
    raise exception 'Description must be 5000 characters or fewer' using errcode = 'P0001';
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
