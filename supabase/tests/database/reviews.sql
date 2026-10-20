-- pgTAP tests for the reviews feature (ROADMAP 5.4), `20261020113819_reviews.sql`
-- and `20261020113820_conversation_detail_can_review.sql`.
--
-- Run with: pnpm exec supabase test db --local
--
-- Same conventions as every other suite here: 4-arg throws_ok(sql, sqlstate,
-- null, description) -- the 3-arg form's third argument is the expected
-- MESSAGE, not a description -- and SQLSTATE assertions only, never message
-- text. A direct `select public.some_rpc(...)` with no is()/throws_ok/ok()
-- wrapper is fixture setup, not an assertion, and does not count toward
-- plan().
create extension if not exists pgtap with schema extensions;

begin;

select plan(48);

-- ============================================================
-- FIXTURES
-- ============================================================
-- Suite UUID namespace is fb... (f1 profiles, f2 listings, f3 feed, f4
-- favorites, f5 chat, f7 follows, f8/f9 ai_suggestion_calls/reports, fa
-- blocks -- confirmed free before claiming it), so this file can never
-- collide with another suite.
--
-- Users:
--   S  (...0a) the seller of every listing below except L8/L9.
--   B  (...0b) the REAL recorded buyer of L1 -- the one `mark_listing_sold`
--              is actually told bought it.
--   C  (...0c) messages S about L1 too, but is never picked as the buyer --
--              the "messaged, but not the recorded buyer" case -- and also
--              separately buys L9 from D, legitimately, on a different sale.
--   D  (...0d) seller of a second, otherwise-untouched pair (L8, L9), kept
--              apart from S's own fixtures so `seller_review_summary`'s
--              avg/count assertions can't be confused by anything above.
--   E  (...0e) the real recorded buyer of L8.
--   U  (...0f) an entirely unrelated third party -- never messages about
--              anything, never part of any sale.
--   BB (...10) messages about and buys L7 from S -- kept as its own buyer
--              (distinct from B) so the block-regression section (K) and
--              the rating-validation section (I) can run against a sale
--              neither of which has been reviewed yet by the time they run.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('fb000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-review-s@test.dev', 'x', now(), now()),
  ('fb000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-review-b@test.dev', 'x', now(), now()),
  ('fb000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-review-c@test.dev', 'x', now(), now()),
  ('fb000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-review-d@test.dev', 'x', now(), now()),
  ('fb000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-review-e@test.dev', 'x', now(), now()),
  ('fb000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-review-u@test.dev', 'x', now(), now()),
  ('fb000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-review-bb@test.dev', 'x', now(), now());

