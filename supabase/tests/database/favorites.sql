-- pgTAP tests for the favorites table.
--
-- Run with: pnpm exec supabase test db --local
--
-- Same conventions as the other suites: 4-arg throws_ok(sql, sqlstate,
-- null, description) -- the 3-arg form's third argument is the expected
-- MESSAGE, not a description -- and SQLSTATE assertions only, never message
-- text. An RLS USING denial matches zero rows silently rather than raising,
-- so those cases are asserted by row survival, checked under `reset role`
-- where the denied caller could not see the answer themselves.
create extension if not exists pgtap with schema extensions;

begin;

select plan(18);

-- ============================================================
-- FIXTURES
-- ============================================================
-- A is the seller. B and C are two different buyers, so "scoped to the
-- caller" can be tested from both sides rather than assumed.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('f4000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-fav-a@test.dev', 'x', now(), now()),
  ('f4000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-fav-b@test.dev', 'x', now(), now()),
  ('f4000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-fav-c@test.dev', 'x', now(), now());

-- Every active row carries a category_id too: listings_complete_when_not_draft
-- requires it. 'c0000001-0000-4000-8000-000000000001' is the seeded
-- Women > Tops leaf (20261018100200_categories.sql).
insert into public.listings
  (id, seller_id, title, description, price_amount, condition, size, category_id, status)
values
  ('dddd1000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-00000000000a',
   'A active listing', 'FAV_ACTIVE', 1000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('dddd1000-0000-0000-0000-000000000002', 'f4000000-0000-0000-0000-00000000000a',
   'A second active',  'FAV_ACTIVE_2', 2000, 'good', 'eu_shoe_42', 'c0000001-0000-4000-8000-000000000001', 'active'),
  -- A draft, which must never be favoritable by anyone -- including, below,
  -- its own owner.
  ('dddd1000-0000-0000-0000-000000000003', 'f4000000-0000-0000-0000-00000000000a',
   'A draft', 'FAV_DRAFT', 3000, 'good', null, null, 'draft');

-- Act as B from here.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f4000000-0000-0000-0000-00000000000b","role":"authenticated"}';

-- ============================================================
-- 1. Favoriting an active listing
-- ============================================================

select lives_ok(
  $$insert into public.favorites (user_id, listing_id) values ('f4000000-0000-0000-0000-00000000000b', 'dddd1000-0000-0000-0000-000000000001')$$,
  'a buyer can favorite an active listing'
);

select is(
  (select count(*)::int from public.favorites
    where user_id = 'f4000000-0000-0000-0000-00000000000b'),
  1,
  'exactly one favorite row was written'
);

-- The PK is (user_id, listing_id), so a double-tap race resolves to a
-- conflict rather than two rows. The client sends this through an
-- idempotent toggle, but the table is what guarantees it.
select throws_ok(
  $$insert into public.favorites (user_id, listing_id) values ('f4000000-0000-0000-0000-00000000000b', 'dddd1000-0000-0000-0000-000000000001')$$,
  '23505', null,
  'favoriting the same listing twice violates the composite primary key'
);

-- ============================================================
-- 2. What cannot be favorited
-- ============================================================

select throws_ok(
  $$insert into public.favorites (user_id, listing_id) values ('f4000000-0000-0000-0000-00000000000b', 'dddd1000-0000-0000-0000-000000000003')$$,
  '42501', null,
  'a DRAFT cannot be favorited -- the insert policy requires an active listing'
);

select throws_ok(
  $$insert into public.favorites (user_id, listing_id) values ('f4000000-0000-0000-0000-00000000000c', 'dddd1000-0000-0000-0000-000000000002')$$,
  '42501', null,
  'forging another user''s user_id is rejected -- RLS pins it to auth.uid()'
);

-- 42501, not the foreign key's 23503: the RLS WITH CHECK is evaluated
-- before the FK, and its `exists (... and status = 'active')` subquery
-- finds nothing for an id that does not exist. The row is refused as a
-- policy violation and never reaches the constraint -- a stricter outcome
-- than the FK, and it means an invented id leaks nothing about whether
-- that listing exists.
select throws_ok(
  $$insert into public.favorites (user_id, listing_id) values ('f4000000-0000-0000-0000-00000000000b', 'dddd1000-0000-0000-0000-00000000dead')$$,
  '42501', null,
  'favoriting a listing id that does not exist is refused by the policy, before the foreign key is even consulted'
);

-- created_at is absent from the column allowlist, so a client cannot forge
-- when something was saved.
select throws_ok(
  $$insert into public.favorites (user_id, listing_id, created_at) values ('f4000000-0000-0000-0000-00000000000b', 'dddd1000-0000-0000-0000-000000000002', now())$$,
  '42501', null,
  'created_at is not client-writable -- it is server-controlled'
);

-- A favorite is inserted or deleted, never edited.
select throws_ok(
  $$update public.favorites set listing_id = 'dddd1000-0000-0000-0000-000000000002' where true$$,
  '42501', null,
  'favorites cannot be updated at all -- there is no UPDATE grant'
);

-- ============================================================
-- 3. Even the seller cannot favorite their own draft
-- ============================================================
-- The insert policy keys on status, not ownership, so owning the row is no
-- exemption. Worth asserting separately: A CAN see this draft (it is
-- theirs), so the denial comes from the status check rather than from the
-- listing being invisible.

set local request.jwt.claims = '{"sub":"f4000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select ok(
  exists(select 1 from public.listings where id = 'dddd1000-0000-0000-0000-000000000003'),
  'sanity: the seller can see their own draft, so the next denial is about status'
);

