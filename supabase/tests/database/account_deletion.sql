-- pgTAP tests for ROADMAP 6.1b "Settings: account deletion" --
-- 20261021065243_account_deletion_sentinel_and_reassignment.sql and
-- 20261021065411_account_deletion_rpc.sql.
--
-- Run with: pnpm exec supabase test db --local
--
-- Same conventions as every other suite here: 4-arg throws_ok(sql, sqlstate,
-- null, description) -- the 3-arg form's third argument is the expected
-- MESSAGE, not a description -- and SQLSTATE assertions only, never message
-- text. An RLS USING denial matches zero rows silently rather than raising,
-- so those cases are asserted by row survival/absence, checked under
-- `reset role` where the denied caller could not see the answer themselves.
-- A direct `select public.some_rpc(...)` or a direct INSERT with no
-- is()/throws_ok()/ok()/lives_ok() wrapper is fixture setup, not an
-- assertion, and does not count toward plan().
create extension if not exists pgtap with schema extensions;

begin;

select plan(45);

-- ============================================================
-- FIXTURES
-- ============================================================
-- Suite UUID namespace is fc... (f1 profiles, f2 listings, f3 feed, f4
-- favorites, f5 chat, f7 follows, f8/f9 ai_suggestion_calls/reports, fa
-- blocks, fb reviews -- confirmed free before claiming it), so this file
-- can never collide with another suite. The sentinel account itself is
-- 00000000-0000-0000-0000-000000000001, created by
-- 20261021065243_account_deletion_sentinel_and_reassignment.sql, not by
-- this file -- it already exists before this transaction starts.
--
-- Users:
--   RPC_A (...01) / RPC_B (...02) -- exercise request_account_deletion()
--   itself, independently of the trigger. B exists purely to prove the RPC
--   never touches another user's listings (cross-user isolation).
--
--   D    (...03) -- the departing user the TRIGGER tests are actually about.
--   SEL  (...04) -- sells SEL_L3; D messages SEL about it (D as BUYER);
--                   also reports D directly.
--   BUY  (...05) -- messages D about D_L1 AND D_L2 (D as SELLER on both);
--                   is the recorded buyer when D_L2 is marked sold; reviews
--                   D and is reviewed by D.
--
--   E1 (...06) / E2 (...07) -- a SEPARATE buyer/seller pair, kept entirely
--   apart from D/SEL/BUY, used only for the sequential-double-deletion
--   collision this migration's own header flags as fix (1)
--   (conversations_distinct_participants).
--
--   C1 (...08) / C2 (...09) / SEL2 (...0a) -- a separate trio for the OTHER
--   sequential-double-deletion collision, fix (2)
--   (conversations_listing_buyer_key): two different real buyers messaging
--   the same seller about the same listing, both later deleting their
--   accounts.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('fc000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-acctdel-rpca@test.dev', 'x', now(), now()),
  ('fc000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-acctdel-rpcb@test.dev', 'x', now(), now()),
  ('fc000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-acctdel-d@test.dev', 'x', now(), now()),
  ('fc000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-acctdel-sel@test.dev', 'x', now(), now()),
  ('fc000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-acctdel-buy@test.dev', 'x', now(), now()),
  ('fc000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-acctdel-e1@test.dev', 'x', now(), now()),
  ('fc000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-acctdel-e2@test.dev', 'x', now(), now()),
  ('fc000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-acctdel-c1@test.dev', 'x', now(), now()),
  ('fc000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-acctdel-c2@test.dev', 'x', now(), now()),
  ('fc000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-acctdel-sel2@test.dev', 'x', now(), now());

-- Every active row carries a category_id too: listings_complete_when_not_draft
-- requires it. 'c0000001-0000-4000-8000-000000000001' is the seeded
-- Women > Tops leaf (20261018100200_categories.sql), same constant every
-- other suite here uses.
insert into public.listings
  (id, seller_id, title, description, price_amount, condition, size, category_id, status)
