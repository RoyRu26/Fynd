-- pgTAP tests for the Home discovery feed foundation.
--
-- Run with: pnpm exec supabase test db --local
--
-- Covers the three feed migrations: cross-seller Storage read access,
-- listing_events + record_listing_impression, and feed_listings.
--
-- Conventions match the existing suites: 4-arg throws_ok(sql, sqlstate,
-- null, description) -- the 3-arg form's third argument is the expected
-- MESSAGE, not a description -- and SQLSTATE assertions only, never
-- message text. An RLS USING denial matches zero rows silently rather than
-- raising, so those cases are asserted by row survival/visibility, checked
-- under `reset role` where the denied caller could not see the answer
-- themselves.
create extension if not exists pgtap with schema extensions;

begin;

select plan(52);

-- ============================================================
-- FIXTURES
-- ============================================================
-- Three sellers. A owns the feed-eligible content, B is the "other seller"
-- whose privacy must hold, C is a pure viewer with nothing of their own.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('f3000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-feed-a@test.dev', 'x', now(), now()),
  ('f3000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-feed-b@test.dev', 'x', now(), now()),
  ('f3000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-feed-c@test.dev', 'x', now(), now());

-- Listings are inserted privileged: id and status are not client-writable,
-- and created_at must be controlled precisely to assert feed ordering.
-- Every active row carries a size AND a category_id:
-- listings_complete_when_not_draft now requires both. 'Active two' uses a
-- shoe size so the feed is proven to carry both halves of the prefixed enum
-- through to the client. 'c0000001-0000-4000-8000-000000000001' is the
-- seeded Women > Tops leaf (20261018100200_categories.sql).
insert into public.listings
  (id, seller_id, title, description, price_amount, condition, size, category_id, status, created_at)