select throws_ok(
  $$insert into public.favorites (user_id, listing_id) values ('f4000000-0000-0000-0000-00000000000a', 'dddd1000-0000-0000-0000-000000000003')$$,
  '42501', null,
  'a seller cannot favorite their own draft either -- owning it is not an exemption'
);

-- ============================================================
-- 4. Reads are scoped to the caller
-- ============================================================

select is(
  (select count(*)::int from public.favorites),
  0,
  'another user sees none of B''s favorites'
);

set local request.jwt.claims = '{"sub":"f4000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select is(
  (select count(*)::int from public.favorites),
  1,
  'B sees their own favorite'
);

-- ============================================================
-- 5. Unfavoriting
-- ============================================================
-- C attempts to delete B's favorite. An RLS USING denial matches zero rows
-- silently, so this is asserted by survival under `reset role` -- C cannot
-- see the row either way, which would make a same-session check meaningless.

set local request.jwt.claims = '{"sub":"f4000000-0000-0000-0000-00000000000c","role":"authenticated"}';

delete from public.favorites where listing_id = 'dddd1000-0000-0000-0000-000000000001';

reset role;
select ok(
  exists(select 1 from public.favorites
          where user_id = 'f4000000-0000-0000-0000-00000000000b'
            and listing_id = 'dddd1000-0000-0000-0000-000000000001'),
  'another user deleting B''s favorite has no effect'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f4000000-0000-0000-0000-00000000000b","role":"authenticated"}';

delete from public.favorites where listing_id = 'dddd1000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.favorites),
  0,
  'B can remove their own favorite'
);

-- Unfavoriting must keep working after a listing leaves 'active', or a
-- favorite could be trapped on a sold item. The DELETE policy deliberately
-- does not mirror the insert policy's status check.
insert into public.favorites (user_id, listing_id)
values ('f4000000-0000-0000-0000-00000000000b', 'dddd1000-0000-0000-0000-000000000002');

reset role;
update public.listings set status = 'sold' where id = 'dddd1000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"f4000000-0000-0000-0000-00000000000b","role":"authenticated"}';

delete from public.favorites where listing_id = 'dddd1000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.favorites),
  0,
  'a favorite on a no-longer-active listing can still be removed -- never trapped'
);

-- ============================================================
-- 6. Cascade and anon
-- ============================================================

reset role;
insert into public.favorites (user_id, listing_id)
values ('f4000000-0000-0000-0000-00000000000b', 'dddd1000-0000-0000-0000-000000000001');

delete from public.listings where id = 'dddd1000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.favorites
    where listing_id = 'dddd1000-0000-0000-0000-000000000001'),
  0,
  'deleting a listing cascades its favorites away, leaving no dangling rows'
);

set local role anon;

select throws_ok(
  $$insert into public.favorites (user_id, listing_id) values ('f4000000-0000-0000-0000-00000000000b', 'dddd1000-0000-0000-0000-000000000002')$$,
  '42501', null,
  'anon cannot favorite anything'
);

-- Stronger than "sees no rows": anon holds no table privilege whatsoever,
-- so the read is refused outright rather than silently returning empty.
select throws_ok(
  $$select count(*) from public.favorites$$,
  '42501', null,
  'anon cannot read favorites at all -- no grant, so not even an empty result'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f4000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select * from finish();

rollback;
