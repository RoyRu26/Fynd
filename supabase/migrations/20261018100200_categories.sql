-- ROADMAP 2.1 "Categories": a real, seeded two-level taxonomy.
--
-- A self-referencing adjacency-list table, not two flat columns on
-- `listings` and not an enum: DESIGN.md's Explore (2.3) and search (2.2)
-- will both want to browse/filter by group as well as by leaf, and a
-- top-level/leaf pair of enums would duplicate the parent/child
-- relationship in application code instead of the schema.
--
-- The two-level invariant -- a listing's category_id always points at a
-- LEAF row, never a bare top-level row -- is enforced at the UI/RPC layer,
-- not by a DB trigger. This table has no client write path at all (no
-- insert/update/delete grant to any role below), so review rigor is the
-- enforcement mechanism here, exactly as it already is for listing_size's
-- "system_value prefix" naming convention (20260922090100_listing_size.sql).
--
-- Seed ids are hardcoded literal UUIDs, not gen_random_uuid(), so the seed
-- is reproducible across environments and pgTAP fixtures (this file, and
-- supabase/tests/database/listings.sql) can reference known ids rather than
-- querying for them.

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.categories (id) on delete restrict,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint categories_not_self_parent check (parent_id is distinct from id),
  constraint categories_parent_name_unique unique (parent_id, name)
);

-- categories_parent_name_unique (a composite unique on (parent_id, name))
-- does not by itself stop two top-level rows from sharing a name, because
-- parent_id is NULL for all of them and NULL is never equal to NULL in a
-- unique index. This partial index closes that gap specifically for the
-- top level.
create unique index categories_top_level_name_unique
  on public.categories (name) where parent_id is null;

create index categories_parent_id_idx on public.categories (parent_id);

alter table public.categories enable row level security;

-- Mirrors "Profiles are publicly readable" (20260829142345): a taxonomy is
-- not sensitive, and every screen that lists or filters by category needs
-- it, logged in or not.
create policy "Categories are publicly readable"
on public.categories
for select
using (true);

-- pg_default_acl grants arwdDxtm to anon and authenticated on every new
-- relation in this schema, so this blanket revoke is what makes the select
-- grant below load-bearing rather than decorative. No insert/update/delete
-- grant to any client role at all -- the taxonomy is server-seeded only,
-- same posture as listing_condition/listing_size being enums no client can
-- extend.
revoke all on public.categories from anon, authenticated;
grant select on public.categories to anon, authenticated;