values
  -- A's active listings, oldest -> newest. These are the feed.
  ('aaaa1000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-00000000000a',
   'Active one',   'FEED_1', 1000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active', '2026-01-01 10:00:00+00'),
  ('aaaa1000-0000-0000-0000-000000000002', 'f3000000-0000-0000-0000-00000000000a',
   'Active two',   'FEED_2', 2000, 'good', 'eu_shoe_42', 'c0000001-0000-4000-8000-000000000001', 'active', '2026-01-02 10:00:00+00'),
  ('aaaa1000-0000-0000-0000-000000000003', 'f3000000-0000-0000-0000-00000000000a',
   'Active three', 'FEED_3', 3000, 'good', 'alpha_l', 'c0000001-0000-4000-8000-000000000001', 'active', '2026-01-03 10:00:00+00'),
  -- Active but NO images: must never appear in the feed.
  ('aaaa1000-0000-0000-0000-000000000004', 'f3000000-0000-0000-0000-00000000000a',
   'Active imageless', 'FEED_NOIMG', 4000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active', '2026-01-04 10:00:00+00'),
  -- Cover-gap case: its position-0 image was removed, leaving 1 and 2.
  ('aaaa1000-0000-0000-0000-000000000005', 'f3000000-0000-0000-0000-00000000000a',
   'Active gap', 'FEED_GAP', 5000, 'good', 'one_size', 'c0000001-0000-4000-8000-000000000001', 'active', '2026-01-05 10:00:00+00'),
  -- A's draft: never in the feed, images never readable by others. No size
  -- and no category, which is legal for a draft and proves the feed
  -- excludes it for status reasons rather than incidentally.
  ('aaaa1000-0000-0000-0000-000000000006', 'f3000000-0000-0000-0000-00000000000a',
   'A draft', 'FEED_DRAFT_A', 6000, 'good', null, null, 'draft', '2026-01-06 10:00:00+00'),
  -- C's own active listing, for the exclude-own-listings assertions.
  ('cccc1000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-00000000000c',
   'C own active', 'FEED_OWN_C', 7000, 'good', 'alpha_s', 'c0000001-0000-4000-8000-000000000001', 'active', '2026-01-07 10:00:00+00');

insert into public.listing_images (listing_id, storage_path, "position")
values
  ('aaaa1000-0000-0000-0000-000000000001',
   'f3000000-0000-0000-0000-00000000000a/aaaa1000-0000-0000-0000-000000000001/one.jpg', 0),
  ('aaaa1000-0000-0000-0000-000000000002',
   'f3000000-0000-0000-0000-00000000000a/aaaa1000-0000-0000-0000-000000000002/two.jpg', 0),
  ('aaaa1000-0000-0000-0000-000000000003',
   'f3000000-0000-0000-0000-00000000000a/aaaa1000-0000-0000-0000-000000000003/three.jpg', 0),
  -- Gap listing: positions 1 and 2 only. The cover must be position 1.
  ('aaaa1000-0000-0000-0000-000000000005',
   'f3000000-0000-0000-0000-00000000000a/aaaa1000-0000-0000-0000-000000000005/gap-second.jpg', 2),
  ('aaaa1000-0000-0000-0000-000000000005',
   'f3000000-0000-0000-0000-00000000000a/aaaa1000-0000-0000-0000-000000000005/gap-first.jpg', 1),
  -- A's draft image.
  ('aaaa1000-0000-0000-0000-000000000006',
   'f3000000-0000-0000-0000-00000000000a/aaaa1000-0000-0000-0000-000000000006/draft.jpg', 0),
  ('cccc1000-0000-0000-0000-000000000001',
   'f3000000-0000-0000-0000-00000000000c/cccc1000-0000-0000-0000-000000000001/own.jpg', 0);

-- Storage objects. Only (bucket_id, name) is written: path_tokens is
-- GENERATED ALWAYS and must never appear in an INSERT.
insert into storage.objects (bucket_id, name)
values
  ('listing-images', 'f3000000-0000-0000-0000-00000000000a/aaaa1000-0000-0000-0000-000000000001/one.jpg'),
  ('listing-images', 'f3000000-0000-0000-0000-00000000000a/aaaa1000-0000-0000-0000-000000000006/draft.jpg'),
  -- THE ORPHAN. Sits under an ACTIVE listing's directory but has no
  -- listing_images row: an upload whose attach step failed, or a photo the
  -- seller uploaded and discarded. A path-only policy would expose it.
  ('listing-images', 'f3000000-0000-0000-0000-00000000000a/aaaa1000-0000-0000-0000-000000000001/orphan.jpg'),
  -- C's own orphan, under C's own prefix.
  ('listing-images', 'f3000000-0000-0000-0000-00000000000c/cccc1000-0000-0000-0000-000000000001/own-orphan.jpg');

-- ============================================================
-- FIXTURE SCOPE
-- ============================================================
-- feed_listings is SECURITY INVOKER and returns EVERY eligible row the
-- caller may see -- which, run against a database that also holds real
-- development listings, is not just this suite's fixtures. Any assertion
-- that aggregates over the whole feed (a count, a string_agg, a bool_or) or
-- derives a cursor from a page is therefore only deterministic when it is
-- scoped to the rows this file created.
--
-- This table is that scope: the four of A's listings that are feed-eligible
-- (active, with at least one image). 'Active imageless' and 'A draft' are
-- deliberately absent -- their exclusion is what several assertions test, so
-- including them here would mask exactly those bugs. C's own listing is
-- absent too, since the own-listing assertions key on its title instead.
--
-- Scoping is applied ONLY where it is load-bearing. Assertions that already
-- name a single row (`where f.title = 'Active one'`), or that test a LIMIT
-- rather than a row set (`feed_listings(2)` returns 2), need nothing and are
-- left exactly as they were.
--
-- Fixture created_at values are all 2026-01-0x, so unrelated live rows sort
-- NEWER and lead the feed -- which is why a cursor derived from an
-- unscoped page 1 lands in dev data rather than in this suite's sequence.
create temp table feed_fixture (listing_id uuid primary key);

insert into feed_fixture (listing_id)
values
  ('aaaa1000-0000-0000-0000-000000000001'),   -- Active one
  ('aaaa1000-0000-0000-0000-000000000002'),   -- Active two
  ('aaaa1000-0000-0000-0000-000000000003'),   -- Active three
  ('aaaa1000-0000-0000-0000-000000000005');   -- Active gap

grant select on feed_fixture to authenticated;

-- ============================================================
-- 1. Storage SELECT -- cross-seller feed access
-- ============================================================
-- Acting as C, who owns none of A's content.

set local role authenticated;
set local request.jwt.claims = '{"sub":"f3000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select ok(
  exists(select 1 from storage.objects
          where name = 'f3000000-0000-0000-0000-00000000000a/aaaa1000-0000-0000-0000-000000000001/one.jpg'),
  'another seller''s ATTACHED image on an ACTIVE listing is readable -- this is what unblocks the feed'
);

-- The correction this migration exists for.
select ok(
  not exists(select 1 from storage.objects
              where name = 'f3000000-0000-0000-0000-00000000000a/aaaa1000-0000-0000-0000-000000000001/orphan.jpg'),
  'an UNATTACHED orphan under another seller''s ACTIVE listing directory is NOT readable -- path alone never authorises'
);

select ok(
  not exists(select 1 from storage.objects
              where name = 'f3000000-0000-0000-0000-00000000000a/aaaa1000-0000-0000-0000-000000000006/draft.jpg'),
  'another seller''s DRAFT image remains unreadable'
);

select ok(
  exists(select 1 from storage.objects
          where name = 'f3000000-0000-0000-0000-00000000000c/cccc1000-0000-0000-0000-000000000001/own-orphan.jpg'),
  'my own orphan stays readable to me, so I can still clean it up'
);

-- Acting as A, the owner of the draft.
set local request.jwt.claims = '{"sub":"f3000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select ok(
  exists(select 1 from storage.objects
          where name = 'f3000000-0000-0000-0000-00000000000a/aaaa1000-0000-0000-0000-000000000006/draft.jpg'),
  'my own draft image stays readable to me'
);

