-- pgTAP database tests for the manual Sell/listing foundation, Phase 1:
-- draft nullability (M1) and the writable-column privilege allowlist (M2).
--
-- Run with: pnpm exec supabase test db --local
--
-- Scope: only what M1/M2 actually changed. Storage, attach/reorder RPCs,
-- and draft-scoping listing_images RLS are later phases and are
-- deliberately not covered here.
create extension if not exists pgtap with schema extensions;

begin;

select plan(22);

-- ============================================================
-- FIXTURES
-- ============================================================
-- Two disposable, unmistakably-fake auth users, distinct from the
-- profiles.sql fixtures so there is no collision risk even though each
-- test file runs in its own rolled-back transaction.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('f2000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-listings-a@test.dev', 'x', now(), now()),
  ('f2000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-listings-b@test.dev', 'x', now(), now());

-- Act as user A via RLS from here on. Rows are located throughout by a
-- unique marker in `description` (not `title`, which some tests rename,
-- and not row order, which is not guaranteed across statements).
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 1. INSERT column-privilege boundary
-- ============================================================
-- status/currency/created_at have no INSERT privilege at all -- these must
-- fail with 42501 (insufficient privilege), not a constraint violation,
-- and must fail even when the value supplied is the column's own default.

select throws_ok(
  $$insert into public.listings (seller_id, status) values ('f2000000-0000-0000-0000-00000000000a', 'draft')$$,
  '42501', null,
  'explicit INSERT of status=''draft'' (its own default value) is rejected -- status has no INSERT privilege'
);

select throws_ok(
  $$insert into public.listings (seller_id, status) values ('f2000000-0000-0000-0000-00000000000a', 'active')$$,
  '42501', null,
  'explicit INSERT of status=''active'' is rejected'
);

select throws_ok(
  $$insert into public.listings (seller_id, created_at) values ('f2000000-0000-0000-0000-00000000000a', now())$$,
  '42501', null,
  'explicit INSERT of created_at is rejected -- prevents feed-ranking manipulation'
);

select throws_ok(
  $$insert into public.listings (seller_id, currency) values ('f2000000-0000-0000-0000-00000000000a', 'USD')$$,
  '42501', null,
  'explicit INSERT of currency is rejected -- this slice relies on the EUR default'
);

-- ============================================================
-- 2. Valid draft INSERT omitting status succeeds and defaults to draft
-- ============================================================

insert into public.listings (seller_id, title, description, price_amount, condition)
values ('f2000000-0000-0000-0000-00000000000a', 'Alpha listing', 'ROW_ALPHA', 4500, 'good');

select is(
  (select status from public.listings where description = 'ROW_ALPHA'),
  'draft'::listing_status,
  'a valid insert omitting status succeeds and defaults to draft'
);

-- ============================================================
-- 3. Incomplete draft succeeds; incomplete non-draft is rejected
-- ============================================================

insert into public.listings (seller_id, description)
values ('f2000000-0000-0000-0000-00000000000a', 'ROW_GAMMA');

select is(
  (select status from public.listings where description = 'ROW_GAMMA'),
  'draft'::listing_status,
  'a draft with no title/price/condition is accepted'
);

select is(
  (select title from public.listings where description = 'ROW_GAMMA'),
  null,
  'the incomplete draft''s title is genuinely NULL, not a placeholder'
);

-- The completeness constraint is a database invariant, not a privilege
-- boundary -- it must hold even for a writer with full table privileges
-- (which is what a future SECURITY DEFINER publish RPC, running as the
-- function owner, would have). Tested here by dropping back to the
-- connecting superuser role rather than staying as `authenticated`.
reset role;

