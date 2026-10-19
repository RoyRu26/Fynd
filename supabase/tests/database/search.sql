-- pgTAP tests for ROADMAP 2.2 "Search backend" (search_listings).
--
-- Run with: pnpm exec supabase test db --local
--
-- Conventions match feed.sql: 3 test sellers, 4-arg throws_ok(sql, sqlstate,
-- null, description), SQLSTATE-only assertions, and a scoping fixture table
-- for any assertion that aggregates (count/string_agg) rather than naming a
-- single row by title -- a single-row `exists(... where title = 'X')` check
-- is unaffected by unrelated dev data and needs no scoping, exactly as
-- feed.sql's own header documents.
--
-- DEVIATION from feed.sql, called out once here rather than repeated below:
-- every search_listings call below uses NAMED parameters
-- (`p_query := 'leather'`), not positional. feed_listings has 4 parameters
-- and reads fine positionally; search_listings has 11, and a positional
-- call eleven arguments deep (half of them typically omitted via DEFAULT)
-- would be unreadable and error-prone to review. Named parameters are also
-- exactly how the mobile client calls `supabase.rpc(...)` in practice.
create extension if not exists pgtap with schema extensions;

begin;

select plan(46);

-- ============================================================
-- FIXTURES
-- ============================================================
-- Three sellers, mirroring feed.sql: A owns most of the catalog, B owns the
-- one listing used to prove the "different top-level group" category case,
-- and C is the viewer who runs every assertion below AND owns one active
-- listing of their own -- used to prove Search does NOT exclude the
-- viewer's own listings (unlike the Home feed).

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('b9000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-search-a@test.dev', 'x', now(), now()),
  ('b9000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-search-b@test.dev', 'x', now(), now()),
  ('b9000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-search-c@test.dev', 'x', now(), now());

-- Listings are inserted privileged: id/status are not client-writable, and
-- created_at must be controlled precisely for the pagination assertions.
-- category_id values are the seeded leaves/groups from
-- 20261018100200_categories.sql: Women > Tops (...0001-...0001),
-- Women > Dresses (...0001-...0002), Men > Tops (...0002-...0001).
--
-- Every listing that must prove a NEGATIVE ("never appears") is still given
-- an image below, so that negative is isolated to the thing actually under
-- test (status, or absence of a match) rather than being accidentally also
-- true because of the unrelated "has at least one image" eligibility rule.
-- The sole deliberate exception is 'Leather Gloves No Image'.
insert into public.listings
  (id, seller_id, title, description, price_amount, condition, size, category_id, status, created_at)