select ok(
  exists(select 1 from storage.objects
          where name = 'f3000000-0000-0000-0000-00000000000a/aaaa1000-0000-0000-0000-000000000001/orphan.jpg'),
  'my own orphan under my own active listing stays readable to me'
);

-- anon holds no storage policy at all.
set local role anon;
select ok(
  not exists(select 1 from storage.objects
              where name = 'f3000000-0000-0000-0000-00000000000a/aaaa1000-0000-0000-0000-000000000001/one.jpg'),
  'anon cannot read listing images at all'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f3000000-0000-0000-0000-00000000000c","role":"authenticated"}';

-- ============================================================
-- 2. feed_listings -- eligibility
-- ============================================================

-- Four of A's five active listings qualify (the imageless one does not), and
-- C's own active listing is excluded by the default -- so four. Scoped to
-- this suite's fixtures, so an unrelated live listing cannot inflate it.
select is(
  (select count(*)::int from public.feed_listings(50) f
    join feed_fixture ff on ff.listing_id = f.listing_id),
  4,
  'the feed returns exactly the active, imaged listings that are not my own'
);

select ok(
  not exists(
    select 1 from public.feed_listings(50) f where f.title = 'Active imageless'
  ),
  'an active listing with zero images is excluded'
);

select ok(
  not exists(
    select 1 from public.feed_listings(50) f where f.title = 'A draft'
  ),
  'a draft is excluded from the feed'
);

-- The exact case that rules out a PostgREST .eq(position, 0) filter.
select is(
  (select f.cover_storage_path from public.feed_listings(50) f where f.title = 'Active gap'),
  'f3000000-0000-0000-0000-00000000000a/aaaa1000-0000-0000-0000-000000000005/gap-first.jpg',
  'the cover is the MINIMUM position, not position 0 -- a listing whose cover was deleted still appears, with the right photo'
);

select is(
  (select f.seller_username from public.feed_listings(50) f where f.title = 'Active one'),
  (select username from public.profiles where id = 'f3000000-0000-0000-0000-00000000000a'),
  'seller context is joined in, so one card costs no extra query'
);

select is(
  (select f.size from public.feed_listings(50) f where f.title = 'Active one'),
  'alpha_m'::listing_size,
  'the feed carries size, so the card can render its second chip without another query'
);

select is(
  (select f.size from public.feed_listings(50) f where f.title = 'Active two'),
  'eu_shoe_42'::listing_size,
  'a numeric shoe size survives the feed RPC intact, not just alpha sizes'
);

select is(
  (select f.currency from public.feed_listings(50) f where f.title = 'Active one'),
  'ILS',
  'the feed carries the listing currency, so the card never hardcodes a symbol'
);

-- ============================================================
-- 2a. feed_listings -- is_favorited, resolved per viewer
-- ============================================================
-- C has favorited nothing yet.

select is(
  (select bool_or(f.is_favorited) from public.feed_listings(50) f
    join feed_fixture ff on ff.listing_id = f.listing_id),
  false,
  'nothing reads as favorited before anything is favorited'
);

insert into public.favorites (user_id, listing_id)
values ('f3000000-0000-0000-0000-00000000000c', 'aaaa1000-0000-0000-0000-000000000001');

select is(
  (select f.is_favorited from public.feed_listings(50) f where f.title = 'Active one'),
  true,
  'a favorited listing reads back as favorited, resolved in the same single query'
);

select is(
  (select f.is_favorited from public.feed_listings(50) f where f.title = 'Active two'),
  false,
  'and only that listing -- the flag is per row, not per page'
);

-- The flag is per VIEWER. A must not inherit C's favorite.
set local request.jwt.claims = '{"sub":"f3000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is(
  (select bool_or(f.is_favorited) from public.feed_listings(50, null, null, true) f
    join feed_fixture ff on ff.listing_id = f.listing_id),
  false,
  'another viewer does not see C''s favorite -- is_favorited is scoped to the caller'
);

