-- pgTAP database tests for the profiles auth/onboarding foundation.
--
-- Run with: pnpm exec supabase test db --local
--
-- pgTAP is enabled here, not via a migration, so it never reaches
-- staging/prod and `supabase db reset` leaves no trace of it.
create extension if not exists pgtap with schema extensions;

begin;

select plan(34);

-- ============================================================
-- FIXTURES
-- ============================================================
-- Two disposable, unmistakably-fake auth users. Inserted as the
-- connecting superuser (before any role switch below), which exercises
-- the real on_auth_user_created trigger the same way Supabase Auth's
-- signup path would.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('f1000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-a@test.dev', 'x', now(), now()),
  ('f1000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-b@test.dev', 'x', now(), now());

-- ============================================================
-- 1. auth.users insert auto-creates a profiles row with NULL fields
-- ============================================================

select ok(
  exists(select 1 from public.profiles where id = 'f1000000-0000-0000-0000-00000000000a'),
  'profile row is auto-created for a new auth user'
);

select is(
  (select username from public.profiles where id = 'f1000000-0000-0000-0000-00000000000a'),
  null,
  'auto-created profile has username = NULL'
);

select is(
  (select display_name from public.profiles where id = 'f1000000-0000-0000-0000-00000000000a'),
  null,
  'auto-created profile has display_name = NULL'
);

-- From here on, act as user A via RLS.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 2. User A cannot update User B's profile
-- ============================================================
-- RLS blocks this via the USING filter, which silently matches 0 rows
-- rather than raising, so no throws_ok is needed here.

update public.profiles
set display_name = 'Hacked'
where id = 'f1000000-0000-0000-0000-00000000000b';

select is(
  (select display_name from public.profiles where id = 'f1000000-0000-0000-0000-00000000000b'),
  null,
  'user A updating user B''s profile has no effect'
);

-- ============================================================
-- 3. User A cannot reassign their own id to User B's id
-- ============================================================

select throws_ok(
  $$update public.profiles set id = 'f1000000-0000-0000-0000-00000000000b' where id = 'f1000000-0000-0000-0000-00000000000a'$$,
  '42501',
  null,
  'reassigning own profile id to another user''s id violates RLS'
);

-- ============================================================
-- 4. Username uniqueness is case-insensitive
-- ============================================================

update public.profiles set username = 'Roy' where id = 'f1000000-0000-0000-0000-00000000000a';

select is(
  (select username from public.profiles where id = 'f1000000-0000-0000-0000-00000000000a'),
  'Roy',
  'user A successfully claims username Roy'
);

set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select throws_ok(
  $$update public.profiles set username = 'roy' where id = 'f1000000-0000-0000-0000-00000000000b'$$,
  '23505',
  null,
  'claiming roy when Roy is taken fails on case-insensitive uniqueness'
);

set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 5. Username format is enforced by the database
-- ============================================================

update public.profiles set username = 'abc_123' where id = 'f1000000-0000-0000-0000-00000000000a';
select is(
  (select username from public.profiles where id = 'f1000000-0000-0000-0000-00000000000a'),
  'abc_123',
  'valid username with underscore and digits is accepted'
);

update public.profiles set username = repeat('a', 30) where id = 'f1000000-0000-0000-0000-00000000000a';
select is(
  (select username from public.profiles where id = 'f1000000-0000-0000-0000-00000000000a'),
  repeat('a', 30),
  'username at the 30-character upper bound is accepted'
);

select throws_ok(
  $$update public.profiles set username = 'ab' where id = 'f1000000-0000-0000-0000-00000000000a'$$,
  '23514',
  null,
  'username shorter than 3 characters is rejected'
);

select throws_ok(
  $$update public.profiles set username = 'a b c' where id = 'f1000000-0000-0000-0000-00000000000a'$$,
  '23514',
  null,
  'username containing spaces is rejected'
);

select throws_ok(
  $$update public.profiles set username = '../admin' where id = 'f1000000-0000-0000-0000-00000000000a'$$,
  '23514',
  null,
  'username containing path-like punctuation is rejected'
);

-- ============================================================
-- 6. Display name validation
-- ============================================================

update public.profiles set display_name = 'Roy' where id = 'f1000000-0000-0000-0000-00000000000a';
select is(
  (select display_name from public.profiles where id = 'f1000000-0000-0000-0000-00000000000a'),
  'Roy',
  'a normal display name is accepted'
);

update public.profiles set display_name = repeat('B', 50) where id = 'f1000000-0000-0000-0000-00000000000a';
select is(
  (select display_name from public.profiles where id = 'f1000000-0000-0000-0000-00000000000a'),
  repeat('B', 50),
  'display name at the 50-trimmed-character upper bound is accepted'
);

select throws_ok(
  $$update public.profiles set display_name = '' where id = 'f1000000-0000-0000-0000-00000000000a'$$,
  '23514',
  null,
  'empty display name is rejected'
);