values
  -- Text-match correctness: one match via title only, one via description
  -- only, one via neither.
  ('bbbb1000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-00000000000a',
   'Leather Jacket', 'Warm and stylish', 5000, 'good', 'alpha_m',
   'c0000001-0000-4000-8000-000000000001', 'active', '2026-03-01 10:00:00+00'),
  ('bbbb1000-0000-0000-0000-000000000002', 'b9000000-0000-0000-0000-00000000000a',
   'Blue Jacket', 'Made of genuine leather accents', 6000, 'very_good', 'alpha_l',
   'c0000001-0000-4000-8000-000000000001', 'active', '2026-03-01 10:01:00+00'),
  ('bbbb1000-0000-0000-0000-000000000003', 'b9000000-0000-0000-0000-00000000000a',
   'Cotton Shirt', 'Soft cotton material', 7000, 'good', 'alpha_m',
   'c0000001-0000-4000-8000-000000000001', 'active', '2026-03-01 10:02:00+00'),

  -- Status exclusion: each of these otherwise matches the 'leather' query.
  ('bbbb1000-0000-0000-0000-000000000004', 'b9000000-0000-0000-0000-00000000000a',
   'Leather Boots Draft', 'draft item', 1500, 'good', null,
   null, 'draft', '2026-03-01 10:03:00+00'),
  ('bbbb1000-0000-0000-0000-000000000005', 'b9000000-0000-0000-0000-00000000000a',
   'Leather Bag Removed', '', 1200, 'good', 'one_size',
   'c0000001-0000-4000-8000-000000000001', 'removed', '2026-03-01 10:04:00+00'),
  ('bbbb1000-0000-0000-0000-000000000006', 'b9000000-0000-0000-0000-00000000000a',
   'Leather Belt Reserved', '', 1300, 'good', 'one_size',
   'c0000001-0000-4000-8000-000000000001', 'reserved', '2026-03-01 10:05:00+00'),
  ('bbbb1000-0000-0000-0000-000000000007', 'b9000000-0000-0000-0000-00000000000a',
   'Leather Wallet Sold', '', 1400, 'good', 'one_size',
   'c0000001-0000-4000-8000-000000000001', 'sold', '2026-03-01 10:06:00+00'),

  -- Active but imageless: must never appear either.
  ('bbbb1000-0000-0000-0000-000000000008', 'b9000000-0000-0000-0000-00000000000a',
   'Leather Gloves No Image', '', 1600, 'good', 'one_size',
   'c0000001-0000-4000-8000-000000000001', 'active', '2026-03-01 10:07:00+00'),

  -- Category/condition/size/price fixtures. Two leaves under Women (Tops,
  -- Dresses), one leaf under Men -- enough to test both the exact-leaf and
  -- the top-level-expand branches of the category filter without any of
  -- the three cross-matching the others.
  ('bbbb1000-0000-0000-0000-000000000009', 'b9000000-0000-0000-0000-00000000000a',
   'Leather Leaf A1', '', 2500, 'new', 'alpha_s',
   'c0000001-0000-4000-8000-000000000001', 'active', '2026-03-01 10:08:00+00'),
  ('bbbb1000-0000-0000-0000-00000000000a', 'b9000000-0000-0000-0000-00000000000a',
   'Leather Leaf A2', '', 3500, 'like_new', 'alpha_m',
   'c0000001-0000-4000-8000-000000000002', 'active', '2026-03-01 10:09:00+00'),
  ('bbbb1000-0000-0000-0000-00000000000b', 'b9000000-0000-0000-0000-00000000000b',
   'Leather Leaf B1', '', 4500, 'fair', 'alpha_l',
   'c0000002-0000-4000-8000-000000000001', 'active', '2026-03-01 10:10:00+00'),

  -- The viewer's (C) own active listing -- must be returned, not excluded.
  ('bbbb1000-0000-0000-0000-00000000000c', 'b9000000-0000-0000-0000-00000000000c',
   'Leather Viewer Own', '', 5500, 'good', 'one_size',
   'c0000001-0000-4000-8000-000000000001', 'active', '2026-03-01 10:11:00+00'),

  -- Pagination + price-tie fixtures. 'leatherpage' is a single token the
  -- English text search parser will never fold into 'leather' (it is not a
  -- word boundary split), so searching it is itself a complete, collision-
  -- proof scope for the aggregate pagination assertions below -- nothing
  -- else in this file or in real dev data can contain that exact token.
  -- Two (price = 2000) to exercise the id tiebreaker under price sort:
  -- 'Leatherpage Two' (...0e) sorts before 'Leatherpage Three' (...0f).
  ('bbbb1000-0000-0000-0000-00000000000d', 'b9000000-0000-0000-0000-00000000000a',
   'Leatherpage One', '', 1000, 'good', 'one_size',
   'c0000001-0000-4000-8000-000000000001', 'active', '2026-02-01 10:00:00+00'),
  ('bbbb1000-0000-0000-0000-00000000000e', 'b9000000-0000-0000-0000-00000000000a',
   'Leatherpage Two', '', 2000, 'good', 'one_size',
   'c0000001-0000-4000-8000-000000000001', 'active', '2026-02-02 10:00:00+00'),
  ('bbbb1000-0000-0000-0000-00000000000f', 'b9000000-0000-0000-0000-00000000000a',
   'Leatherpage Three', '', 2000, 'good', 'one_size',
   'c0000001-0000-4000-8000-000000000001', 'active', '2026-02-03 10:00:00+00'),
  ('bbbb1000-0000-0000-0000-000000000010', 'b9000000-0000-0000-0000-00000000000a',
   'Leatherpage Four', '', 3000, 'good', 'one_size',
   'c0000001-0000-4000-8000-000000000001', 'active', '2026-02-04 10:00:00+00');

