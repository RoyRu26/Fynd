-- pgTAP tests for the listing attribute taxonomy (AI listing metadata plan,
-- Phase 1a): the seeded vocabularies, kind applicability, the item type ↔
-- category compatibility mapping, the leaf-only guard, and access rules.
-- Attribute values on listings and set_listing_attributes are covered in
-- listing_attributes.sql.
--
-- Run with: pnpm exec supabase test db --local
create extension if not exists pgtap with schema extensions;

begin;

select plan(56);

-- ============================================================
-- 1. Seed shape (Phase 0 approved values)
-- ============================================================

select is((select count(*)::int from public.listing_attribute_kinds), 6, 'there are exactly 6 attribute kinds');

select is(
  (select string_agg(kind || ':' || max_values, ',' order by position) from public.listing_attribute_kinds),
  'item_type:1,color:3,style:3,material:2,pattern:1,fit:1',
  'kinds are in display order with the approved max_values'
);

select is((select count(*)::int from public.listing_attribute_terms), 80, 'there are 80 terms in total');
select is((select count(*)::int from public.listing_attribute_terms where kind = 'item_type'), 32, '32 item types');
select is((select count(*)::int from public.listing_attribute_terms where kind = 'color'), 18, '18 colors');
select is((select count(*)::int from public.listing_attribute_terms where kind = 'style'), 9, '9 styles');
select is((select count(*)::int from public.listing_attribute_terms where kind = 'material'), 8, '8 materials');
select is((select count(*)::int from public.listing_attribute_terms where kind = 'pattern'), 9, '9 patterns');
select is((select count(*)::int from public.listing_attribute_terms where kind = 'fit'), 4, '4 fits');

select is((select count(*)::int from public.listing_attribute_terms where retired_at is not null), 0, 'no term starts retired');

-- Phase 0 changes, asserted explicitly so a later edit can't quietly undo them.
select ok(not exists (select 1 from public.listing_attribute_terms where slug = 'other'), '`other` was dropped');
select ok(not exists (select 1 from public.listing_attribute_terms where slug = 'formal_shoes'), '`formal_shoes` does not exist');
select ok(not exists (select 1 from public.listing_attribute_terms where kind = 'style' and slug = 'casual'), '`casual` is not a style');
select is(
  (select label from public.listing_attribute_terms where kind = 'item_type' and slug = 'dress_shoes'),
  'Dress shoes',
  '`dress_shoes` exists with label "Dress shoes"'
);
select ok(exists (select 1 from public.listing_attribute_terms where kind = 'item_type' and slug = 'loafers'), '`loafers` exists');
select ok(exists (select 1 from public.listing_attribute_terms where kind = 'item_type' and slug = 'joggers'), '`joggers` exists');

-- ============================================================
-- 2. Kind applicability (leaf-level)
-- ============================================================

select is((select count(*)::int from public.listing_attribute_kind_categories), 78, '78 applicability rows');

select is(
  (select count(*)::int from public.listing_attribute_kind_categories where kind = 'color'),
  17,
  'color applies to all 17 fashion leaves'
);

select is(
  (select string_agg(kind || ':' || n, ',' order by kind) from (
     select kind, count(*) n from public.listing_attribute_kind_categories group by kind
   ) s),
  'color:17,fit:10,material:17,pattern:17,style:17',
  'color/material/pattern/style apply to 17 leaves each, fit to 10'
);

select ok(
  not exists (
    select 1 from public.listing_attribute_kind_categories kc
      join public.categories c on c.id = kc.category_id
     where kc.kind = 'fit' and c.name in ('Shoes', 'Bags', 'Accessories')
  ),
  'fit never applies to a Shoes, Bags or Accessories leaf'
);

select ok(
  exists (
    select 1 from public.listing_attribute_kind_categories
     where kind = 'material' and category_id = 'c0000001-0000-4000-8000-000000000005'
  ),
  'material applies to Women › Shoes (leather shoes are expressible)'
);

select ok(
  not exists (
    select 1 from public.listing_attribute_kind_categories kc
      join public.categories c on c.id = kc.category_id
     where c.parent_id in ('c0000000-0000-4000-8000-000000000004',
                           'c0000000-0000-4000-8000-000000000005',
                           'c0000000-0000-4000-8000-000000000006')
  ),
  'no attribute kind applies to Home, Electronics or Other'
);

select ok(
  not exists (select 1 from public.listing_attribute_kind_categories where kind = 'item_type'),
  'item_type has no kind-level applicability rows (it uses the mapping table)'
);

