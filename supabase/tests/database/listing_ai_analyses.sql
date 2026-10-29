-- pgTAP tests for listing_ai_analyses and record_listing_ai_analysis (AI
-- listing metadata plan, Phase 2). The per-listing attempt limit lives in
-- ai_suggestion_calls.sql with the rest of record_ai_suggestion_attempt.
--
-- Same conventions as the other suites: 4-arg throws_ok(sql, sqlstate,
-- null, description), SQLSTATE only, never message text.
--
-- Run with: pnpm exec supabase test db --local
create extension if not exists pgtap with schema extensions;

begin;

select plan(42);

-- ============================================================
-- Fixtures
-- ============================================================
--   D1 A's draft with two photos
--   A2 A's ACTIVE listing with one photo
--   D3 B's draft with one photo

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('f9000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-aian-a@test.dev', 'x', now(), now()),
  ('f9000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-aian-b@test.dev', 'x', now(), now());

insert into public.listings
  (id, seller_id, title, description, price_amount, condition, size, category_id, status)
values
  ('f9aa0000-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-00000000000a',
   'AI draft', '', null, null, null, null, 'draft'),
  ('f9aa0000-0000-0000-0000-000000000002', 'f9000000-0000-0000-0000-00000000000a',
   'AI active', '', 5000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('f9aa0000-0000-0000-0000-000000000003', 'f9000000-0000-0000-0000-00000000000b',
   'AI B draft', '', null, null, null, null, 'draft');

insert into public.listing_images (id, listing_id, storage_path, position) values
  ('f9bb0000-0000-0000-0000-000000000001', 'f9aa0000-0000-0000-0000-000000000001',
   'f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg', 0),
  ('f9bb0000-0000-0000-0000-000000000002', 'f9aa0000-0000-0000-0000-000000000001',
   'f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/two.jpg', 1),
  ('f9bb0000-0000-0000-0000-000000000003', 'f9aa0000-0000-0000-0000-000000000002',
   'f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000002/act.jpg', 0),
  ('f9bb0000-0000-0000-0000-000000000004', 'f9aa0000-0000-0000-0000-000000000003',
   'f9000000-0000-0000-0000-00000000000b/f9aa0000-0000-0000-0000-000000000003/b.jpg', 0);

-- Shorthand for the long constant arguments, so each test shows only what it varies.
create function pg_temp.rec(
  p_listing uuid,
  p_status text,
  p_reason text,
  p_paths text[],
  p_suggestion jsonb,
  p_hash text default repeat('a', 64),
  p_issues text[] default '{}'
) returns uuid language sql as $$
  select public.record_listing_ai_analysis(
    p_listing, p_status, p_reason, p_issues, 'claude-haiku-4-5-20251001', 2,
    repeat('b', 64), p_hash, p_paths, p_suggestion, 1200, 300, 4100)
$$;
grant execute on function pg_temp.rec(uuid, text, text, text[], jsonb, text, text[]) to authenticated, anon;

set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 1. Recording, as the owner of a draft
-- ============================================================

select isnt(
  pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'succeeded', null,
    array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg',
          'f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/two.jpg'],
    '{"title": "Grey hoodie"}'::jsonb, repeat('c', 64), array['colors.unknown_value']),
  null,
  'the owner can record a succeeded analysis of their draft (returns its id)'
);

select is(
  (select row(status, suggestion ->> 'title', user_id, image_paths[2], validation_issues[1], input_tokens)
     from public.listing_ai_analyses where analysis_input_hash = repeat('c', 64)),
  row('succeeded'::text, 'Grey hoodie'::text, 'f9000000-0000-0000-0000-00000000000a'::uuid,
      'f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/two.jpg'::text,
      'colors.unknown_value'::text, 1200),
  'the owner reads it back: status, suggestion, caller as user_id, ordered paths, issues, usage'
);

select lives_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'failed', 'provider_timeout',
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg'], null)$$,
  'a failed analysis records a reason and no suggestion'
);

select lives_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'invalid', 'no_valid_fields',
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg'], null)$$,
  'an invalid (unusable model output) analysis records a reason and no suggestion'
);

-- ============================================================
-- 2. Shape and consistency (CHECK constraints, 23514)
-- ============================================================

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'succeeded', null,
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg'], null)$$,
  '23514', null,
  'a succeeded analysis without a suggestion is refused'
);

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'failed', null,
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg'], null)$$,
  '23514', null,
  'a failed analysis without a reason is refused'
);

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'failed', 'timeout',
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg'],
      '{"title": "x"}'::jsonb)$$,
  '23514', null,
  'a failed analysis carrying a suggestion is refused'
);

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'cached', 'x',
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg'], null)$$,
  '23514', null,
  'an unknown status is refused'
);

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'succeeded', null,
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg'],
      '{"title": "x"}'::jsonb, 'not-a-hash')$$,
  '23514', null,
  'an input hash that is not 64 hex characters is refused'
);

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'succeeded', null,
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg'],
      jsonb_build_object('description', repeat('x', 33000)))$$,
  '23514', null,
  'a suggestion over 32 KB is refused'
);

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'succeeded', null,
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg'],
      '["not", "an", "object"]'::jsonb)$$,
  '23514', null,
  'a suggestion that is not a JSON object is refused'
);