insert into public.listing_images (listing_id, storage_path, "position")
values
  ('bbbb1000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-00000000000a/bbbb1000-0000-0000-0000-000000000001/a.jpg', 0),
  ('bbbb1000-0000-0000-0000-000000000002', 'b9000000-0000-0000-0000-00000000000a/bbbb1000-0000-0000-0000-000000000002/a.jpg', 0),
  ('bbbb1000-0000-0000-0000-000000000003', 'b9000000-0000-0000-0000-00000000000a/bbbb1000-0000-0000-0000-000000000003/a.jpg', 0),
  ('bbbb1000-0000-0000-0000-000000000004', 'b9000000-0000-0000-0000-00000000000a/bbbb1000-0000-0000-0000-000000000004/a.jpg', 0),
  ('bbbb1000-0000-0000-0000-000000000005', 'b9000000-0000-0000-0000-00000000000a/bbbb1000-0000-0000-0000-000000000005/a.jpg', 0),
  ('bbbb1000-0000-0000-0000-000000000006', 'b9000000-0000-0000-0000-00000000000a/bbbb1000-0000-0000-0000-000000000006/a.jpg', 0),
  ('bbbb1000-0000-0000-0000-000000000007', 'b9000000-0000-0000-0000-00000000000a/bbbb1000-0000-0000-0000-000000000007/a.jpg', 0),
  -- 000008 ('Leather Gloves No Image') deliberately gets NO row.
  ('bbbb1000-0000-0000-0000-000000000009', 'b9000000-0000-0000-0000-00000000000a/bbbb1000-0000-0000-0000-000000000009/a.jpg', 0),
  ('bbbb1000-0000-0000-0000-00000000000a', 'b9000000-0000-0000-0000-00000000000a/bbbb1000-0000-0000-0000-00000000000a/a.jpg', 0),
  ('bbbb1000-0000-0000-0000-00000000000b', 'b9000000-0000-0000-0000-00000000000b/bbbb1000-0000-0000-0000-00000000000b/a.jpg', 0),
  ('bbbb1000-0000-0000-0000-00000000000c', 'b9000000-0000-0000-0000-00000000000c/bbbb1000-0000-0000-0000-00000000000c/a.jpg', 0),
  ('bbbb1000-0000-0000-0000-00000000000d', 'b9000000-0000-0000-0000-00000000000a/bbbb1000-0000-0000-0000-00000000000d/a.jpg', 0),
  ('bbbb1000-0000-0000-0000-00000000000e', 'b9000000-0000-0000-0000-00000000000a/bbbb1000-0000-0000-0000-00000000000e/a.jpg', 0),
  ('bbbb1000-0000-0000-0000-00000000000f', 'b9000000-0000-0000-0000-00000000000a/bbbb1000-0000-0000-0000-00000000000f/a.jpg', 0),
  ('bbbb1000-0000-0000-0000-000000000010', 'b9000000-0000-0000-0000-00000000000a/bbbb1000-0000-0000-0000-000000000010/a.jpg', 0);

-- Acting as C throughout (the viewer), except where a role switch is itself
-- under test (section 16, anon).
set local role authenticated;
set local request.jwt.claims = '{"sub":"b9000000-0000-0000-0000-00000000000c","role":"authenticated"}';

-- ============================================================
-- 1. Status exclusion -- never appear, even on a matching query
-- ============================================================

select ok(
  not exists(select 1 from public.search_listings(p_query := 'leather') where title = 'Leather Boots Draft'),
  'a draft is excluded even though its title matches the query'
);

select ok(
  not exists(select 1 from public.search_listings(p_query := 'leather') where title = 'Leather Bag Removed'),
  'a removed listing is excluded'
);

select ok(
  not exists(select 1 from public.search_listings(p_query := 'leather') where title = 'Leather Belt Reserved'),
  'a reserved listing is excluded'
);

select ok(
  not exists(select 1 from public.search_listings(p_query := 'leather') where title = 'Leather Wallet Sold'),
  'a sold listing is excluded'
);

select ok(
  not exists(select 1 from public.search_listings(p_query := 'leather') where title = 'Leather Gloves No Image'),
  'an active listing with zero images is excluded'
);

-- ============================================================
-- 2. Text match correctness
-- ============================================================

