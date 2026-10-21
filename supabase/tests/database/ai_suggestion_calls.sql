-- pgTAP tests for ai_suggestion_calls and record_ai_suggestion_attempt
-- (ROADMAP 4.2 "Suggest-from-photos Edge Function").
--
-- Run with: pnpm exec supabase test db --local
--
-- Same conventions as the other suites: 4-arg throws_ok(sql, sqlstate,
-- null, description) -- the 3-arg form's third argument is the expected
-- MESSAGE, not a description -- and SQLSTATE assertions only, never message
-- text.
create extension if not exists pgtap with schema extensions;

begin;

select plan(23);

-- ============================================================
-- FIXTURES
-- ============================================================
-- A owns a draft (D1) and a separately-published active listing (L_ACTIVE),
-- so both "owned draft" and "owned but not a draft" can be exercised from
-- the same seller. B owns a second draft (D2), used to prove a caller
-- cannot spend another user's attempts. C owns neither -- it attempts
-- against B's draft to prove cross-user access is rejected.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('f8000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-aisugg-a@test.dev', 'x', now(), now()),
  ('f8000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-aisugg-b@test.dev', 'x', now(), now()),
  ('f8000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-aisugg-c@test.dev', 'x', now(), now());

-- 'c0000001-0000-4000-8000-000000000001' is the seeded Women > Tops leaf
-- (20261018100200_categories.sql), required for an ACTIVE row to satisfy
-- listings_complete_when_not_draft.
insert into public.listings
  (id, seller_id, title, description, price_amount, condition, size, category_id, status)
values
  ('ee000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-00000000000a',
   'A draft', 'AISUGG_D1', null, null, null, null, 'draft'),
  ('ee000000-0000-0000-0000-000000000002', 'f8000000-0000-0000-0000-00000000000a',
   'A active listing', 'AISUGG_ACTIVE', 1000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('ee000000-0000-0000-0000-000000000003', 'f8000000-0000-0000-0000-00000000000b',
   'B draft', 'AISUGG_D2', null, null, null, null, 'draft');

-- Act as A from here.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 1. Under the limit: allows and increments
-- ============================================================

select is(
  (select allowed from public.record_ai_suggestion_attempt('ee000000-0000-0000-0000-000000000001')),
  true,
  'first attempt on an owned draft is allowed'
);

select is(
  (select count(*)::int from public.ai_suggestion_calls
    where user_id = 'f8000000-0000-0000-0000-00000000000a'),
  1,
  'exactly one call row was recorded for A'
);

select is(
  (select remaining from public.record_ai_suggestion_attempt('ee000000-0000-0000-0000-000000000001')),
  18,
  'second attempt reports remaining = 18 (limit 20, minus the two calls just made)'
);

select is(
  (select count(*)::int from public.ai_suggestion_calls
    where user_id = 'f8000000-0000-0000-0000-00000000000a'),
  2,
  'the second attempt recorded a second row -- each allowed call increments the ledger'
);

-- ============================================================
-- 2. Two successive calls report a monotonically decreasing `remaining`
-- ============================================================
-- NOT a proof the advisory lock serializes concurrent callers -- it can't
-- be: pgTAP runs one session's statements strictly sequentially, so this
-- passes identically whether or not the lock exists. It only proves
-- count-then-insert is monotonic under sequential execution. The lock
-- itself was verified by hand against two real concurrent psql sessions
-- (see the migration's own header comment) -- that is what actually
-- backs the "serializes concurrent callers" claim, not this assertion.

select isnt(
  (select remaining from public.record_ai_suggestion_attempt('ee000000-0000-0000-0000-000000000001')),
  (select remaining from public.record_ai_suggestion_attempt('ee000000-0000-0000-0000-000000000001')),
  'two immediately-successive calls never report the same remaining value'
);

select is(
  (select count(*)::int from public.ai_suggestion_calls
    where user_id = 'f8000000-0000-0000-0000-00000000000a'),
  4,
  'A has made 4 calls total so far'
);

-- ============================================================
-- 3. At the limit: denies without inserting a new row
-- ============================================================
-- Top A up to exactly the limit (20) via direct inserts under the
-- privileged connecting role -- the RPC itself is the thing under test, so
-- the remaining 16 rows needed to reach the cap are seeded directly rather
-- than by calling it 16 more times.

reset role;
insert into public.ai_suggestion_calls (user_id, listing_id)
select 'f8000000-0000-0000-0000-00000000000a', 'ee000000-0000-0000-0000-000000000001'
  from generate_series(1, 16);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is(
  (select count(*)::int from public.ai_suggestion_calls
    where user_id = 'f8000000-0000-0000-0000-00000000000a'),
  20,
  'sanity: A is now exactly at the 20-call limit'
);

select is(
  (select row(allowed, remaining) from public.record_ai_suggestion_attempt('ee000000-0000-0000-0000-000000000001')),
  row(false, 0),
  'at the limit, the attempt is denied and remaining is reported as 0'
);

select is(
  (select count(*)::int from public.ai_suggestion_calls
    where user_id = 'f8000000-0000-0000-0000-00000000000a'),
  20,
  'a denied attempt inserts no new row -- the ledger stays at 20'
);

-- ============================================================
-- 3a. Deleting the draft that accrued calls does not reset the quota
-- ============================================================
-- The regression case for a real bug caught in review: listing_id used to
-- be `on delete cascade`, so deleting D1 (which every one of A's 20 calls
-- above was recorded against) deleted all 20 ledger rows along with it --
-- a user could burn their quota, delete the draft (RLS permits deleting
-- any of your own drafts; this is ordinary, not a privilege escalation),
-- and get a fresh 20 for free. `on delete set null` keeps the rows (and
-- therefore the count) alive regardless of what happens to the listing.

reset role;
delete from public.listings where id = 'ee000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.ai_suggestion_calls
    where user_id = 'f8000000-0000-0000-0000-00000000000a'),
  20,
  'deleting the draft the calls were recorded against does not reduce A''s count'
);