-- ============================================================
-- 3. Image paths must be THIS listing's images (22023)
-- ============================================================

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'succeeded', null,
      array['f9000000-0000-0000-0000-00000000000b/f9aa0000-0000-0000-0000-000000000003/b.jpg'],
      '{"title": "x"}'::jsonb)$$,
  '22023', null,
  'another user''s photo path is refused'
);

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'succeeded', null,
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000002/act.jpg'],
      '{"title": "x"}'::jsonb)$$,
  '22023', null,
  'the caller''s own photo from a DIFFERENT listing is refused'
);

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'succeeded', null,
      array['../../etc/passwd'], '{"title": "x"}'::jsonb)$$,
  '22023', null,
  'an arbitrary path is refused'
);

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'succeeded', null,
      '{}'::text[], '{"title": "x"}'::jsonb)$$,
  '22023', null,
  'an empty path list is refused'
);

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'succeeded', null,
      array_fill('f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg'::text, array[5]),
      '{"title": "x"}'::jsonb)$$,
  '22023', null,
  'more than 4 paths are refused'
);

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'succeeded', null,
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg',
            'f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg'],
      '{"title": "x"}'::jsonb)$$,
  '22023', null,
  'the same photo path twice is refused'
);

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'succeeded', null,
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg'],
      '{"title": "x"}'::jsonb, repeat('d', 64), array_fill('too_many'::text, array[51]))$$,
  '22023', null,
  'more than 50 validation issues are refused'
);

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'succeeded', null,
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg'],
      '{"title": "x"}'::jsonb, repeat('d', 64), array[null]::text[])$$,
  '22023', null,
  'a NULL validation issue is refused'
);

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'succeeded', null,
      array[null]::text[], '{"title": "x"}'::jsonb)$$,
  '22023', null,
  'a NULL photo path is refused'
);

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'succeeded', null,
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg'],
      '"just a string"'::jsonb)$$,
  '23514', null,
  'a scalar suggestion is refused'
);

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'succeeded', null,
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg'],
      '{"title": "x"}'::jsonb, repeat('d', 64), array['Not A Code'])$$,
  '22023', null,
  'a validation issue that is not a short lowercase code is refused'
);

-- ============================================================
-- 4. Ownership and status (42501, collapsed "not found")
-- ============================================================

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000002', 'succeeded', null,
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000002/act.jpg'],
      '{"title": "x"}'::jsonb)$$,
  '42501', null,
  'the owner''s ACTIVE listing is refused (drafts only)'
);

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000003', 'succeeded', null,
      array['f9000000-0000-0000-0000-00000000000b/f9aa0000-0000-0000-0000-000000000003/b.jpg'],
      '{"title": "x"}'::jsonb)$$,
  '42501', null,
  'another user''s draft is refused'
);

select throws_ok(
  $$select pg_temp.rec('00000000-0000-4000-8000-00000000dead', 'succeeded', null,
      array['x.jpg'], '{"title": "x"}'::jsonb)$$,
  '42501', null,
  'a nonexistent listing gives the same 42501 as someone else''s'
);

-- ============================================================
-- 5. No direct client writes
-- ============================================================

select throws_ok(
  $$insert into public.listing_ai_analyses
      (listing_id, user_id, status, model, prompt_version, metadata_schema_version, analysis_input_hash, image_paths, suggestion)
    values ('f9aa0000-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-00000000000a', 'succeeded',
            'm', 1, repeat('a', 64), repeat('a', 64), array['x'], '{}'::jsonb)$$,
  '42501', null,
  'a client cannot INSERT an analysis directly'
);

select throws_ok(
  $$update public.listing_ai_analyses set status = 'succeeded' where true$$,
  '42501', null,
  'a client cannot UPDATE analyses'
);

select throws_ok(
  $$delete from public.listing_ai_analyses where true$$,
  '42501', null,
  'a client cannot DELETE analyses'
);

-- ============================================================
-- 6. Read visibility: owner only
-- ============================================================

set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select is_empty(
  $$select id from public.listing_ai_analyses where listing_id = 'f9aa0000-0000-0000-0000-000000000001'$$,
  'another signed-in user cannot read A''s analyses, even by listing id'
);

set local request.jwt.claims = '{"role":"authenticated"}';

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'failed', 'x',
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg'], null)$$,
  '42501', null,
  'a call with no user in the token is refused'
);

set local role anon;

select throws_ok(
  $$select count(*) from public.listing_ai_analyses$$,
  '42501', null,
  'anon cannot read analyses'
);

select throws_ok(
  $$select public.record_listing_ai_analysis('f9aa0000-0000-0000-0000-000000000001', 'failed', 'x', '{}',
      'm', 1, repeat('a', 64), repeat('a', 64), array['x'], null, null, null, null)$$,
  '42501', null,
  'anon cannot execute record_listing_ai_analysis'
);