-- ============================================================
-- 3. Item type ↔ category mapping
-- ============================================================

select is((select count(*)::int from public.listing_item_type_categories), 103, '103 compatibility rows');

select is(
  (select count(*)::int from public.listing_attribute_terms t
    where t.kind = 'item_type'
      and not exists (select 1 from public.listing_item_type_categories m where m.term_id = t.id)),
  0,
  'every item type is valid under at least one category'
);

select is(
  (select string_agg(t.slug, ',' order by t.position)
     from public.listing_item_type_categories m
     join public.listing_attribute_terms t on t.id = m.term_id
    where m.category_id = 'c0000001-0000-4000-8000-000000000005'),
  'sneakers,boots,sandals,heels,flats,loafers,dress_shoes',
  'Women › Shoes allows exactly the approved 7 types'
);

select is(
  (select string_agg(t.slug, ',' order by t.position)
     from public.listing_item_type_categories m
     join public.listing_attribute_terms t on t.id = m.term_id
    where m.category_id = 'c0000002-0000-4000-8000-000000000004'),
  'sneakers,boots,sandals,loafers,dress_shoes',
  'Men › Shoes allows exactly the approved 5 types (no flats)'
);

select is(
  (select string_agg(t.slug, ',' order by t.position)
     from public.listing_item_type_categories m
     join public.listing_attribute_terms t on t.id = m.term_id
    where m.category_id = 'c0000003-0000-4000-8000-000000000002'),
  'sneakers,boots,sandals,flats',
  'Kids & Baby › Shoes allows exactly sneakers, boots, sandals and flats'
);

select is(
  (select count(*)::int
     from public.listing_item_type_categories m
     join public.listing_attribute_terms t on t.id = m.term_id
    where t.slug = 'joggers'),
  5,
  'joggers is valid under exactly 5 leaves'
);

select ok(
  exists (
    select 1 from public.listing_item_type_categories m
      join public.listing_attribute_terms t on t.id = m.term_id
     where t.slug = 'leggings' and m.category_id = 'c0000002-0000-4000-8000-000000000006'
  ),
  'leggings is valid under Men › Activewear'
);

select ok(
  not exists (
    select 1 from public.listing_item_type_categories m
      join public.listing_attribute_terms t on t.id = m.term_id
      join public.categories c on c.id = m.category_id
     where t.slug in ('t_shirt', 'shirt', 'polo', 'blouse', 'tank_top', 'sweater', 'cardigan',
                      'hoodie', 'sweatshirt', 'jacket', 'coat', 'blazer', 'vest', 'jeans',
                      'trousers', 'joggers', 'shorts', 'skirt', 'leggings', 'dress', 'jumpsuit')
       and c.name in ('Shoes', 'Bags', 'Accessories')
  ),
  'no clothing item type maps to a Shoes, Bags or Accessories leaf'
);

select ok(
  not exists (
    select 1 from public.listing_item_type_categories m
      join public.listing_attribute_terms t on t.id = m.term_id
      join public.categories c on c.id = m.category_id
     where t.slug in ('sneakers', 'boots', 'sandals', 'heels', 'flats', 'loafers', 'dress_shoes')
       and c.name <> 'Shoes'
  ),
  'shoe item types map only to Shoes leaves'
);

select ok(
  not exists (
    select 1 from public.listing_item_type_categories m
      join public.listing_attribute_terms t on t.id = m.term_id
     where t.slug in ('blazer', 'heels', 'dress_shoes')
       and m.category_id in ('c0000003-0000-4000-8000-000000000001',
                             'c0000003-0000-4000-8000-000000000002',
                             'c0000003-0000-4000-8000-000000000005')
  ),
  'no blazer, heels or dress_shoes under any Kids leaf'
);

select ok(
  not exists (
    select 1 from public.listing_item_type_categories m
      join public.categories c on c.id = m.category_id
     where c.parent_id in ('c0000000-0000-4000-8000-000000000004',
                           'c0000000-0000-4000-8000-000000000005',
                           'c0000000-0000-4000-8000-000000000006')
        or m.category_id in ('c0000003-0000-4000-8000-000000000003',
                             'c0000003-0000-4000-8000-000000000004')
  ),
  'no item types under Home, Electronics, Other, Kids › Toys or Kids › Baby gear'
);

