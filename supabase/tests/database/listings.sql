-- pgTAP database tests for the manual Sell/listing foundation.
--
-- Run with: pnpm exec supabase test db --local
--
-- Sections 1-11  Phase 1: draft nullability (M1) and the writable-column
--                privilege allowlist (M2).
-- Sections 12-20 Phase 2: draft-scoped image RLS, Storage bucket/policies
--                (M3), and the three SECURITY DEFINER RPCs (M4).
--
-- Two recurring conventions worth stating once:
--
--   * A privilege denial raises 42501, but an RLS USING denial silently
--     matches zero rows. Only the former is testable with throws_ok; the
--     latter is asserted by rows-affected / row survival.
--   * When checking whether someone else's write had an effect, the check
--     runs under `reset role` (the privileged connecting role). Verifying
--     through the denied caller's own session proves nothing: the SELECT
--     policy may hide the row from them whether or not the write succeeded.
create extension if not exists pgtap with schema extensions;

begin;

select plan(83);

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
  'explicit INSERT of currency is rejected -- the ILS column default is the whole mechanism'
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
-- 3a. size -- nullable on drafts, required on everything else
-- ============================================================
-- ROW_GAMMA above already proves a draft may carry no size at all (it has
-- no size and was accepted). These cover the column privilege and the
-- rebuilt completeness invariant.

select is(
  (select size from public.listings where description = 'ROW_GAMMA'),
  null,
  'a draft may hold size = NULL, exactly like title/price/condition'
);

update public.listings set size = 'alpha_m' where description = 'ROW_ALPHA';

select is(
  (select size from public.listings where description = 'ROW_ALPHA'),
  'alpha_m'::listing_size,
  'a seller can set size on their own draft -- the column grant landed'
);

-- The footwear escape path: the reason this is a prefixed enum rather than
-- an alpha-only set. The fixture inventory that motivated it was a shirt
-- and a pair of Vans.
update public.listings set size = 'eu_shoe_42' where description = 'ROW_ALPHA';

select is(
  (select size from public.listings where description = 'ROW_ALPHA'),
  'eu_shoe_42'::listing_size,
  'a numeric shoe size is representable, not just alpha clothing sizes'
);

select throws_ok(
  $$update public.listings set size = 'M' where description = 'ROW_ALPHA'$$,
  '22P02', null,
  'an uncontrolled free-text size is rejected by the enum -- "M" never becomes its own semantic size'
);

-- The invariant the migration's demote-to-draft step existed to protect:
-- once size is required for non-drafts, an active listing cannot lack one,
-- and this holds even for a privileged writer bypassing RLS entirely.
reset role;

update public.listings set size = null where description = 'ROW_ALPHA';

select throws_ok(
  $$update public.listings set status = 'active' where description = 'ROW_ALPHA'$$,
  '23514', null,
  'a listing with every other field set but no size still cannot become active'
);

update public.listings set size = 'alpha_m' where description = 'ROW_ALPHA';

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

-- ============================================================
-- 12. PHASE 2 FIXTURES
-- ============================================================
-- Inserted as the connecting superuser so ids and status can be set
-- explicitly -- neither is client-writable after Phase 1, which is itself
-- the point. Ids are readable rather than random so the storage paths
-- below can be written out in full:
--
--   aaaa0001-*  storage-policy listings (A)      bbbb0001-*  same, owned by B
--   aaaa0002-*  attach_listing_image listings    aaaa0003-*  reorder listings
--   aaaa0004-*  publish listings                 bbbb0004-*  B's publish draft
--   cccc0000-…-00000000dead                      a listing id that never exists
--
-- Non-draft rows are fully populated because listings_complete_when_not_draft
-- (M1) will not accept an incomplete one.

reset role;

