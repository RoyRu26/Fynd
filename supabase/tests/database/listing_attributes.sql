-- pgTAP tests for listing attributes (AI listing metadata plan, Phase 1a):
-- listing_attribute_values, listings.keywords, set_listing_attributes, and
-- the triggers that keep attributes consistent with the listing's
-- category. The taxonomy itself is covered in listing_attribute_taxonomy.sql.
--
-- Same conventions as the other suites: 4-arg throws_ok(sql, sqlstate,
-- null, description), SQLSTATE only, never message text.
--
-- Run with: pnpm exec supabase test db --local
create extension if not exists pgtap with schema extensions;

begin;

select plan(69);

-- ============================================================
-- Fixtures
-- ============================================================
-- A owns every listing except L5 (B's). Inserted privileged, because status
-- isn't client-writable.
--   L1 draft,  Women › Tops
--   L2 draft,  no category yet
--   L3 active, Women › Shoes
--   L4 sold,   Women › Tops (terminal)
--   L5 draft,  Women › Tops, owned by B
--   L6 active, Women › Tops (read-visibility and retired-term cases)
--   L7 reserved, Women › Tops
--   L8 removed,  Women › Tops (terminal)

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('f7000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-attrs-a@test.dev', 'x', now(), now()),
  ('f7000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-attrs-b@test.dev', 'x', now(), now());

insert into public.listings
  (id, seller_id, title, description, price_amount, condition, size, category_id, status)
values
  ('f7aa0000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-00000000000a',
   'Attr draft tops', '', null, null, null, 'c0000001-0000-4000-8000-000000000001', 'draft'),
  ('f7aa0000-0000-0000-0000-000000000002', 'f7000000-0000-0000-0000-00000000000a',
   'Attr draft no category', '', null, null, null, null, 'draft'),
  ('f7aa0000-0000-0000-0000-000000000003', 'f7000000-0000-0000-0000-00000000000a',
   'Attr active shoes', '', 5000, 'good', 'eu_shoe_38', 'c0000001-0000-4000-8000-000000000005', 'active'),
  ('f7aa0000-0000-0000-0000-000000000004', 'f7000000-0000-0000-0000-00000000000a',
   'Attr sold tops', '', 5000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'sold'),
  ('f7aa0000-0000-0000-0000-000000000005', 'f7000000-0000-0000-0000-00000000000b',
   'Attr B draft', '', null, null, null, 'c0000001-0000-4000-8000-000000000001', 'draft'),
  ('f7aa0000-0000-0000-0000-000000000006', 'f7000000-0000-0000-0000-00000000000a',
   'Attr active tops', '', 5000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('f7aa0000-0000-0000-0000-000000000007', 'f7000000-0000-0000-0000-00000000000a',
   'Attr reserved tops', '', 5000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'reserved'),
  ('f7aa0000-0000-0000-0000-000000000008', 'f7000000-0000-0000-0000-00000000000a',
   'Attr removed tops', '', 5000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'removed');

-- B's draft already carries a hoodie and a keyword, so the denied paths below
-- can prove nothing of B's was touched.
insert into public.listing_attribute_values (listing_id, term_id, kind, position)
values ('f7aa0000-0000-0000-0000-000000000005', 'a1000001-0000-4000-8000-000000000008', 'item_type', 0);
update public.listings set keywords = array['b keyword'] where id = 'f7aa0000-0000-0000-0000-000000000005';

-- Term ids used below (seeded literals from the taxonomy migration):
--   item types: t_shirt ...0001-...001, hoodie ...0001-...008, sneakers ...0001-...022
--   colors:     black ...0002-...001, white ...002, grey ...003, red ...012, navy ...007
--   style:      streetwear ...0003-...001
--   material:   cotton ...0004-...001, leather ...004
--   pattern:    solid ...0005-...001, camo ...009
--   fit:        regular ...0006-...002, oversized ...004

set local role authenticated;
set local request.jwt.claims = '{"sub":"f7000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 1. Allowed path: set, positions, keyword normalization, replace
-- ============================================================

select lives_ok(
  $$select public.set_listing_attributes(
      'f7aa0000-0000-0000-0000-000000000001',
      array['a1000001-0000-4000-8000-000000000008',  -- hoodie
            'a1000002-0000-4000-8000-000000000003',  -- grey (primary)
            'a1000002-0000-4000-8000-000000000001',  -- black
            'a1000004-0000-4000-8000-000000000001',  -- cotton
            'a1000003-0000-4000-8000-000000000001',  -- streetwear
            'a1000006-0000-4000-8000-000000000004']::uuid[],  -- oversized
      array['  Crewneck ', 'LOGO', 'crewneck', '', 'Zip   Up'])$$,
  'the owner can set attributes on their draft'
);

select is(
  (select count(*)::int from public.listing_attribute_values where listing_id = 'f7aa0000-0000-0000-0000-000000000001'),
  6,
  'all six values were stored'
);

select is(
  (select string_agg(t.slug, ',' order by v.position)
     from public.listing_attribute_values v
     join public.listing_attribute_terms t on t.id = v.term_id
    where v.listing_id = 'f7aa0000-0000-0000-0000-000000000001' and v.kind = 'color'),
  'grey,black',
  'colors keep the given order: the first one is the primary color'
);

select is(
  (select keywords from public.listings where id = 'f7aa0000-0000-0000-0000-000000000001'),
  array['crewneck', 'logo', 'zip up'],
  'keywords are trimmed, lowercased, space-collapsed, de-duplicated and emptied of blanks'
);

select lives_ok(
  $$select public.set_listing_attributes(
      'f7aa0000-0000-0000-0000-000000000001',
      array['a1000001-0000-4000-8000-000000000001', 'a1000002-0000-4000-8000-000000000002']::uuid[],
      '{}')$$,
  'a second call replaces the whole set'
);

select is(
  (select string_agg(t.slug, ',' order by t.kind)
     from public.listing_attribute_values v
     join public.listing_attribute_terms t on t.id = v.term_id
    where v.listing_id = 'f7aa0000-0000-0000-0000-000000000001'),
  'white,t_shirt',
  'only the new values remain after a replace'
);

select is(
  (select keywords from public.listings where id = 'f7aa0000-0000-0000-0000-000000000001'),
  '{}'::text[],
  'keywords were replaced with the empty list'
);

-- ============================================================
-- 2. Category rules: item-type compatibility and kind applicability
-- ============================================================

select throws_ok(
  $$select public.set_listing_attributes(
      'f7aa0000-0000-0000-0000-000000000003',
      array['a1000001-0000-4000-8000-000000000008']::uuid[], '{}')$$,
  '23514', null,
  'a hoodie is refused on a Women › Shoes listing'
);

select throws_ok(
  $$select public.set_listing_attributes(
      'f7aa0000-0000-0000-0000-000000000003',
      array['a1000006-0000-4000-8000-000000000002']::uuid[], '{}')$$,
  '23514', null,
  'fit is refused on a Shoes listing'
);

select lives_ok(
  $$select public.set_listing_attributes(
      'f7aa0000-0000-0000-0000-000000000003',
      array['a1000001-0000-4000-8000-000000000022',  -- sneakers
            'a1000002-0000-4000-8000-000000000001',  -- black
            'a1000004-0000-4000-8000-000000000004',  -- leather
            'a1000003-0000-4000-8000-000000000001',  -- streetwear
            'a1000005-0000-4000-8000-000000000001']::uuid[],  -- solid
      '{}')$$,
  'an ACTIVE shoes listing accepts sneakers plus color, material, style and pattern'
);

select is(
  (select count(*)::int from public.listing_attribute_values where listing_id = 'f7aa0000-0000-0000-0000-000000000003'),
  5,
  'the active listing stored all five values'
);

select lives_ok(
  $$select public.set_listing_attributes(
      'f7aa0000-0000-0000-0000-000000000002',
      array['a1000001-0000-4000-8000-000000000008',
            'a1000006-0000-4000-8000-000000000002',
            'a1000002-0000-4000-8000-000000000003']::uuid[], '{}')$$,
  'a draft with no category yet accepts any active term'
);

-- ============================================================
-- 3. Input validation (22023 from the RPC itself)
-- ============================================================

select throws_ok(
  $$select public.set_listing_attributes(
      'f7aa0000-0000-0000-0000-000000000001',
      array['a1000002-0000-4000-8000-000000000001', 'a1000002-0000-4000-8000-000000000002',
            'a1000002-0000-4000-8000-000000000003', 'a1000002-0000-4000-8000-000000000012']::uuid[], '{}')$$,
  '22023', null,
  'four colors exceed max_values (3)'
);

select throws_ok(
  $$select public.set_listing_attributes(
      'f7aa0000-0000-0000-0000-000000000001',
      array['a1000001-0000-4000-8000-000000000001', 'a1000001-0000-4000-8000-000000000008']::uuid[], '{}')$$,
  '22023', null,
  'two item types exceed max_values (1)'
);

select throws_ok(
  $$select public.set_listing_attributes(
      'f7aa0000-0000-0000-0000-000000000001',
      array['a1000002-0000-4000-8000-000000000001', 'a1000002-0000-4000-8000-000000000001']::uuid[], '{}')$$,
  '22023', null,
  'the same term twice is refused'
);

select throws_ok(
  $$select public.set_listing_attributes(
      'f7aa0000-0000-0000-0000-000000000001',
      array['00000000-0000-4000-8000-00000000dead']::uuid[], '{}')$$,
  '22023', null,
  'an unknown term id is refused'
);

select throws_ok(
  $$select public.set_listing_attributes(
      'f7aa0000-0000-0000-0000-000000000001',
      array[null]::uuid[], '{}')$$,
  '22023', null,
  'a null element is refused'
);

-- ============================================================
-- 4. Who and which listings
-- ============================================================

select throws_ok(
  $$select public.set_listing_attributes('f7aa0000-0000-0000-0000-000000000004', '{}', '{}')$$,
  'P0001', null,
  'a sold listing can no longer be edited'
);

select throws_ok(
  $$select public.set_listing_attributes('f7aa0000-0000-0000-0000-000000000005', '{}', '{}')$$,
  '42501', null,
  'a seller cannot edit someone else''s listing'
);

select throws_ok(
  $$select public.set_listing_attributes('00000000-0000-4000-8000-00000000dead', '{}', '{}')$$,
  'P0002', null,
  'a nonexistent listing raises not-found'
);

-- ============================================================
-- 5. Keywords (CHECK constraints, 23514)
-- ============================================================

select throws_ok(
  $$select public.set_listing_attributes('f7aa0000-0000-0000-0000-000000000001', '{}', array['x'])$$,
  '23514', null,
  'a one-character keyword is refused'
);

select throws_ok(
  $$select public.set_listing_attributes('f7aa0000-0000-0000-0000-000000000001', '{}', array['wow!!'])$$,
  '23514', null,
  'punctuation in a keyword is refused'
);

select throws_ok(
  $$select public.set_listing_attributes('f7aa0000-0000-0000-0000-000000000001', '{}',
      array['k01','k02','k03','k04','k05','k06','k07','k08','k09','k10','k11'])$$,
  '23514', null,
  'eleven keywords exceed the limit of ten'
);

select throws_ok(
  $$select public.set_listing_attributes('f7aa0000-0000-0000-0000-000000000001', '{}',
      array['abcdefghijklmnopqrstuvwxy'])$$,
  '23514', null,
  'a 25-character keyword is refused'
);

select lives_ok(
  $$select public.set_listing_attributes('f7aa0000-0000-0000-0000-000000000001',
      array['a1000001-0000-4000-8000-000000000001']::uuid[],
      array['טרנינג', 'מעיל גשם', 'zip-up'])$$,
  'Hebrew and hyphenated keywords are accepted'
);

select is(
  (select keywords from public.listings where id = 'f7aa0000-0000-0000-0000-000000000001'),
  array['טרנינג', 'מעיל גשם', 'zip-up'],
  'Hebrew keywords are stored as given'
);

-- ============================================================
-- 6. No direct client writes
-- ============================================================

select throws_ok(
  $$insert into public.listing_attribute_values (listing_id, term_id, kind, position)
    values ('f7aa0000-0000-0000-0000-000000000001', 'a1000002-0000-4000-8000-000000000001', 'color', 0)$$,
  '42501', null,
  'a client cannot INSERT attribute values directly'
);

select throws_ok(
  $$delete from public.listing_attribute_values where listing_id = 'f7aa0000-0000-0000-0000-000000000003'$$,
  '42501', null,
  'a client cannot DELETE attribute values directly'
);

select throws_ok(
  $$update public.listings set keywords = array['hack'] where id = 'f7aa0000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'a client cannot write listings.keywords directly (no column grant)'
);

-- ============================================================
-- 7. Category change prunes only what became invalid (decision 12)
-- ============================================================

select lives_ok(
  $$select public.set_listing_attributes(
      'f7aa0000-0000-0000-0000-000000000001',
      array['a1000001-0000-4000-8000-000000000008',  -- hoodie
            'a1000002-0000-4000-8000-000000000003',  -- grey
            'a1000004-0000-4000-8000-000000000001',  -- cotton
            'a1000003-0000-4000-8000-000000000001',  -- streetwear
            'a1000006-0000-4000-8000-000000000004']::uuid[], '{}')$$,
  'setup: hoodie, grey, cotton, streetwear and oversized on the Women › Tops draft'
);

-- Through the seller's own plain draft UPDATE, the same path the editor uses.
select lives_ok(
  $$update public.listings set category_id = 'c0000001-0000-4000-8000-000000000008'
     where id = 'f7aa0000-0000-0000-0000-000000000001'$$,
  'the seller moves the draft to Women › Activewear'
);

select is(
  (select count(*)::int from public.listing_attribute_values where listing_id = 'f7aa0000-0000-0000-0000-000000000001'),
  5,
  'everything is kept: a hoodie (and fit) is valid under both Tops and Activewear'
);

select lives_ok(
  $$update public.listings set category_id = 'c0000001-0000-4000-8000-000000000005'
     where id = 'f7aa0000-0000-0000-0000-000000000001'$$,
  'the seller moves the draft to Women › Shoes'
);

select is(
  (select string_agg(kind, ',' order by kind) from public.listing_attribute_values
    where listing_id = 'f7aa0000-0000-0000-0000-000000000001'),
  'color,material,style',
  'item type and fit were pruned; color, material and style still apply to shoes and were kept'
);

select lives_ok(
  $$update public.listings set category_id = 'c0000004-0000-4000-8000-000000000001'
     where id = 'f7aa0000-0000-0000-0000-000000000001'$$,
  'the seller moves the draft to Home › Furniture'
);

select is(
  (select count(*)::int from public.listing_attribute_values where listing_id = 'f7aa0000-0000-0000-0000-000000000001'),
  0,
  'no fashion attribute applies to Furniture, so all were pruned'
);

select lives_ok(
  $$update public.listings set category_id = 'c0000001-0000-4000-8000-000000000001'
     where id = 'f7aa0000-0000-0000-0000-000000000002'$$,
  'the uncategorized draft gets its first category, Women › Tops'
);

select is(
  (select count(*)::int from public.listing_attribute_values where listing_id = 'f7aa0000-0000-0000-0000-000000000002'),
  3,
  'hoodie, regular fit and grey are all valid under Tops and were kept'
);

-- ============================================================
-- 8. Retired terms
-- ============================================================
-- Privileged setup: L6 already carries `camo`, then camo is retired.
reset role;

insert into public.listing_attribute_values (listing_id, term_id, kind, position)
values ('f7aa0000-0000-0000-0000-000000000006', 'a1000005-0000-4000-8000-000000000009', 'pattern', 0);

update public.listing_attribute_terms set retired_at = now()
 where id = 'a1000005-0000-4000-8000-000000000009';

set local role authenticated;
set local request.jwt.claims = '{"sub":"f7000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select lives_ok(
  $$select public.set_listing_attributes(
      'f7aa0000-0000-0000-0000-000000000006',
      array['a1000005-0000-4000-8000-000000000009', 'a1000002-0000-4000-8000-000000000001']::uuid[], '{}')$$,
  'a listing that already has a retired term can keep it while editing'
);

select throws_ok(
  $$select public.set_listing_attributes(
      'f7aa0000-0000-0000-0000-000000000003',
      array['a1000005-0000-4000-8000-000000000009']::uuid[], '{}')$$,
  '22023', null,
  'a retired term cannot be newly added to another listing'
);

-- ============================================================
-- 8b. More statuses, input caps, keyword normalization
-- ============================================================

select throws_ok(
  $$select public.set_listing_attributes('f7aa0000-0000-0000-0000-000000000008', '{}', '{}')$$,
  'P0001', null,
  'a removed listing can no longer be edited'
);

select lives_ok(
  $$select public.set_listing_attributes(
      'f7aa0000-0000-0000-0000-000000000007',
      array['a1000001-0000-4000-8000-000000000008',  -- hoodie
            'a1000002-0000-4000-8000-000000000003',  -- grey
            'a1000006-0000-4000-8000-000000000004']::uuid[], '{}')$$,
  'a RESERVED listing can still be edited'
);

select throws_ok(
  $$select public.set_listing_attributes('f7aa0000-0000-0000-0000-000000000001',
      array_fill('a1000002-0000-4000-8000-000000000001'::uuid, array[51]), '{}')$$,
  '22023', null,
  'more than 50 term ids is refused before any lookup'
);

select throws_ok(
  $$select public.set_listing_attributes('f7aa0000-0000-0000-0000-000000000001', '{}',
      array_fill('ab'::text, array[51]))$$,
  '22023', null,
  'more than 50 raw keywords is refused before normalization'
);

select throws_ok(
  $$select public.set_listing_attributes('f7aa0000-0000-0000-0000-000000000001', '{}',
      array[repeat('a', 201)])$$,
  '22023', null,
  'a keyword over 200 bytes is refused before normalization'
);

select lives_ok(
  $$select public.set_listing_attributes('f7aa0000-0000-0000-0000-000000000001', '{}',
      array['   ', null, ''])$$,
  'blank and NULL keywords are accepted as input'
);

select is(
  (select keywords from public.listings where id = 'f7aa0000-0000-0000-0000-000000000001'),
  '{}'::text[],
  'blank and NULL keywords normalize to the empty list'
);

-- ============================================================
-- 8c. Other sellers' rows survive denied calls and direct UPDATEs
-- ============================================================

select throws_ok(
  $$select public.set_listing_attributes('f7aa0000-0000-0000-0000-000000000005',
      array['a1000002-0000-4000-8000-000000000001']::uuid[], array['hijack'])$$,
  '42501', null,
  'A cannot set attributes on B''s draft'
);

-- RLS limits a direct UPDATE to the caller's own drafts, so this matches no
-- row and the prune trigger never fires for B's listing.
select is_empty(
  $$update public.listings set category_id = 'c0000001-0000-4000-8000-000000000005'
     where id = 'f7aa0000-0000-0000-0000-000000000005' returning id$$,
  'A''s direct category UPDATE on B''s draft matches no row'
);

select lives_ok(
  $$update public.listings set title = 'Attr draft tops renamed'
     where id = 'f7aa0000-0000-0000-0000-000000000001'$$,
  'a plain draft UPDATE still works (listings_keywords_valid stays executable by authenticated)'
);

-- ============================================================
-- 8d. Pruning through update_listing_details and via a NULL category
-- ============================================================

select lives_ok(
  $$select public.update_listing_details(
      'f7aa0000-0000-0000-0000-000000000007', 'Attr reserved tops', '', 5000,
      'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000005')$$,
  'the seller moves the reserved listing to Women › Shoes through update_listing_details'
);

select is(
  (select string_agg(kind, ',' order by kind) from public.listing_attribute_values
    where listing_id = 'f7aa0000-0000-0000-0000-000000000007'),
  'color',
  'update_listing_details pruned the hoodie and the fit, and kept the color'
);

select lives_ok(
  $$update public.listings set category_id = null where id = 'f7aa0000-0000-0000-0000-000000000002'$$,
  'the seller clears the draft''s category'
);

select is(
  (select count(*)::int from public.listing_attribute_values where listing_id = 'f7aa0000-0000-0000-0000-000000000002'),
  3,
  'clearing the category keeps every value'
);

select lives_ok(
  $$update public.listings set category_id = 'c0000001-0000-4000-8000-000000000005'
     where id = 'f7aa0000-0000-0000-0000-000000000002'$$,
  'the seller then picks Women › Shoes'
);

select is(
  (select string_agg(kind, ',' order by kind) from public.listing_attribute_values
    where listing_id = 'f7aa0000-0000-0000-0000-000000000002'),
  'color',
  'NULL -> Shoes prunes what doesn''t fit shoes'
);

select throws_ok(
  $$select public.listing_attribute_value_applies('color', 'a1000002-0000-4000-8000-000000000001',
      'c0000001-0000-4000-8000-000000000001')$$,
  '42501', null,
  'listing_attribute_value_applies is not client-callable'
);

-- ============================================================
-- 9. Read visibility follows the listing
-- ============================================================

set local request.jwt.claims = '{"sub":"f7000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select is(
  (select count(*)::int from public.listing_attribute_values where listing_id = 'f7aa0000-0000-0000-0000-000000000006'),
  2,
  'another signed-in user can read the attributes of an active listing'
);