set local request.jwt.claims = '{"sub":"f3000000-0000-0000-0000-00000000000c","role":"authenticated"}';

-- ============================================================
-- 3. feed_listings -- own listings
-- ============================================================

select ok(
  not exists(select 1 from public.feed_listings(50) f where f.title = 'C own active'),
  'my own listings are excluded from Home by default'
);

select ok(
  exists(
    select 1 from public.feed_listings(50, null, null, true) f where f.title = 'C own active'
  ),
  'p_include_own => true brings them back'
);

select ok(
  not exists(
    select 1 from public.feed_listings(50, null, null, null) f where f.title = 'C own active'
  ),
  'p_include_own => null is treated as false, not as null-propagating'
);

-- ============================================================
-- 4. feed_listings -- ordering, limit, cursor
-- ============================================================

-- Scoped to the fixtures, so unrelated live rows cannot interleave. The
-- assertion itself is unchanged: these four must come back newest-first, in
-- exactly this order.
select is(
  (select string_agg(f.title, ',' order by f.created_at desc)
     from public.feed_listings(50) f
     join feed_fixture ff on ff.listing_id = f.listing_id),
  'Active gap,Active three,Active two,Active one',
  'ordering is newest-first and deterministic'
);

select is(
  (select count(*)::int from public.feed_listings(2)),
  2,
  'p_limit is honoured'
);

-- "Clamped rather than rejected": the call must succeed and still return
-- every fixture. Note what this does and does not prove -- the clamp to 50
-- is not observable at this row count, and never was, since the suite has
-- only four eligible fixtures either way. What would fail here is the RPC
-- raising, or dropping rows.
select is(
  (select count(*)::int from public.feed_listings(999) f
    join feed_fixture ff on ff.listing_id = f.listing_id),
  4,
  'p_limit above the cap is clamped rather than rejected'
);