select ok(
  exists(select 1 from public.search_listings(p_query := 'leather') where title = 'Leather Jacket'),
  'a title-only match is found'
);

select ok(
  exists(select 1 from public.search_listings(p_query := 'leather') where title = 'Blue Jacket'),
  'a description-only match is found'
);

select ok(
  not exists(select 1 from public.search_listings(p_query := 'leather') where title = 'Cotton Shirt'),
  'a listing matching neither title nor description is not returned'
);

-- ============================================================
-- 3. Category filter alone
-- ============================================================
-- Exact leaf: 'c0000001-...-0001' is the seeded Women > Tops leaf.

select ok(
  exists(select 1 from public.search_listings(p_category_id := 'c0000001-0000-4000-8000-000000000001') where title = 'Leather Leaf A1'),
  'exact-leaf category filter matches a listing in that leaf'
);

select ok(
  not exists(select 1 from public.search_listings(p_category_id := 'c0000001-0000-4000-8000-000000000001') where title = 'Leather Leaf A2'),
  'exact-leaf category filter excludes a sibling leaf under the same group'
);

select ok(
  not exists(select 1 from public.search_listings(p_category_id := 'c0000001-0000-4000-8000-000000000001') where title = 'Leather Leaf B1'),
  'exact-leaf category filter excludes a leaf under a different group'
);

-- Top-level expand: 'c0000000-...-0001' is the seeded Women group. Unlike
-- the exact-leaf case above, "all of Women" is broad enough to also match
-- ordinary dev/seed data living in this same database (a local seed
-- script now populates dozens of real Women's-category listings) --
-- enough of it, dated more recently than this suite's fixtures, to push
-- 'Leather Leaf A1'/'A2' off the default-limited page entirely. The
-- `p_query := 'Leather Leaf'` text filter scopes these three assertions
-- back down to just this suite's own fixtures (none of which contain
-- those words) without touching the category-filter logic under test --
-- it's ANDed with the category predicate, never substituting for it.
select ok(
  exists(select 1 from public.search_listings(p_category_id := 'c0000000-0000-4000-8000-000000000001', p_query := 'Leather Leaf') where title = 'Leather Leaf A1'),
  'top-level category filter matches a listing in a child leaf (Tops)'
);

select ok(
  exists(select 1 from public.search_listings(p_category_id := 'c0000000-0000-4000-8000-000000000001', p_query := 'Leather Leaf') where title = 'Leather Leaf A2'),
  'top-level category filter matches a listing in a different child leaf (Dresses)'
);

select ok(
  not exists(select 1 from public.search_listings(p_category_id := 'c0000000-0000-4000-8000-000000000001', p_query := 'Leather Leaf') where title = 'Leather Leaf B1'),
  'top-level category filter excludes a listing under a different group entirely'
);

-- ============================================================
-- 4. Condition filter alone
-- ============================================================

select ok(
  exists(select 1 from public.search_listings(p_condition := 'new') where title = 'Leather Leaf A1'),
  'condition filter matches the listing with that condition'
);

select ok(
  not exists(select 1 from public.search_listings(p_condition := 'new') where title = 'Leather Leaf A2'),
  'condition filter excludes a listing with a different condition'
);

-- ============================================================
-- 5. Size filter alone
-- ============================================================

select ok(
  exists(select 1 from public.search_listings(p_size := 'alpha_s') where title = 'Leather Leaf A1'),
  'size filter matches the listing with that size'
);

select ok(
  not exists(select 1 from public.search_listings(p_size := 'alpha_s') where title = 'Leather Leaf A2'),
  'size filter excludes a listing with a different size'
);

-- ============================================================
-- 6. Price filters alone
-- ============================================================
-- p_price_min alone is the broadest filter in this file -- no category
-- constraint at all -- so it's the one most exposed to unrelated dev/seed
-- data also clearing the floor. Same `p_query := 'Leather Leaf'` scoping
-- as the top-level category case above, same reasoning: ANDed with the
-- price predicate, not a substitute for it.

select ok(
  exists(select 1 from public.search_listings(p_price_min := 4000, p_query := 'Leather Leaf') where title = 'Leather Leaf B1'),
  'price_min alone includes a listing at or above the floor'
);