select is(
  (select count(*)::int from public.listing_attribute_values where listing_id = 'f7aa0000-0000-0000-0000-000000000002'),
  0,
  'another user cannot read the attributes of someone else''s draft'
);

select is_empty(
  $$select keywords from public.listings where id = 'f7aa0000-0000-0000-0000-000000000001'$$,
  'another user cannot read the keywords of someone else''s draft'
);

select is(
  (select keywords from public.listings where id = 'f7aa0000-0000-0000-0000-000000000005'),
  array['b keyword'],
  'B''s keywords survived A''s denied call'
);

select is(
  (select string_agg(t.slug, ',') from public.listing_attribute_values v
     join public.listing_attribute_terms t on t.id = v.term_id
    where v.listing_id = 'f7aa0000-0000-0000-0000-000000000005'),
  'hoodie',
  'B''s attribute values survived A''s denied call and A''s direct category UPDATE'
);

set local request.jwt.claims = '{"role":"authenticated"}';

select throws_ok(
  $$select public.set_listing_attributes('f7aa0000-0000-0000-0000-000000000001', '{}', '{}')$$,
  '42501', null,
  'a call with no user in the token is refused'
);

set local role anon;

select throws_ok(
  $$select count(*) from public.listing_attribute_values$$,
  '42501', null,
  'anon cannot read attribute values'
);