-- Every ACTIVE row must now carry a size: listings_complete_when_not_draft
-- requires it. Drafts are free to omit it, and the PUB_* fixtures below
-- exercise exactly that boundary.
insert into public.listings (id, seller_id, title, description, price_amount, condition, size, status)
values
  -- Storage policy fixtures
  ('aaaa0001-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-00000000000a',
   'A draft for storage',  'SA_DRAFT',  1000, 'good', 'alpha_m', 'draft'),
  ('aaaa0001-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-00000000000a',
   'A active for storage', 'SA_ACTIVE', 1000, 'good', 'alpha_m', 'active'),
  ('aaaa0001-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-00000000000a',
   'A doomed draft',       'SA_DOOMED', 1000, 'good', 'alpha_m', 'draft'),
  ('bbbb0001-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-00000000000b',
   'B draft for storage',  'SB_DRAFT',  1000, 'good', 'alpha_m', 'draft'),
  ('bbbb0001-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-00000000000b',
   'B active for storage', 'SB_ACTIVE', 1000, 'good', 'alpha_m', 'active'),
  -- attach_listing_image fixtures
  ('aaaa0002-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-00000000000a',
   'A attach draft',       'AT_A',      1000, 'good', 'alpha_m', 'draft'),
  ('aaaa0002-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-00000000000a',
   'A photo cap draft',    'AT_CAP',    1000, 'good', 'alpha_m', 'draft'),
  ('aaaa0002-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-00000000000a',
   'A attach active',      'AT_ACTIVE', 1000, 'good', 'alpha_m', 'active'),
  -- set_listing_image_order fixtures
  ('aaaa0003-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-00000000000a',
   'A reorder draft',      'OR_A',      1000, 'good', 'alpha_m', 'draft'),
  ('aaaa0003-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-00000000000a',
   'A other draft',        'OR_OTHER',  1000, 'good', 'alpha_m', 'draft'),
  ('aaaa0003-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-00000000000a',
   'A reorder active',     'OR_ACTIVE', 1000, 'good', 'alpha_m', 'active'),
  -- publish_listing fixtures. A numeric shoe size on the happy path, so the
  -- publish flow is proven against the escape-path half of the enum too.
  ('aaaa0004-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-00000000000a',
   'A publishable draft',  'PUB_OK',    2500, 'good', 'eu_shoe_42', 'draft'),
  ('aaaa0004-0000-0000-0000-000000000005', 'f2000000-0000-0000-0000-00000000000a',
   'A draft no photos',    'PUB_NOIMG', 2500, 'good', 'alpha_m', 'draft'),
  ('aaaa0004-0000-0000-0000-000000000006', 'f2000000-0000-0000-0000-00000000000a',
   'A ghost photo draft',  'PUB_GHOST', 2500, 'good', 'alpha_m', 'draft'),
  ('bbbb0004-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-00000000000b',
   'B publishable draft',  'PUB_B',     2500, 'good', 'alpha_m', 'draft');

-- The four incomplete drafts, each missing exactly one required field.
insert into public.listings (id, seller_id, title, description, price_amount, condition, size)
values
  ('aaaa0004-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-00000000000a',
   null,                'PUB_NOTITLE', 2500, 'good', 'alpha_m'),
  ('aaaa0004-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-00000000000a',
   'A draft no price',  'PUB_NOPRICE', null, 'good', 'alpha_m'),
  ('aaaa0004-0000-0000-0000-000000000004', 'f2000000-0000-0000-0000-00000000000a',
   'A draft no cond',   'PUB_NOCOND',  2500, null,   'alpha_m'),
  -- Complete in every respect EXCEPT size -- the new publish requirement.
  ('aaaa0004-0000-0000-0000-000000000007', 'f2000000-0000-0000-0000-00000000000a',
   'A draft no size',   'PUB_NOSIZE',  2500, 'good', null);