-- ============================================================
-- SEED DATA -- Roy-approved taxonomy. Do not alter the names/structure
-- below without a new sign-off; this is product content, not a schema
-- decision.
-- ============================================================
-- Top-level ids: c0000000-0000-4000-8000-00000000000N (N = position + 1).
-- Leaf ids: c000000G-0000-4000-8000-0000000000NN, where G is the parent's
-- position + 1 and NN is the leaf's own position + 1 within that parent.
-- The middle two groups (4000-8000) are fixed, valid-looking UUID version/
-- variant nibbles -- chosen so these ids pass strict UUID validators (e.g.
-- zod's `.uuid()`, used client-side by categoryIdSchema) the same way a
-- real gen_random_uuid() value would, not just Postgres's own looser uuid
-- column type.

insert into public.categories (id, name, parent_id, position) values
  -- ---- Top level (position 0-5) ----
  ('c0000000-0000-4000-8000-000000000001', 'Women',       null, 0),
  ('c0000000-0000-4000-8000-000000000002', 'Men',         null, 1),
  ('c0000000-0000-4000-8000-000000000003', 'Kids & Baby', null, 2),
  ('c0000000-0000-4000-8000-000000000004', 'Home',        null, 3),
  ('c0000000-0000-4000-8000-000000000005', 'Electronics', null, 4),
  ('c0000000-0000-4000-8000-000000000006', 'Other',       null, 5),

  -- ---- Women (8 leaves) ----
  ('c0000001-0000-4000-8000-000000000001', 'Tops',        'c0000000-0000-4000-8000-000000000001', 0),
  ('c0000001-0000-4000-8000-000000000002', 'Dresses',     'c0000000-0000-4000-8000-000000000001', 1),
  ('c0000001-0000-4000-8000-000000000003', 'Bottoms',     'c0000000-0000-4000-8000-000000000001', 2),
  ('c0000001-0000-4000-8000-000000000004', 'Outerwear',   'c0000000-0000-4000-8000-000000000001', 3),
  ('c0000001-0000-4000-8000-000000000005', 'Shoes',       'c0000000-0000-4000-8000-000000000001', 4),
  ('c0000001-0000-4000-8000-000000000006', 'Bags',        'c0000000-0000-4000-8000-000000000001', 5),
  ('c0000001-0000-4000-8000-000000000007', 'Accessories', 'c0000000-0000-4000-8000-000000000001', 6),
  ('c0000001-0000-4000-8000-000000000008', 'Activewear',  'c0000000-0000-4000-8000-000000000001', 7),

  -- ---- Men (6 leaves) ----
  ('c0000002-0000-4000-8000-000000000001', 'Tops',        'c0000000-0000-4000-8000-000000000002', 0),
  ('c0000002-0000-4000-8000-000000000002', 'Bottoms',     'c0000000-0000-4000-8000-000000000002', 1),
  ('c0000002-0000-4000-8000-000000000003', 'Outerwear',   'c0000000-0000-4000-8000-000000000002', 2),
  ('c0000002-0000-4000-8000-000000000004', 'Shoes',       'c0000000-0000-4000-8000-000000000002', 3),
  ('c0000002-0000-4000-8000-000000000005', 'Accessories', 'c0000000-0000-4000-8000-000000000002', 4),
  ('c0000002-0000-4000-8000-000000000006', 'Activewear',  'c0000000-0000-4000-8000-000000000002', 5),

  -- ---- Kids & Baby (5 leaves) ----
  ('c0000003-0000-4000-8000-000000000001', 'Clothing',    'c0000000-0000-4000-8000-000000000003', 0),
  ('c0000003-0000-4000-8000-000000000002', 'Shoes',       'c0000000-0000-4000-8000-000000000003', 1),
  ('c0000003-0000-4000-8000-000000000003', 'Toys',        'c0000000-0000-4000-8000-000000000003', 2),
  ('c0000003-0000-4000-8000-000000000004', 'Baby gear',   'c0000000-0000-4000-8000-000000000003', 3),
  ('c0000003-0000-4000-8000-000000000005', 'Accessories', 'c0000000-0000-4000-8000-000000000003', 4),

  -- ---- Home (5 leaves) ----
  ('c0000004-0000-4000-8000-000000000001', 'Furniture',   'c0000000-0000-4000-8000-000000000004', 0),
  ('c0000004-0000-4000-8000-000000000002', 'Decor',       'c0000000-0000-4000-8000-000000000004', 1),
  ('c0000004-0000-4000-8000-000000000003', 'Kitchen',     'c0000000-0000-4000-8000-000000000004', 2),
  ('c0000004-0000-4000-8000-000000000004', 'Bedding',     'c0000000-0000-4000-8000-000000000004', 3),
  ('c0000004-0000-4000-8000-000000000005', 'Garden',      'c0000000-0000-4000-8000-000000000004', 4),

  -- ---- Electronics (6 leaves) ----
  ('c0000005-0000-4000-8000-000000000001', 'Phones & tablets',    'c0000000-0000-4000-8000-000000000005', 0),
  ('c0000005-0000-4000-8000-000000000002', 'Computers',           'c0000000-0000-4000-8000-000000000005', 1),
  ('c0000005-0000-4000-8000-000000000003', 'Audio',               'c0000000-0000-4000-8000-000000000005', 2),
  ('c0000005-0000-4000-8000-000000000004', 'Gaming',              'c0000000-0000-4000-8000-000000000005', 3),
  ('c0000005-0000-4000-8000-000000000005', 'Cameras',             'c0000000-0000-4000-8000-000000000005', 4),
  ('c0000005-0000-4000-8000-000000000006', 'Other electronics',   'c0000000-0000-4000-8000-000000000005', 5),

  -- ---- Other (5 leaves) ----
  ('c0000006-0000-4000-8000-000000000001', 'Books & media',             'c0000000-0000-4000-8000-000000000006', 0),
  ('c0000006-0000-4000-8000-000000000002', 'Sports & outdoors',         'c0000000-0000-4000-8000-000000000006', 1),
  ('c0000006-0000-4000-8000-000000000003', 'Beauty & personal care',    'c0000000-0000-4000-8000-000000000006', 2),
  ('c0000006-0000-4000-8000-000000000004', 'Collectibles',              'c0000000-0000-4000-8000-000000000006', 3),
  ('c0000006-0000-4000-8000-000000000005', 'Miscellaneous',             'c0000000-0000-4000-8000-000000000006', 4);

-- ============================================================
-- listings.category_id
-- ============================================================
-- Nullable, exactly like title/price_amount/condition/size: a draft may be
-- incomplete, and completeness is enforced only at the draft -> active
-- boundary (see the constraint below, publish_listing, and
-- update_listing_details). `on delete restrict` because a category that is
-- in use must not vanish out from under a listing -- there is no client
-- delete path on categories at all, but a future admin/reseed path should
-- have to deal with reassignment explicitly rather than silently nulling
-- out every listing in a category.
alter table public.listings add column category_id uuid references public.categories (id) on delete restrict;

-- NOT automatic -- see listing_size's identical note. A newly added column
-- inherits no privileges, so without this, sellers could not set a category
-- at all and every publish would fail.
grant insert (category_id), update (category_id) on public.listings to authenticated;

-- ============================================================
-- Bring existing data into the new invariant
-- ============================================================
-- Demote, don't fabricate -- exactly listing_size's own precedent. Any
-- active listing that predates this column has no category, so it is
-- demoted to draft rather than assigned one: inventing a category for
-- someone else's listing is exactly the fabricated data this table exists
-- to prevent, and a demoted draft loses nothing -- the seller re-picks a
-- real category and republishes through the ordinary flow.
--
-- This MUST run before the constraint is added, or adding it fails against
-- those rows.
update public.listings
   set status = 'draft'
 where status = 'active'
   and category_id is null;

alter table public.listings drop constraint listings_complete_when_not_draft;

alter table public.listings add constraint listings_complete_when_not_draft
  check (
    status = 'draft'
    or (
      title is not null
      and price_amount is not null
      and condition is not null
      and size is not null
      and category_id is not null
    )
  );

-- ============================================================
-- publish_listing: the server stays authoritative
-- ============================================================
-- CREATE OR REPLACE is fine here: the return type is the `listings` table
-- rowtype, which widened automatically when `category_id` was added above --
-- no DROP needed, unlike update_listing_details below. The category check
-- sits right after the size check and before the photo-count check, so a
-- seller missing several fields is told about the cheapest one to fix
-- first, same ordering rule as every other field here.

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

  if v_listing.category_id is null then
    raise exception 'A category is required' using errcode = 'P0001';
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

-- ============================================================
-- update_listing_details: DROP + CREATE, not CREATE OR REPLACE
-- ============================================================
-- Unlike publish_listing, this function's parameter list grows by one
-- argument (p_category_id) -- a shape change, not just a widened return
-- type. CREATE OR REPLACE refuses that ("cannot change routine's parameter
-- types"), exactly as 20260922090300_feed_listings_size_and_favorites.sql's
-- header explains for feed_listings' RETURNS TABLE shape. So the old 6-arg
-- overload is dropped and the new 7-arg one created, and the three
-- grant/revoke statements at the bottom are re-done for the new signature.
--
-- Everything else is carried over verbatim from
-- 20261014064148_listing_description_length_guard.sql: SECURITY DEFINER,
-- `set search_path = ''`, ownership/status checks, the trimmed-title and
-- description-length guards, and the grants/revokes pattern.

drop function if exists public.update_listing_details(
  uuid, text, text, bigint, public.listing_condition, public.listing_size
);

create function public.update_listing_details(
  p_listing_id   uuid,
  p_title        text,
  p_description  text,
  p_price_amount bigint,
  p_condition    public.listing_condition,
  p_size         public.listing_size,
  p_category_id  uuid
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

  if p_category_id is null then
    raise exception 'A category is required' using errcode = 'P0001';
  end if;

  update public.listings
     set title        = p_title,
         description  = coalesce(p_description, ''),
         price_amount = p_price_amount,
         condition    = p_condition,
         size         = p_size,
         category_id  = p_category_id
   where id = p_listing_id
   returning * into v_listing;

  return v_listing;
end;
$$;

revoke all    on function public.update_listing_details(uuid, text, text, bigint, public.listing_condition, public.listing_size, uuid) from public;
revoke all    on function public.update_listing_details(uuid, text, text, bigint, public.listing_condition, public.listing_size, uuid) from anon;
grant execute on function public.update_listing_details(uuid, text, text, bigint, public.listing_condition, public.listing_size, uuid) to authenticated;