select ok(
  not exists(select 1 from public.search_listings(p_price_min := 4000, p_query := 'Leather Leaf') where title = 'Leather Leaf A1'),
  'price_min alone excludes a listing below the floor'
);

select ok(
  exists(select 1 from public.search_listings(p_price_max := 3000) where title = 'Leather Leaf A1'),
  'price_max alone includes a listing at or below the ceiling'
);

select ok(
  not exists(select 1 from public.search_listings(p_price_max := 3000) where title = 'Leather Leaf B1'),
  'price_max alone excludes a listing above the ceiling'
);

select ok(
  exists(select 1 from public.search_listings(p_price_min := 3000, p_price_max := 4000) where title = 'Leather Leaf A2'),
  'price_min and price_max together include a listing inside the range'
);

select ok(
  not exists(select 1 from public.search_listings(p_price_min := 3000, p_price_max := 4000) where title = 'Leather Leaf A1'),
  'price_min and price_max together exclude a listing below the range'
);

select ok(
  not exists(select 1 from public.search_listings(p_price_min := 3000, p_price_max := 4000) where title = 'Leather Leaf B1'),
  'price_min and price_max together exclude a listing above the range'
);

-- ============================================================
-- 7. Filters combined with each other and with a text query
-- ============================================================

select ok(
  exists(
    select 1 from public.search_listings(
      p_query := 'leather', p_category_id := 'c0000001-0000-4000-8000-000000000001', p_condition := 'new'
    ) where title = 'Leather Leaf A1'
  ),
  'query + category + condition together match the one listing satisfying all three'
);

select ok(
  not exists(
    select 1 from public.search_listings(
      p_query := 'leather', p_category_id := 'c0000001-0000-4000-8000-000000000001', p_condition := 'new'
    ) where title = 'Leather Leaf A2'
  ),
  'query + category + condition together exclude a listing failing the category/condition narrowing'
);

select ok(
  exists(
    select 1 from public.search_listings(
      p_query := 'leather', p_size := 'alpha_s', p_price_min := 2000, p_price_max := 3000
    ) where title = 'Leather Leaf A1'
  ),
  'query + size + price range together match the one listing satisfying all four'
);

select ok(
  not exists(
    select 1 from public.search_listings(
      p_query := 'leather', p_size := 'alpha_s', p_price_min := 2000, p_price_max := 3000
    ) where title = 'Leather Leaf B1'
  ),
  'query + size + price range together exclude a listing failing the size narrowing'
);

-- ============================================================
-- 8. A genuinely non-matching query
-- ============================================================

select lives_ok(
  $$select * from public.search_listings(p_query := 'zzzznonexistentqueryterm123')$$,
  'a query matching nothing does not raise'
);

select is(
  (select count(*)::int from public.search_listings(p_query := 'zzzznonexistentqueryterm123')),
  0,
  'and it returns zero rows'
);

-- ============================================================
-- 9. price_min > price_max
-- ============================================================

select throws_ok(
  $$select * from public.search_listings(p_price_min := 5000, p_price_max := 1000)$$,
  'P0001', null,
  'p_price_min greater than p_price_max is rejected'
);

-- ============================================================
-- 10. Pagination -- newest sort
-- ============================================================
-- 'leatherpage' is this section's complete, self-contained scope (see the
-- fixture comment above) -- newest-first order is Four, Three, Two, One.

select is(
  (
    with page1 as (
      select * from public.search_listings(p_query := 'leatherpage', p_sort := 'newest', p_limit := 2)
    ),
    cur as (
      select created_at, listing_id from page1 order by created_at asc, listing_id asc limit 1
    ),
    page2 as (
      select * from public.search_listings(
        p_query := 'leatherpage', p_sort := 'newest', p_limit := 2,
        p_cursor_created_at := (select created_at from cur),
        p_cursor_id := (select listing_id from cur)
      )
    )
    select string_agg(title, ',' order by created_at desc)
      from (select * from page1 union all select * from page2) combined
  ),
  'Leatherpage Four,Leatherpage Three,Leatherpage Two,Leatherpage One',
  'newest-sort keyset pagination returns the next page with no gap and no duplicate'
);