-- Storage objects the RPC tests need to already exist. Only (bucket_id,
-- name) is written: path_tokens is GENERATED ALWAYS and must never appear
-- in an INSERT.
insert into storage.objects (bucket_id, name)
values
  -- attach happy path / retry
  ('listing-images', 'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000001/i0.jpg'),
  ('listing-images', 'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000001/i1.jpg'),
  ('listing-images', 'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000001/i2.jpg'),
  -- attach denial cases (object exists, so the denial is never a false negative)
  ('listing-images', 'f2000000-0000-0000-0000-00000000000b/aaaa0002-0000-0000-0000-000000000001/wrong-owner.jpg'),
  ('listing-images', 'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000003/active.jpg'),
  ('listing-images', 'f2000000-0000-0000-0000-00000000000b/bbbb0001-0000-0000-0000-000000000001/foreign.jpg'),
  -- reorder
  ('listing-images', 'f2000000-0000-0000-0000-00000000000a/aaaa0003-0000-0000-0000-000000000001/o1.jpg'),
  ('listing-images', 'f2000000-0000-0000-0000-00000000000a/aaaa0003-0000-0000-0000-000000000001/o2.jpg'),
  ('listing-images', 'f2000000-0000-0000-0000-00000000000a/aaaa0003-0000-0000-0000-000000000001/o3.jpg'),
  ('listing-images', 'f2000000-0000-0000-0000-00000000000a/aaaa0003-0000-0000-0000-000000000002/other1.jpg'),
  -- publish
  ('listing-images', 'f2000000-0000-0000-0000-00000000000a/aaaa0004-0000-0000-0000-000000000001/pub1.jpg'),
  ('listing-images', 'f2000000-0000-0000-0000-00000000000a/aaaa0004-0000-0000-0000-000000000006/ghost.jpg'),
  -- storage DELETE policy fixtures
  ('listing-images', 'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000001/del1.jpg'),
  ('listing-images', 'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000002/del2.jpg'),
  ('listing-images', 'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000003/del3.jpg'),
  ('listing-images', 'f2000000-0000-0000-0000-00000000000b/aaaa0001-0000-0000-0000-000000000003/del4.jpg'),
  ('listing-images', 'f2000000-0000-0000-0000-00000000000a/bbbb0001-0000-0000-0000-000000000002/del5.jpg');

-- The doomed draft gets an image row, so deleting the listing demonstrates
-- the cascade that strands its objects (section 15).
insert into public.listing_images (listing_id, storage_path, "position")
values ('aaaa0001-0000-0000-0000-000000000003',
        'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000003/del3.jpg', 0);