-- The LIMIT null hole: least(greatest(null,1),50) is null, and LIMIT null
-- means no limit at all. A feed_fixture-join count (the pattern used
-- everywhere else in this file) can't prove this one: if enough unrelated
-- live data outranks this suite's intentionally-old (2026-01-0x) fixtures
-- -- which a local dev seed script now provides, in volume -- the fixture
-- rows can be legitimately pushed off page 1 by an ordinary, correctly
-- bounded page, and a join-count of zero would look identical to the bug
-- this test exists to catch. Proven two ways instead, neither of which
-- depends on how much unrelated data coexists in this database:
--   1. the page is never larger than the real default (10) -- directly
--      rules out "null became unbounded";
--   2. null produces the IDENTICAL page to passing the default explicitly
--      -- rules out null coalescing to anything else.
select ok(
  (select count(*)::int from public.feed_listings(null)) <= 10,
  'an explicit p_limit => null never returns more than the default limit (10) -- it does not become unbounded'
);

select is(
  (select array_agg(listing_id order by created_at desc, listing_id desc) from public.feed_listings(null)),
  (select array_agg(listing_id order by created_at desc, listing_id desc) from public.feed_listings(10)),
  'an explicit p_limit => null produces the exact same page as passing the default (10) explicitly'
);

select is(
  (select count(*)::int from public.feed_listings(0)),
  1,
  'p_limit => 0 is clamped up to 1'
);

select is(
  (select count(*)::int from public.feed_listings(-5)),
  1,
  'a negative p_limit is clamped up to 1'
);

-- Keyset pagination: page 2 continues exactly where page 1 stopped.
--
-- The cursor is still DERIVED from a real page rather than hardcoded -- that
-- derivation is what the client itself does, so it is part of what this
-- asserts -- but the page it is derived FROM is scoped to the fixtures.
-- Unscoped, `feed_listings(2)` is the two newest rows in the database, which
-- on any DB holding live listings are not this suite's at all, so the cursor
-- would land in unrelated data and page 2 would be meaningless.
--
-- `cur` is the SECOND-newest fixture ('Active three'), i.e. exactly where a
-- two-row first page of fixtures would have stopped. Page 2 must then be the
-- next two in order, with no row repeated from page 1 and none skipped.
select is(
  (
    select string_agg(f.title, ',' order by f.created_at desc)
      from (
        select f1.created_at, f1.listing_id
          from public.feed_listings(50) f1
          join feed_fixture ff on ff.listing_id = f1.listing_id
         order by f1.created_at desc, f1.listing_id desc
         limit 1 offset 1
      ) cur
      cross join lateral public.feed_listings(2, cur.created_at, cur.listing_id) f
      join feed_fixture ff2 on ff2.listing_id = f.listing_id
  ),
  'Active two,Active one',
  'the keyset cursor returns the next page with no gap and no duplicate'
);

select throws_ok(
  $$select * from public.feed_listings(10, now(), null)$$,
  'P0001', null,
  'a half cursor (created_at without id) is rejected rather than silently returning page 1'
);

select throws_ok(
  $$select * from public.feed_listings(10, null, 'aaaa1000-0000-0000-0000-000000000001')$$,
  'P0001', null,
  'a half cursor (id without created_at) is rejected too'
);

select lives_ok(
  $$select * from public.feed_listings(10, null, null)$$,
  'both cursor halves null is the normal first page'
);

-- ============================================================
-- 5. record_listing_impression
-- ============================================================

select lives_ok(
  $$select public.record_listing_impression('aaaa1000-0000-0000-0000-000000000001', 'session-aaaaaaaa', 0)$$,
  'an impression on an eligible listing is recorded'
);

select is(
  (select count(*)::int from public.listing_events
    where listing_id = 'aaaa1000-0000-0000-0000-000000000001'),
  1,
  'exactly one event row was written'
);

-- The signature has no user parameter; the id can only come from auth.uid().
select is(
  (select e.user_id from public.listing_events e
    where e.listing_id = 'aaaa1000-0000-0000-0000-000000000001'),
  'f3000000-0000-0000-0000-00000000000c'::uuid,
  'user_id is derived from the caller, never supplied'
);

