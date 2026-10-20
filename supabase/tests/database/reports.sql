-- pgTAP tests for the reports table.
--
-- Run with: pnpm exec supabase test db --local
--
-- Same conventions as the other suites: 4-arg throws_ok(sql, sqlstate,
-- null, description) -- the 3-arg form's third argument is the expected
-- MESSAGE, not a description -- and SQLSTATE assertions only, never message
-- text. An RLS USING denial matches zero rows silently rather than raising,
-- so those cases are asserted by row survival, checked under `reset role`
-- where the denied caller could not see the answer themselves.
--
-- Every SQLSTATE asserted below for the ambiguous cases (both targets set,
-- neither target set, a nonexistent listing_id) was confirmed empirically
-- against the local database before writing these assertions, not assumed
-- by analogy with another suite -- see the task notes. Both the
-- authenticated-role cases land on `42501` (the RLS WITH CHECK clause),
-- not `23514` (the table CHECK constraint, reports_at_most_one_target):
-- the WITH CHECK clause re-encodes "exactly one target" for every insert
-- an `authenticated` role can attempt, and Postgres evaluates it first.
-- The table CHECK only still fires for an authenticated-role insert in the
-- "both set" direction and is otherwise empirically unreachable from this
-- role's own vantage point -- exercised directly instead under
-- `service_role` (which bypasses RLS entirely) in case 3's own
-- service_role sub-case, rather than only trusted by inference.
create extension if not exists pgtap with schema extensions;

begin;

select plan(32);

-- ============================================================
-- FIXTURES
-- ============================================================
-- A is the reporter throughout. B is the seller of an active listing AND
-- the person A reports directly. C is a third party, uninvolved in any
-- edge under test, used for the "forging another user's reporter_id" case
-- and the "authenticated cannot SELECT" case. D sells the SECOND listing
-- used by case 6 -- deliberately NOT B, because `listings.seller_id`
-- references `profiles` `on delete cascade`, which chains from
-- `auth.users` -- deleting B in case 18 would otherwise transitively delete
-- every listing B sold (including the second one) and, with it, case 6's
-- report, before case 19 ever gets to assert on it.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('f9000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-report-a@test.dev', 'x', now(), now()),
  ('f9000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-report-b@test.dev', 'x', now(), now()),
  ('f9000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-report-c@test.dev', 'x', now(), now()),
  ('f9000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-report-d@test.dev', 'x', now(), now());

-- Every active row carries a category_id too: listings_complete_when_not_draft
-- requires it. 'c0000001-0000-4000-8000-000000000001' is the seeded
-- Women > Tops leaf (20261018100200_categories.sql).
-- Two listings: the second (…02, sold by D) exists only so case 6's
-- 'other'-reason report has a target that doesn't collide with case 1's
-- unique index entry on (reporter_id, listing_id) -- A already reports …01
-- in case 1, and the unique index is keyed on the listing, not the reason.
insert into public.listings
  (id, seller_id, title, description, price_amount, condition, size, category_id, status)