-- ============================================================
-- 7. Per-listing row cap (bounded growth even if called directly)
-- ============================================================

reset role;
insert into public.listing_ai_analyses
  (listing_id, user_id, status, failure_reason, model, prompt_version, metadata_schema_version, analysis_input_hash, image_paths)
select 'f9aa0000-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-00000000000a', 'failed', 'seeded',
       'claude-haiku-4-5-20251001', 2, repeat('b', 64), repeat('e', 64),
       array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg']
  from generate_series(1, 27);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is(
  (select count(*)::int from public.listing_ai_analyses where listing_id = 'f9aa0000-0000-0000-0000-000000000001'),
  30,
  'sanity: the draft now has 30 analysis records in the last 24h'
);

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000001', 'failed', 'x',
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000001/one.jpg'], null)$$,
  'P0001', null,
  'a 31st record for the same listing within 24h is refused'
);

-- ============================================================
-- 8. Lifecycle: analyses go with their draft
-- ============================================================

select lives_ok(
  $$delete from public.listings where id = 'f9aa0000-0000-0000-0000-000000000001'$$,
  'the owner deletes the draft'
);

reset role;

select is(
  (select count(*)::int from public.listing_ai_analyses where listing_id = 'f9aa0000-0000-0000-0000-000000000001'),
  0,
  'its analyses were deleted with it'
);

-- ============================================================
-- 9. Grants on the function itself
-- ============================================================

select ok(
  not has_function_privilege('anon',
    'public.record_listing_ai_analysis(uuid, text, text, text[], text, integer, text, text, text[], jsonb, integer, integer, integer)',
    'execute'),
  'anon has no EXECUTE on record_listing_ai_analysis'
);

select ok(
  has_function_privilege('authenticated',
    'public.record_listing_ai_analysis(uuid, text, text, text[], text, integer, text, text, text[], jsonb, integer, integer, integer)',
    'execute'),
  'authenticated can EXECUTE record_listing_ai_analysis (the Edge Function runs as the user)'
);

-- ============================================================
-- 10. Windows, the per-user cap, account deletion, realtime
-- ============================================================
-- Still privileged here. D4 and D5 are two more of A's drafts.

insert into public.listings
  (id, seller_id, title, description, price_amount, condition, size, category_id, status)
values
  ('f9aa0000-0000-0000-0000-000000000004', 'f9000000-0000-0000-0000-00000000000a',
   'AI draft 4', '', null, null, null, null, 'draft'),
  ('f9aa0000-0000-0000-0000-000000000005', 'f9000000-0000-0000-0000-00000000000a',
   'AI draft 5', '', null, null, null, null, 'draft');
insert into public.listing_images (id, listing_id, storage_path, position) values
  ('f9bb0000-0000-0000-0000-000000000005', 'f9aa0000-0000-0000-0000-000000000004',
   'f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000004/four.jpg', 0);

-- 35 records on D4 from more than 24h ago: outside the per-listing window.
insert into public.listing_ai_analyses
  (listing_id, user_id, created_at, status, failure_reason, model, prompt_version, metadata_schema_version, analysis_input_hash, image_paths)
select 'f9aa0000-0000-0000-0000-000000000004', 'f9000000-0000-0000-0000-00000000000a', now() - interval '25 hours',
       'failed', 'old', 'claude-haiku-4-5-20251001', 2, repeat('b', 64), repeat('e', 64),
       array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000004/four.jpg']
  from generate_series(1, 35);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select lives_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000004', 'failed', 'x',
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000004/four.jpg'], null)$$,
  'records older than 24h do not count toward the per-listing cap'
);

-- Fill A up to 100 recent records via another draft (D5): the per-USER cap.
reset role;
insert into public.listing_ai_analyses
  (listing_id, user_id, status, failure_reason, model, prompt_version, metadata_schema_version, analysis_input_hash, image_paths)
select 'f9aa0000-0000-0000-0000-000000000005', 'f9000000-0000-0000-0000-00000000000a',
       'failed', 'seeded', 'claude-haiku-4-5-20251001', 2, repeat('b', 64), repeat('e', 64), array['x']
  from generate_series(1, 99);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f9000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select throws_ok(
  $$select pg_temp.rec('f9aa0000-0000-0000-0000-000000000004', 'failed', 'x',
      array['f9000000-0000-0000-0000-00000000000a/f9aa0000-0000-0000-0000-000000000004/four.jpg'], null)$$,
  'P0001', null,
  'the 101st record by one user within 24h is refused, even on a draft under its own cap'
);

reset role;

select is_empty(
  $$select 1 from pg_publication_tables where schemaname = 'public' and tablename = 'listing_ai_analyses'$$,
  'listing_ai_analyses is not published to realtime'
);

delete from auth.users where id = 'f9000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.listing_ai_analyses where user_id = 'f9000000-0000-0000-0000-00000000000a'),
  0,
  'deleting the account removes all of that user''s analyses'
);

select * from finish();

rollback;
