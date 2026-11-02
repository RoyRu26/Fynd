-- pgTAP tests for search over attributes (roadmap 7.3, spec §10.3 / §10.6
-- step 2): the trigger-maintained listings.search_tsv document and the
-- attribute / brand filters of search_listings.
--
-- Dev data persists in this database, so every assertion is scoped to this
-- suite's fixture ids or to a nonce token ('qzattr', 'qzattrpage') that no
-- real listing contains. Real terms are looked up by (kind, slug), brands by
-- key, categories by their seeded ids. Rename tests use a test-only brand
-- ('Zqbrand') and a test-only color term ('zqcolor'); everything is rolled
-- back.
--
-- Same conventions as the other suites: 4-arg throws_ok(sql, sqlstate,
-- null, description), SQLSTATE only, never message text.
--
-- Run with: pnpm exec supabase test db --local
create extension if not exists pgtap with schema extensions;

begin;

select plan(137);

-- ============================================================
-- Helpers
-- ============================================================

create function pg_temp.term(p_kind text, p_slug text)
returns uuid
language sql
stable
as $$
  select t.id from public.listing_attribute_terms t where t.kind = p_kind and t.slug = p_slug;
$$;

create function pg_temp.brand(p_key text)
returns uuid
language sql
stable
as $$
  select b.id from public.brands b where b.key = p_key;
$$;

-- The weights (e.g. 'A', 'BC') a lexeme carries in a listing's search_tsv;
-- NULL when the lexeme is absent.
create function pg_temp.w(p_listing_id uuid, p_lexeme text)
returns text
language sql
stable
as $$
  select string_agg(distinct x.wt, '' order by x.wt)
    from public.listings l
    cross join lateral unnest(l.search_tsv) as u
    cross join lateral unnest(u.weights) as x(wt)
   where l.id = p_listing_id
     and u.lexeme = p_lexeme;
$$;

-- Whether a listing's stored search_tsv matches a search query (privileged
-- callers only: fynd_search_query is fine, but this reads any listing).
create function pg_temp.m(p_listing_id uuid, p_query text)
returns boolean
language sql
stable
as $$
  select coalesce(l.search_tsv @@ public.fynd_search_query(p_query), false)
    from public.listings l
   where l.id = p_listing_id;
$$;

-- ============================================================
-- Fixtures (privileged)
-- ============================================================
-- Sellers A and B, viewer V.
-- Category ids (20261018100200_categories.sql): Women > Tops ...0001-...0001,
-- Women > Dresses ...0001-...0002, Women > Outerwear ...0001-...0004,
-- Women > Shoes ...0001-...0005.
--
--   L01 A Tops      Nike    t_shirt black streetwear cotton solid slim, keyword, description word
--   L02 A Tops      Adidas  hoodie white vintage wool striped oversized
--   L03 A Shoes     brand_text 'Qzcustomlabel', sneakers black
--   L04 A Tops      Nike    Hebrew title, geresh word in description
--   L05 A Dresses   Hebrew dress title
--   L06 A Outerwear Hebrew coat title
--   L07-L10 A Tops  Nike t_shirt black: draft / removed / reserved / sold
--   L11 B Tops      Nike t_shirt black (blocks)
--   L12-L16 A Tops  'Qzattrpage', red (pagination); L20 same token, no color
--   L17 A Tops      draft (direct UPDATE)
--   L18 A Tops      Zqbrand, t_shirt zqcolor slim (rename + category change)
--   L19 A Tops      green (set_listing_attributes)
--   L21 A Qzleaf    draft, test-only categories (parent change, added in 7b)
-- Every fixture starts with updated_at = 2026-01-01, and every fixture's
-- description carries the nonce 'qzattr': search_listings returns at most 20
-- rows (newest first) and newer dev data would otherwise push fixtures off
-- the page, so every search below includes 'qzattr' in p_query (the
-- pagination section uses its own token, 'qzattrpage').

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('a7300000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-sattr-a@test.dev', 'x', now(), now()),
  ('a7300000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-sattr-b@test.dev', 'x', now(), now()),
  ('a7300000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-sattr-v@test.dev', 'x', now(), now());

insert into public.brands (id, name, key)
values ('a73b0000-0000-0000-0000-000000000001', 'Zqbrand', public.normalize_brand_key('Zqbrand'));
insert into public.brand_aliases (alias_key, brand_id, alias)
values (public.normalize_brand_key('Zqbrand'), 'a73b0000-0000-0000-0000-000000000001', 'Zqbrand');

insert into public.listing_attribute_terms (id, kind, slug, label, position)
values ('a73c0000-0000-0000-0000-000000000001', 'color', 'zqcolor', 'Zqcolor', 99);

insert into public.listings
  (id, seller_id, title, description, price_amount, condition, size, category_id,
   status, created_at, updated_at, brand_id, brand_text, keywords)
