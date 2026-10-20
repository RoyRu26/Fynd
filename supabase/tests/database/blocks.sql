-- pgTAP tests for the blocks table (ROADMAP 5.2).
--
-- Run with: pnpm exec supabase test db --local
--
-- Same conventions as the other suites: 4-arg throws_ok(sql, sqlstate,
-- null, description) -- the 3-arg form's third argument is the expected
-- MESSAGE, not a description -- and SQLSTATE assertions only, never
-- message text. An RLS USING denial matches zero rows silently rather
-- than raising, so those cases are asserted by row survival/absence,
-- checked under `reset role` where the denied caller could not see the
-- answer themselves.
create extension if not exists pgtap with schema extensions;

begin;

select plan(30);

-- ============================================================
-- FIXTURES
-- ============================================================
-- A, B, C are three distinct users -- A blocks B below, C is an unrelated
-- third party used both to prove "forging another user's blocker_id" and
-- "an unrelated party also sees nothing for the A/B edge". D and E are a
-- separate pair, kept untouched by everything above, so the cascade test's
-- row count can't be confused by the A/B edge. Suite UUID namespace is
-- fa… (f1 profiles, f2 listings, f3 feed, f4 favorites, f5 chat, f6
-- reports, f7 follows), so this file can never collide with another
-- suite.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('fa000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-block-a@test.dev', 'x', now(), now()),
  ('fa000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-block-b@test.dev', 'x', now(), now()),
  ('fa000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-block-c@test.dev', 'x', now(), now()),
  ('fa000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-block-d@test.dev', 'x', now(), now()),
  ('fa000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-block-e@test.dev', 'x', now(), now());

-- Act as A from here.
set local role authenticated;
set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 1. Blocking
-- ============================================================

select lives_ok(
  $$insert into public.blocks (blocker_id, blocked_id) values ('fa000000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-00000000000b')$$,
  'A can block B'
);

select is(
  (select count(*)::int from public.blocks
    where blocker_id = 'fa000000-0000-0000-0000-00000000000a'),
  1,
  'exactly one block row was written'
);

-- The PK is (blocker_id, blocked_id), so a double-tap race resolves to a
-- conflict rather than two rows.
select throws_ok(
  $$insert into public.blocks (blocker_id, blocked_id) values ('fa000000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-00000000000b')$$,
  '23505', null,
  'blocking the same person twice violates the composite primary key'
);

-- Self-block is rejected by the CHECK, independent of RLS.
select throws_ok(
  $$insert into public.blocks (blocker_id, blocked_id) values ('fa000000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-00000000000a')$$,
  '23514', null,
  'a user cannot block themselves -- rejected by the blocks_not_self check'
);

-- ============================================================
-- 2. Forging another user's blocker_id
-- ============================================================
-- Act as C -- a third party, neither side of the A/B edge above.

set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select throws_ok(
  $$insert into public.blocks (blocker_id, blocked_id) values ('fa000000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-00000000000c')$$,
  '42501', null,
  'forging another user''s blocker_id is rejected -- RLS pins it to auth.uid()'
);

-- Back to A.
set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 3. The central privacy decision: owner-scoped, one direction only
-- ============================================================

-- A, the blocker, can read their own "A blocked B" row.
select is(
  (select count(*)::int from public.blocks
    where blocker_id = 'fa000000-0000-0000-0000-00000000000a'
      and blocked_id = 'fa000000-0000-0000-0000-00000000000b'),
  1,
  'A can read their own block-of-B row'
);

-- B, the BLOCKED party, must see ZERO rows -- not an error, row absence.
-- This is the central decision this table makes, the one assertion that
-- would fail loudly against a wrongly-owner-scoped-by-either-column
-- policy rather than passing by accident.
set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select is(
  (select count(*)::int from public.blocks
    where blocked_id = 'fa000000-0000-0000-0000-00000000000b'),
  0,
  'B, the blocked party, sees ZERO rows for the edge against them -- confirming a block must never be provable by its target'
);

-- C, an unrelated third party, also sees zero rows for the A/B edge.
set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select is(
  (select count(*)::int from public.blocks
    where blocker_id = 'fa000000-0000-0000-0000-00000000000a'
      and blocked_id = 'fa000000-0000-0000-0000-00000000000b'),
  0,
  'an unrelated third party C sees zero rows for the A/B block edge'
);

-- Back to A.
set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 4. Unblocking and delete isolation
-- ============================================================

select lives_ok(
  $$delete from public.blocks where blocker_id = 'fa000000-0000-0000-0000-00000000000a' and blocked_id = 'fa000000-0000-0000-0000-00000000000b'$$,
  'A can unblock B'
);