select throws_ok(
  $$select public.set_listing_attributes('f7aa0000-0000-0000-0000-000000000001', '{}', '{}')$$,
  '42501', null,
  'anon cannot execute set_listing_attributes'
);

select throws_ok(
  $$select public.listing_keywords_valid(array['ab'])$$,
  '42501', null,
  'anon cannot execute listing_keywords_valid'
);

-- ============================================================
-- 10. Table-level backstops (privileged writes bypass the RPC)
-- ============================================================

reset role;

select throws_ok(
  $$insert into public.listing_attribute_values (listing_id, term_id, kind, position) values
      ('f7aa0000-0000-0000-0000-000000000006', 'a1000002-0000-4000-8000-000000000002', 'color', 1),
      ('f7aa0000-0000-0000-0000-000000000006', 'a1000002-0000-4000-8000-000000000003', 'color', 2),
      ('f7aa0000-0000-0000-0000-000000000006', 'a1000002-0000-4000-8000-000000000012', 'color', 3)$$,
  '23514', null,
  'the max_values trigger refuses a fourth color even when the RPC is bypassed'
);

select throws_ok(
  $$insert into public.listing_attribute_values (listing_id, term_id, kind, position)
    values ('f7aa0000-0000-0000-0000-000000000006', 'a1000001-0000-4000-8000-000000000008', 'color', 2)$$,
  '23503', null,
  'an item-type term filed as a color is refused by the composite foreign key'
);

select throws_ok(
  $$insert into public.listing_attribute_values (listing_id, term_id, kind, position)
    values ('f7aa0000-0000-0000-0000-000000000003', 'a1000001-0000-4000-8000-000000000008', 'item_type', 0)$$,
  '23514', null,
  'the validate trigger refuses a hoodie on a shoes listing even when the RPC is bypassed'
);

select * from finish();

rollback;