-- ============================================================
-- 11. Pagination -- price sort, including the tied-price pair
-- ============================================================
-- Ascending price order is One(1000), Two(2000), Three(2000), Four(3000) --
-- Two sorts before Three only because of the id tiebreaker. Page 1 (limit 2)
-- stops exactly between the tied pair, so page 2 starting from that cursor
-- is what proves the tiebreaker works, not just the price column.

select is(
  (
    with page1 as (
      select * from public.search_listings(p_query := 'leatherpage', p_sort := 'price', p_limit := 2)
    ),
    cur as (
      select price_amount, listing_id from page1 order by price_amount desc, listing_id desc limit 1
    ),
    page2 as (
      select * from public.search_listings(
        p_query := 'leatherpage', p_sort := 'price', p_limit := 2,
        p_cursor_price := (select price_amount from cur),
        p_cursor_id := (select listing_id from cur)
      )
    )
    select string_agg(title, ',' order by price_amount asc, listing_id asc)
      from (select * from page1 union all select * from page2) combined
  ),
  'Leatherpage One,Leatherpage Two,Leatherpage Three,Leatherpage Four',
  'price-sort keyset pagination, including across the tied-price pair, has no gap and no duplicate'
);

-- ============================================================
-- 12. Half-cursor rejected, both sort modes
-- ============================================================

select throws_ok(
  $$select * from public.search_listings(p_sort := 'newest', p_cursor_created_at := now())$$,
  'P0001', null,
  'newest-sort: created_at without id is rejected'
);

select throws_ok(
  $$select * from public.search_listings(p_sort := 'newest', p_cursor_id := 'bbbb1000-0000-0000-0000-00000000000d')$$,
  'P0001', null,
  'newest-sort: id without created_at is rejected'
);

select throws_ok(
  $$select * from public.search_listings(p_sort := 'price', p_cursor_price := 1000)$$,
  'P0001', null,
  'price-sort: price without id is rejected'
);

select throws_ok(
  $$select * from public.search_listings(p_sort := 'price', p_cursor_id := 'bbbb1000-0000-0000-0000-00000000000d')$$,
  'P0001', null,
  'price-sort: id without price is rejected'
);

-- ============================================================
-- 13. Wrong-mode cursor rejected
-- ============================================================

select throws_ok(
  $$select * from public.search_listings(p_sort := 'newest', p_cursor_price := 1000)$$,
  'P0001', null,
  'a price cursor cannot be used with sort = newest'
);

select throws_ok(
  $$select * from public.search_listings(p_sort := 'price', p_cursor_created_at := now())$$,
  'P0001', null,
  'a created_at cursor cannot be used with sort = price'
);

select lives_ok(
  $$select * from public.search_listings(p_sort := 'newest')$$,
  'newest-sort: both cursor halves null is the normal first page'
);

select lives_ok(
  $$select * from public.search_listings(p_sort := 'price')$$,
  'price-sort: both cursor halves null is the normal first page'
);

-- ============================================================
-- 14. p_limit clamping
-- ============================================================
-- Scoped by the 'leatherpage' query, which has exactly 4 eligible rows.
-- As feed.sql's own equivalent test notes: this proves the call succeeds
-- and still returns every eligible row, not that 50 is the exact clamp
-- value -- this fixture set is too small to observe the cap itself.

select is(
  (select count(*)::int from public.search_listings(p_query := 'leatherpage', p_limit := 999)),
  4,
  'p_limit above the cap is clamped rather than rejected'
);

select is(
  (select count(*)::int from public.search_listings(p_query := 'leatherpage', p_limit := null)),
  4,
  'an explicit p_limit => null falls back to the default, and never becomes an unbounded LIMIT'
);

-- ============================================================
-- 15. The viewer's own active listing
-- ============================================================

select ok(
  exists(select 1 from public.search_listings(p_query := 'leather') where title = 'Leather Viewer Own'),
  'the viewer''s own active listing IS returned -- Search is a catalog lookup, not a discover-others feed'
);

-- ============================================================
-- 16. anon cannot execute
-- ============================================================

set local role anon;

select throws_ok(
  $$select * from public.search_listings()$$,
  '42501', null,
  'anon cannot execute search_listings -- the pg_default_acl grant was revoked'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"b9000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select * from finish();

rollback;