select is(
  (select e.feed_position from public.listing_events e
    where e.listing_id = 'aaaa1000-0000-0000-0000-000000000001'),
  0,
  'feed_position round-trips, including zero'
);

-- Deduplication must be a no-op, NOT a 23505 the client has to swallow.
select lives_ok(
  $$select public.record_listing_impression('aaaa1000-0000-0000-0000-000000000001', 'session-aaaaaaaa', 0)$$,
  'a repeated impression in the same session does not raise'
);

select is(
  (select count(*)::int from public.listing_events
    where listing_id = 'aaaa1000-0000-0000-0000-000000000001'),
  1,
  'and it wrote no second row -- ON CONFLICT DO NOTHING caught the partial unique index'
);

select lives_ok(
  $$select public.record_listing_impression('aaaa1000-0000-0000-0000-000000000001', 'session-bbbbbbbb', 4)$$,
  'a new session is a genuinely new impression'
);

select is(
  (select count(*)::int from public.listing_events
    where listing_id = 'aaaa1000-0000-0000-0000-000000000001'),
  2,
  'so the second session did write a row'
);

-- Eligibility must match the feed contract exactly.
select throws_ok(
  $$select public.record_listing_impression('aaaa1000-0000-0000-0000-000000000006', 'session-aaaaaaaa')$$,
  'P0002', null,
  'an impression on a DRAFT is rejected'
);

select throws_ok(
  $$select public.record_listing_impression('aaaa1000-0000-0000-0000-000000000004', 'session-aaaaaaaa')$$,
  'P0002', null,
  'an impression on an active but IMAGELESS listing is rejected -- eligibility matches the feed'
);

select throws_ok(
  $$select public.record_listing_impression('dddd0000-0000-0000-0000-00000000dead', 'session-aaaaaaaa')$$,
  'P0002', null,
  'an impression on a listing that does not exist is rejected'
);

select throws_ok(
  $$select public.record_listing_impression('aaaa1000-0000-0000-0000-000000000001', 'short')$$,
  'P0001', null,
  'a too-short session token is rejected'
);

select throws_ok(
  $$select public.record_listing_impression('aaaa1000-0000-0000-0000-000000000001', 'session-aaaaaaaa', -1)$$,
  'P0001', null,
  'a negative feed_position is rejected'
);

-- ============================================================
-- 6. listing_events -- no direct client write path
-- ============================================================

select throws_ok(
  $$insert into public.listing_events (user_id, listing_id, event_type, session_id) values ('f3000000-0000-0000-0000-00000000000c', 'aaaa1000-0000-0000-0000-000000000001', 'impression', 'session-cccccccc')$$,
  '42501', null,
  'a direct INSERT is refused -- authenticated holds no INSERT privilege at all, so the RPC is the only writer'
);

select throws_ok(
  $$update public.listing_events set feed_position = 99 where true$$,
  '42501', null,
  'events cannot be updated -- the table is append-only'
);

select throws_ok(
  $$delete from public.listing_events where true$$,
  '42501', null,
  'events cannot be deleted'
);

-- A's events are invisible to C.
select is(
  (select count(*)::int from public.listing_events e
    where e.user_id = 'f3000000-0000-0000-0000-00000000000a'),
  0,
  'another user''s events are not readable'
);

-- ============================================================
-- 7. anon cannot execute either RPC
-- ============================================================

set local role anon;

select throws_ok(
  $$select * from public.feed_listings(10)$$,
  '42501', null,
  'anon cannot execute feed_listings -- the pg_default_acl grant was revoked'
);

select throws_ok(
  $$select public.record_listing_impression('aaaa1000-0000-0000-0000-000000000001', 'session-aaaaaaaa')$$,
  '42501', null,
  'anon cannot execute record_listing_impression'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f3000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select * from finish();

rollback;