values
  ('ee100000-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-00000000000b',
   'B active listing', 'REPORT_ACTIVE', 1000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('ee100000-0000-0000-0000-000000000002', 'f9000000-0000-0000-0000-00000000000d',
   'D active listing', 'REPORT_ACTIVE_2', 1500, 'good', 'alpha_l', 'c0000001-0000-4000-8000-000000000001', 'active');

-- Act as A from here.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 1. Filing a report against a listing
-- ============================================================

select lives_ok(
  $$insert into public.reports (reporter_id, listing_id, reason) values ('f9000000-0000-0000-0000-00000000000a', 'ee100000-0000-0000-0000-000000000001', 'spam')$$,
  'A can report B''s listing with a valid reason and no note'
);

-- ============================================================
-- 2. Filing a report against a user directly
-- ============================================================

select lives_ok(
  $$insert into public.reports (reporter_id, reported_user_id, reason) values ('f9000000-0000-0000-0000-00000000000a', 'f9000000-0000-0000-0000-00000000000b', 'harassment')$$,
  'A can report B directly via reported_user_id'
);

-- ============================================================
-- 3. Both targets set
-- ============================================================
-- Confirmed empirically: 42501, from the insert policy's WITH CHECK, not
-- 23514 from the reports_exactly_one_target CHECK constraint. The WITH
-- CHECK clause's two branches both require the OTHER target column to be
-- null, so with both set neither branch can be true and RLS refuses the
-- row before the table CHECK is ever reached.

select throws_ok(
  $$insert into public.reports (reporter_id, listing_id, reported_user_id, reason) values ('f9000000-0000-0000-0000-00000000000a', 'ee100000-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-00000000000b', 'spam')$$,
  '42501', null,
  'setting both listing_id and reported_user_id is rejected by the insert policy, not the CHECK constraint'
);

-- The table CHECK (reports_at_most_one_target) is the thing that still
-- protects "both set" the day something inserts as service_role, which
-- bypasses RLS entirely -- exercised here directly, under `reset role`,
-- rather than only trusted by inference from reading the migration. Note
-- the CHECK is deliberately `<= 1`, not `= 1`: `ON DELETE SET NULL` on
-- listing_id/reported_user_id performs an internal UPDATE, and a `= 1`
-- CHECK would then fire the instant a referenced row's deletion cascades
-- (both columns legitimately become null on a historical report) -- caught
-- empirically during review. `<= 1` still rejects "both set" unconditionally
-- while tolerating the "both null" state a cascade can legitimately reach.
reset role;
select throws_ok(
  $$insert into public.reports (reporter_id, listing_id, reported_user_id, reason) values ('f9000000-0000-0000-0000-00000000000a', 'ee100000-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-00000000000b', 'spam')$$,
  '23514', null,
  'service_role (RLS bypassed) inserting both targets still hits reports_at_most_one_target'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 4. Neither target set
-- ============================================================
-- Confirmed empirically: also 42501, for the same reason as case 3 -- both
-- WITH CHECK branches require their own target column to be non-null. The
-- table CHECK alone would NOT reject this (it only rejects "both set", not
-- "both null" -- see the service_role case above and the migration's own
-- comment for why), so this case is proof the INSERT policy -- not the
-- table CHECK -- is what still requires a target at insert time for every
-- client role.

select throws_ok(
  $$insert into public.reports (reporter_id, reason) values ('f9000000-0000-0000-0000-00000000000a', 'spam')$$,
  '42501', null,
  'setting neither target is rejected by the insert policy, not the CHECK constraint'
);

-- ============================================================
-- 5 & 6. reason = 'other' requires a note
-- ============================================================
-- Unlike cases 3/4, this one IS reachable past RLS: the target is valid,
-- so the WITH CHECK passes and the table CHECK constraint is what fires.

select throws_ok(
  $$insert into public.reports (reporter_id, listing_id, reason) values ('f9000000-0000-0000-0000-00000000000a', 'ee100000-0000-0000-0000-000000000001', 'other')$$,
  '23514', null,
  'reason=other with no note violates reports_other_reason_requires_note'
);

-- Targets the SECOND listing (…02), not the one from case 1 -- reporting
-- …01 again here would hit reports_unique_reporter_listing (23505) instead
-- of exercising what this case is actually testing.
select lives_ok(
  $$insert into public.reports (reporter_id, listing_id, reason, note) values ('f9000000-0000-0000-0000-00000000000a', 'ee100000-0000-0000-0000-000000000002', 'other', 'Counterfeit tag inside the collar')$$,
  'reason=other with a non-empty note is accepted'
);

-- ============================================================
-- 7. Self-reporting a listing
-- ============================================================

set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select throws_ok(
  $$insert into public.reports (reporter_id, listing_id, reason) values ('f9000000-0000-0000-0000-00000000000b', 'ee100000-0000-0000-0000-000000000001', 'spam')$$,
  '42501', null,
  'B cannot report their own listing -- the insert policy requires l.seller_id <> auth.uid()'
);

-- ============================================================
-- 8. Self-reporting as a user
-- ============================================================

select throws_ok(
  $$insert into public.reports (reporter_id, reported_user_id, reason) values ('f9000000-0000-0000-0000-00000000000b', 'f9000000-0000-0000-0000-00000000000b', 'harassment')$$,
  '42501', null,
  'B cannot report themselves -- the insert policy requires reported_user_id <> auth.uid()'
);

-- ============================================================
-- 9. Forging reporter_id
-- ============================================================

set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select throws_ok(
  $$insert into public.reports (reporter_id, reported_user_id, reason) values ('f9000000-0000-0000-0000-00000000000c', 'f9000000-0000-0000-0000-00000000000b', 'spam')$$,
  '42501', null,
  'A forging C''s reporter_id is rejected -- RLS pins it to auth.uid()'
);

-- ============================================================
-- 10. Duplicate report against the same listing
-- ============================================================
-- A already reported this listing in case 1.

select throws_ok(
  $$insert into public.reports (reporter_id, listing_id, reason) values ('f9000000-0000-0000-0000-00000000000a', 'ee100000-0000-0000-0000-000000000001', 'scam_or_fraud')$$,
  '23505', null,
  'A reporting the same listing twice violates reports_unique_reporter_listing'
);

-- ============================================================
-- 11. Duplicate report against the same user
-- ============================================================
-- A already reported B directly in case 2.

select throws_ok(
  $$insert into public.reports (reporter_id, reported_user_id, reason) values ('f9000000-0000-0000-0000-00000000000a', 'f9000000-0000-0000-0000-00000000000b', 'scam_or_fraud')$$,
  '23505', null,
  'A reporting B as a user twice violates reports_unique_reporter_user'
);

-- ============================================================
-- 12. The two unique indexes don't collide with each other
-- ============================================================
-- A has, by this point, successfully filed exactly one listing report
-- (case 1) and one user report (case 2) against the same reporter/target
-- pairing conceptually (B's listing, and B themselves) -- proving the two
-- partial unique indexes are independent, not one disguised as two.
--
-- There is no SELECT grant to `authenticated` at all (see case 14 below),
-- so verifying this -- same as every cascade check in cases 17-19 -- has to
-- `reset role` first; it is the test oracle reading state, not a user.

reset role;

select is(
  (select count(*)::int from public.reports
    where reporter_id = 'f9000000-0000-0000-0000-00000000000a'
      and listing_id = 'ee100000-0000-0000-0000-000000000001'),
  1,
  'A''s report against B''s listing survived'
);

select is(
  (select count(*)::int from public.reports
    where reporter_id = 'f9000000-0000-0000-0000-00000000000a'
      and reported_user_id = 'f9000000-0000-0000-0000-00000000000b'),
  1,
  'A''s report against B as a user survived independently of the listing report'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 13. anon cannot insert
-- ============================================================

set local role anon;

select throws_ok(
  $$insert into public.reports (reporter_id, listing_id, reason) values ('f9000000-0000-0000-0000-00000000000a', 'ee100000-0000-0000-0000-000000000001', 'spam')$$,
  '42501', null,
  'anon cannot file a report'
);

-- ============================================================
-- 14. No SELECT grant at all -- the single most important test in this
-- file, mirroring follows.sql's public-read test being the most important
-- one there, just inverted.
-- ============================================================
-- Stronger than "sees no rows": there is no SELECT grant to anon OR
-- authenticated, so the read is refused outright rather than silently
-- returning empty -- same shape favorites.sql asserts for anon, but here
-- it also applies to authenticated, which favorites.sql's does not.

select throws_ok(
  $$select count(*) from public.reports$$,
  '42501', null,
  'anon cannot read reports at all -- no grant, so not even an empty result'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select throws_ok(
  $$select count(*) from public.reports$$,
  '42501', null,
  'authenticated (C, an uninvolved third party) cannot read reports either -- insert-only for users, per ROADMAP 5.1'
);

-- ============================================================
-- 15. No UPDATE grant at all
-- ============================================================

select throws_ok(
  $$update public.reports set note = 'edited' where true$$,
  '42501', null,
  'reports cannot be updated at all -- there is no UPDATE grant'
);

-- ============================================================
-- 16. No DELETE grant at all
-- ============================================================

select throws_ok(
  $$delete from public.reports where true$$,
  '42501', null,
  'reports cannot be deleted by a user at all -- there is no DELETE grant'
);

-- ============================================================
-- 17. Deleting the reported listing nulls the row, not deletes it
-- ============================================================
-- listing_id/reported_user_id are ON DELETE SET NULL, not CASCADE -- a
-- report is moderation evidence that must survive the thing it was filed
-- against being removed (see the migration's own header comment). These
-- cases prove that directly: the row SURVIVES with its target nulled,
-- which a weaker assertion (just "count where listing_id = X is now 0")
-- would not distinguish from the row having been deleted outright.

reset role;

select is(
  (select count(*)::int from public.reports where listing_id = 'ee100000-0000-0000-0000-000000000001'),
  1,
  'sanity: exactly one report against the listing exists before it is deleted'
);

delete from public.listings where id = 'ee100000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.reports where listing_id = 'ee100000-0000-0000-0000-000000000001'),
  0,
  'no report row still references the now-deleted listing_id'
);

select is(
  (select count(*)::int from public.reports
    where reporter_id = 'f9000000-0000-0000-0000-00000000000a' and listing_id is null and reported_user_id is null),
  1,
  'the row SURVIVES deletion of its listing target, with listing_id set to null -- not removed'
);

-- ============================================================
-- 18. Deleting the reported user nulls the row, not deletes it
-- ============================================================

select is(
  (select count(*)::int from public.reports where reported_user_id = 'f9000000-0000-0000-0000-00000000000b'),
  1,
  'sanity: exactly one report against B as a user exists before B is deleted'
);

delete from auth.users where id = 'f9000000-0000-0000-0000-00000000000b';

select is(
  (select count(*)::int from public.reports where reported_user_id = 'f9000000-0000-0000-0000-00000000000b'),
  0,
  'no report row still references the now-deleted reported_user_id'
);

select is(
  (select count(*)::int from public.reports
    where reporter_id = 'f9000000-0000-0000-0000-00000000000a' and listing_id is null and reported_user_id is null),
  2,
  'this row ALSO survives (case 17''s already-nulled row, plus this one) -- two of A''s rows are now target-null, neither deleted'
);

-- ============================================================
-- 19. Cascade on reporter deletion
-- ============================================================
-- A now has THREE report rows total: case 1's and case 2's (both survived
-- their own target's deletion above with the target column nulled, per
-- cases 17/18 -- NOT removed, since listing_id/reported_user_id are SET
-- NULL, not CASCADE) plus case 6's still-fully-intact 'other'-reason report
-- against the SECOND listing. reporter_id itself is unchanged -- still ON
-- DELETE CASCADE -- so deleting A's account must still remove all three,
-- regardless of what state their target columns are in.

select is(
  (select count(*)::int from public.reports where reporter_id = 'f9000000-0000-0000-0000-00000000000a'),
  3,
  'sanity: three report rows still reference A as reporter before A is deleted (two target-nulled, one intact)'
);

delete from auth.users where id = 'f9000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.reports where reporter_id = 'f9000000-0000-0000-0000-00000000000a'),
  0,
  'deleting the reporter cascades away all of their remaining report rows, regardless of target state'
);

-- ============================================================
-- 20. Reporting a nonexistent listing_id
-- ============================================================
-- Confirmed empirically: 42501, not the foreign key's 23503 -- same shape
-- favorites.sql documents for its own analogous case. The insert policy's
-- `exists (select 1 from public.listings l where l.id = listing_id and
-- l.seller_id <> auth.uid())` subquery matches nothing for an id that does
-- not exist, so the WITH CHECK clause itself evaluates to false and RLS
-- refuses the row before the foreign key is ever consulted.

set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select throws_ok(
  $$insert into public.reports (reporter_id, listing_id, reason) values ('f9000000-0000-0000-0000-00000000000c', 'ee100000-0000-0000-0000-0000deadbeef', 'spam')$$,
  '42501', null,
  'reporting a nonexistent listing_id is refused by the policy, before the foreign key is even consulted'
);

-- ============================================================
-- 21. reason = 'other' with a whitespace-only note is still rejected
-- ============================================================
-- Regression case for a real gap caught in review: a plain
-- `char_length(btrim(note)) > 0` check (btrim with no explicit character
-- argument strips only ASCII 0x20) would accept a tab- or no-break-space-
-- only note as "non-empty". reports_other_reason_requires_note strips an
-- explicit character class instead -- confirm both a tab and a no-break
-- space (chr(160)) are still refused, not just plain whitespace.

select throws_ok(
  $$insert into public.reports (reporter_id, listing_id, reason, note) values ('f9000000-0000-0000-0000-00000000000c', 'ee100000-0000-0000-0000-000000000002', 'other', chr(9))$$,
  '23514', null,
  'reason=other with a tab-only note is rejected, not accepted as non-empty'
);

select throws_ok(
  $$insert into public.reports (reporter_id, listing_id, reason, note) values ('f9000000-0000-0000-0000-00000000000c', 'ee100000-0000-0000-0000-000000000002', 'other', chr(160))$$,
  '23514', null,
  'reason=other with a no-break-space-only note is rejected, not accepted as non-empty'
);

-- ============================================================
-- 22. The identity sequence is not readable by anon or authenticated
-- ============================================================
-- Regression case for a real gap caught in review: the table-level revoke
-- does not touch its identity column's backing sequence, which
-- pg_default_acl grants rwU to anon/authenticated independently. Left
-- alone, either role could read `reports_id_seq`'s current value directly
-- and infer total report volume/filing velocity with no row-level access
-- at all -- a real gap against this table's own "not even a reporter can
-- confirm their own report still exists" claim.

set local role anon;

select throws_ok(
  $$select last_value from public.reports_id_seq$$,
  '42501', null,
  'anon cannot read the reports_id_seq identity sequence -- no row count inference'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select throws_ok(
  $$select last_value from public.reports_id_seq$$,
  '42501', null,
  'authenticated cannot read reports_id_seq either -- the revoke is not owner-scoped, it is total'
);

select * from finish();

rollback;