select throws_ok(
  $$update public.profiles set display_name = '   ' where id = 'f1000000-0000-0000-0000-00000000000a'$$,
  '23514',
  null,
  'whitespace-only display name is rejected'
);

select throws_ok(
  $$update public.profiles set display_name = repeat('B', 51) where id = 'f1000000-0000-0000-0000-00000000000a'$$,
  '23514',
  null,
  'display name exceeding 50 trimmed characters is rejected'
);

-- ============================================================
-- 7. bio length is enforced by the database (ROADMAP 1.7)
-- ============================================================
-- Nullable, and -- unlike display_name -- there is no minimum: the client
-- normalizes an empty/whitespace-only bio to NULL before ever sending it
-- (see profile/profile.ts's normalizeBio), but the CHECK constraint itself
-- does not require that, so an empty string is legal at the database layer.

update public.profiles set bio = 'Selling gently loved clothes.'
  where id = 'f1000000-0000-0000-0000-00000000000a';
select is(
  (select bio from public.profiles where id = 'f1000000-0000-0000-0000-00000000000a'),
  'Selling gently loved clothes.',
  'a normal bio is accepted'
);

update public.profiles set bio = repeat('b', 160) where id = 'f1000000-0000-0000-0000-00000000000a';
select is(
  (select bio from public.profiles where id = 'f1000000-0000-0000-0000-00000000000a'),
  repeat('b', 160),
  'bio at the 160-trimmed-character upper bound is accepted'
);

select throws_ok(
  $$update public.profiles set bio = repeat('b', 161) where id = 'f1000000-0000-0000-0000-00000000000a'$$,
  '23514',
  null,
  'bio exceeding 160 trimmed characters is rejected'
);

update public.profiles set bio = null where id = 'f1000000-0000-0000-0000-00000000000a';
select is(
  (select bio from public.profiles where id = 'f1000000-0000-0000-0000-00000000000a'),
  null,
  'bio can be cleared back to NULL'
);

update public.profiles set bio = '' where id = 'f1000000-0000-0000-0000-00000000000a';
select is(
  (select bio from public.profiles where id = 'f1000000-0000-0000-0000-00000000000a'),
  '',
  'an empty-string bio is accepted at the database layer -- normalizing it to NULL is the client''s job, not a database invariant'
);

-- ============================================================
-- 8. Column-privilege regression: created_at has no UPDATE privilege
-- ============================================================
-- Before this migration's allowlist, RLS's `auth.uid() = id` was the ONLY
-- gate on UPDATE, and RLS does not distinguish columns -- an owner could set
-- created_at on their own row through the ordinary REST path. The allowlist
-- closes that even though RLS alone never would.

select throws_ok(
  $$update public.profiles set created_at = now() where id = 'f1000000-0000-0000-0000-00000000000a'$$,
  '42501',
  null,
  'UPDATE of created_at is rejected -- created_at has no UPDATE privilege'
);

-- ============================================================
-- 9. avatar_path ownership isolation
-- ============================================================

update public.profiles set avatar_path = 'f1000000-0000-0000-0000-00000000000a/pic.jpg'
  where id = 'f1000000-0000-0000-0000-00000000000a';
select is(
  (select avatar_path from public.profiles where id = 'f1000000-0000-0000-0000-00000000000a'),
  'f1000000-0000-0000-0000-00000000000a/pic.jpg',
  'a user can set their own avatar_path -- the column grant landed'
);

update public.profiles set avatar_path = 'hacked.jpg' where id = 'f1000000-0000-0000-0000-00000000000b';
select is(
  (select avatar_path from public.profiles where id = 'f1000000-0000-0000-0000-00000000000b'),
  null,
  'user A setting user B''s avatar_path has no effect -- RLS''s USING clause silently matches zero rows'
);

-- ============================================================
-- 9a. avatar_path ownership CHECK constraint (profiles_avatar_path_owned)
-- ============================================================
-- RLS's `auth.uid() = id` on the update policy only gates WHICH ROW a
-- client may write -- it never validated the VALUE written into
-- avatar_path. Before this constraint, a user could set their own
-- avatar_path to a path prefixed with someone else's uid, and -- since the
-- avatars bucket's SELECT policy lets any authenticated user read any
-- avatar object (section 11 below) -- their profile would then render with
-- that other user's real photo everywhere a profile is shown. See
-- 20261014201554_profiles_avatar_path_owned.sql.

select throws_ok(
  $$update public.profiles set avatar_path = 'f1000000-0000-0000-0000-00000000000b/stolen.jpg' where id = 'f1000000-0000-0000-0000-00000000000a'$$,
  '23514',
  null,
  'setting avatar_path to a path under another user''s uid prefix is rejected'
);

update public.profiles set avatar_path = 'f1000000-0000-0000-0000-00000000000a/mine.jpg'
  where id = 'f1000000-0000-0000-0000-00000000000a';

select is(
  (select avatar_path from public.profiles where id = 'f1000000-0000-0000-0000-00000000000a'),
  'f1000000-0000-0000-0000-00000000000a/mine.jpg',
  'setting avatar_path to a path under my own uid prefix succeeds'
);

-- ============================================================
-- 10. avatars Storage bucket -- INSERT policy (own uid prefix only)
-- ============================================================
-- An INSERT denied by WITH CHECK does raise (42501), unlike a USING denial,
-- so throws_ok is correct here -- same convention as listings.sql's own
-- storage INSERT section.

insert into storage.objects (bucket_id, name)
values ('avatars', 'f1000000-0000-0000-0000-00000000000a/pic1.jpg');

select ok(
  exists(select 1 from storage.objects
          where bucket_id = 'avatars' and name = 'f1000000-0000-0000-0000-00000000000a/pic1.jpg'),
  'uploading an avatar under my own uid prefix succeeds'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('avatars', 'f1000000-0000-0000-0000-00000000000b/pic2.jpg')$$,
  '42501',
  null,
  'uploading an avatar under another user''s uid prefix is denied'
);

-- ============================================================
-- 11. avatars Storage bucket -- SELECT policy: ANY authenticated user can
--     read ANY avatar object (deliberate asymmetry with listing-images)
-- ============================================================
-- Avatars have no private/draft state to protect, unlike a seller's
-- unpublished listing photos -- every screen that renders someone else's
-- avatar (seller profile, inbox, listing detail, feed) needs to resolve a
-- signed URL for a storage_path it does not own, so the SELECT policy is
-- deliberately unscoped by uid prefix.

set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select ok(
  exists(select 1 from storage.objects
          where bucket_id = 'avatars' and name = 'f1000000-0000-0000-0000-00000000000a/pic1.jpg'),
  'user B can read an avatar object uploaded by user A -- the documented asymmetry with listing-images'
);

set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 11a. avatars Storage bucket -- SELECT policy: anon is denied outright
-- ============================================================
-- The SELECT policy is `to authenticated`, not `to public` -- anon matches
-- no policy at all, so the query silently returns zero rows (an RLS
-- denial, not an error), same `set local role anon` + row-count-zero
-- pattern listings.sql uses for its own anon checks. Only an
-- authenticated-to-authenticated cross-read was exercised above (section
-- 11); this is the missing anon-is-actually-denied case.

set local role anon;

select ok(
  not exists(select 1 from storage.objects
              where bucket_id = 'avatars' and name = 'f1000000-0000-0000-0000-00000000000a/pic1.jpg'),
  'anon gets zero rows reading the avatars bucket -- the SELECT policy is authenticated-only'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 12. avatars Storage bucket -- DELETE policy (own uid prefix only)
-- ============================================================
-- Same storage.protect_delete() BEFORE DELETE STATEMENT trigger
-- listings.sql documents: a direct SQL DELETE is refused outright unless
-- storage.allow_delete_query is set, which reproduces the context the
-- Storage API itself issues deletes in. No UPDATE policy exists for this
-- bucket at all (not tested separately -- objects are immutable by the
-- same convention as listing-images, and the absence of any UPDATE grant
-- change for storage.objects globally means that is already covered by
-- listings.sql's own section 16 at the storage.objects level).

select throws_ok(
  $$delete from storage.objects where bucket_id = 'avatars' and name = 'f1000000-0000-0000-0000-00000000000a/pic1.jpg'$$,
  '42501',
  null,
  'a direct SQL delete on storage.objects is refused outright by storage.protect_delete()'
);

set local storage.allow_delete_query = 'true';

-- Inserted privileged, not as user A: the fixture needs to live under
-- user B's own uid prefix, which the INSERT policy (section 10) would
-- otherwise refuse to let user A create.
reset role;
insert into storage.objects (bucket_id, name)
values ('avatars', 'f1000000-0000-0000-0000-00000000000b/pic3.jpg');
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-00000000000a","role":"authenticated"}';

delete from storage.objects
 where bucket_id = 'avatars' and name = 'f1000000-0000-0000-0000-00000000000a/pic1.jpg';

reset role;
select ok(
  not exists(select 1 from storage.objects
              where bucket_id = 'avatars' and name = 'f1000000-0000-0000-0000-00000000000a/pic1.jpg'),
  'deleting my own avatar object succeeds'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-00000000000a","role":"authenticated"}';

delete from storage.objects
 where bucket_id = 'avatars' and name = 'f1000000-0000-0000-0000-00000000000b/pic3.jpg';

reset role;
select ok(
  exists(select 1 from storage.objects
          where bucket_id = 'avatars' and name = 'f1000000-0000-0000-0000-00000000000b/pic3.jpg'),
  'deleting another user''s avatar object is denied'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select * from finish();

rollback;