-- Listings. L1/L2/L6/L7 start 'active' and some are moved to 'sold' by the
-- real RPC further down (never a direct status write for the sold cases --
-- `mark_listing_sold` is the only path that should ever produce one).
-- L3/L4/L5 are fixed fixtures for the non-sold rejection matrix (D below).
insert into public.listings (id, seller_id, title, description, price_amount, condition, size, category_id, status)
values
  ('fbee0000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-00000000000a',
   'RV sold pair',      'RV_SOLD_PAIR',      2500, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('fbee0000-0000-0000-0000-000000000002', 'fb000000-0000-0000-0000-00000000000a',
   'RV active',         'RV_ACTIVE',         2500, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('fbee0000-0000-0000-0000-000000000003', 'fb000000-0000-0000-0000-00000000000a',
   'RV reserved',       'RV_RESERVED',       2500, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'reserved'),
  ('fbee0000-0000-0000-0000-000000000004', 'fb000000-0000-0000-0000-00000000000a',
   'RV removed',        'RV_REMOVED',        2500, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'removed'),
  ('fbee0000-0000-0000-0000-000000000005', 'fb000000-0000-0000-0000-00000000000a',
   'RV draft',          'RV_DRAFT',          2500, 'good', 'alpha_m', null, 'draft'),
  ('fbee0000-0000-0000-0000-000000000006', 'fb000000-0000-0000-0000-00000000000a',
   'RV sold no buyer',  'RV_SOLD_NO_BUYER',  2500, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('fbee0000-0000-0000-0000-000000000007', 'fb000000-0000-0000-0000-00000000000a',
   'RV rating+block',   'RV_RATING_BLOCK',   2500, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('fbee0000-0000-0000-0000-000000000008', 'fb000000-0000-0000-0000-00000000000d',
   'RV DE pair one',    'RV_DE_PAIR_ONE',    2500, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('fbee0000-0000-0000-0000-000000000009', 'fb000000-0000-0000-0000-00000000000d',
   'RV DE pair two',    'RV_DE_PAIR_TWO',    2500, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active');

-- ============================================================
-- Conversation fixtures -- real conversations via the real RPC, exactly
-- like listings.sql's own ROADMAP 5.3 fixtures, never a direct INSERT:
-- `conversations` has no client INSERT grant at all.
-- ============================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000c","role":"authenticated"}';

-- C messages about L1 (will NOT be the recorded buyer) and about L2 (which
-- never gets sold at all -- the "before the sale" can_review fixture).
create temp table rv_conv_c as select
  public.get_or_create_listing_conversation('fbee0000-0000-0000-0000-000000000001') as cv_c_l1,
  public.get_or_create_listing_conversation('fbee0000-0000-0000-0000-000000000002') as cv_c_l2;

reset role;
grant select on rv_conv_c to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000b","role":"authenticated"}';

-- B messages about L1 -- this is the real buyer S will record.
create temp table rv_conv_b as select
  public.get_or_create_listing_conversation('fbee0000-0000-0000-0000-000000000001') as cv_b_l1;

reset role;
grant select on rv_conv_b to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-000000000010","role":"authenticated"}';

create temp table rv_conv_bb as select
  public.get_or_create_listing_conversation('fbee0000-0000-0000-0000-000000000007') as cv_bb_l7;

reset role;
grant select on rv_conv_bb to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000e","role":"authenticated"}';

create temp table rv_conv_e as select
  public.get_or_create_listing_conversation('fbee0000-0000-0000-0000-000000000008') as cv_e_l8;

reset role;
grant select on rv_conv_e to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000c","role":"authenticated"}';

-- C's second, unrelated sale -- buying L9 from D.
create temp table rv_conv_c2 as select
  public.get_or_create_listing_conversation('fbee0000-0000-0000-0000-000000000009') as cv_c_l9;

reset role;
grant select on rv_conv_c2 to authenticated;

-- ============================================================
-- Mark the real sales -- the only path that ever writes `sold_to_user_id`.
-- ============================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select public.mark_listing_sold('fbee0000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-00000000000b');
-- Sold outside the app -- no buyer recorded. The pre-5.3 call shape.
select public.mark_listing_sold('fbee0000-0000-0000-0000-000000000006');
select public.mark_listing_sold('fbee0000-0000-0000-0000-000000000007', 'fb000000-0000-0000-0000-000000000010');

set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000d","role":"authenticated"}';

select public.mark_listing_sold('fbee0000-0000-0000-0000-000000000008', 'fb000000-0000-0000-0000-00000000000e');
select public.mark_listing_sold('fbee0000-0000-0000-0000-000000000009', 'fb000000-0000-0000-0000-00000000000c');

-- ============================================================
-- A. conversation_detail's new `can_review` column -- BEFORE either party
--    has reviewed anything.
-- ============================================================

set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is(
  (select d.can_review from public.conversation_detail((select cv_b_l1 from rv_conv_b)) d),
  true,
  'can_review is true for the seller viewing the thread with the recorded buyer, before either has reviewed'
);

select is(
  (select d.can_review from public.conversation_detail((select cv_c_l1 from rv_conv_c)) d),
  false,
  'can_review is false for the seller viewing a thread with someone who messaged but was NOT the recorded buyer -- same listing as the true case above'
);

select is(
  (select d.can_review from public.conversation_detail((select cv_c_l2 from rv_conv_c)) d),
  false,
  'can_review is false before the listing has even been sold'
);

set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select is(
  (select d.can_review from public.conversation_detail((select cv_b_l1 from rv_conv_b)) d),
  true,
  'can_review is also true from the buyer''s own side of the same thread'
);

-- Third party C's OWN perspective on the same thread checked from the
-- seller's side above (line ~174): C messaged about L1 but was never the
-- recorded buyer, so C's own can_review on this thread must read false
-- too -- not just the seller's view of it.
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select is(
  (select d.can_review from public.conversation_detail((select cv_c_l1 from rv_conv_c)) d),
  false,
  'can_review is false from C''s own perspective on the thread C started but was never the recorded buyer on'
);

-- ============================================================
-- B. submit_review succeeds -- both directions of the one real sale.
-- ============================================================

set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is(
  (select r.rating from public.submit_review('fbee0000-0000-0000-0000-000000000001', 5::smallint, 'Great buyer!') r),
  5::smallint,
  'the seller can review the recorded buyer on a completed sale'
);

select is(
  (select reviewee_id from public.reviews
    where listing_id = 'fbee0000-0000-0000-0000-000000000001'
      and reviewer_id = 'fb000000-0000-0000-0000-00000000000a'),
  'fb000000-0000-0000-0000-00000000000b'::uuid,
  'the seller''s review names the recorded buyer as reviewee, derived server-side from the locked listings row'
);

set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select is(
  (select r.rating from public.submit_review('fbee0000-0000-0000-0000-000000000001', 4::smallint, 'Smooth transaction') r),
  4::smallint,
  'the buyer can review the seller on the same completed sale'
);

select is(
  (select reviewee_id from public.reviews
    where listing_id = 'fbee0000-0000-0000-0000-000000000001'
      and reviewer_id = 'fb000000-0000-0000-0000-00000000000b'),
  'fb000000-0000-0000-0000-00000000000a'::uuid,
  'the buyer''s review names the seller as reviewee'
);

-- ============================================================
-- C. can_review flips back to false once a party has already reviewed.
-- ============================================================

set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is(
  (select d.can_review from public.conversation_detail((select cv_b_l1 from rv_conv_b)) d),
  false,
  'can_review flips back to false for the seller once they have already reviewed this sale'
);

set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select is(
  (select d.can_review from public.conversation_detail((select cv_b_l1 from rv_conv_b)) d),
  false,
  'can_review flips back to false for the buyer once they have already reviewed this sale'
);

-- ============================================================
-- D. submit_review rejected (P0001) -- no completed sale.
-- ============================================================

set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select throws_ok(
  $$select public.submit_review('fbee0000-0000-0000-0000-000000000002', 5::smallint)$$,
  'P0001', null,
  'submit_review is rejected on an active listing -- no completed sale'
);

select throws_ok(
  $$select public.submit_review('fbee0000-0000-0000-0000-000000000003', 5::smallint)$$,
  'P0001', null,
  'submit_review is rejected on a reserved listing'
);

select throws_ok(
  $$select public.submit_review('fbee0000-0000-0000-0000-000000000004', 5::smallint)$$,
  'P0001', null,
  'submit_review is rejected on a removed listing'
);

select throws_ok(
  $$select public.submit_review('fbee0000-0000-0000-0000-000000000005', 5::smallint)$$,
  'P0001', null,
  'submit_review is rejected on a draft listing'
);

-- ============================================================
-- E. submit_review rejected (P0001) -- sold with no recorded buyer.
-- ============================================================

select throws_ok(
  $$select public.submit_review('fbee0000-0000-0000-0000-000000000006', 5::smallint)$$,
  'P0001', null,
  'submit_review is rejected on a sold listing with no recorded buyer -- sold outside the app, no second party to review'
);

-- ============================================================
-- F. submit_review rejected (P0002) -- listing does not exist.
-- ============================================================

select throws_ok(
  $$select public.submit_review('cccc0000-0000-0000-0000-00000000dead', 5::smallint)$$,
  'P0002', null,
  'submit_review on a listing that does not exist is rejected as not-found'
);

-- ============================================================
-- G. submit_review rejected (42501) -- not part of this sale.
-- ============================================================

set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select throws_ok(
  $$select public.submit_review('fbee0000-0000-0000-0000-000000000001', 5::smallint)$$,
  '42501', null,
  'someone who messaged about the listing but was never the recorded buyer cannot review it -- the RPC derives the reviewee, it is never supplied, so there is no way to target an arbitrary third party either'
);

set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000f","role":"authenticated"}';

select throws_ok(
  $$select public.submit_review('fbee0000-0000-0000-0000-000000000001', 5::smallint)$$,
  '42501', null,
  'an entirely unrelated caller, who never messaged about the listing at all, cannot review it'
);

-- ============================================================
-- H. Duplicate (listing_id, reviewer_id) -> 23505.
-- ============================================================

set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select throws_ok(
  $$select public.submit_review('fbee0000-0000-0000-0000-000000000001', 3::smallint)$$,
  '23505', null,
  'the seller cannot review the same sale a second time -- (listing_id, reviewer_id) is unique'
);

-- ============================================================
-- I. Rating validation at the RPC layer -- P0001, on a sale no one has
--    reviewed yet (L7), kept untouched for section K below.
-- ============================================================

select throws_ok(
  $$select public.submit_review('fbee0000-0000-0000-0000-000000000007', 0::smallint)$$,
  'P0001', null,
  'a rating of 0 is rejected at the RPC layer'
);

select throws_ok(
  $$select public.submit_review('fbee0000-0000-0000-0000-000000000007', 6::smallint)$$,
  'P0001', null,
  'a rating of 6 is rejected at the RPC layer'
);

select throws_ok(
  $$select public.submit_review('fbee0000-0000-0000-0000-000000000007', null)$$,
  'P0001', null,
  'a null rating is rejected at the RPC layer'
);

-- ============================================================
-- J. A direct bypass insert against the bare table still hits the CHECK,
--    independent of the RPC entirely.
-- ============================================================

reset role;

select throws_ok(
  $$insert into public.reviews (listing_id, reviewer_id, reviewee_id, rating)
    values ('fbee0000-0000-0000-0000-000000000007', 'fb000000-0000-0000-0000-00000000000a',
            'fb000000-0000-0000-0000-000000000010', 0)$$,
  '23514', null,
  'a direct bypass insert with an out-of-range rating is rejected by reviews_rating_range, even for a privileged writer that skips the RPC entirely'
);

select throws_ok(
  $$insert into public.reviews (listing_id, reviewer_id, reviewee_id, rating, comment)
    values ('fbee0000-0000-0000-0000-000000000007', 'fb000000-0000-0000-0000-00000000000a',
            'fb000000-0000-0000-0000-000000000010', 5, repeat('x', 1001))$$,
  '23514', null,
  'a direct bypass insert with a comment over 1000 characters is rejected by reviews_comment_length, even for a privileged writer that skips the RPC entirely'
);

-- ============================================================
-- K. THE regression proving the central decision holds: a block between
--    the two parties, taken out AFTER the sale, does not stop either
--    direction of submit_review.
-- ============================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000a","role":"authenticated"}';

insert into public.blocks (blocker_id, blocked_id)
values ('fb000000-0000-0000-0000-00000000000a', 'fb000000-0000-0000-0000-000000000010');

select is(
  (select public.is_blocked_with('fb000000-0000-0000-0000-000000000010')),
  true,
  'confirms the block between the seller and the buyer genuinely exists before testing the regression'
);

select is(
  (select r.rating from public.submit_review('fbee0000-0000-0000-0000-000000000007', 5::smallint, 'thanks') r),
  5::smallint,
  'THE central-decision regression: the seller can still review a buyer they have since blocked -- submit_review is blind to block state, by design'
);

set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-000000000010","role":"authenticated"}';

select is(
  (select r.rating from public.submit_review('fbee0000-0000-0000-0000-000000000007', 4::smallint, 'thanks') r),
  4::smallint,
  'and the blocked buyer can still review the seller back -- blind in both directions, not just the blocker''s'
);

-- ============================================================
-- L. reviews SELECT is genuinely public.
-- ============================================================

set local role anon;

select is(
  (select count(*)::int from public.reviews where reviewee_id = 'fb000000-0000-0000-0000-00000000000b'),
  1,
  'anon can read a review about someone else -- reviews are genuinely public, unlike reports/blocks'
);

-- Two, not one: B's review of S from section B, and BB's review of S from
-- section K's block regression -- both are genuinely public.
select is(
  (select count(*)::int from public.reviews where reviewee_id = 'fb000000-0000-0000-0000-00000000000a'),
  2,
  'anon can likewise read every review of the seller, including the one from the block-regression section'
);

-- ============================================================
-- M. No authenticated caller can write directly -- submit_review is the
--    sole writer, and there is no edit/delete affordance at all.
-- ============================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select throws_ok(
  $$insert into public.reviews (listing_id, reviewer_id, reviewee_id, rating)
    values ('fbee0000-0000-0000-0000-000000000008', 'fb000000-0000-0000-0000-00000000000a',
            'fb000000-0000-0000-0000-00000000000d', 5)$$,
  '42501', null,
  'no authenticated caller holds an INSERT grant on reviews -- submit_review is the sole writer'
);

select throws_ok(
  $$update public.reviews set rating = 1 where true$$,
  '42501', null,
  'reviews cannot be updated at all -- immutable, insert-only history'
);

select throws_ok(
  $$delete from public.reviews where true$$,
  '42501', null,
  'reviews cannot be deleted at all'
);

-- ============================================================
-- N. The identity sequence is locked down too, same discipline as reports.
-- ============================================================

set local role anon;

select throws_ok(
  $$select last_value from public.reviews_id_seq$$,
  '42501', null,
  'anon cannot read the reviews identity sequence directly'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select throws_ok(
  $$select last_value from public.reviews_id_seq$$,
  '42501', null,
  'authenticated cannot read the reviews identity sequence directly either'
);

-- ============================================================
-- O. seller_review_summary -- zero, one, then two reviews.
-- ============================================================

select is(
  (select average_rating from public.seller_review_summary('fb000000-0000-0000-0000-00000000000f')),
  0.00::numeric(3,2),
  'a seller with no reviews at all has average_rating 0'
);

select is(
  (select review_count from public.seller_review_summary('fb000000-0000-0000-0000-00000000000f')),
  0,
  'and review_count 0'
);

set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000e","role":"authenticated"}';

select is(
  (select r.rating from public.submit_review('fbee0000-0000-0000-0000-000000000008', 4::smallint, 'nice') r),
  4::smallint,
  'the buyer on the untouched D/E pair can review the seller too'
);

-- can_review's `NOT EXISTS` is scoped to `reviewer_id = v_viewer`, not to
-- the listing as a whole: E (buyer) has just reviewed, but D (seller) has
-- not reviewed yet, so D must still see can_review = true on this same
-- thread. A regression that scoped "already reviewed" to the listing
-- instead of the viewer would wrongly read false here.
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000d","role":"authenticated"}';

select is(
  (select d.can_review from public.conversation_detail((select cv_e_l8 from rv_conv_e)) d),
  true,
  'can_review is still true for the seller D after only the buyer E has reviewed this sale -- scoped per-viewer, not per-listing'
);

select is(
  (select r.comment from public.submit_review('fbee0000-0000-0000-0000-000000000008', 5::smallint, '   ') r),
  null,
  'a whitespace-only comment is normalized to NULL, not stored as literal whitespace'
);

select is(
  (select average_rating from public.seller_review_summary('fb000000-0000-0000-0000-00000000000d')),
  4.00::numeric(3,2),
  'after exactly one review, average_rating equals that single rating'
);

select is(
  (select review_count from public.seller_review_summary('fb000000-0000-0000-0000-00000000000d')),
  1,
  'and review_count is 1'
);

set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select is(
  (select r.rating from public.submit_review('fbee0000-0000-0000-0000-000000000009', 2::smallint, 'ok') r),
  2::smallint,
  'a second, unrelated buyer can review the same seller on a different completed sale'
);

select is(
  (select average_rating from public.seller_review_summary('fb000000-0000-0000-0000-00000000000d')),
  3.00::numeric(3,2),
  'average_rating correctly reflects the mean of both ratings (4 and 2)'
);

select is(
  (select review_count from public.seller_review_summary('fb000000-0000-0000-0000-00000000000d')),
  2,
  'and review_count is now 2'
);

-- ============================================================
-- P. EXECUTE grants -- anon locked out of submit_review, the two roles
--    retain exactly the EXECUTE privileges this migration intends.
-- ============================================================

set local role anon;

select throws_ok(
  $$select public.submit_review('fbee0000-0000-0000-0000-000000000001', 5::smallint)$$,
  '42501', null,
  'anon cannot execute submit_review at all'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"fb000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select ok(
  has_function_privilege('authenticated', 'public.submit_review(uuid, smallint, text)', 'execute'),
  'authenticated retains EXECUTE on submit_review'
);

select ok(
  has_function_privilege('anon', 'public.seller_review_summary(uuid)', 'execute'),
  'anon retains EXECUTE on seller_review_summary -- the summary is exactly as public as the reviews it reads'
);

select * from finish();
