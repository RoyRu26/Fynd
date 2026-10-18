-- pgTAP database tests for ROADMAP 2.1 "Categories" -- the seeded taxonomy
-- table itself. Coverage of listings.category_id (the FK, the completeness
-- constraint, publish_listing, update_listing_details) lives in
-- listings.sql alongside the rest of that table's invariants.
--
-- Run with: pnpm exec supabase test db --local
create extension if not exists pgtap with schema extensions;

begin;

select plan(16);

-- ============================================================
-- 1. Seed shape -- spot-check a few rows rather than every leaf
-- ============================================================

select is(
  (select count(*)::int from public.categories where parent_id is null),
  6,
  'there are exactly 6 top-level categories'
);

select is(
  (select count(*)::int from public.categories),
  41,
  'there are 41 categories in total -- 6 top-level groups plus 35 leaves'
);

select is(
  (select count(*)::int from public.categories
    where parent_id = 'c0000000-0000-4000-8000-000000000001'),
  8,
  'Women has exactly 8 children'
);

select is(
  (select string_agg(name, ',' order by position) from public.categories
    where parent_id = 'c0000000-0000-4000-8000-000000000001'),
  'Tops,Dresses,Bottoms,Outerwear,Shoes,Bags,Accessories,Activewear',
  'Women''s children have the right names in the right order'
);

select is(
  (select count(*)::int from public.categories
    where parent_id = 'c0000000-0000-4000-8000-000000000002'),
  6,
  'Men has exactly 6 children'
);

select is(
  (select count(*)::int from public.categories
    where parent_id = 'c0000000-0000-4000-8000-000000000005'),
  6,
  'Electronics has exactly 6 children'
);

select is(
  (select name from public.categories where id = 'c0000000-0000-4000-8000-000000000006'),
  'Other',
  'the sixth top-level row is named Other'
);

-- A leaf's parent_id resolves back to the correct top-level row.
select is(
  (select p.name from public.categories c
     join public.categories p on p.id = c.parent_id
    where c.id = 'c0000001-0000-4000-8000-000000000005'),
  'Women',
  'Women > Shoes resolves its parent_id back to Women'
);

select is(
  (select c.name from public.categories c where c.id = 'c0000001-0000-4000-8000-000000000005'),
  'Shoes',
  'c0000001-...-005 is indeed named Shoes'
);

-- categories_top_level_name_unique / categories_parent_name_unique: not
-- directly exercised since there is no client write path, but a sanity
-- check that no sibling name collides within one parent.
select is(
  (select count(*)::int from (
     select parent_id, name, count(*) c from public.categories
      group by parent_id, name having count(*) > 1
   ) dup),
  0,
  'no two siblings (same parent_id, including top-level NULL) share a name'
);

-- ============================================================
-- 2. RLS -- anon and authenticated can both SELECT
-- ============================================================

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('f3000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-categories-a@test.dev', 'x', now(), now());

set local role anon;

select is(
  (select count(*)::int from public.categories),
  41,
  'anon can select every category row'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f3000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is(
  (select count(*)::int from public.categories),
  41,
  'authenticated can select every category row'
);

-- ============================================================
-- 3. No client write path at all
-- ============================================================
-- There is no grant to any client role, so every write is a privilege
-- denial (42501), not an RLS/constraint rejection. Confirmed empirically
-- (not assumed) that the missing grant surfaces as 42501.

select throws_ok(
  $$insert into public.categories (name) values ('Hacked')$$,
  '42501', null,
  'authenticated cannot INSERT into categories -- no grant exists'
);

select throws_ok(
  $$update public.categories set name = 'Hacked' where id = 'c0000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'authenticated cannot UPDATE categories -- no grant exists'
);

select throws_ok(
  $$delete from public.categories where id = 'c0000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'authenticated cannot DELETE from categories -- no grant exists'
);

set local role anon;

select throws_ok(
  $$insert into public.categories (name) values ('Hacked')$$,
  '42501', null,
  'anon cannot INSERT into categories either'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f3000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select * from finish();

rollback;
