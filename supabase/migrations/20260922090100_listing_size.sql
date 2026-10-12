-- Listing size, required for publication.
--
-- Size is the attribute that decides relevance fastest in second-hand
-- fashion after price, and it is the one DESIGN.md §14.1 tier 3 names
-- alongside condition. It is also a future search filter and recommendation
-- feature, which is why it is a controlled enum rather than free text: "M",
-- "Medium", "medium" and "m" must not become four semantic sizes.
--
-- ============================================================
-- Why a flat prefixed enum rather than size_system + size_value
-- ============================================================
-- The existing fixture inventory is a shirt AND a pair of Vans -- clothing
-- and footwear -- so an alpha-only (XXS-XXL) set could not describe one of
-- the two rows that already exist. The numeric escape path is needed now.
--
-- The alternative, a discriminated `size_system` + `size_value` pair, buys
-- extensibility that is not needed yet and costs a per-system CHECK
-- constraint with regex ranges, two columns in every future filter, and a
-- composite a recommender would have to concatenate back together anyway.
-- Encoding the system into the value keeps it one indexable categorical
-- column: `size = any(...)` to filter, `size::text like 'eu_shoe_%'` if a
-- system-level query is ever wanted, and a clean generated TS union the
-- selector UI groups by prefix.
--
-- DELIBERATELY EXCLUDED: waist/denim sizing, US/UK shoe conversions, and
-- anything category-dependent. Adding a system later is ALTER TYPE ... ADD
-- VALUE plus new chips -- additive, not a rewrite.
--
-- The part that must be right first time is the `system_value` prefix
-- CONVENTION, not the individual values: enum labels can be added freely
-- but cannot be removed or reordered without recreating the type.

create type public.listing_size as enum (
  'one_size',
  'alpha_xxs',
  'alpha_xs',
  'alpha_s',
  'alpha_m',
  'alpha_l',
  'alpha_xl',
  'alpha_xxl',
  'alpha_xxxl',
  'eu_shoe_35',
  'eu_shoe_36',
  'eu_shoe_37',
  'eu_shoe_38',
  'eu_shoe_39',
  'eu_shoe_40',
  'eu_shoe_41',
  'eu_shoe_42',
  'eu_shoe_43',
  'eu_shoe_44',
  'eu_shoe_45',
  'eu_shoe_46',
  'eu_shoe_47'
);

-- Nullable, exactly like title/price_amount/condition: a draft may be
-- incomplete, and completeness is enforced only at the draft -> active
-- boundary (see the constraint below and publish_listing).
alter table public.listings add column size public.listing_size;

-- NOT automatic. A newly added column inherits no privileges, and
-- `authenticated` holds only SELECT+DELETE at table level -- so without
-- this, sellers could not set a size at all and every publish would fail.
-- Insert+update, matching title/description/price_amount/condition.
grant insert (size), update (size) on public.listings to authenticated;

-- ============================================================
-- Bring existing data into the new invariant
-- ============================================================
-- The two active fixture listings predate this column and have no size, so
-- they violate the completeness constraint below. They are demoted to draft
-- rather than backfilled: inventing a size for someone else's listing is
-- exactly the fabricated data this enum exists to prevent, and a demoted
-- draft loses nothing -- the seller re-picks a real size and republishes
-- through the ordinary flow.
--
-- This MUST run before the constraint is added, or adding it fails against
-- those rows.
update public.listings
   set status = 'draft'
 where status = 'active'
   and size is null;

alter table public.listings drop constraint listings_complete_when_not_draft;

alter table public.listings add constraint listings_complete_when_not_draft
  check (
    status = 'draft'
    or (
      title is not null
      and price_amount is not null
      and condition is not null
      and size is not null
    )
  );

-- ============================================================
-- publish_listing: the server stays authoritative
-- ============================================================
-- Replaced in full rather than patched, so the guard order stays readable
-- and matches the constraint above. The size check sits with the other
-- completeness guards, before the photo checks, so a seller missing several
-- fields is told about the cheapest one to fix first.
--
-- RETURNS public.listings is the table rowtype, which widened automatically
-- when `size` was added above -- no DROP needed, unlike feed_listings.

create or replace function public.publish_listing(p_listing_id uuid)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing     public.listings;
  v_image_count integer;
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

  -- `for update` above serialises concurrent publishes, so the second caller
  -- reaches this check after the first has committed and sees a non-draft.
  if v_listing.status <> 'draft' then
    raise exception 'Only drafts can be published' using errcode = 'P0001';
  end if;

  -- Trimmed, matching listings_title_length exactly, so the constraint and
  -- this validation agree rather than silently diverging.
  if v_listing.title is null or char_length(btrim(v_listing.title)) < 3 then
    raise exception 'A title of at least 3 characters is required' using errcode = 'P0001';
  end if;

  if v_listing.price_amount is null or v_listing.price_amount <= 0 then
    raise exception 'A price greater than zero is required' using errcode = 'P0001';
  end if;

  if v_listing.condition is null then
    raise exception 'A condition is required' using errcode = 'P0001';
  end if;

  if v_listing.size is null then
    raise exception 'A size is required' using errcode = 'P0001';
  end if;

  select count(*) into v_image_count
    from public.listing_images where listing_id = p_listing_id;

  if v_image_count < 1 then
    raise exception 'At least one photo is required' using errcode = 'P0001';
  end if;

  -- Attachments are trustworthy at creation time (attach_listing_image
  -- verifies the object exists), but an object can be deleted afterwards
  -- while the listing is still a draft -- the remove flow deletes the DB row
  -- first and the object second, and a crash between the two inverts that.
  -- Re-verify here, so a published listing can never reference a file that
  -- is not there.
  if exists (
    select 1 from public.listing_images li
     where li.listing_id = p_listing_id
       and not exists (
         select 1 from storage.objects o
          where o.bucket_id = 'listing-images'
            and o.name = li.storage_path
       )
  ) then
    raise exception 'A photo is missing its uploaded file' using errcode = 'P0001';
  end if;

  update public.listings set status = 'active'
   where id = p_listing_id
   returning * into v_listing;

  return v_listing;
end;
$$;

revoke all    on function public.publish_listing(uuid) from public;
revoke all    on function public.publish_listing(uuid) from anon;
grant execute on function public.publish_listing(uuid) to authenticated;