-- Image rows on active listings, which no client path can create (attach is
-- draft-only). Inserted privileged so the draft-scoped DELETE policy has
-- something to refuse in section 20, and reorder has an id to reject.
insert into public.listing_images (listing_id, storage_path, "position")
values ('aaaa0003-0000-0000-0000-000000000003',
        'f2000000-0000-0000-0000-00000000000a/aaaa0003-0000-0000-0000-000000000003/act1.jpg', 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 13. Storage INSERT policy -- strict: a live, owned, draft listing
-- ============================================================
-- An INSERT denied by WITH CHECK does raise (42501), unlike a USING denial,
-- so throws_ok is correct here.

insert into storage.objects (bucket_id, name)
values ('listing-images',
        'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000001/p1.jpg');

select ok(
  exists(select 1 from storage.objects
          where name = 'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000001/p1.jpg'),
  'upload under {my uid}/{my draft}/ succeeds'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('listing-images', 'f2000000-0000-0000-0000-00000000000a/cccc0000-0000-0000-0000-00000000dead/x.jpg')$$,
  '42501', null,
  'upload under a listing id that does not exist is denied -- the orphan branch is not an entry point'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('listing-images', 'f2000000-0000-0000-0000-00000000000a/bbbb0001-0000-0000-0000-000000000001/x.jpg')$$,
  '42501', null,
  'upload under another seller''s draft is denied'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('listing-images', 'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000002/x.jpg')$$,
  '42501', null,
  'upload under my own ACTIVE listing is denied -- active listings are immutable'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('listing-images', 'f2000000-0000-0000-0000-00000000000b/bbbb0001-0000-0000-0000-000000000001/x.jpg')$$,
  '42501', null,
  'upload under another user''s uid prefix is denied by path segment 1'
);

-- ============================================================
-- 14. Storage SELECT policy -- own uid prefix only
-- ============================================================

select ok(
  exists(select 1 from storage.objects
          where name = 'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000001/del1.jpg'),
  'a seller can read objects under their own uid prefix'
);

set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select ok(
  not exists(select 1 from storage.objects
              where name = 'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000001/del1.jpg'),
  'a seller cannot read objects under another seller''s uid prefix'
);

set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 15. Storage DELETE policy -- owned draft, or the listing is gone
-- ============================================================
-- This storage version ships a BEFORE DELETE STATEMENT trigger,
-- storage.protect_delete(), which refuses every direct SQL delete on
-- storage.objects unless the GUC storage.allow_delete_query is 'true'. It is
-- not RLS and not role-sensitive: it fires ahead of the policy, for every
-- caller. Assert that first, because it means the only context the DELETE
-- policy is ever evaluated in is the Storage API's.

select throws_ok(
  $$delete from storage.objects where name = 'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000001/del1.jpg'$$,
  '42501', null,
  'a direct SQL delete on storage.objects is refused outright by storage.protect_delete()'
);

-- The Storage API sets this GUC before issuing its deletes, then runs them as
-- `authenticated` carrying the caller's JWT -- so RLS still applies and the
-- policy below is what actually authorises a client-side .remove() call.
-- Setting it here reproduces that context exactly; without it the DELETE
-- policy could not be exercised at all.
set local storage.allow_delete_query = 'true';

-- A DELETE denied by USING matches zero rows silently, so every case below
-- is asserted by row survival, checked under `reset role`.

delete from storage.objects
 where name = 'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000001/del1.jpg';

reset role;
select ok(
  not exists(select 1 from storage.objects
              where name = 'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000001/del1.jpg'),
  'deleting an object under my own draft succeeds -- ordinary per-image removal'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

delete from storage.objects
 where name = 'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000002/del2.jpg';

reset role;
select ok(
  exists(select 1 from storage.objects
          where name = 'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000002/del2.jpg'),
  'deleting an object under my own ACTIVE listing is denied'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- Whole-draft deletion: the listing goes, the image rows cascade away, and
-- the objects are left stranded. This is the orphan the DELETE policy's
-- `not exists` branch exists to make cleanable.
delete from public.listings where id = 'aaaa0001-0000-0000-0000-000000000003';

reset role;
select ok(
  not exists(select 1 from public.listing_images
              where listing_id = 'aaaa0001-0000-0000-0000-000000000003'),
  'deleting a whole draft cascades its image rows away, stranding the objects'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

delete from storage.objects
 where name = 'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000003/del3.jpg';

reset role;
select ok(
  not exists(select 1 from storage.objects
              where name = 'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000003/del3.jpg'),
  'an orphan under my own uid prefix is deletable after its listing is gone'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

delete from storage.objects
 where name = 'f2000000-0000-0000-0000-00000000000b/aaaa0001-0000-0000-0000-000000000003/del4.jpg';

reset role;
select ok(
  exists(select 1 from storage.objects
          where name = 'f2000000-0000-0000-0000-00000000000b/aaaa0001-0000-0000-0000-000000000003/del4.jpg'),
  'an orphan under ANOTHER uid prefix is not deletable -- segment 1 gates the orphan branch too'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- The case the `not exists` branch must not swallow: the listing segment
-- names someone else's ACTIVE listing, so the listing does exist and the
-- orphan branch is false.
delete from storage.objects
 where name = 'f2000000-0000-0000-0000-00000000000a/bbbb0001-0000-0000-0000-000000000002/del5.jpg';

reset role;
select ok(
  exists(select 1 from storage.objects
          where name = 'f2000000-0000-0000-0000-00000000000a/bbbb0001-0000-0000-0000-000000000002/del5.jpg'),
  'an object naming another seller''s ACTIVE listing is not deletable even under my own prefix'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 16. There is no Storage UPDATE path at all
-- ============================================================
-- No UPDATE policy exists, so USING is effectively false: zero rows, no
-- exception. Objects are immutable; replacing a photo is delete + upload to
-- a fresh uuid path.

update storage.objects
   set name = 'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000001/renamed.jpg'
 where name = 'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000001/p1.jpg';

reset role;
select ok(
  exists(select 1 from storage.objects
          where name = 'f2000000-0000-0000-0000-00000000000a/aaaa0001-0000-0000-0000-000000000001/p1.jpg'),
  'objects cannot be updated -- no Storage UPDATE policy exists'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 17. attach_listing_image
-- ============================================================
-- Positions are allocated server-side, 0-based, under the listing's row
-- lock. The client never supplies one.

select is(
  (select li."position" from public.attach_listing_image(
     'aaaa0002-0000-0000-0000-000000000001',
     'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000001/i0.jpg') li),
  0,
  'the first attached photo is given position 0'
);

select is(
  (select li."position" from public.attach_listing_image(
     'aaaa0002-0000-0000-0000-000000000001',
     'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000001/i1.jpg') li),
  1,
  'the second attached photo is given position 1'
);

select is(
  (select li."position" from public.attach_listing_image(
     'aaaa0002-0000-0000-0000-000000000001',
     'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000001/i2.jpg') li),
  2,
  'the third attached photo is given position 2'
);

-- Safe retry: the client's upload -> attach sequence can be interrupted and
-- retried, so attaching the same path twice must be a no-op returning the
-- original row -- not an error, and not a duplicate.
select is(
  (select li.id from public.attach_listing_image(
     'aaaa0002-0000-0000-0000-000000000001',
     'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000001/i0.jpg') li),
  (select id from public.listing_images
    where storage_path = 'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000001/i0.jpg'),
  'a retried attach returns the id of the existing row'
);

select is(
  (select li."position" from public.attach_listing_image(
     'aaaa0002-0000-0000-0000-000000000001',
     'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000001/i0.jpg') li),
  0,
  'a retried attach returns the original position, not a fresh one'
);

select is(
  (select count(*)::int from public.listing_images
    where listing_id = 'aaaa0002-0000-0000-0000-000000000001'),
  3,
  'retrying an attach does not duplicate the row'
);

select throws_ok(
  $$select public.attach_listing_image('aaaa0002-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000001/never-uploaded.jpg')$$,
  'P0001', null,
  'attaching a path with no uploaded object behind it is rejected -- no phantom photos'
);

select throws_ok(
  $$select public.attach_listing_image('bbbb0001-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-00000000000b/bbbb0001-0000-0000-0000-000000000001/foreign.jpg')$$,
  '42501', null,
  'attaching to another seller''s listing is rejected'
);

select throws_ok(
  $$select public.attach_listing_image('aaaa0002-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000003/active.jpg')$$,
  'P0001', null,
  'attaching to my own ACTIVE listing is rejected'
);

select throws_ok(
  $$select public.attach_listing_image('aaaa0002-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-00000000000b/aaaa0002-0000-0000-0000-000000000001/wrong-owner.jpg')$$,
  '42501', null,
  'attaching a path under another user''s uid prefix is rejected'
);

select throws_ok(
  $$select public.attach_listing_image('aaaa0002-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-00000000000a/aaaa0003-0000-0000-0000-000000000001/o1.jpg')$$,
  '42501', null,
  'attaching a path whose listing segment names a different listing is rejected'
);

select throws_ok(
  $$select public.attach_listing_image('aaaa0002-0000-0000-0000-000000000001', '   ')$$,
  'P0001', null,
  'attaching a blank storage path is rejected'
);

select throws_ok(
  $$select public.attach_listing_image('cccc0000-0000-0000-0000-00000000dead', 'f2000000-0000-0000-0000-00000000000a/cccc0000-0000-0000-0000-00000000dead/x.jpg')$$,
  'P0002', null,
  'attaching to a listing that does not exist is rejected as not-found'
);

-- The 10-photo cap. Enforceable only because direct INSERT on
-- listing_images is revoked: this RPC is the sole write path, so a count
-- check inside it is authoritative. (A count cap cannot be a CHECK
-- constraint.)
reset role;
insert into storage.objects (bucket_id, name)
select 'listing-images',
       'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000002/cap'
       || g || '.jpg'
  from generate_series(1, 11) g;
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $do$
declare g integer;
begin
  for g in 1..10 loop
    perform public.attach_listing_image(
      'aaaa0002-0000-0000-0000-000000000002'::uuid,
      'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000002/cap'
      || g || '.jpg');
  end loop;
end
$do$;

select is(
  (select count(*)::int from public.listing_images
    where listing_id = 'aaaa0002-0000-0000-0000-000000000002'),
  10,
  'ten photos attach successfully'
);

select throws_ok(
  $$select public.attach_listing_image('aaaa0002-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000002/cap11.jpg')$$,
  'P0001', null,
  'the eleventh photo is rejected by the 10-photo cap'
);

set local role anon;
select throws_ok(
  $$select public.attach_listing_image('aaaa0002-0000-0000-0000-000000000001', 'x')$$,
  '42501', null,
  'anon cannot execute attach_listing_image -- the pg_default_acl grant was revoked'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 18. set_listing_image_order
-- ============================================================

do $do$
declare g integer;
begin
  for g in 1..3 loop
    perform public.attach_listing_image(
      'aaaa0003-0000-0000-0000-000000000001'::uuid,
      'f2000000-0000-0000-0000-00000000000a/aaaa0003-0000-0000-0000-000000000001/o'
      || g || '.jpg');
  end loop;
  perform public.attach_listing_image(
    'aaaa0003-0000-0000-0000-000000000002'::uuid,
    'f2000000-0000-0000-0000-00000000000a/aaaa0003-0000-0000-0000-000000000002/other1.jpg');
end
$do$;

do $do$
begin
  perform public.set_listing_image_order(
    'aaaa0003-0000-0000-0000-000000000001'::uuid,
    array[
      (select id from public.listing_images where storage_path like '%/aaaa0003-0000-0000-0000-000000000001/o3.jpg'),
      (select id from public.listing_images where storage_path like '%/aaaa0003-0000-0000-0000-000000000001/o1.jpg'),
      (select id from public.listing_images where storage_path like '%/aaaa0003-0000-0000-0000-000000000001/o2.jpg')
    ]::uuid[]);
end
$do$;

select is(
  (select string_agg(storage.filename(li.storage_path), ',' order by li."position")
     from public.listing_images li
    where li.listing_id = 'aaaa0003-0000-0000-0000-000000000001'),
  'o3.jpg,o1.jpg,o2.jpg',
  'set_listing_image_order produces exactly the requested order'
);

-- The rewrite above is legal only because listing_images_unique_position is
-- DEFERRABLE INITIALLY DEFERRED -- its intermediate states collide. Forcing
-- the check now proves the FINAL state is genuinely unique rather than
-- merely unchecked.
select lives_ok(
  'set constraints public.listing_images_unique_position immediate',
  'the reordered positions are genuinely unique, not just deferred'
);

set constraints public.listing_images_unique_position deferred;

select throws_ok(
  $$select public.set_listing_image_order('aaaa0003-0000-0000-0000-000000000003', array(select id from public.listing_images where listing_id = 'aaaa0003-0000-0000-0000-000000000003'))$$,
  'P0001', null,
  'reordering photos on an ACTIVE listing is rejected'
);

select throws_ok(
  $$select public.set_listing_image_order('aaaa0003-0000-0000-0000-000000000001', array[(select id from public.listing_images where storage_path like '%/aaaa0003-0000-0000-0000-000000000001/o1.jpg'), (select id from public.listing_images where storage_path like '%/aaaa0003-0000-0000-0000-000000000001/o2.jpg'), (select id from public.listing_images where storage_path like '%/aaaa0003-0000-0000-0000-000000000002/other1.jpg')])$$,
  '42501', null,
  'an image id belonging to a different listing is rejected'
);

select throws_ok(
  $$select public.set_listing_image_order('aaaa0003-0000-0000-0000-000000000001', array[(select id from public.listing_images where storage_path like '%/aaaa0003-0000-0000-0000-000000000001/o1.jpg'), (select id from public.listing_images where storage_path like '%/aaaa0003-0000-0000-0000-000000000001/o1.jpg'), (select id from public.listing_images where storage_path like '%/aaaa0003-0000-0000-0000-000000000001/o2.jpg')])$$,
  'P0001', null,
  'duplicate image ids are rejected'
);

select throws_ok(
  $$select public.set_listing_image_order('aaaa0003-0000-0000-0000-000000000001', array[(select id from public.listing_images where storage_path like '%/aaaa0003-0000-0000-0000-000000000001/o1.jpg')])$$,
  'P0001', null,
  'a partial order that omits some images is rejected'
);

select throws_ok(
  $$select public.set_listing_image_order('aaaa0003-0000-0000-0000-000000000001', array[]::uuid[])$$,
  'P0001', null,
  'an empty order array is rejected'
);

set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000b","role":"authenticated"}';

-- Before the ownership test: B cannot even enumerate the rows, because the
-- listing_images SELECT policy follows listing visibility and A's draft is
-- invisible to B. That is why the ownership case below passes literal ids --
-- an id-bearing attacker is the case actually worth testing, and building
-- the array from a subquery here would silently test the empty-array guard
-- instead.
select ok(
  array_length(array(select id from public.listing_images
                      where listing_id = 'aaaa0003-0000-0000-0000-000000000001'), 1) is null,
  'another seller cannot even enumerate a draft''s image rows'
);

select throws_ok(
  $$select public.set_listing_image_order('aaaa0003-0000-0000-0000-000000000001', array['dddd0000-0000-0000-0000-000000000001','dddd0000-0000-0000-0000-000000000002','dddd0000-0000-0000-0000-000000000003']::uuid[])$$,
  '42501', null,
  'reordering another seller''s listing is rejected on ownership, before the ids are even considered'
);
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

set local role anon;
select throws_ok(
  $$select public.set_listing_image_order('aaaa0003-0000-0000-0000-000000000001', array[]::uuid[])$$,
  '42501', null,
  'anon cannot execute set_listing_image_order'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 19. publish_listing
-- ============================================================

do $do$
begin
  perform public.attach_listing_image(
    'aaaa0004-0000-0000-0000-000000000001'::uuid,
    'f2000000-0000-0000-0000-00000000000a/aaaa0004-0000-0000-0000-000000000001/pub1.jpg');
  perform public.attach_listing_image(
    'aaaa0004-0000-0000-0000-000000000006'::uuid,
    'f2000000-0000-0000-0000-00000000000a/aaaa0004-0000-0000-0000-000000000006/ghost.jpg');
end
$do$;

select is(
  (select l.status from public.publish_listing('aaaa0004-0000-0000-0000-000000000001') l),
  'active'::listing_status,
  'a complete draft with a real photo publishes to active'
);

select throws_ok(
  $$select public.publish_listing('aaaa0004-0000-0000-0000-000000000001')$$,
  'P0001', null,
  'publishing an already-published listing is rejected -- double publish is closed'
);

select throws_ok(
  $$select public.publish_listing('aaaa0004-0000-0000-0000-000000000002')$$,
  'P0001', null,
  'publishing a draft with no title is rejected'
);

select throws_ok(
  $$select public.publish_listing('aaaa0004-0000-0000-0000-000000000003')$$,
  'P0001', null,
  'publishing a draft with no price is rejected'
);

select throws_ok(
  $$select public.publish_listing('aaaa0004-0000-0000-0000-000000000004')$$,
  'P0001', null,
  'publishing a draft with no condition is rejected'
);

select throws_ok(
  $$select public.publish_listing('aaaa0004-0000-0000-0000-000000000007')$$,
  'P0001', null,
  'publishing a draft with no size is rejected -- the server, not the client, is authoritative'
);

select throws_ok(
  $$select public.publish_listing('aaaa0004-0000-0000-0000-000000000005')$$,
  'P0001', null,
  'publishing a draft with zero photos is rejected'
);

-- The trustworthy-image re-verification: the row was attached against a real
-- object, but the object was removed afterwards while the listing was still
-- a draft. A published listing must never reference a missing file.
reset role;
delete from storage.objects
 where name = 'f2000000-0000-0000-0000-00000000000a/aaaa0004-0000-0000-0000-000000000006/ghost.jpg';
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select throws_ok(
  $$select public.publish_listing('aaaa0004-0000-0000-0000-000000000006')$$,
  'P0001', null,
  'publishing a draft whose photo object was deleted is rejected'
);

select throws_ok(
  $$select public.publish_listing('bbbb0004-0000-0000-0000-000000000001')$$,
  '42501', null,
  'publishing another seller''s draft is rejected'
);

select throws_ok(
  $$select public.publish_listing('cccc0000-0000-0000-0000-00000000dead')$$,
  'P0002', null,
  'publishing a listing that does not exist is rejected as not-found'
);

-- Title trimming: publish requires 3 trimmed characters, and the M1
-- constraint refuses to store anything less, so the two agree exactly and a
-- whitespace-only title can never reach publish in the first place.
select throws_ok(
  $$update public.listings set title = '   ' where id = 'aaaa0004-0000-0000-0000-000000000002'$$,
  '23514', null,
  'a whitespace-only title cannot even be stored -- the constraint matches publish''s trimmed check'
);

set local role anon;
select throws_ok(
  $$select public.publish_listing('aaaa0004-0000-0000-0000-000000000001')$$,
  '42501', null,
  'anon cannot execute publish_listing'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 20. listing_images direct DELETE is draft-scoped
-- ============================================================
-- The one remaining direct client write path on this table. Phase 1 left it
-- owner-scoped but not draft-scoped; M3 closed that.

delete from public.listing_images
 where storage_path = 'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000001/i2.jpg';

reset role;
select ok(
  not exists(select 1 from public.listing_images
              where storage_path = 'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000001/i2.jpg'),
  'removing a photo from my own draft succeeds -- the DB row goes first'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

delete from public.listing_images
 where storage_path = 'f2000000-0000-0000-0000-00000000000a/aaaa0004-0000-0000-0000-000000000001/pub1.jpg';

reset role;
select ok(
  exists(select 1 from public.listing_images
          where storage_path = 'f2000000-0000-0000-0000-00000000000a/aaaa0004-0000-0000-0000-000000000001/pub1.jpg'),
  'removing a photo from my own now-ACTIVE listing is denied'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000b","role":"authenticated"}';

delete from public.listing_images
 where storage_path = 'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000001/i1.jpg';

reset role;
select ok(
  exists(select 1 from public.listing_images
          where storage_path = 'f2000000-0000-0000-0000-00000000000a/aaaa0002-0000-0000-0000-000000000001/i1.jpg'),
  'removing a photo from another seller''s draft is denied'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select * from finish();

rollback;