values
  ('a73a0000-0000-0000-0000-000000000001', 'a7300000-0000-0000-0000-00000000000a',
   'Qzattr alpha', 'qzdesconly words qzattr', 5000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001',
   'active', '2026-04-01 10:01:00+00', '2026-01-01 00:00:00+00', pg_temp.brand('nike'), null, '{qzkeyword}'),
  ('a73a0000-0000-0000-0000-000000000002', 'a7300000-0000-0000-0000-00000000000a',
   'Qzattr beta', 'qzattr', 5000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001',
   'active', '2026-04-01 10:02:00+00', '2026-01-01 00:00:00+00', pg_temp.brand('adidas'), null, '{}'),
  ('a73a0000-0000-0000-0000-000000000003', 'a7300000-0000-0000-0000-00000000000a',
   'Qzattr gamma', 'qzattr', 3000, 'good', 'one_size', 'c0000001-0000-4000-8000-000000000005',
   'active', '2026-04-01 10:03:00+00', '2026-01-01 00:00:00+00', null, 'Qzcustomlabel', '{}'),
  ('a73a0000-0000-0000-0000-000000000004', 'a7300000-0000-0000-0000-00000000000a',
   'חולצה שחורה', 'קפוצ׳ון qzattr', 2000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001',
   'active', '2026-04-01 10:04:00+00', '2026-01-01 00:00:00+00', pg_temp.brand('nike'), null, '{}'),
  ('a73a0000-0000-0000-0000-000000000005', 'a7300000-0000-0000-0000-00000000000a',
   'שמלה qzattr', 'qzattr', 2000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000002',
   'active', '2026-04-01 10:05:00+00', '2026-01-01 00:00:00+00', null, null, '{}'),
  ('a73a0000-0000-0000-0000-000000000006', 'a7300000-0000-0000-0000-00000000000a',
   'מעיל ארוך', 'qzattr', 2000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000004',
   'active', '2026-04-01 10:06:00+00', '2026-01-01 00:00:00+00', null, null, '{}'),
  ('a73a0000-0000-0000-0000-000000000007', 'a7300000-0000-0000-0000-00000000000a',
   'Qzattr status draft', 'qzattr', 1000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001',
   'draft', '2026-04-01 10:07:00+00', '2026-01-01 00:00:00+00', pg_temp.brand('nike'), null, '{}'),
  ('a73a0000-0000-0000-0000-000000000008', 'a7300000-0000-0000-0000-00000000000a',
   'Qzattr status removed', 'qzattr', 1000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001',
   'removed', '2026-04-01 10:08:00+00', '2026-01-01 00:00:00+00', pg_temp.brand('nike'), null, '{}'),
  ('a73a0000-0000-0000-0000-000000000009', 'a7300000-0000-0000-0000-00000000000a',
   'Qzattr status reserved', 'qzattr', 1000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001',
   'reserved', '2026-04-01 10:09:00+00', '2026-01-01 00:00:00+00', pg_temp.brand('nike'), null, '{}'),
  ('a73a0000-0000-0000-0000-000000000010', 'a7300000-0000-0000-0000-00000000000a',
   'Qzattr status sold', 'qzattr', 1000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001',
   'sold', '2026-04-01 10:10:00+00', '2026-01-01 00:00:00+00', pg_temp.brand('nike'), null, '{}'),
  ('a73a0000-0000-0000-0000-000000000011', 'a7300000-0000-0000-0000-00000000000b',
   'Qzattr blocked', 'qzattr', 1000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001',
   'active', '2026-04-01 10:11:00+00', '2026-01-01 00:00:00+00', pg_temp.brand('nike'), null, '{}'),
  ('a73a0000-0000-0000-0000-000000000012', 'a7300000-0000-0000-0000-00000000000a',
   'Qzattrpage one', 'qzattr', 1000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001',
   'active', '2026-04-02 10:01:00+00', '2026-01-01 00:00:00+00', null, null, '{}'),
  ('a73a0000-0000-0000-0000-000000000013', 'a7300000-0000-0000-0000-00000000000a',
   'Qzattrpage two', 'qzattr', 2000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001',
   'active', '2026-04-02 10:02:00+00', '2026-01-01 00:00:00+00', null, null, '{}'),
  ('a73a0000-0000-0000-0000-000000000014', 'a7300000-0000-0000-0000-00000000000a',
   'Qzattrpage three', 'qzattr', 2000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001',
   'active', '2026-04-02 10:03:00+00', '2026-01-01 00:00:00+00', null, null, '{}'),
  ('a73a0000-0000-0000-0000-000000000015', 'a7300000-0000-0000-0000-00000000000a',
   'Qzattrpage four', 'qzattr', 3000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001',
   'active', '2026-04-02 10:04:00+00', '2026-01-01 00:00:00+00', null, null, '{}'),
  ('a73a0000-0000-0000-0000-000000000016', 'a7300000-0000-0000-0000-00000000000a',
   'Qzattrpage five', 'qzattr', 4000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001',
   'active', '2026-04-02 10:05:00+00', '2026-01-01 00:00:00+00', null, null, '{}'),
  ('a73a0000-0000-0000-0000-000000000017', 'a7300000-0000-0000-0000-00000000000a',
   'Qzattr draft edit', 'qzattr', null, null, null, 'c0000001-0000-4000-8000-000000000001',
   'draft', '2026-04-01 10:17:00+00', '2026-01-01 00:00:00+00', null, null, '{}'),
  ('a73a0000-0000-0000-0000-000000000018', 'a7300000-0000-0000-0000-00000000000a',
   'Qzattr refresh one', 'qzattr', 4000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001',
   'active', '2026-04-01 10:18:00+00', '2026-01-01 00:00:00+00', 'a73b0000-0000-0000-0000-000000000001', null, '{}'),
  ('a73a0000-0000-0000-0000-000000000019', 'a7300000-0000-0000-0000-00000000000a',
   'Qzattr refresh two', 'qzattr', 4000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001',
   'active', '2026-04-01 10:19:00+00', '2026-01-01 00:00:00+00', null, null, '{}'),
  ('a73a0000-0000-0000-0000-000000000020', 'a7300000-0000-0000-0000-00000000000a',
   'Qzattrpage uncolored', 'qzattr', 1500, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001',
   'active', '2026-04-02 10:06:00+00', '2026-01-01 00:00:00+00', null, null, '{}');

insert into public.listing_images (listing_id, storage_path, "position")
select l.id, format('%s/%s/a.jpg', l.seller_id, l.id), 0
  from public.listings l
 where l.id::text like 'a73a0000-%';

insert into public.listing_attribute_values (listing_id, term_id, kind, position)
select f.listing_id::uuid, t.id, t.kind, 0
  from (values
    ('a73a0000-0000-0000-0000-000000000001', 'item_type', 't_shirt'),
    ('a73a0000-0000-0000-0000-000000000001', 'color', 'black'),
    ('a73a0000-0000-0000-0000-000000000001', 'style', 'streetwear'),
    ('a73a0000-0000-0000-0000-000000000001', 'material', 'cotton'),
    ('a73a0000-0000-0000-0000-000000000001', 'pattern', 'solid'),
    ('a73a0000-0000-0000-0000-000000000001', 'fit', 'slim'),
    ('a73a0000-0000-0000-0000-000000000002', 'item_type', 'hoodie'),
    ('a73a0000-0000-0000-0000-000000000002', 'color', 'white'),
    ('a73a0000-0000-0000-0000-000000000002', 'style', 'vintage'),
    ('a73a0000-0000-0000-0000-000000000002', 'material', 'wool'),
    ('a73a0000-0000-0000-0000-000000000002', 'pattern', 'striped'),
    ('a73a0000-0000-0000-0000-000000000002', 'fit', 'oversized'),
    ('a73a0000-0000-0000-0000-000000000003', 'item_type', 'sneakers'),
    ('a73a0000-0000-0000-0000-000000000003', 'color', 'black'),
    ('a73a0000-0000-0000-0000-000000000007', 'item_type', 't_shirt'),
    ('a73a0000-0000-0000-0000-000000000007', 'color', 'black'),
    ('a73a0000-0000-0000-0000-000000000008', 'item_type', 't_shirt'),
    ('a73a0000-0000-0000-0000-000000000008', 'color', 'black'),
    ('a73a0000-0000-0000-0000-000000000009', 'item_type', 't_shirt'),
    ('a73a0000-0000-0000-0000-000000000009', 'color', 'black'),
    ('a73a0000-0000-0000-0000-000000000010', 'item_type', 't_shirt'),
    ('a73a0000-0000-0000-0000-000000000010', 'color', 'black'),
    ('a73a0000-0000-0000-0000-000000000011', 'item_type', 't_shirt'),
    ('a73a0000-0000-0000-0000-000000000011', 'color', 'black'),
    ('a73a0000-0000-0000-0000-000000000012', 'color', 'red'),
    ('a73a0000-0000-0000-0000-000000000013', 'color', 'red'),
    ('a73a0000-0000-0000-0000-000000000014', 'color', 'red'),
    ('a73a0000-0000-0000-0000-000000000015', 'color', 'red'),
    ('a73a0000-0000-0000-0000-000000000016', 'color', 'red'),
    ('a73a0000-0000-0000-0000-000000000018', 'item_type', 't_shirt'),
    ('a73a0000-0000-0000-0000-000000000018', 'color', 'zqcolor'),
    ('a73a0000-0000-0000-0000-000000000018', 'fit', 'slim'),
    ('a73a0000-0000-0000-0000-000000000019', 'color', 'green')
  ) as f(listing_id, kind, slug)
  join public.listing_attribute_terms t on t.kind = f.kind and t.slug = f.slug;