select throws_ok(
  $$update public.listings set status = 'active' where description = 'ROW_GAMMA'$$,
  '23514', null,
  'promoting an incomplete listing to active fails listings_complete_when_not_draft, even for a privileged writer'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 4. Valid draft UPDATE succeeds
-- ============================================================

update public.listings set title = 'Alpha listing (edited)' where description = 'ROW_ALPHA';

select is(
  (select title from public.listings where description = 'ROW_ALPHA'),
  'Alpha listing (edited)',
  'updating an allowlisted column on an owned draft succeeds'
);

-- ============================================================
-- 5. UPDATE status is rejected outright (generic privilege boundary)
-- ============================================================

select throws_ok(
  $$update public.listings set status = 'active' where description = 'ROW_ALPHA'$$,
  '42501', null,
  'UPDATE of status is rejected -- status has no UPDATE privilege'
);

-- ============================================================
-- 6. The draft -> delete escape is closed at both steps
-- ============================================================
-- Promote ROW_ALPHA to active the only way currently possible: as the
-- connecting superuser, simulating what the future publish RPC will do
-- (SECURITY DEFINER, bypassing RLS and the client privilege model).

reset role;
update public.listings set status = 'active' where description = 'ROW_ALPHA';
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is(
  (select status from public.listings where description = 'ROW_ALPHA'),
  'active'::listing_status,
  'sanity check: ROW_ALPHA is now active, so the escape attempts below are meaningful'
);

-- Step 1 of the escape: demote back to draft. Same privilege boundary as
-- test 5, exercised here specifically in the escape's own scenario.
select throws_ok(
  $$update public.listings set status = 'draft' where description = 'ROW_ALPHA'$$,
  '42501', null,
  'demoting an active listing to draft is rejected -- closes step 1 of the delete-escape'
);

-- Step 2: even without the demotion, attempt a direct delete of the (still
-- active) listing. The draft-only DELETE RLS policy (from the delete-safety
-- migration) must still block it.
delete from public.listings where description = 'ROW_ALPHA';

select ok(
  exists(select 1 from public.listings where description = 'ROW_ALPHA'),
  'an active listing survives a direct delete attempt -- draft-only DELETE RLS still enforced, escape closed at step 2 too'
);

-- ============================================================
-- 7. An active listing cannot be edited through the ordinary UPDATE path
-- ============================================================
-- title IS an allowlisted UPDATE column, so this does not throw -- the
-- draft-only USING clause on the update policy silently matches 0 rows.

update public.listings set title = 'Should not work' where description = 'ROW_ALPHA';

select isnt(
  (select title from public.listings where description = 'ROW_ALPHA'),
  'Should not work',
  'an active listing cannot be edited through the ordinary client UPDATE path -- RLS requires status = draft'
);

-- ============================================================
-- 8. UPDATE seller_id is rejected (ownership transfer blocked at the
--    privilege layer, not merely by RLS)
-- ============================================================

insert into public.listings (seller_id, title, description, price_amount, condition)
values ('f2000000-0000-0000-0000-00000000000a', 'Delta listing', 'ROW_DELTA', 1000, 'new');

select throws_ok(
  $$update public.listings set seller_id = 'f2000000-0000-0000-0000-00000000000b' where description = 'ROW_DELTA'$$,
  '42501', null,
  'UPDATE of seller_id is rejected -- seller_id is INSERT-only, never updatable'
);

-- ============================================================
-- 9. A non-owner cannot update or delete another seller's draft
-- ============================================================
-- The SELECT policy hides another seller's draft entirely (status='active'
-- OR auth.uid()=seller_id both fail for B against A's draft), so checking
-- the outcome through B's own session would prove nothing -- B can't see
-- the row either way, whether or not the write succeeded. Each write is
-- performed as B, then verified through a privileged/owner view.

set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000b","role":"authenticated"}';

update public.listings set title = 'Hacked' where description = 'ROW_DELTA';

reset role;

select isnt(
  (select title from public.listings where description = 'ROW_DELTA'),
  'Hacked',
  'user B updating user A''s draft has no effect'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000b","role":"authenticated"}';

delete from public.listings where description = 'ROW_DELTA';

reset role;

select ok(
  exists(select 1 from public.listings where description = 'ROW_DELTA'),
  'user B deleting user A''s draft has no effect'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 10. anon has no INSERT/UPDATE/DELETE on listings
-- ============================================================

set local role anon;

select throws_ok(
  $$insert into public.listings (seller_id) values ('f2000000-0000-0000-0000-00000000000a')$$,
  '42501', null,
  'anon cannot INSERT into listings at all'
);

select throws_ok(
  $$update public.listings set title = 'x' where false$$,
  '42501', null,
  'anon cannot UPDATE listings at all'
);

select throws_ok(
  $$delete from public.listings where false$$,
  '42501', null,
  'anon cannot DELETE from listings at all'
);

-- ============================================================
-- 11. listing_images: INSERT/UPDATE are fully revoked in this phase
-- ============================================================
-- Attaching and reordering become RPC-only in a later phase. Until then
-- the client has no direct write path to this table at all. `where false`
-- is sufficient because the privilege check fails before any row is
-- evaluated -- no fixture row is needed.

set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select throws_ok(
  $$insert into public.listing_images (listing_id, storage_path, position) values (gen_random_uuid(), 'x', 0)$$,
  '42501', null,
  'authenticated cannot INSERT into listing_images -- attach is RPC-only, not yet built'
);

select throws_ok(
  $$update public.listing_images set position = 0 where false$$,
  '42501', null,
  'authenticated cannot UPDATE listing_images -- reorder is RPC-only, not yet built'
);

select * from finish();

rollback;