select is(
  (select count(*)::int from public.blocks
    where blocker_id = 'fa000000-0000-0000-0000-00000000000a'
      and blocked_id = 'fa000000-0000-0000-0000-00000000000b'),
  0,
  'the block row is gone after unblocking'
);

-- Re-block for the next section (B cannot delete A's block-of-B).
insert into public.blocks (blocker_id, blocked_id)
values ('fa000000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-00000000000b');

-- B attempts to delete A's block-of-B row. No DELETE grant reaches rows
-- where blocked_id = auth.uid() -- only blocker_id -- so the DELETE
-- policy's USING clause matches zero rows for B, silently. Asserted by
-- row-survival under `reset role`, same convention follows.sql/
-- favorites.sql use for RLS-filtered-to-zero DELETEs, since B cannot even
-- SELECT the row to confirm the denial themselves.
set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000b","role":"authenticated"}';

delete from public.blocks
 where blocker_id = 'fa000000-0000-0000-0000-00000000000a'
   and blocked_id = 'fa000000-0000-0000-0000-00000000000b';

reset role;
select ok(
  exists(select 1 from public.blocks
          where blocker_id = 'fa000000-0000-0000-0000-00000000000a'
            and blocked_id = 'fa000000-0000-0000-0000-00000000000b'),
  'B (the blocked party) deleting A''s block-of-B row has no effect -- no DELETE grant reaches blocked_id = auth.uid()'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 5. Blocking severs a pre-existing mutual follow (scope added beyond ROADMAP 5.2's literal wording)
-- ============================================================
-- D and E, untouched by everything above. Set up D follows E AND E follows
-- D, THEN D blocks E, then confirm BOTH follow rows are gone.

set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000d","role":"authenticated"}';
insert into public.follows (follower_id, followed_id)
values ('fa000000-0000-0000-0000-00000000000d', 'fa000000-0000-0000-0000-00000000000e');

set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000e","role":"authenticated"}';
insert into public.follows (follower_id, followed_id)
values ('fa000000-0000-0000-0000-00000000000e', 'fa000000-0000-0000-0000-00000000000d');

select is(
  (select count(*)::int from public.follows
    where (follower_id = 'fa000000-0000-0000-0000-00000000000d' and followed_id = 'fa000000-0000-0000-0000-00000000000e')
       or (follower_id = 'fa000000-0000-0000-0000-00000000000e' and followed_id = 'fa000000-0000-0000-0000-00000000000d')),
  2,
  'sanity: D and E mutually follow each other before the block'
);

set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000d","role":"authenticated"}';
insert into public.blocks (blocker_id, blocked_id)
values ('fa000000-0000-0000-0000-00000000000d', 'fa000000-0000-0000-0000-00000000000e');

reset role;
select is(
  (select count(*)::int from public.follows
    where (follower_id = 'fa000000-0000-0000-0000-00000000000d' and followed_id = 'fa000000-0000-0000-0000-00000000000e')
       or (follower_id = 'fa000000-0000-0000-0000-00000000000e' and followed_id = 'fa000000-0000-0000-0000-00000000000d')),
  0,
  'D blocking E severs BOTH directions of the pre-existing mutual follow'
);

-- ============================================================
-- 6. Blocking with no pre-existing follow doesn't error
-- ============================================================
-- A and C have no follow relationship between them at all. The trigger's
-- DELETE simply affects zero rows -- must not raise.

set local role authenticated;
set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select lives_ok(
  $$insert into public.blocks (blocker_id, blocked_id) values ('fa000000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-00000000000c')$$,
  'blocking someone with no pre-existing follow relationship does not error'
);

-- ============================================================
-- 7. Re-following while blocked is refused (scope added beyond ROADMAP 5.2's literal wording)
-- ============================================================
-- D blocked E above. Both directions of attempting to re-follow must be
-- refused by the amended follows INSERT policy.

set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000d","role":"authenticated"}';

select throws_ok(
  $$insert into public.follows (follower_id, followed_id) values ('fa000000-0000-0000-0000-00000000000d', 'fa000000-0000-0000-0000-00000000000e')$$,
  '42501', null,
  'D (the blocker) attempting to re-follow E (the blocked party) is refused'
);

set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000e","role":"authenticated"}';

select throws_ok(
  $$insert into public.follows (follower_id, followed_id) values ('fa000000-0000-0000-0000-00000000000e', 'fa000000-0000-0000-0000-00000000000d')$$,
  '42501', null,
  'E (the blocked party) attempting to follow D (the blocker) back is refused too'
);

-- ============================================================
-- 8. Cascade on user deletion -- the deliberate opposite of reports' SET NULL
-- ============================================================
-- D blocked E (section 5). Deleting D must cascade the block row away
-- entirely -- unlike `reports`, which SET NULLs its target columns because
-- a report is moderation evidence that must survive the thing it targets
-- being deleted. A block carries no such evidentiary value: it is pure
-- current-state relationship data, so CASCADE (mirroring follows/
-- favorites) is correct here.

set local role authenticated;
set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000d","role":"authenticated"}';

select is(
  (select count(*)::int from public.blocks
    where blocker_id = 'fa000000-0000-0000-0000-00000000000d'
      and blocked_id = 'fa000000-0000-0000-0000-00000000000e'),
  1,
  'sanity: D''s block of E exists before the cascade test'
);

reset role;
delete from auth.users where id = 'fa000000-0000-0000-0000-00000000000d';

select is(
  (select count(*)::int from public.blocks
    where blocker_id = 'fa000000-0000-0000-0000-00000000000d'
       or blocked_id = 'fa000000-0000-0000-0000-00000000000d'),
  0,
  'deleting a user cascades away their blocks on both sides -- CASCADE, not SET NULL like reports, since a block has no evidentiary value'
);

-- ============================================================
-- 9. anon and the no-UPDATE-at-all invariant
-- ============================================================

set local role anon;

select throws_ok(
  $$insert into public.blocks (blocker_id, blocked_id) values ('fa000000-0000-0000-0000-00000000000e', 'fa000000-0000-0000-0000-00000000000a')$$,
  '42501', null,
  'anon cannot block anything'
);

select throws_ok(
  $$select count(*) from public.blocks$$,
  '42501', null,
  'anon cannot read blocks at all -- no grant, so not even an empty result'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- A block is created or deleted, never edited.
select throws_ok(
  $$update public.blocks set created_at = now() where true$$,
  '42501', null,
  'blocks cannot be updated at all -- there is no UPDATE grant'
);

-- ============================================================
-- 10. private.has_block_between / private.unfollow_on_block are not directly reachable
-- ============================================================
-- Mirrors chat.sql's identical assertion for private.message_send_allowed:
-- run under `reset role`, since as `authenticated` resolving
-- `private.anything` by name fails outright with "permission denied for
-- schema private" -- these are assertions ABOUT authenticated's
-- privileges, not assertions MADE BY authenticated.

reset role;

select ok(
  not has_schema_privilege('authenticated', 'private', 'usage'),
  'authenticated holds no USAGE on the private schema -- it cannot resolve private.has_block_between or private.unfollow_on_block by name'
);

select ok(
  has_function_privilege(
    'authenticated', 'private.has_block_between(uuid, uuid)', 'execute'
  ),
  'authenticated retains EXECUTE on has_block_between -- policy/function evaluation needs it'
);

select is(
  (select count(*)::int from pg_proc
    where proname = 'unfollow_on_block'
      and pronamespace = 'private'::regnamespace
      and has_function_privilege('authenticated', oid, 'execute')),
  0,
  'authenticated has no EXECUTE on unfollow_on_block -- it is a trigger function, invoked by the executor, never called by name'
);

select ok(
  not has_function_privilege('anon', 'private.has_block_between(uuid, uuid)', 'execute'),
  'anon has no EXECUTE on has_block_between either'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 11. public.is_blocked_with -- the client-callable, direction-agnostic wrapper
-- ============================================================
-- A blocked C in section 6. Both callable, both parties should read true.

select is(
  (select public.is_blocked_with('fa000000-0000-0000-0000-00000000000c')),
  true,
  'A sees is_blocked_with(C) as true -- A is the blocker'
);

set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select is(
  (select public.is_blocked_with('fa000000-0000-0000-0000-00000000000a')),
  true,
  'C, the blocked party, ALSO sees is_blocked_with(A) as true -- direction-agnostic, unlike the owner-scoped SELECT policy'
);

select is(
  (select public.is_blocked_with('fa000000-0000-0000-0000-00000000000b')),
  false,
  'C and B have no block between them -- is_blocked_with correctly reads false'
);

set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- anon gets the same explicit EXECUTE-lockdown assertion section 9/10
-- already give every other new function in this migration -- is_blocked_with
-- is the one client-facing wrapper of the three and deliberately grants
-- EXECUTE to authenticated only, never anon or bare public.
set local role anon;

select ok(
  not has_function_privilege('anon', 'public.is_blocked_with(uuid)', 'execute'),
  'anon has no EXECUTE on is_blocked_with -- the client-facing wrapper is authenticated-only too'
);

select throws_ok(
  $$select public.is_blocked_with('fa000000-0000-0000-0000-00000000000a')$$,
  '42501', null,
  'anon cannot call is_blocked_with at all, not just read a trivially-false result'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"fa000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select * from finish();

rollback;