values
  -- RPC_A's fixtures: two 'active' rows, transitioned to 'reserved'/'sold'
  -- via the real RPCs below (never a direct status write -- status has no
  -- client column grant, and the real transition RPCs are what every other
  -- suite here uses too).
  ('fcee0000-0000-0000-0000-000000000002', 'fc000000-0000-0000-0000-000000000001',
   'RPC_A active',     'ACCTDEL_RPCA_ACTIVE',  1000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('fcee0000-0000-0000-0000-000000000003', 'fc000000-0000-0000-0000-000000000001',
   'RPC_A to-reserve', 'ACCTDEL_RPCA_RESERVE', 1500, 'good', 'alpha_l', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('fcee0000-0000-0000-0000-000000000004', 'fc000000-0000-0000-0000-000000000001',
   'RPC_A to-sell',    'ACCTDEL_RPCA_SOLD',    2000, 'good', 'alpha_s', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('fcee0000-0000-0000-0000-000000000005', 'fc000000-0000-0000-0000-000000000002',
   'RPC_B active',     'ACCTDEL_RPCB_ACTIVE',  1200, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active'),
  -- D's fixtures.
  ('fcee0000-0000-0000-0000-000000000006', 'fc000000-0000-0000-0000-000000000003',
   'D listing one', 'ACCTDEL_D_L1', 3000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('fcee0000-0000-0000-0000-000000000007', 'fc000000-0000-0000-0000-000000000003',
   'D listing two', 'ACCTDEL_D_L2', 3500, 'good', 'alpha_l', 'c0000001-0000-4000-8000-000000000001', 'active'),
  -- SEL's fixture -- D messages about this one (D as buyer).
  ('fcee0000-0000-0000-0000-000000000008', 'fc000000-0000-0000-0000-000000000004',
   'SEL listing', 'ACCTDEL_SEL_L3', 4000, 'good', 'alpha_s', 'c0000001-0000-4000-8000-000000000001', 'active'),
  -- E2's fixture -- the sequential-double-deletion CHECK collision pair.
  ('fcee0000-0000-0000-0000-000000000009', 'fc000000-0000-0000-0000-000000000007',
   'E2 listing', 'ACCTDEL_E2_L5', 2200, 'good', 'eu_shoe_42', 'c0000001-0000-4000-8000-000000000001', 'active'),
  -- SEL2's fixture -- the sequential-double-deletion UNIQUE-index collision
  -- pair (two different buyers, same seller, same listing).
  ('fcee0000-0000-0000-0000-00000000000a', 'fc000000-0000-0000-0000-00000000000a',
   'SEL2 listing', 'ACCTDEL_SEL2_L4', 2600, 'good', 'eu_shoe_40', 'c0000001-0000-4000-8000-000000000001', 'active');

-- A plain draft -- no completeness columns required.
insert into public.listings (id, seller_id)
values ('fcee0000-0000-0000-0000-000000000001', 'fc000000-0000-0000-0000-000000000001');

-- One listing_image on SEL_L3 so record_listing_impression's eligibility
-- check (active AND at least one image) is satisfiable below -- inserted
-- directly while still connected as the superuser, mirroring every other
-- suite's fixture-phase direct inserts.
insert into public.listing_images (listing_id, storage_path, "position")
values ('fcee0000-0000-0000-0000-000000000008', 'fc000000-0000-0000-0000-000000000004/fcee0000-0000-0000-0000-000000000008/0.jpg', 0);

-- ============================================================
-- 1. The sentinel account exists and is well-formed
-- ============================================================

select ok(
  exists(select 1 from auth.users where id = '00000000-0000-0000-0000-000000000001'),
  'the sentinel auth.users row exists'
);

select is(
  (select display_name from public.profiles where id = '00000000-0000-0000-0000-000000000001'),
  'Deleted user',
  'the sentinel profile is anonymized to "Deleted user"'
);

select ok(
  (select username from public.profiles where id = '00000000-0000-0000-0000-000000000001') is null,
  'the sentinel profile has no username'
);

-- Regression guard for a real bug caught in review: these four columns
-- have no column DEFAULT (confirmed via information_schema) and a real
-- GoTrue signup's application code -- not the database -- is what writes
-- '' into them. A direct SQL insert that omits any of them leaves it NULL,
-- which doesn't just affect this one row: GoTrue's Admin API scans the
-- ENTIRE auth.users table into non-nullable Go strings for these columns,
-- so a single NULL anywhere makes `listUsers()`/`getUserById()` -- and with
-- them, Supabase Studio's own Authentication -> Users page -- fail with a
-- 500 for EVERY user, project-wide, not just the sentinel. Verified live
-- against a real local stack before writing this assertion, not assumed.
select ok(
  (select confirmation_token is not null
     and recovery_token is not null
     and email_change_token_new is not null
     and email_change is not null
     from auth.users where id = '00000000-0000-0000-0000-000000000001'),
  'the sentinel has no NULL text columns that would break GoTrue''s Admin API user-listing scan'
);

-- Regression guard for the Critical finding from ROADMAP 6.4's full-schema
-- security audit: with Auth confirmations disabled (this repo's local
-- config), a plain POST /auth/v1/signup against an email that exists but
-- has NEVER been confirmed (email_confirmed_at null) is treated by GoTrue
-- as completing an abandoned signup -- it silently accepts a new
-- attacker-chosen password and returns a fully valid, fully authenticated
-- session for that user id, never checking the existing encrypted_password
-- at all. Verified live against a real local stack before this fix: an
-- anonymous signup call against the sentinel's email returned a real
-- session whose `sub` was the sentinel's id -- a full account takeover
-- that would expose every deleted user's reassigned conversations/listings
-- to anyone who simply read this migration file's own hardcoded email.
-- Fixed by setting email_confirmed_at at creation time; verified live that
-- the identical signup call now correctly returns 422 user_already_exists
-- instead. pgTAP has no path to GoTrue's own HTTP API to re-run that exact
-- exploit as a test, so this asserts the one column whose NULL-ness is what
-- made the exploit reachable in the first place -- the same proxy-assertion
-- shape as the NULL-text-column guard immediately above.
select ok(
  (select email_confirmed_at is not null from auth.users where id = '00000000-0000-0000-0000-000000000001'),
  'the sentinel is pre-confirmed, so an unauthenticated signup against its email cannot hijack it'
);

-- ============================================================
-- 2. anon cannot execute request_account_deletion()
-- ============================================================

set local role anon;

select throws_ok(
  $$select public.request_account_deletion()$$,
  '42501', null,
  'anon cannot execute request_account_deletion -- no EXECUTE grant'
);

-- ============================================================
-- 3-7, 18. request_account_deletion() -- draft/active/reserved/sold,
-- cross-user isolation, idempotency
-- ============================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Fixture setup via the real transition RPCs, not a direct status write.
select public.mark_listing_reserved('fcee0000-0000-0000-0000-000000000003');
select public.mark_listing_sold('fcee0000-0000-0000-0000-000000000004');

select lives_ok(
  $$select public.request_account_deletion()$$,
  'request_account_deletion runs without error for an account with a draft, an active, a reserved, and a sold listing'
);

reset role;

select is(
  (select count(*)::int from public.listings where seller_id = 'fc000000-0000-0000-0000-000000000001' and status = 'draft'),
  0,
  'the RPC hard-deletes the caller''s own draft listing'
);

select is(
  (select status::text from public.listings where id = 'fcee0000-0000-0000-0000-000000000002'),
  'removed',
  'the RPC sets the caller''s active listing to removed'
);

select is(
  (select status::text from public.listings where id = 'fcee0000-0000-0000-0000-000000000003'),
  'removed',
  'the RPC sets the caller''s reserved listing to removed'
);

select is(
  (select status::text from public.listings where id = 'fcee0000-0000-0000-0000-000000000004'),
  'sold',
  'the RPC leaves the caller''s sold listing completely untouched'
);

select is(
  (select status::text from public.listings where id = 'fcee0000-0000-0000-0000-000000000005'),
  'active',
  'the RPC does not affect another user''s (RPC_B''s) active listing'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.request_account_deletion()$$,
  'calling request_account_deletion a second time for an already-cleaned-up account is a safe no-op'
);

reset role;

select is(
  (select status::text from public.listings where id = 'fcee0000-0000-0000-0000-000000000002'),
  'removed',
  'the second call left the already-removed listing exactly as it was'
);

-- ============================================================
-- Trigger lockdown -- mirrors chat.sql's identical assertion for
-- touch_conversation_last_message exactly: a BEFORE DELETE trigger function
-- is invoked by the executor, never called by name, so it needs no EXECUTE
-- grant to fire, and the default PUBLIC grant is revoked so it is not a
-- callable `POST /rest/v1/rpc/...` endpoint either.
-- ============================================================

select ok(
  not has_function_privilege('authenticated', 'public.reassign_departing_user_rows()', 'execute'),
  'authenticated holds no EXECUTE on the reassignment trigger function -- it is not a reachable endpoint'
);

-- ============================================================
-- TRIGGER FIXTURES: D, SEL, BUY
-- ============================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-000000000005","role":"authenticated"}';

-- BUY messages D about D_L1 (D as SELLER) -- conversation "CV_A".
select public.get_or_create_listing_conversation('fcee0000-0000-0000-0000-000000000006');
-- BUY messages D about D_L2 too (D as SELLER again) -- conversation "CV_C",
-- needed so mark_listing_sold below accepts BUY as the buyer (it requires
-- the buyer to have messaged about THIS listing).
select public.get_or_create_listing_conversation('fcee0000-0000-0000-0000-000000000007');

-- A client-session lookup for CV_A/CV_C's ids, built as the superuser --
-- same reason and same shape as chat.sql's own `chat_conv` temp table:
-- `listing_id` is outside the client column allowlist on `conversations`,
-- and BUY/seller-D are indistinguishable between CV_A and CV_C from the
-- columns the client CAN see (buyer_id and seller_id are identical on both
-- rows -- BUY messaged the same seller D about two different listings).
reset role;
create temp table acctdel_conv as
select
  (select c.id from public.conversations c where c.listing_id = 'fcee0000-0000-0000-0000-000000000006') as conv_a,
  (select c.id from public.conversations c where c.listing_id = 'fcee0000-0000-0000-0000-000000000007') as conv_c;
grant select on acctdel_conv to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-000000000005","role":"authenticated"}';

-- BUY sends a message into CV_A -- the OTHER party's message, which item 13
-- below asserts keeps its own real sender_id after D is deleted.
insert into public.messages (conversation_id, sender_id, body, client_nonce)
values ((select conv_a from acctdel_conv), 'fc000000-0000-0000-0000-000000000005', 'Is this still available?', 'acctdel-buy-nonce-1');

set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-000000000003","role":"authenticated"}';

-- D sends a message into CV_A -- D's OWN message, which item 11 below
-- asserts is reassigned to the sentinel.
insert into public.messages (conversation_id, sender_id, body, client_nonce)
values ((select conv_a from acctdel_conv), 'fc000000-0000-0000-0000-000000000003', 'Yes, still available.', 'acctdel-d-nonce-1');

-- D messages SEL about SEL_L3 (D as BUYER) -- conversation "CV_B".
select public.get_or_create_listing_conversation('fcee0000-0000-0000-0000-000000000008');

set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-000000000003","role":"authenticated"}';

-- D marks D_L2 sold to BUY -- BUY already messaged about it (CV_C above).
select public.mark_listing_sold('fcee0000-0000-0000-0000-000000000007', 'fc000000-0000-0000-0000-000000000005');

-- D favorites SEL_L3.
insert into public.favorites (user_id, listing_id)
values ('fc000000-0000-0000-0000-000000000003', 'fcee0000-0000-0000-0000-000000000008');

-- D records an impression on SEL_L3.
select public.record_listing_impression('fcee0000-0000-0000-0000-000000000008', 'acctdel-session-d-0001');

-- D follows SEL.
insert into public.follows (follower_id, followed_id)
values ('fc000000-0000-0000-0000-000000000003', 'fc000000-0000-0000-0000-000000000004');

-- D blocks SEL2.
insert into public.blocks (blocker_id, blocked_id)
values ('fc000000-0000-0000-0000-000000000003', 'fc000000-0000-0000-0000-00000000000a');

-- D reports SEL directly -- reporter_id cascades (pre-existing, unaffected).
insert into public.reports (reporter_id, reported_user_id, reason)
values ('fc000000-0000-0000-0000-000000000003', 'fc000000-0000-0000-0000-000000000004', 'harassment');

set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-000000000005","role":"authenticated"}';

-- BUY reviews D -- reviewer=BUY, reviewee=D (D is the seller of D_L2).
select public.submit_review('fcee0000-0000-0000-0000-000000000007'::uuid, 5::smallint, 'Great seller!');

set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-000000000003","role":"authenticated"}';

-- D reviews BUY back -- reviewer=D, reviewee=BUY.
select public.submit_review('fcee0000-0000-0000-0000-000000000007'::uuid, 4::smallint, 'Great buyer!');

-- SEL reports D directly -- reported_user_id SET NULLs (pre-existing,
-- unaffected); this row must SURVIVE D's deletion.
set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-000000000004","role":"authenticated"}';
insert into public.reports (reporter_id, reported_user_id, reason, note)
values ('fc000000-0000-0000-0000-000000000004', 'fc000000-0000-0000-0000-000000000003', 'other', 'Flaky on handoff location');

-- A rate-limit ledger row for D, inserted directly as the superuser (no
-- client INSERT grant exists on this table at all -- record_ai_suggestion_attempt
-- is the only writer, and this is purely fixture setup, not an exercise of
-- that RPC).
reset role;
insert into public.ai_suggestion_calls (user_id, listing_id)
values ('fc000000-0000-0000-0000-000000000003', null);

-- ============================================================
-- Sanity checks -- state exists BEFORE D is deleted, so the "gone after"
-- assertions below prove something real disappeared rather than having
-- never existed.
-- ============================================================

select is(
  (select count(*)::int from public.reviews
    where reviewer_id = 'fc000000-0000-0000-0000-000000000003'
       or reviewee_id = 'fc000000-0000-0000-0000-000000000003'),
  2,
  'sanity: D has exactly two review rows (one as reviewer, one as reviewee) before deletion'
);

select is(
  (select count(*)::int from public.reports where reporter_id = 'fc000000-0000-0000-0000-000000000003'),
  1,
  'sanity: exactly one report authored by D exists before deletion'
);

-- ============================================================
-- THE DELETE -- fires the BEFORE DELETE reassignment trigger, then
-- Postgres's own CASCADE machinery.
-- ============================================================

delete from auth.users where id = 'fc000000-0000-0000-0000-000000000003';

-- ============================================================
-- 8. listings.seller_id reassigned to the sentinel
-- ============================================================

select is(
  (select count(*)::int from public.listings where seller_id = 'fc000000-0000-0000-0000-000000000003'),
  0,
  'no listing still names D as seller_id after D is deleted'
);

select is(
  (select count(*)::int from public.listings
    where seller_id = '00000000-0000-0000-0000-000000000001'
      and id in ('fcee0000-0000-0000-0000-000000000006', 'fcee0000-0000-0000-0000-000000000007')),
  2,
  'both of D''s former listings now have seller_id reassigned to the sentinel'
);

-- ============================================================
-- 9. conversations.buyer_id reassigned (D was the buyer, CV_B)
-- ============================================================

select is(
  (select buyer_id from public.conversations where listing_id = 'fcee0000-0000-0000-0000-000000000008'),
  '00000000-0000-0000-0000-000000000001'::uuid,
  'CV_B''s buyer_id is reassigned to the sentinel -- D was the buyer'
);

-- ============================================================
-- 10. conversations.seller_id reassigned (D was the seller, CV_A and CV_C)
-- ============================================================

select is(
  (select count(*)::int from public.conversations
    where seller_id = '00000000-0000-0000-0000-000000000001'
      and listing_id in ('fcee0000-0000-0000-0000-000000000006', 'fcee0000-0000-0000-0000-000000000007')),
  2,
  'both conversations where D was the seller now have seller_id reassigned to the sentinel'
);

-- ============================================================
-- 11. messages.sender_id reassigned for D's own message in CV_A
-- ============================================================

select is(
  (select sender_id from public.messages where client_nonce = 'acctdel-d-nonce-1'),
  '00000000-0000-0000-0000-000000000001'::uuid,
  'D''s own message in CV_A is reassigned to the sentinel'
);

-- ============================================================
-- 12. CV_A and ALL its messages still exist -- the key regression guard
-- ============================================================

select is(
  (select count(*)::int from public.conversations where listing_id = 'fcee0000-0000-0000-0000-000000000006'),
  1,
  'CV_A itself still exists after D (its seller) is deleted'
);

select is(
  (select count(*)::int from public.messages m
     join public.conversations c on c.id = m.conversation_id
    where c.listing_id = 'fcee0000-0000-0000-0000-000000000006'),
  2,
  'both messages in CV_A still exist -- the trigger ran before CASCADE had anything left to remove'
);

-- ============================================================
-- 13. The OTHER party's (BUY's) message keeps its own real sender_id
-- ============================================================

select is(
  (select sender_id from public.messages where client_nonce = 'acctdel-buy-nonce-1'),
  'fc000000-0000-0000-0000-000000000005'::uuid,
  'BUY''s own message in the same conversation is unaffected, still attributed to BUY'
);

-- ============================================================
-- 14. favorites/listing_events/follows/blocks/ai_suggestion_calls for D are
-- gone -- pre-existing cascades, unchanged by this migration
-- ============================================================

select is(
  (select count(*)::int from public.favorites where user_id = 'fc000000-0000-0000-0000-000000000003'),
  0,
  'D''s favorite is gone'
);

select is(
  (select count(*)::int from public.listing_events where user_id = 'fc000000-0000-0000-0000-000000000003'),
  0,
  'D''s listing_events row is gone'
);

select is(
  (select count(*)::int from public.follows where follower_id = 'fc000000-0000-0000-0000-000000000003'),
  0,
  'D''s follow row is gone'
);

select is(
  (select count(*)::int from public.blocks where blocker_id = 'fc000000-0000-0000-0000-000000000003'),
  0,
  'D''s block row is gone'
);

select is(
  (select count(*)::int from public.ai_suggestion_calls where user_id = 'fc000000-0000-0000-0000-000000000003'),
  0,
  'D''s ai_suggestion_calls row is gone'
);

-- ============================================================
-- 15. reports -- reporter cascade fires, SET NULL target survives
-- ============================================================

select is(
  (select count(*)::int from public.reports where reporter_id = 'fc000000-0000-0000-0000-000000000003'),
  0,
  'the report D authored is gone -- reporter_id cascades, unchanged by this migration'
);

select is(
  (select count(*)::int from public.reports
    where reporter_id = 'fc000000-0000-0000-0000-000000000004' and reported_user_id is null),
  1,
  'the report SEL filed against D survives, with reported_user_id nulled -- unchanged by this migration'
);

-- ============================================================
-- 16. reviews.reviewer_id/reviewee_id reassigned to the sentinel
-- ============================================================
-- Fixed by 20261021101633 -- reviews.reviewer_id/reviewee_id used to
-- reference auth.users directly, bypassing this trigger entirely and
-- cascading away regardless of role (BUY's own, otherwise-untouched review
-- content was collateral damage of D's unrelated deletion). Retargeted
-- through profiles, same as every other reassigned column, so both of D's
-- review rows now survive this delete with D's own side reassigned --
-- BUY's own side of each row is untouched, since BUY was never deleted.

select is(
  (select count(*)::int from public.reviews
    where reviewer_id = 'fc000000-0000-0000-0000-000000000003'
       or reviewee_id = 'fc000000-0000-0000-0000-000000000003'),
  0,
  'D no longer appears as reviewer or reviewee under D''s own former id'
);

select is(
  (select count(*)::int from public.reviews
    where listing_id = 'fcee0000-0000-0000-0000-000000000007'
      and reviewer_id = '00000000-0000-0000-0000-000000000001'
      and reviewee_id = 'fc000000-0000-0000-0000-000000000005'),
  1,
  'D''s own review of BUY survives, reviewer_id reassigned to the sentinel'
);

select is(
  (select count(*)::int from public.reviews
    where listing_id = 'fcee0000-0000-0000-0000-000000000007'
      and reviewer_id = 'fc000000-0000-0000-0000-000000000005'
      and reviewee_id = '00000000-0000-0000-0000-000000000001'),
  1,
  'BUY''s review of D survives, reviewee_id reassigned to the sentinel -- BUY''s own reviewer_id is untouched, BUY was never deleted'
);

-- ============================================================
-- SCOPE ADDED BEYOND THE PLAN, flagged in the migration's own header --
-- (1): conversations_distinct_participants, relaxed to tolerate two
-- INDEPENDENT, sequential deletions reassigning BOTH sides of one
-- conversation to the sentinel.
-- ============================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-000000000006","role":"authenticated"}';

-- E1 messages E2 about E2_L5 -- "CV_E".
select public.get_or_create_listing_conversation('fcee0000-0000-0000-0000-000000000009');

set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-000000000007","role":"authenticated"}';

-- E2 (the seller) marks E2_L5 sold to E1 -- required so both of E1/E2 can
-- review each other below, and reused (not a separate fixture pair) so one
-- coherent "two people who transacted, both later delete" story covers
-- BOTH this file's own fix-(1)/(2) collisions AND 20261021101633's reviews
-- collision in a single sequential-deletion scenario.
select public.mark_listing_sold('fcee0000-0000-0000-0000-000000000009', 'fc000000-0000-0000-0000-000000000006');

-- E2 reviews E1 -- reviewer=E2, reviewee=E1.
select public.submit_review('fcee0000-0000-0000-0000-000000000009'::uuid, 5::smallint, 'Smooth buyer!');

set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-000000000006","role":"authenticated"}';

-- E1 reviews E2 back -- reviewer=E1, reviewee=E2.
select public.submit_review('fcee0000-0000-0000-0000-000000000009'::uuid, 5::smallint, 'Smooth seller!');

reset role;

select is(
  (select count(*)::int from public.reviews where listing_id = 'fcee0000-0000-0000-0000-000000000009'),
  2,
  'sanity: E2_L5 has exactly two review rows (E1<->E2) before either account is deleted'
);

select lives_ok(
  $$delete from auth.users where id = 'fc000000-0000-0000-0000-000000000006'$$,
  'deleting E1 (the buyer) reassigns CV_E''s buyer_id to the sentinel without error'
);

select is(
  (select buyer_id from public.conversations where listing_id = 'fcee0000-0000-0000-0000-000000000009'),
  '00000000-0000-0000-0000-000000000001'::uuid,
  'CV_E''s buyer_id is now the sentinel'
);

-- THE regression this fix exists for: without the relaxed CHECK, this
-- would raise 23514 (buyer_id = seller_id, both now the sentinel) and abort
-- E2's entire account deletion.
select lives_ok(
  $$delete from auth.users where id = 'fc000000-0000-0000-0000-000000000007'$$,
  'deleting E2 (the seller) too -- on a row whose buyer_id is ALREADY the sentinel -- still does not error'
);

select is(
  (select count(*)::int from public.conversations
    where listing_id = 'fcee0000-0000-0000-0000-000000000009'
      and buyer_id = '00000000-0000-0000-0000-000000000001'
      and seller_id = '00000000-0000-0000-0000-000000000001'),
  1,
  'CV_E survives as a single row with BOTH sides now the sentinel'
);

-- Same collision, same fixture pair, for 20261021101633's reviews fix --
-- the `lives_ok` on E2's own delete above already proves neither
-- reviews_reviewer_not_reviewee (23514) nor the partial
-- reviews_unique_listing_reviewer index (23505) raised; this confirms the
-- two review rows actually ended up correctly reassigned, not just that
-- nothing errored.
select is(
  (select count(*)::int from public.reviews
    where listing_id = 'fcee0000-0000-0000-0000-000000000009'
      and reviewer_id = '00000000-0000-0000-0000-000000000001'
      and reviewee_id = '00000000-0000-0000-0000-000000000001'),
  2,
  'both of E1/E2''s reviews survive with BOTH sides now the sentinel, same as CV_E'
);

-- ============================================================
-- SCOPE ADDED BEYOND THE PLAN, flagged in the migration's own header --
-- (2): conversations_listing_buyer_key, made partial to tolerate two
-- DIFFERENT real buyers of the same listing both later being reassigned to
-- the sentinel.
-- ============================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-000000000008","role":"authenticated"}';
select public.get_or_create_listing_conversation('fcee0000-0000-0000-0000-00000000000a');

set local request.jwt.claims = '{"sub":"fc000000-0000-0000-0000-000000000009","role":"authenticated"}';
select public.get_or_create_listing_conversation('fcee0000-0000-0000-0000-00000000000a');

reset role;

select lives_ok(
  $$delete from auth.users where id = 'fc000000-0000-0000-0000-000000000008'$$,
  'deleting C1 reassigns their conversation''s buyer_id to the sentinel without error'
);

-- THE regression this fix exists for: without the partial index, this
-- would raise 23505 (listing_id, buyer_id) colliding with C1's now-sentinel
-- row, aborting C2's entire account deletion.
select lives_ok(
  $$delete from auth.users where id = 'fc000000-0000-0000-0000-000000000009'$$,
  'deleting C2 too -- a SECOND buyer of the SAME listing -- still does not error'
);

select is(
  (select count(*)::int from public.conversations
    where listing_id = 'fcee0000-0000-0000-0000-00000000000a' and buyer_id = '00000000-0000-0000-0000-000000000001'),
  2,
  'both C1''s and C2''s conversations survive independently, both now buyer_id = sentinel'
);

-- ============================================================
-- 17. Deleting the sentinel's own row does not error and does not reassign
-- anything to itself -- run LAST, since this (and its cascade) would
-- otherwise destroy every row the assertions above just verified.
-- ============================================================

select lives_ok(
  $$delete from auth.users where id = '00000000-0000-0000-0000-000000000001'$$,
  'deleting the sentinel''s own row does not error -- the trigger''s self-guard skips the reassignment entirely'
);

select * from finish();

rollback;
