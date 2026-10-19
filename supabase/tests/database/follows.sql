-- pgTAP tests for the follows table.
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

select plan(16);

-- ============================================================
-- FIXTURES
-- ============================================================
-- A, B, C are three distinct users so "forging another user's follower_id"
-- and "a third, unrelated party can still read" can both be tested from a
-- caller that is neither side of the edge under test. D and E are a
-- separate pair, kept untouched by everything above, so the cascade test's
-- row counts can't be confused by follow edges created earlier in this
-- file.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('f7000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-follow-a@test.dev', 'x', now(), now()),
  ('f7000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-follow-b@test.dev', 'x', now(), now()),
  ('f7000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-follow-c@test.dev', 'x', now(), now()),
  ('f7000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-follow-d@test.dev', 'x', now(), now()),
  ('f7000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-follow-e@test.dev', 'x', now(), now());

-- Act as A from here.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f7000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 1. Following
-- ============================================================

select lives_ok(
  $$insert into public.follows (follower_id, followed_id) values ('f7000000-0000-0000-0000-00000000000a', 'f7000000-0000-0000-0000-00000000000b')$$,
  'A can follow B'
);

select is(
  (select count(*)::int from public.follows
    where follower_id = 'f7000000-0000-0000-0000-00000000000a'),
  1,
  'exactly one follow row was written'
);

-- The PK is (follower_id, followed_id), so a double-tap race resolves to a
-- conflict rather than two rows.
select throws_ok(
  $$insert into public.follows (follower_id, followed_id) values ('f7000000-0000-0000-0000-00000000000a', 'f7000000-0000-0000-0000-00000000000b')$$,
  '23505', null,
  'following the same person twice violates the composite primary key'
);

-- Self-follow is rejected by the CHECK, independent of RLS.
select throws_ok(
  $$insert into public.follows (follower_id, followed_id) values ('f7000000-0000-0000-0000-00000000000a', 'f7000000-0000-0000-0000-00000000000a')$$,
  '23514', null,
  'a user cannot follow themselves -- rejected by the follows_not_self check'
);

-- ============================================================
-- 2. Forging and nonexistent targets
-- ============================================================

-- Act as C -- a third party, neither side of the A/B edge above.
set local request.jwt.claims = '{"sub":"f7000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select throws_ok(
  $$insert into public.follows (follower_id, followed_id) values ('f7000000-0000-0000-0000-00000000000a', 'f7000000-0000-0000-0000-00000000000c')$$,
  '42501', null,
  'forging another user''s follower_id is rejected -- RLS pins it to auth.uid()'
);

-- Back to A.
set local request.jwt.claims = '{"sub":"f7000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- Unlike favorites' insert policy, the follows insert policy checks only
-- follower_id = auth.uid() -- it asserts nothing about followed_id's
-- existence. So a nonexistent followed_id reaches the foreign key
-- unobstructed and fails there, as 23503 -- not 42501. Confirmed empirically
-- against the local database before writing this assertion (see the task
-- notes); it is not assumed by analogy with favorites.
select throws_ok(
  $$insert into public.follows (follower_id, followed_id) values ('f7000000-0000-0000-0000-00000000000a', 'f7000000-0000-0000-0000-0000deadbeef')$$,
  '23503', null,
  'following a nonexistent followed_id fails on the foreign key, since the insert policy never checks followed_id'
);

-- ============================================================
-- 3. Unfollowing and delete isolation
-- ============================================================
-- C attempts to delete A's follow of B. An RLS USING denial matches zero
-- rows silently, so this is asserted by survival under `reset role`, same
-- pattern as favorites' own delete-isolation test.

set local request.jwt.claims = '{"sub":"f7000000-0000-0000-0000-00000000000c","role":"authenticated"}';

delete from public.follows
 where follower_id = 'f7000000-0000-0000-0000-00000000000a'
   and followed_id = 'f7000000-0000-0000-0000-00000000000b';