select is(
  (select count(*)::int from public.ai_suggestion_calls
    where user_id = 'f8000000-0000-0000-0000-00000000000a' and listing_id is null),
  20,
  'the deleted draft''s rows survive with listing_id nulled out, not removed'
);

-- A brand new draft doesn't grant a fresh quota -- A is still at the limit.
insert into public.listings (id, seller_id, title, description, price_amount, condition, size, category_id, status)
values ('ee000000-0000-0000-0000-000000000004', 'f8000000-0000-0000-0000-00000000000a',
        'A second draft', 'AISUGG_D4', null, null, null, null, 'draft');

set local role authenticated;
set local request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is(
  (select row(allowed, remaining) from public.record_ai_suggestion_attempt('ee000000-0000-0000-0000-000000000004')),
  row(false, 0),
  'a fresh draft does not reset A''s quota -- still denied at the limit'
);

-- ============================================================
-- 4. Another user's draft is rejected
-- ============================================================

set local request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select throws_ok(
  $$select * from public.record_ai_suggestion_attempt('ee000000-0000-0000-0000-000000000003')$$,
  '42501', null,
  'C cannot spend an attempt against B''s draft -- it is not C''s listing'
);

reset role;
select is(
  (select count(*)::int from public.ai_suggestion_calls where user_id = 'f8000000-0000-0000-0000-00000000000c'),
  0,
  'the rejected cross-user attempt inserted no row'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 5. A non-draft (active) listing is rejected
-- ============================================================
-- Exercised against A's OWN active listing, so the denial is provably
-- about status, not ownership -- A already has visibility and
-- authorization over this row, same as the favorites suite's equivalent
-- "even the owner" check.

select throws_ok(
  $$select * from public.record_ai_suggestion_attempt('ee000000-0000-0000-0000-000000000002')$$,
  '42501', null,
  'an active (non-draft) listing is rejected, even for its own owner'
);

reset role;
select is(
  (select count(*)::int from public.ai_suggestion_calls where listing_id = 'ee000000-0000-0000-0000-000000000002'),
  0,
  'the rejected active-listing attempt inserted no row'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 6. Grants: no client role can write this table directly
-- ============================================================
-- record_ai_suggestion_attempt is meant to be the ONLY writer. These
-- assert that directly, rather than relying only on this review having
-- read the revoke/grant statements correctly.

select throws_ok(
  $$insert into public.ai_suggestion_calls (user_id, listing_id) values ('f8000000-0000-0000-0000-00000000000a', null)$$,
  '42501', null,
  'authenticated cannot INSERT into ai_suggestion_calls directly -- only the RPC may write'
);

select throws_ok(
  $$update public.ai_suggestion_calls set created_at = now() where true$$,
  '42501', null,
  'authenticated cannot UPDATE ai_suggestion_calls -- there is no UPDATE grant at all'
);

select throws_ok(
  $$delete from public.ai_suggestion_calls where true$$,
  '42501', null,
  'authenticated cannot DELETE from ai_suggestion_calls -- a client can never reset its own quota by deleting rows'
);

set local role anon;

select throws_ok(
  $$select count(*) from public.ai_suggestion_calls$$,
  '42501', null,
  'anon cannot read ai_suggestion_calls at all -- no grant, so not even an empty result'
);

select throws_ok(
  $$insert into public.ai_suggestion_calls (user_id, listing_id) values ('f8000000-0000-0000-0000-00000000000a', null)$$,
  '42501', null,
  'anon cannot INSERT into ai_suggestion_calls'
);

-- ============================================================
-- 6a. ai_suggestion_calls_id_seq -- identity sequence lockdown (ROADMAP 6.4)
-- ============================================================
-- Same bug class as reports_id_seq/reviews_id_seq (already fixed and
-- tested elsewhere): the identity column's own backing sequence is granted
-- rwU to anon/authenticated by pg_default_acl independently of the table's
-- own grants above, and a direct `last_value` read bypasses this table's
-- RLS entirely, leaking global suggestion-call volume platform-wide. Fixed
-- in 20261021101950_identity_sequence_privilege_cleanup.sql. Still `anon`
-- from the section above.

select throws_ok(
  $$select last_value from public.ai_suggestion_calls_id_seq$$,
  '42501', null,
  'anon cannot read the ai_suggestion_calls_id_seq identity sequence -- no row-count inference'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select throws_ok(
  $$select last_value from public.ai_suggestion_calls_id_seq$$,
  '42501', null,
  'authenticated cannot read ai_suggestion_calls_id_seq either -- the revoke is not owner-scoped, it is total'
);

select * from finish();

rollback;