-- ============================================================
-- 1. Structure
-- ============================================================

select is(
  (select attgenerated::text from pg_attribute
    where attrelid = 'public.listings'::regclass and attname = 'search_tsv'),
  '',
  'search_tsv is no longer a generated column'
);

select col_not_null('public', 'listings', 'search_tsv', 'search_tsv is NOT NULL');
select col_has_default('public', 'listings', 'search_tsv', 'search_tsv has a default (optional in Insert types)');
select has_index('public', 'listings', 'listings_search_tsv_idx', 'the GIN index on search_tsv still exists');

select is_empty(
  $$select p.oid::regprocedure::text
      from pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and p.proname in ('listings_set_search_tsv', 'listing_attribute_values_refresh_search',
                         'brands_refresh_search', 'brand_aliases_refresh_search',
                         'listing_attribute_terms_refresh_search', 'categories_refresh_search')
       and not (p.prosecdef and p.proconfig @> array['search_path=""'])$$,
  'every search_tsv trigger function is SECURITY DEFINER with search_path = '''''
);

select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.proname in ('listings_set_search_tsv', 'listing_attribute_values_refresh_search',
                        'brands_refresh_search', 'brand_aliases_refresh_search',
                        'listing_attribute_terms_refresh_search', 'categories_refresh_search')),
  6,
  'all six trigger functions exist in schema private'
);

-- Drift guard: a column added to listings later must be added to this
-- trigger's column list too (everything except the derived search_tsv).
select is(
  (select array_agg(a.attname::text order by a.attname)
     from pg_trigger t
     cross join lateral unnest(t.tgattr::int2[]) as k(attnum)
     join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = k.attnum
    where t.tgrelid = 'public.listings'::regclass
      and t.tgname = 'listings_set_updated_at'),
  (select array_agg(a.attname::text order by a.attname)
     from pg_attribute a
    where a.attrelid = 'public.listings'::regclass
      and a.attnum > 0 and not a.attisdropped
      and a.attname <> 'search_tsv'),
  'listings_set_updated_at fires on every listings column except search_tsv'
);

select is(
  (select count(*)::int from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'search_listings'),
  1,
  'search_listings has exactly one overload (the old 11-argument one is gone)'
);

select ok(
  to_regprocedure('public.search_listings(text, uuid, public.listing_condition, public.listing_size, bigint, bigint, public.search_sort, timestamptz, bigint, uuid, integer, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[])') is not null,
  'the 18-argument search_listings exists'
);

-- ============================================================
-- 2. Invariant: stored document == computed document
-- ============================================================

select is_empty(
  $$select l.id from public.listings l
     where l.search_tsv is distinct from private.listing_search_document(
             l.id, l.title, l.description, l.category_id, l.brand_id, l.brand_text, l.keywords)$$,
  'every listing''s stored search_tsv equals its computed document'
);

-- ============================================================
-- 3. Weights (L01)
-- ============================================================

select is(pg_temp.w('a73a0000-0000-0000-0000-000000000001', 'alpha'), 'A', 'title word has weight A');
select is(pg_temp.w('a73a0000-0000-0000-0000-000000000001', 'נייקי'), 'A', 'brand alias (Hebrew Nike) has weight A');
select is(pg_temp.w('a73a0000-0000-0000-0000-000000000001', 'women'), 'A', 'category group name has weight A');
select is(pg_temp.w('a73a0000-0000-0000-0000-000000000001', 'shirt'), 'A', 'item-type label/slug has weight A');
select is(pg_temp.w('a73a0000-0000-0000-0000-000000000001', 'black'), 'B', 'color label has weight B');
select is(pg_temp.w('a73a0000-0000-0000-0000-000000000001', 'qzkeyword'), 'B', 'keyword has weight B');
select is(pg_temp.w('a73a0000-0000-0000-0000-000000000001', 'qzdesconly'), 'C', 'description-only word has weight C');

-- ============================================================
-- 8a. updated_at: the refresh helper does not bump it
-- ============================================================

select private.refresh_listing_search_tsv(array['a73a0000-0000-0000-0000-000000000001'::uuid]);

select is(
  (select updated_at from public.listings where id = 'a73a0000-0000-0000-0000-000000000001'),
  '2026-01-01 00:00:00+00'::timestamptz,
  'refresh_listing_search_tsv leaves updated_at untouched'
);

-- Viewer V from here on, unless a section says otherwise.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000c","role":"authenticated"}';

-- ============================================================
-- 4. Each filter alone
-- ============================================================

select ok(exists(select 1 from public.search_listings(p_query := 'qzattr', p_brand_ids := array[pg_temp.brand('nike')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000001'), 'brand filter: Nike listing in');
select ok(not exists(select 1 from public.search_listings(p_query := 'qzattr', p_brand_ids := array[pg_temp.brand('nike')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000002'), 'brand filter: Adidas listing out');

select ok(exists(select 1 from public.search_listings(p_query := 'qzattr', p_item_type_ids := array[pg_temp.term('item_type', 't_shirt')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000001'), 'item type filter: t-shirt in');
select ok(not exists(select 1 from public.search_listings(p_query := 'qzattr', p_item_type_ids := array[pg_temp.term('item_type', 't_shirt')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000002'), 'item type filter: hoodie out');

select ok(exists(select 1 from public.search_listings(p_query := 'qzattr', p_color_ids := array[pg_temp.term('color', 'black')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000001'), 'color filter: black in');
select ok(not exists(select 1 from public.search_listings(p_query := 'qzattr', p_color_ids := array[pg_temp.term('color', 'black')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000002'), 'color filter: white out');

select ok(exists(select 1 from public.search_listings(p_query := 'qzattr', p_style_ids := array[pg_temp.term('style', 'streetwear')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000001'), 'style filter: streetwear in');
select ok(not exists(select 1 from public.search_listings(p_query := 'qzattr', p_style_ids := array[pg_temp.term('style', 'streetwear')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000002'), 'style filter: vintage out');

select ok(exists(select 1 from public.search_listings(p_query := 'qzattr', p_material_ids := array[pg_temp.term('material', 'cotton')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000001'), 'material filter: cotton in');
select ok(not exists(select 1 from public.search_listings(p_query := 'qzattr', p_material_ids := array[pg_temp.term('material', 'cotton')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000002'), 'material filter: wool out');

select ok(exists(select 1 from public.search_listings(p_query := 'qzattr', p_pattern_ids := array[pg_temp.term('pattern', 'solid')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000001'), 'pattern filter: solid in');
select ok(not exists(select 1 from public.search_listings(p_query := 'qzattr', p_pattern_ids := array[pg_temp.term('pattern', 'solid')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000002'), 'pattern filter: striped out');

select ok(exists(select 1 from public.search_listings(p_query := 'qzattr', p_fit_ids := array[pg_temp.term('fit', 'slim')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000001'), 'fit filter: slim in');
select ok(not exists(select 1 from public.search_listings(p_query := 'qzattr', p_fit_ids := array[pg_temp.term('fit', 'slim')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000002'), 'fit filter: oversized out');

-- ============================================================
-- 4b. Each filter alone, price sort (the second branch of the body)
-- ============================================================

select ok(exists(select 1 from public.search_listings(p_sort := 'price', p_query := 'qzattr', p_brand_ids := array[pg_temp.brand('nike')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000001'), 'price sort, brand filter: Nike listing in');
select ok(not exists(select 1 from public.search_listings(p_sort := 'price', p_query := 'qzattr', p_brand_ids := array[pg_temp.brand('nike')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000002'), 'price sort, brand filter: Adidas listing out');

select ok(exists(select 1 from public.search_listings(p_sort := 'price', p_query := 'qzattr', p_item_type_ids := array[pg_temp.term('item_type', 't_shirt')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000001'), 'price sort, item type filter: t-shirt in');
select ok(not exists(select 1 from public.search_listings(p_sort := 'price', p_query := 'qzattr', p_item_type_ids := array[pg_temp.term('item_type', 't_shirt')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000002'), 'price sort, item type filter: hoodie out');

select ok(exists(select 1 from public.search_listings(p_sort := 'price', p_query := 'qzattr', p_color_ids := array[pg_temp.term('color', 'black')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000001'), 'price sort, color filter: black in');
select ok(not exists(select 1 from public.search_listings(p_sort := 'price', p_query := 'qzattr', p_color_ids := array[pg_temp.term('color', 'black')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000002'), 'price sort, color filter: white out');

select ok(exists(select 1 from public.search_listings(p_sort := 'price', p_query := 'qzattr', p_style_ids := array[pg_temp.term('style', 'streetwear')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000001'), 'price sort, style filter: streetwear in');
select ok(not exists(select 1 from public.search_listings(p_sort := 'price', p_query := 'qzattr', p_style_ids := array[pg_temp.term('style', 'streetwear')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000002'), 'price sort, style filter: vintage out');

select ok(exists(select 1 from public.search_listings(p_sort := 'price', p_query := 'qzattr', p_material_ids := array[pg_temp.term('material', 'cotton')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000001'), 'price sort, material filter: cotton in');
select ok(not exists(select 1 from public.search_listings(p_sort := 'price', p_query := 'qzattr', p_material_ids := array[pg_temp.term('material', 'cotton')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000002'), 'price sort, material filter: wool out');

select ok(exists(select 1 from public.search_listings(p_sort := 'price', p_query := 'qzattr', p_pattern_ids := array[pg_temp.term('pattern', 'solid')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000001'), 'price sort, pattern filter: solid in');
select ok(not exists(select 1 from public.search_listings(p_sort := 'price', p_query := 'qzattr', p_pattern_ids := array[pg_temp.term('pattern', 'solid')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000002'), 'price sort, pattern filter: striped out');

select ok(exists(select 1 from public.search_listings(p_sort := 'price', p_query := 'qzattr', p_fit_ids := array[pg_temp.term('fit', 'slim')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000001'), 'price sort, fit filter: slim in');
select ok(not exists(select 1 from public.search_listings(p_sort := 'price', p_query := 'qzattr', p_fit_ids := array[pg_temp.term('fit', 'slim')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000002'), 'price sort, fit filter: oversized out');

-- ============================================================
-- 5. Combinations
-- ============================================================

select is(
  (select array_agg(listing_id order by listing_id)
     from public.search_listings(p_query := 'qzattr', p_color_ids := array[pg_temp.term('color', 'black'), pg_temp.term('color', 'white')])
    where listing_id in ('a73a0000-0000-0000-0000-000000000001', 'a73a0000-0000-0000-0000-000000000002')),
  array['a73a0000-0000-0000-0000-000000000001', 'a73a0000-0000-0000-0000-000000000002']::uuid[],
  'OR within a kind: black or white returns both'
);

select is(
  (select array_agg(listing_id order by listing_id)
     from public.search_listings(p_query := 'qzattr',
            p_color_ids := array[pg_temp.term('color', 'black'), pg_temp.term('color', 'white')],
            p_item_type_ids := array[pg_temp.term('item_type', 't_shirt')])
    where listing_id in ('a73a0000-0000-0000-0000-000000000001', 'a73a0000-0000-0000-0000-000000000002')),
  array['a73a0000-0000-0000-0000-000000000001']::uuid[],
  'AND across kinds: (black or white) and t-shirt returns only the t-shirt'
);

select is(
  (select array_agg(listing_id order by listing_id)
     from public.search_listings(p_query := 'qzattr',
            p_brand_ids := array[pg_temp.brand('nike')],
            p_color_ids := array[pg_temp.term('color', 'black')])
    where listing_id in ('a73a0000-0000-0000-0000-000000000001', 'a73a0000-0000-0000-0000-000000000002',
                         'a73a0000-0000-0000-0000-000000000003', 'a73a0000-0000-0000-0000-000000000004')),
  array['a73a0000-0000-0000-0000-000000000001']::uuid[],
  'brand AND color: only the black Nike listing (not uncolored Nike, not unbranded black)'
);

select is(
  (select count(*)::int
     from public.search_listings(p_query := 'qzattr', p_color_ids := '{}', p_brand_ids := '{}', p_fit_ids := '{}')
    where listing_id in ('a73a0000-0000-0000-0000-000000000001', 'a73a0000-0000-0000-0000-000000000002')),
  2,
  'an empty array is the same as no filter'
);

select is_empty(
  $$select 1 from public.search_listings(p_color_ids := array[pg_temp.term('item_type', 't_shirt')])$$,
  'a term id of another kind matches nothing'
);

select is(
  (select array_agg(listing_id order by listing_id)
     from public.search_listings(p_query := 'qzattr',
            p_category_id := 'c0000001-0000-4000-8000-000000000005',
            p_color_ids := array[pg_temp.term('color', 'black')])
    where listing_id in ('a73a0000-0000-0000-0000-000000000001', 'a73a0000-0000-0000-0000-000000000003')),
  array['a73a0000-0000-0000-0000-000000000003']::uuid[],
  'color filter combines with the category filter'
);

select ok(
  not exists(select 1 from public.search_listings(p_query := 'qzattr', p_color_ids := array[pg_temp.term('color', 'black')], p_price_max := 4000)
              where listing_id = 'a73a0000-0000-0000-0000-000000000001'),
  'color filter combines with the price filter'
);

select ok(
  exists(select 1 from public.search_listings(p_query := 'alpha qzattr', p_color_ids := array[pg_temp.term('color', 'black')])
          where listing_id = 'a73a0000-0000-0000-0000-000000000001')
  and not exists(select 1 from public.search_listings(p_query := 'beta qzattr', p_color_ids := array[pg_temp.term('color', 'black')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000002'),
  'color filter combines with text search'
);

-- ============================================================
-- 6. Text search over the document
-- ============================================================

select ok(exists(select 1 from public.search_listings(p_query := 'נייקי qzattr')
                  where listing_id = 'a73a0000-0000-0000-0000-000000000001'),
  'Hebrew brand alias נייקי finds the Nike listing');

select ok(exists(select 1 from public.search_listings(p_query := 'qzcustomlabel qzattr')
                  where listing_id = 'a73a0000-0000-0000-0000-000000000003'),
  'free-text brand_text is searchable');

select ok(exists(select 1 from public.search_listings(p_query := 'קפוצון qzattr')
                  where listing_id = 'a73a0000-0000-0000-0000-000000000004'),
  'קפוצון finds a description written with a geresh (קפוצ׳ון)');

select ok(exists(select 1 from public.search_listings(p_query := 'החולצה qzattr')
                  where listing_id = 'a73a0000-0000-0000-0000-000000000004'),
  'החולצה finds "חולצה שחורה"');

select ok(exists(select 1 from public.search_listings(p_query := 'חולצות qzattr')
                  where listing_id = 'a73a0000-0000-0000-0000-000000000004'),
  'חולצות finds "חולצה שחורה"');

select ok(exists(select 1 from public.search_listings(p_query := 'ארוכים qzattr')
                  where listing_id = 'a73a0000-0000-0000-0000-000000000006'),
  'ארוכים finds "מעיל ארוך"');

select ok(exists(select 1 from public.search_listings(p_query := 'nike חולצה qzattr')
                  where listing_id = 'a73a0000-0000-0000-0000-000000000004'),
  '"nike חולצה" finds the Nike חולצה (brand + title)');

select ok(not exists(select 1 from public.search_listings(p_query := 'חולצה qzattr')
                      where listing_id = 'a73a0000-0000-0000-0000-000000000005'),
  'חולצה does not return a שמלה');

select ok(exists(select 1 from public.search_listings(p_query := 'sneaker qzattr')
                  where listing_id = 'a73a0000-0000-0000-0000-000000000003'),
  '"sneaker" finds a listing whose only mention is item type Sneakers');

select ok(exists(select 1 from public.search_listings(p_query := 'qzkeyword qzattr')
                  where listing_id = 'a73a0000-0000-0000-0000-000000000001'),
  'a keyword is searchable');

-- ============================================================
-- 7 / 8. Refresh on lookup-table changes (privileged), updated_at kept
-- ============================================================

reset role;

insert into public.brand_aliases (alias_key, brand_id, alias)
values (public.normalize_brand_key('Zqnewalias'), 'a73b0000-0000-0000-0000-000000000001', 'Zqnewalias');

update public.brands
   set name = 'Zqrenamed', key = public.normalize_brand_key('Zqrenamed')
 where id = 'a73b0000-0000-0000-0000-000000000001';

update public.listing_attribute_terms
   set label = 'Zqhue'
 where id = 'a73c0000-0000-0000-0000-000000000001';

update public.categories
   set name = 'Qzouterwear'
 where id = 'c0000001-0000-4000-8000-000000000004';

set local role authenticated;
set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000c","role":"authenticated"}';

select ok(exists(select 1 from public.search_listings(p_query := 'zqnewalias qzattr')
                  where listing_id = 'a73a0000-0000-0000-0000-000000000018'),
  'a newly inserted brand alias becomes searchable');

select ok(exists(select 1 from public.search_listings(p_query := 'zqrenamed qzattr')
                  where listing_id = 'a73a0000-0000-0000-0000-000000000018'),
  'a brand rename refreshes listings with that brand');

select ok(exists(select 1 from public.search_listings(p_query := 'zqhue qzattr')
                  where listing_id = 'a73a0000-0000-0000-0000-000000000018'),
  'a term label rename refreshes listings with that term');

select ok(exists(select 1 from public.search_listings(p_query := 'zqcolor qzattr')
                  where listing_id = 'a73a0000-0000-0000-0000-000000000018'),
  'the unchanged slug is still indexed after a label rename');

select ok(exists(select 1 from public.search_listings(p_query := 'qzouterwear qzattr')
                  where listing_id = 'a73a0000-0000-0000-0000-000000000006'),
  'a category rename refreshes listings in that category');

select is(
  (select updated_at from public.listings where id = 'a73a0000-0000-0000-0000-000000000018'),
  '2026-01-01 00:00:00+00'::timestamptz,
  'brand / alias / term renames leave updated_at untouched'
);

-- ============================================================
-- 7b. More refresh paths (privileged; checked on the stored document)
-- ============================================================

reset role;

-- brand_aliases DELETE
delete from public.brand_aliases where alias_key = public.normalize_brand_key('Zqnewalias');
select ok(not pg_temp.m('a73a0000-0000-0000-0000-000000000018', 'zqnewalias'),
  'a deleted brand alias stops matching');

-- brand_aliases UPDATE
update public.brand_aliases
   set alias = 'Zqupdalias', alias_key = public.normalize_brand_key('Zqupdalias')
 where alias_key = public.normalize_brand_key('Zqbrand');
select ok(not pg_temp.m('a73a0000-0000-0000-0000-000000000018', 'zqbrand'),
  'an updated brand alias: the old alias stops matching');
select ok(pg_temp.m('a73a0000-0000-0000-0000-000000000018', 'zqupdalias'),
  'an updated brand alias: the new alias matches');

-- term slug change
update public.listing_attribute_terms
   set slug = 'zqslugnew'
 where id = 'a73c0000-0000-0000-0000-000000000001';
select ok(not pg_temp.m('a73a0000-0000-0000-0000-000000000018', 'zqcolor'),
  'a term slug change: the old slug stops matching');
select ok(pg_temp.m('a73a0000-0000-0000-0000-000000000018', 'zqslugnew'),
  'a term slug change: the new slug matches');

-- listing_attribute_values UPDATE (term swap)
update public.listing_attribute_values
   set term_id = pg_temp.term('color', 'red')
 where listing_id = 'a73a0000-0000-0000-0000-000000000018'
   and kind = 'color';
select ok(not pg_temp.m('a73a0000-0000-0000-0000-000000000018', 'zqhue'),
  'a direct listing_attribute_values UPDATE: the old term stops matching');
select ok(pg_temp.m('a73a0000-0000-0000-0000-000000000018', 'red'),
  'a direct listing_attribute_values UPDATE: the new term matches');

-- category GROUP rename (L01 is in Women > Tops)
update public.categories
   set name = 'Qzwomengroup'
 where id = 'c0000000-0000-4000-8000-000000000001';
select ok(not pg_temp.m('a73a0000-0000-0000-0000-000000000001', 'women'),
  'a category group rename: the old group word stops matching a leaf listing');
select ok(pg_temp.m('a73a0000-0000-0000-0000-000000000001', 'qzwomengroup'),
  'a category group rename: the new group word matches a leaf listing');

-- category parent_id change (test-only groups, leaf and draft listing L21)
insert into public.categories (id, name, parent_id)
values ('a73d0000-0000-0000-0000-000000000001', 'Qzgroupa', null),
       ('a73d0000-0000-0000-0000-000000000002', 'Qzgroupb', null);
insert into public.categories (id, name, parent_id)
values ('a73d0000-0000-0000-0000-000000000003', 'Qzleaf', 'a73d0000-0000-0000-0000-000000000001');
insert into public.listings (id, seller_id, title, description, category_id, status, created_at, updated_at)
values ('a73a0000-0000-0000-0000-000000000021', 'a7300000-0000-0000-0000-00000000000a',
        'Qzattr moved', 'qzattr', 'a73d0000-0000-0000-0000-000000000003',
        'draft', '2026-04-01 10:21:00+00', '2026-01-01 00:00:00+00');
select ok(pg_temp.m('a73a0000-0000-0000-0000-000000000021', 'qzgroupa'),
  'sanity: the leaf listing carries its original group name');

update public.categories
   set parent_id = 'a73d0000-0000-0000-0000-000000000002'
 where id = 'a73d0000-0000-0000-0000-000000000003';
select ok(not pg_temp.m('a73a0000-0000-0000-0000-000000000021', 'qzgroupa'),
  'a category parent change: the old group name stops matching');
select ok(pg_temp.m('a73a0000-0000-0000-0000-000000000021', 'qzgroupb'),
  'a category parent change: the new group name matches');

select is(
  (select array_agg(updated_at order by id) from public.listings
    where id in ('a73a0000-0000-0000-0000-000000000001', 'a73a0000-0000-0000-0000-000000000018',
                 'a73a0000-0000-0000-0000-000000000021')),
  array['2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00']::timestamptz[],
  'alias / slug / attribute-value / category refreshes leave updated_at untouched'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000c","role":"authenticated"}';

-- set_listing_attributes as the seller: color green -> blue (attributes only).
set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000a","role":"authenticated"}';
select public.set_listing_attributes(
  'a73a0000-0000-0000-0000-000000000019', array[pg_temp.term('color', 'blue')], '{}', null, null);
set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000c","role":"authenticated"}';

select ok(not exists(select 1 from public.search_listings(p_query := 'qzattr', p_color_ids := array[pg_temp.term('color', 'green')])
                      where listing_id = 'a73a0000-0000-0000-0000-000000000019'),
  'after a color change the old color filter no longer matches');
select ok(exists(select 1 from public.search_listings(p_query := 'qzattr', p_color_ids := array[pg_temp.term('color', 'blue')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000019'),
  'after a color change the new color filter matches');
select ok(not exists(select 1 from public.search_listings(p_query := 'green qzattr')
                      where listing_id = 'a73a0000-0000-0000-0000-000000000019'),
  'after a color change the old color word no longer matches');
select ok(exists(select 1 from public.search_listings(p_query := 'blue qzattr')
                  where listing_id = 'a73a0000-0000-0000-0000-000000000019'),
  'after a color change the new color word matches');

select is(
  (select updated_at from public.listings where id = 'a73a0000-0000-0000-0000-000000000019'),
  '2026-01-01 00:00:00+00'::timestamptz,
  'an attributes-only set_listing_attributes leaves updated_at untouched'
);

-- Brand switch via set_listing_attributes.
set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000a","role":"authenticated"}';
select public.set_listing_attributes(
  'a73a0000-0000-0000-0000-000000000019', array[pg_temp.term('color', 'blue')], '{}', pg_temp.brand('nike'), null);
set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000c","role":"authenticated"}';

select ok(exists(select 1 from public.search_listings(p_query := 'qzattr', p_brand_ids := array[pg_temp.brand('nike')])
                  where listing_id = 'a73a0000-0000-0000-0000-000000000019'),
  'a brand set via set_listing_attributes is matched by the brand filter');
select ok(exists(select 1 from public.search_listings(p_query := 'נייקי qzattr')
                  where listing_id = 'a73a0000-0000-0000-0000-000000000019'),
  'a brand set via set_listing_attributes is searchable by its Hebrew alias');

-- Title change via update_listing_details.
set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000a","role":"authenticated"}';
select public.update_listing_details(
  'a73a0000-0000-0000-0000-000000000018', 'Qzattr qznewtitle', '', 4000, 'good', 'alpha_m',
  'c0000001-0000-4000-8000-000000000001');
set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000c","role":"authenticated"}';

select ok(exists(select 1 from public.search_listings(p_query := 'qznewtitle qzattr')
                  where listing_id = 'a73a0000-0000-0000-0000-000000000018'),
  'a title change via update_listing_details is searchable');

select ok(not exists(select 1 from public.search_listings(p_query := 'refresh qzattr')
                      where listing_id = 'a73a0000-0000-0000-0000-000000000018'),
  'the old title no longer matches');

-- Category change Tops -> Shoes: fit (and the t-shirt item type) are pruned.
set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000a","role":"authenticated"}';
select public.update_listing_details(
  'a73a0000-0000-0000-0000-000000000018', 'Qzattr qznewtitle', '', 4000, 'good', 'alpha_m',
  'c0000001-0000-4000-8000-000000000005');
set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000c","role":"authenticated"}';

select ok(exists(select 1 from public.search_listings(p_query := 'shoes qzattr')
                  where listing_id = 'a73a0000-0000-0000-0000-000000000018'),
  'after a category change to Shoes, "shoes" matches');
select ok(not exists(select 1 from public.search_listings(p_query := 'qzattr', p_fit_ids := array[pg_temp.term('fit', 'slim')])
                      where listing_id = 'a73a0000-0000-0000-0000-000000000018'),
  'the pruned fit no longer matches the fit filter');
select is(pg_temp.w('a73a0000-0000-0000-0000-000000000018', 'slim'), null,
  'the pruned fit is gone from the document');

-- Direct draft UPDATE by the seller.
set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000a","role":"authenticated"}';
update public.listings set title = 'Qzattr qzdraftedit' where id = 'a73a0000-0000-0000-0000-000000000017';

select ok(
  (select search_tsv @@ public.fynd_search_query('qzdraftedit')
     from public.listings where id = 'a73a0000-0000-0000-0000-000000000017'),
  'a direct draft title UPDATE refreshes search_tsv'
);

select is(
  (select updated_at from public.listings where id = 'a73a0000-0000-0000-0000-000000000017'),
  now(),
  'a direct title UPDATE still bumps updated_at'
);

set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000c","role":"authenticated"}';

-- ============================================================
-- 9. Non-active listings never appear
-- ============================================================

select ok(
  exists(select 1 from public.search_listings(
           p_query := 'qzattr', p_brand_ids := array[pg_temp.brand('nike')],
           p_color_ids := array[pg_temp.term('color', 'black')],
           p_item_type_ids := array[pg_temp.term('item_type', 't_shirt')])
          where listing_id = 'a73a0000-0000-0000-0000-000000000001'),
  'sanity: the active listing matches text + brand + color + item type'
);

select is_empty(
  $$select 1 from public.search_listings(
      p_query := 'qzattr', p_brand_ids := array[pg_temp.brand('nike')],
      p_color_ids := array[pg_temp.term('color', 'black')],
      p_item_type_ids := array[pg_temp.term('item_type', 't_shirt')])
     where listing_id in ('a73a0000-0000-0000-0000-000000000007', 'a73a0000-0000-0000-0000-000000000008',
                          'a73a0000-0000-0000-0000-000000000009', 'a73a0000-0000-0000-0000-000000000010')$$,
  'draft / removed / reserved / sold never appear (newest sort)'
);

select is_empty(
  $$select 1 from public.search_listings(
      p_sort := 'price',
      p_query := 'qzattr', p_brand_ids := array[pg_temp.brand('nike')],
      p_color_ids := array[pg_temp.term('color', 'black')],
      p_item_type_ids := array[pg_temp.term('item_type', 't_shirt')])
     where listing_id in ('a73a0000-0000-0000-0000-000000000007', 'a73a0000-0000-0000-0000-000000000008',
                          'a73a0000-0000-0000-0000-000000000009', 'a73a0000-0000-0000-0000-000000000010')$$,
  'draft / removed / reserved / sold never appear (price sort)'
);

-- ============================================================
-- 10. Blocks with attribute filters
-- ============================================================

select ok(
  exists(select 1 from public.search_listings(p_query := 'qzattr', p_color_ids := array[pg_temp.term('color', 'black')])
          where listing_id = 'a73a0000-0000-0000-0000-000000000011'),
  'sanity: before any block, V sees B''s black listing'
);

insert into public.blocks (blocker_id, blocked_id)
values ('a7300000-0000-0000-0000-00000000000c', 'a7300000-0000-0000-0000-00000000000b');

select ok(
  not exists(select 1 from public.search_listings(p_query := 'qzattr', p_color_ids := array[pg_temp.term('color', 'black')])
              where listing_id = 'a73a0000-0000-0000-0000-000000000011'),
  'V blocks B: B''s listing is suppressed under newest sort with a filter'
);
select ok(
  not exists(select 1 from public.search_listings(p_query := 'qzattr', p_sort := 'price', p_brand_ids := array[pg_temp.brand('nike')])
              where listing_id = 'a73a0000-0000-0000-0000-000000000011'),
  'V blocks B: B''s listing is suppressed under price sort with a filter'
);

delete from public.blocks
 where blocker_id = 'a7300000-0000-0000-0000-00000000000c'
   and blocked_id = 'a7300000-0000-0000-0000-00000000000b';

set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000b","role":"authenticated"}';
insert into public.blocks (blocker_id, blocked_id)
values ('a7300000-0000-0000-0000-00000000000b', 'a7300000-0000-0000-0000-00000000000c');
set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000c","role":"authenticated"}';

select ok(
  not exists(select 1 from public.search_listings(p_query := 'qzattr', p_color_ids := array[pg_temp.term('color', 'black')])
              where listing_id = 'a73a0000-0000-0000-0000-000000000011'),
  'B blocks V: B''s listing is suppressed under newest sort with a filter'
);
select ok(
  not exists(select 1 from public.search_listings(p_query := 'qzattr', p_sort := 'price', p_brand_ids := array[pg_temp.brand('nike')])
              where listing_id = 'a73a0000-0000-0000-0000-000000000011'),
  'B blocks V: B''s listing is suppressed under price sort with a filter'
);

set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000b","role":"authenticated"}';
delete from public.blocks
 where blocker_id = 'a7300000-0000-0000-0000-00000000000b'
   and blocked_id = 'a7300000-0000-0000-0000-00000000000c';
set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000c","role":"authenticated"}';

-- ============================================================
-- 11. Keyset pagination with filters ('qzattrpage' + red)
-- ============================================================
-- Newest: L16, L15, L14, L13, L12. Price: L12 (1000), L13 / L14 (2000, id
-- tiebreak), L15 (3000), L16 (4000). L20 has the token but no color.

select is(
  (select array_agg(listing_id order by created_at desc, listing_id desc)
     from public.search_listings(p_query := 'qzattrpage', p_color_ids := array[pg_temp.term('color', 'red')], p_limit := 2)),
  array['a73a0000-0000-0000-0000-000000000016', 'a73a0000-0000-0000-0000-000000000015']::uuid[],
  'newest page 1'
);
select is(
  (select array_agg(listing_id order by created_at desc, listing_id desc)
     from public.search_listings(p_query := 'qzattrpage', p_color_ids := array[pg_temp.term('color', 'red')], p_limit := 2,
            p_cursor_created_at := '2026-04-02 10:04:00+00', p_cursor_id := 'a73a0000-0000-0000-0000-000000000015')),
  array['a73a0000-0000-0000-0000-000000000014', 'a73a0000-0000-0000-0000-000000000013']::uuid[],
  'newest page 2: no overlap, order kept'
);
select is(
  (select array_agg(listing_id order by created_at desc, listing_id desc)
     from public.search_listings(p_query := 'qzattrpage', p_color_ids := array[pg_temp.term('color', 'red')], p_limit := 2,
            p_cursor_created_at := '2026-04-02 10:02:00+00', p_cursor_id := 'a73a0000-0000-0000-0000-000000000013')),
  array['a73a0000-0000-0000-0000-000000000012']::uuid[],
  'newest page 3: the rest, without the uncolored listing'
);

select is(
  (select array_agg(listing_id order by price_amount, listing_id)
     from public.search_listings(p_sort := 'price', p_query := 'qzattrpage', p_color_ids := array[pg_temp.term('color', 'red')], p_limit := 2)),
  array['a73a0000-0000-0000-0000-000000000012', 'a73a0000-0000-0000-0000-000000000013']::uuid[],
  'price page 1'
);
select is(
  (select array_agg(listing_id order by price_amount, listing_id)
     from public.search_listings(p_sort := 'price', p_query := 'qzattrpage', p_color_ids := array[pg_temp.term('color', 'red')], p_limit := 2,
            p_cursor_price := 2000, p_cursor_id := 'a73a0000-0000-0000-0000-000000000013')),
  array['a73a0000-0000-0000-0000-000000000014', 'a73a0000-0000-0000-0000-000000000015']::uuid[],
  'price page 2: price tie broken by id, no overlap'
);
select is(
  (select array_agg(listing_id order by price_amount, listing_id)
     from public.search_listings(p_sort := 'price', p_query := 'qzattrpage', p_color_ids := array[pg_temp.term('color', 'red')], p_limit := 2,
            p_cursor_price := 3000, p_cursor_id := 'a73a0000-0000-0000-0000-000000000015')),
  array['a73a0000-0000-0000-0000-000000000016']::uuid[],
  'price page 3: the rest'
);

select throws_ok(
  $$select * from public.search_listings(p_query := 'qzattr', p_color_ids := array[pg_temp.term('color', 'red')], p_cursor_created_at := now())$$,
  'P0001', null,
  'a half cursor is still rejected with filters'
);
select throws_ok(
  $$select * from public.search_listings(p_query := 'qzattr', p_sort := 'price', p_color_ids := array[pg_temp.term('color', 'red')], p_cursor_created_at := now())$$,
  'P0001', null,
  'a wrong-mode cursor is still rejected with filters'
);

-- ============================================================
-- 12. Caps
-- ============================================================

select throws_ok(
  $$select * from public.search_listings(p_query := 'qzattr', p_brand_ids := array(select gen_random_uuid() from generate_series(1, 21)))$$,
  '22023', null,
  '21 brand ids are rejected'
);
select throws_ok(
  $$select * from public.search_listings(p_query := 'qzattr', p_color_ids := array(select gen_random_uuid() from generate_series(1, 21)))$$,
  '22023', null,
  '21 term ids are rejected'
);
select throws_ok(
  $$select * from public.search_listings(p_query := 'qzattr', p_style_ids := array[pg_temp.term('style', 'vintage'), null])$$,
  '22023', null,
  'a NULL element is rejected'
);
select throws_ok(
  $$select * from public.search_listings(p_query := 'qzattr', p_fit_ids := '{{a73a0000-0000-0000-0000-000000000001,a73a0000-0000-0000-0000-000000000002},{a73a0000-0000-0000-0000-000000000003,a73a0000-0000-0000-0000-000000000004}}'::uuid[])$$,
  '22023', null,
  'a 2-D array is rejected'
);
select lives_ok(
  $$select * from public.search_listings(p_query := 'qzattr', p_material_ids := array(select gen_random_uuid() from generate_series(1, 20)))$$,
  '20 ids are accepted'
);

-- ============================================================
-- 13. Privileges
-- ============================================================

select throws_ok(
  $$select * from private.listing_search_document(null, 'x', '', null, null, null, '{}')$$,
  '42501', null,
  'authenticated cannot call private.listing_search_document'
);
select throws_ok(
  $$select private.refresh_listing_search_tsv(array['a73a0000-0000-0000-0000-000000000001'::uuid])$$,
  '42501', null,
  'authenticated cannot call private.refresh_listing_search_tsv'
);

set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000a","role":"authenticated"}';
select throws_ok(
  $$update public.listings set search_tsv = ''::tsvector where id = 'a73a0000-0000-0000-0000-000000000017'$$,
  '42501', null,
  'a seller cannot write search_tsv directly'
);

select throws_ok(
  $$select public.fynd_text_tsvector('x')$$,
  '42501', null,
  'authenticated cannot execute public.fynd_text_tsvector'
);

select throws_ok($$select private.listings_set_search_tsv()$$, '42501', null,
  'authenticated cannot execute private.listings_set_search_tsv');
select throws_ok($$select private.listing_attribute_values_refresh_search()$$, '42501', null,
  'authenticated cannot execute private.listing_attribute_values_refresh_search');
select throws_ok($$select private.brands_refresh_search()$$, '42501', null,
  'authenticated cannot execute private.brands_refresh_search');
select throws_ok($$select private.brand_aliases_refresh_search()$$, '42501', null,
  'authenticated cannot execute private.brand_aliases_refresh_search');
select throws_ok($$select private.listing_attribute_terms_refresh_search()$$, '42501', null,
  'authenticated cannot execute private.listing_attribute_terms_refresh_search');
select throws_ok($$select private.categories_refresh_search()$$, '42501', null,
  'authenticated cannot execute private.categories_refresh_search');

-- search_tsv is not in authenticated's INSERT column allowlist.
select throws_ok(
  $$insert into public.listings (seller_id, title, category_id, search_tsv)
    values ('a7300000-0000-0000-0000-00000000000a', 'Qzattr forged', 'c0000001-0000-4000-8000-000000000001', 'qzforged'::tsvector)$$,
  '42501', null,
  'a client INSERT that supplies search_tsv is refused'
);

-- A normal client insert; its document is checked privileged in 2b.
with ins as (
  insert into public.listings (seller_id, title, description, category_id)
  values ('a7300000-0000-0000-0000-00000000000a', 'Qzattr qzclientinsert', 'qzattr',
          'c0000001-0000-4000-8000-000000000001')
  returning id
)
select set_config('t.client_insert', id::text, true) from ins;

-- Seller B cannot see seller A's draft (nor its search_tsv).
set local request.jwt.claims = '{"sub":"a7300000-0000-0000-0000-00000000000b","role":"authenticated"}';
select is_empty(
  $$select search_tsv from public.listings where id = 'a73a0000-0000-0000-0000-000000000017'$$,
  'seller B cannot read search_tsv of seller A''s draft'
);

set local role anon;
select throws_ok(
  $$select * from public.search_listings()$$,
  '42501', null,
  'anon cannot execute search_listings'
);
select throws_ok(
  $$select public.fynd_text_tsvector('x')$$,
  '42501', null,
  'anon cannot execute public.fynd_text_tsvector'
);
select throws_ok(
  $$select search_tsv from public.listings$$,
  '42501', null,
  'anon cannot read listings.search_tsv'
);
select is(
  (select title from public.listings where id = 'a73a0000-0000-0000-0000-000000000001'),
  'Qzattr alpha',
  'anon can still read an active listing''s title'
);

-- ============================================================
-- 2b. Invariant still holds for every fixture after all the edits
-- ============================================================

reset role;

select is_empty(
  $$select l.id from public.listings l
     where l.id::text like 'a73a0000-%'
       and l.search_tsv is distinct from private.listing_search_document(
             l.id, l.title, l.description, l.category_id, l.brand_id, l.brand_text, l.keywords)$$,
  'after every edit above, each fixture''s stored search_tsv still equals its computed document'
);

select is(
  (select l.search_tsv from public.listings l where l.id = current_setting('t.client_insert')::uuid),
  (select private.listing_search_document(l.id, l.title, l.description, l.category_id, l.brand_id, l.brand_text, l.keywords)
     from public.listings l where l.id = current_setting('t.client_insert')::uuid),
  'a normal client insert stores its computed document'
);
select ok(pg_temp.m(current_setting('t.client_insert')::uuid, 'qzclientinsert'),
  'a normal client insert is searchable by its title');

select * from finish();

rollback;