reset role;
select ok(
  exists(select 1 from public.follows
          where follower_id = 'f7000000-0000-0000-0000-00000000000a'
            and followed_id = 'f7000000-0000-0000-0000-00000000000b'),
  'another user deleting A''s follow of B has no effect'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f7000000-0000-0000-0000-00000000000a","role":"authenticated"}';

delete from public.follows
 where follower_id = 'f7000000-0000-0000-0000-00000000000a'
   and followed_id = 'f7000000-0000-0000-0000-00000000000b';

select is(
  (select count(*)::int from public.follows
    where follower_id = 'f7000000-0000-0000-0000-00000000000a'
      and followed_id = 'f7000000-0000-0000-0000-00000000000b'),
  0,
  'A can remove their own follow of B'
);

-- ============================================================
-- 4. Public read -- the single most important test in this file
-- ============================================================
-- A follows B again, then C -- a third party, uninvolved in the edge --
-- reads it. This is the OPPOSITE assertion from favorites' "another user
-- sees none of B's favorites": here a stranger MUST see the edge, because
-- 3.3's follower/following list screens need to show someone else's
-- followers. If this table had favorites' owner-scoped read policy
-- (`using (follower_id = auth.uid())` or similar) instead of the public
-- `using (true)` actually written in the migration, C's session would see
-- zero rows here -- neither follower_id nor followed_id on this row is C --
-- so this assertion would fail loudly against that wrong policy rather than
-- passing by accident.

insert into public.follows (follower_id, followed_id)
values ('f7000000-0000-0000-0000-00000000000a', 'f7000000-0000-0000-0000-00000000000b');

set local request.jwt.claims = '{"sub":"f7000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select is(
  (select count(*)::int from public.follows
    where follower_id = 'f7000000-0000-0000-0000-00000000000a'
      and followed_id = 'f7000000-0000-0000-0000-00000000000b'),
  1,
  'a third, unrelated user C can read the A-follows-B edge -- reads are public, not owner-scoped'
);

-- ============================================================
-- 5. Counts, both directions, after a 3-user sequence
-- ============================================================
-- State so far: A follows B. Add C follows B, then B follows A.

insert into public.follows (follower_id, followed_id)
values ('f7000000-0000-0000-0000-00000000000c', 'f7000000-0000-0000-0000-00000000000b');

select is(
  (select count(*)::int from public.follows
    where followed_id = 'f7000000-0000-0000-0000-00000000000b'),
  2,
  'B has two followers -- A and C -- counted via the followed_id index'
);

set local request.jwt.claims = '{"sub":"f7000000-0000-0000-0000-00000000000b","role":"authenticated"}';

insert into public.follows (follower_id, followed_id)
values ('f7000000-0000-0000-0000-00000000000b', 'f7000000-0000-0000-0000-00000000000a');

select is(
  (select count(*)::int from public.follows
    where followed_id = 'f7000000-0000-0000-0000-00000000000a'),
  1,
  'A has exactly one follower -- B -- after B follows A'
);

select is(
  (select count(*)::int from public.follows
    where follower_id = 'f7000000-0000-0000-0000-00000000000b'),
  1,
  'B is following exactly one person -- A'
);

-- ============================================================
-- 6. Cascade on user deletion, both sides
-- ============================================================
-- D and E are untouched by every test above. D follows E AND E follows D,
-- so deleting D must cascade away both the row where D is the follower and
-- the row where D is the followed party.

set local request.jwt.claims = '{"sub":"f7000000-0000-0000-0000-00000000000d","role":"authenticated"}';
insert into public.follows (follower_id, followed_id)
values ('f7000000-0000-0000-0000-00000000000d', 'f7000000-0000-0000-0000-00000000000e');

set local request.jwt.claims = '{"sub":"f7000000-0000-0000-0000-00000000000e","role":"authenticated"}';
insert into public.follows (follower_id, followed_id)
values ('f7000000-0000-0000-0000-00000000000e', 'f7000000-0000-0000-0000-00000000000d');

reset role;
delete from auth.users where id = 'f7000000-0000-0000-0000-00000000000d';

select is(
  (select count(*)::int from public.follows
    where follower_id = 'f7000000-0000-0000-0000-00000000000d'
       or followed_id = 'f7000000-0000-0000-0000-00000000000d'),
  0,
  'deleting a user cascades away their follows on both sides -- as follower and as followed'
);

-- ============================================================
-- 7. anon
-- ============================================================

set local role anon;

select throws_ok(
  $$insert into public.follows (follower_id, followed_id) values ('f7000000-0000-0000-0000-00000000000e', 'f7000000-0000-0000-0000-00000000000b')$$,
  '42501', null,
  'anon cannot follow anything'
);

-- Opposite of favorites' anon-cannot-read case: SELECT is granted to anon
-- here too (mirroring profiles' public-read grant), so this must succeed
-- rather than throw.
select lives_ok(
  $$select count(*) from public.follows$$,
  'anon CAN read follows -- the same public grant profiles uses for its own publicly-readable policy'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f7000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 8. No UPDATE grant at all
-- ============================================================
-- A follow is inserted or deleted, never edited.

select throws_ok(
  $$update public.follows set created_at = now() where true$$,
  '42501', null,
  'follows cannot be updated at all -- there is no UPDATE grant'
);

select * from finish();

rollback;
