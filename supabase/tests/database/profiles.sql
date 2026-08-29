-- pgTAP database tests for the profiles auth/onboarding foundation.
--
-- Run with: pnpm exec supabase test db --local
--
-- pgTAP is enabled here, not via a migration, so it never reaches
-- staging/prod and `supabase db reset` leaves no trace of it.
create extension if not exists pgtap with schema extensions;

begin;

select plan(17);

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

select * from finish();

rollback;