select ok(
  not exists (
    select 1 from public.listing_item_type_categories m
      join public.listing_attribute_terms t on t.id = m.term_id
      join public.categories c on c.id = m.category_id
     where t.slug = 'vest' and c.name not in ('Outerwear', 'Clothing')
  ),
  'vest maps only to Outerwear (and Kids › Clothing), never Tops'
);

select ok(
  (select bool_and(c.parent_id is not null)
     from public.listing_item_type_categories m
     join public.categories c on c.id = m.category_id),
  'every mapped category is a leaf'
);

-- ============================================================
-- 4. Structural guards (privileged writes, as in a future migration)
-- ============================================================

select throws_ok(
  $$insert into public.listing_item_type_categories (term_id, category_id)
    values ('a1000001-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000001')$$,
  '23514', null,
  'the compatibility table rejects a top-level group (leaf-only guard)'
);

select throws_ok(
  $$insert into public.listing_attribute_kind_categories (kind, category_id)
    values ('color', 'c0000000-0000-4000-8000-000000000002')$$,
  '23514', null,
  'the applicability table rejects a top-level group (leaf-only guard)'
);

select throws_ok(
  $$insert into public.listing_item_type_categories (term_id, category_id)
    values ('a1000002-0000-4000-8000-000000000001', 'c0000001-0000-4000-8000-000000000001')$$,
  '23503', null,
  'a color term cannot be mapped as an item type (composite foreign key)'
);

select throws_ok(
  $$insert into public.listing_attribute_kind_categories (kind, category_id)
    values ('item_type', 'c0000001-0000-4000-8000-000000000001')$$,
  '23514', null,
  'item_type cannot get kind-level applicability rows'
);

select throws_ok(
  $$insert into public.listing_attribute_terms (kind, slug, label)
    values ('color', 'black', 'Black again')$$,
  '23505', null,
  'a slug is unique within its kind'
);

select throws_ok(
  $$insert into public.listing_attribute_terms (kind, slug, label)
    values ('color', 'Light-Blue', 'Bad slug')$$,
  '23514', null,
  'slugs must be lowercase snake_case'
);

-- ============================================================
-- 5. Access: authenticated SELECT only, anon nothing, no client writes
-- ============================================================

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('f6000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-taxonomy-a@test.dev', 'x', now(), now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"f6000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is((select count(*)::int from public.listing_attribute_kinds), 6, 'authenticated can read kinds');
select is((select count(*)::int from public.listing_attribute_terms), 80, 'authenticated can read terms');
select is((select count(*)::int from public.listing_attribute_kind_categories), 78, 'authenticated can read applicability');
select is((select count(*)::int from public.listing_item_type_categories), 103, 'authenticated can read compatibility');

select throws_ok(
  $$insert into public.listing_attribute_terms (kind, slug, label) values ('color', 'teal', 'Teal')$$,
  '42501', null,
  'authenticated cannot INSERT terms'
);
select throws_ok(
  $$update public.listing_attribute_terms set label = 'Hacked' where slug = 'black'$$,
  '42501', null,
  'authenticated cannot UPDATE terms'
);
select throws_ok(
  $$delete from public.listing_attribute_terms where slug = 'black'$$,
  '42501', null,
  'authenticated cannot DELETE terms'
);
select throws_ok(
  $$insert into public.listing_attribute_kinds (kind, label, max_values) values ('season', 'Season', 1)$$,
  '42501', null,
  'authenticated cannot INSERT kinds'
);
select throws_ok(
  $$insert into public.listing_item_type_categories (term_id, category_id)
    values ('a1000001-0000-4000-8000-000000000008', 'c0000001-0000-4000-8000-000000000005')$$,
  '42501', null,
  'authenticated cannot INSERT compatibility rows'
);
select throws_ok(
  $$delete from public.listing_attribute_kind_categories where kind = 'fit'$$,
  '42501', null,
  'authenticated cannot DELETE applicability rows'
);

set local role anon;

select throws_ok(
  $$select count(*) from public.listing_attribute_kinds$$,
  '42501', null,
  'anon cannot read kinds'
);
select throws_ok(
  $$select count(*) from public.listing_attribute_terms$$,
  '42501', null,
  'anon cannot read terms'
);
select throws_ok(
  $$select count(*) from public.listing_attribute_kind_categories$$,
  '42501', null,
  'anon cannot read applicability'
);
select throws_ok(
  $$select count(*) from public.listing_item_type_categories$$,
  '42501', null,
  'anon cannot read compatibility'
);

select * from finish();

rollback;
