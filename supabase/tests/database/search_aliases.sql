-- pgTAP tests for search synonyms (roadmap 7.5a): the
-- listing_attribute_term_aliases table and its seed, the match helpers,
-- fynd_search_query_expanded and search_listings' use of it.
--
-- Dev data persists in this database, so every search_listings assertion is
-- scoped to this suite's fixture ids and the nonce token 'qzalias', which no
-- real listing contains. Real terms are looked up by (kind, slug).
-- Everything is rolled back.
--
-- Same conventions as the other suites: 4-arg throws_ok(sql, sqlstate,
-- null, description), SQLSTATE only, never message text.
--
-- Run with: pnpm exec supabase test db --local
create extension if not exists pgtap with schema extensions;

begin;

select plan(88);

-- ============================================================
-- Helpers
-- ============================================================

create function pg_temp.term(p_kind text, p_slug text)
returns uuid
language sql
stable
as $$
  select t.id from public.listing_attribute_terms t where t.kind = p_kind and t.slug = p_slug;
$$;

-- The term of the best span starting at token p_first (longest, then exact),
-- the same order fynd_search_query_expanded uses.
create function pg_temp.best_span(p_query text, p_first int)
returns text
language sql
stable
as $$
  select t.kind || ':' || t.slug || '/' || s.token_count
    from public.fynd_search_spans(public.fynd_search_tokens(p_query), false) s
    join public.listing_attribute_terms t on t.id = s.term_id
    join public.listing_attribute_kinds k on k.kind = t.kind
   where s.first_token = p_first
   order by s.token_count desc, s.exact desc, k.position, t.position, s.alias
   limit 1;
$$;

-- search_listings ids for a query (newest sort, first page).
create function pg_temp.found(p_query text)
returns uuid[]
language sql
stable
as $$
  select coalesce(array_agg(s.listing_id order by s.listing_id), '{}')
    from public.search_listings(p_query := p_query) s;
$$;

-- ============================================================
-- Fixtures (privileged)
-- ============================================================
-- Seller A, seller B, viewer V. Category ids (20261018100200_categories.sql):
-- Women > Tops c0000001-...-0001, Women > Shoes c0000001-...-0005.
--
--   L1 A Shoes  'Vintage trainers'      untagged
--   L2 A Shoes  'Qzalias pair'          item type sneakers
--   L3 A Tops   'Grey Hoodie'           untagged
--   L4 A Tops   'קפוצ'ון אפור'           untagged
--   L5 A Tops   'Basic T-shirt'         untagged
--   L6 A Tops   'חור בכיס'               untagged (negative for "black")
--   L7 B Shoes  'Vintage trainers'      untagged (blocks)
-- Every description is the nonce 'qzalias'.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('a7500000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-salias-a@test.dev', 'x', now(), now()),
  ('a7500000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-salias-b@test.dev', 'x', now(), now()),
  ('a7500000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-salias-v@test.dev', 'x', now(), now());

insert into public.listings
  (id, seller_id, title, description, price_amount, condition, size, category_id, status)
values
  ('a75a0000-0000-0000-0000-000000000001', 'a7500000-0000-0000-0000-00000000000a',
   'Vintage trainers', 'qzalias', 3000, 'good', 'one_size', 'c0000001-0000-4000-8000-000000000005', 'active'),
  ('a75a0000-0000-0000-0000-000000000002', 'a7500000-0000-0000-0000-00000000000a',
   'Qzalias pair', 'qzalias', 3000, 'good', 'one_size', 'c0000001-0000-4000-8000-000000000005', 'active'),
  ('a75a0000-0000-0000-0000-000000000003', 'a7500000-0000-0000-0000-00000000000a',
   'Grey Hoodie', 'qzalias', 3000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('a75a0000-0000-0000-0000-000000000004', 'a7500000-0000-0000-0000-00000000000a',
   'קפוצ''ון אפור', 'qzalias', 3000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('a75a0000-0000-0000-0000-000000000005', 'a7500000-0000-0000-0000-00000000000a',
   'Basic T-shirt', 'qzalias', 3000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('a75a0000-0000-0000-0000-000000000006', 'a7500000-0000-0000-0000-00000000000a',
   'חור בכיס', 'qzalias', 3000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('a75a0000-0000-0000-0000-000000000007', 'a7500000-0000-0000-0000-00000000000b',
   'Vintage trainers', 'qzalias', 3000, 'good', 'one_size', 'c0000001-0000-4000-8000-000000000005', 'active');

insert into public.listing_images (listing_id, storage_path, "position")
select l.id, format('%s/%s/a.jpg', l.seller_id, l.id), 0
  from public.listings l
 where l.id::text like 'a75a0000-%';

insert into public.listing_attribute_values (listing_id, term_id, kind, position)
values ('a75a0000-0000-0000-0000-000000000002', pg_temp.term('item_type', 'sneakers'), 'item_type', 0);

-- ============================================================
-- 1. Table shape and constraints
-- ============================================================

select has_table('public', 'listing_attribute_term_aliases', 'listing_attribute_term_aliases exists');
select col_is_pk('public', 'listing_attribute_term_aliases', 'alias_key', 'alias_key is the primary key');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.listing_attribute_term_aliases'::regclass),
  'RLS is enabled on listing_attribute_term_aliases'
);

select throws_ok(
  $$insert into public.listing_attribute_term_aliases (alias_key, term_id, term_kind, alias)
    values ('Qzbad', 'a1000002-0000-4000-8000-000000000001', 'color', 'Qzbad')$$,
  '23514', null,
  'an alias_key that is not fynd_text_normalize(alias) is rejected'
);
select throws_ok(
  $$insert into public.listing_attribute_term_aliases (alias_key, term_id, term_kind, alias)
    values ('qz one two three', 'a1000002-0000-4000-8000-000000000001', 'color', 'qz one two three')$$,
  '23514', null,
  'an alias of more than 3 words is rejected'
);
select throws_ok(
  $$insert into public.listing_attribute_term_aliases (alias_key, term_id, term_kind, alias)
    values ('tee', 'a1000002-0000-4000-8000-000000000001', 'color', 'tee')$$,
  '23505', null,
  'an alias key already used by another term is rejected'
);
select throws_ok(
  $$insert into public.listing_attribute_term_aliases (alias_key, term_id, term_kind, alias)
    values ('qzwrongkind', 'a1000002-0000-4000-8000-000000000001', 'item_type', 'qzwrongkind')$$,
  '23503', null,
  'an alias filed under the wrong kind for its term is rejected'
);
select is(
  (select first_forms from public.listing_attribute_term_aliases where alias_key = 'trainers'),
  array['trainer', 'trainers'],
  'first_forms is stored for each alias'
);
select is_empty(
  $$select alias_key from public.listing_attribute_term_aliases
     where member_query is distinct from public.fynd_alias_tsquery(alias_key)
        or first_forms is distinct from public.fynd_match_forms(split_part(alias_key, ' ', 1), false)$$,
  'every stored first_forms / member_query equals its computed value'
);

-- ============================================================
-- 2. Seed guards
-- ============================================================

select is_empty(
  $$select t.slug from public.listing_attribute_terms t
     where not exists (select 1 from public.listing_attribute_term_aliases a
                        where a.term_id = t.id and a.alias_key = public.fynd_text_normalize(t.label))
        or not exists (select 1 from public.listing_attribute_term_aliases a
                        where a.term_id = t.id
                          and a.alias_key = public.fynd_text_normalize(replace(t.slug, '_', ' ')))$$,
  'every term has its own label and slug alias'
);
select is_empty(
  $$select term_id from public.listing_attribute_term_aliases group by term_id having count(*) > 16$$,
  'no term has more than 16 aliases'
);
select is_empty(
  $$select a.alias_key from public.listing_attribute_term_aliases a
      join public.brand_aliases b on public.fynd_text_normalize(b.alias) = a.alias_key$$,
  'no term alias equals a brand alias'
);
select is((select count(*)::int from public.listing_attribute_term_aliases), 311,
  'the seed has 311 alias rows (82 label/slug keys + 229 approved)');
select is(
  (select term_id from public.listing_attribute_term_aliases where alias_key = 'מעיל'),
  pg_temp.term('item_type', 'coat'),
  'מעיל maps to coat (not jacket)'
);
select is(
  (select term_id from public.listing_attribute_term_aliases where alias_key = 'trainers'),
  pg_temp.term('item_type', 'sneakers'),
  'trainers maps to sneakers'
);
select is(
  (select term_id from public.listing_attribute_term_aliases where alias_key = 'skinny'),
  pg_temp.term('fit', 'slim'),
  'skinny maps to fit slim'
);
select is_empty(
  $$select alias_key from public.listing_attribute_term_aliases
     where alias_key in ('עור', 'חלק', 'נקודות', 'הדפס', 'print', 'off white')$$,
  'excluded ambiguous words (and off white, a brand) are not aliases'
);

-- ============================================================
-- 3. fynd_match_forms / fynd_member_token_query / fynd_search_tokens
-- ============================================================

select is(public.fynd_match_forms('trainers', true), array['trainer', 'trainers'], 'English token: token + english lexemes');
select is(public.fynd_match_forms('the', true), array['the'], 'English stopword keeps the token');
select is(public.fynd_match_forms('שחור', true), array['שחור', 'חור'], 'Hebrew query token: all variants');
select is(public.fynd_match_forms('שחור', false), array['שחור'], 'Hebrew alias token: suffix forms only (no חור)');
select is(public.fynd_match_forms('שמלה', false), array['שמלה', 'שמל'], 'Hebrew alias token keeps its stem');
select is(public.fynd_match_forms('', true), '{}'::text[], 'empty token has no forms');
select is(public.fynd_match_forms(null, false), '{}'::text[], 'NULL token has no forms');

select is(public.fynd_member_token_query('t')::text, '''t''', 'a stopword alias token is kept via simple');
select is(public.fynd_member_token_query('שחור')::text, '''שחור''', 'a Hebrew alias token never yields its prefix-stripped form');
select is(public.fynd_alias_tsquery('t shirt')::text, '''t'' & ''shirt''', 'a multi-word alias is the AND of its tokens');

select is(public.fynd_search_tokens('Black  T-Shirt!'), array['black', 't', 'shirt'], 'tokens are normalized and split');
select is(public.fynd_search_tokens(null), '{}'::text[], 'NULL input has no tokens');
select is(
  public.fynd_search_tokens(repeat('x', 199) || ' hoodie'),
  array[repeat('x', 199)],
  'the 200-character cut drops a word it lands inside (7.2 rule)'
);
select is(
  public.fynd_search_tokens(repeat('ab ', 70)),
  (select array_agg(x) from generate_series(1, 67) g cross join lateral (select 'ab'::text as x) y),
  'long input keeps only the words inside the first 200 characters'
);

-- ============================================================
-- 4. Spans
-- ============================================================

select is(pg_temp.best_span('trainers', 1), 'item_type:sneakers/1', 'trainers -> sneakers');
select is(pg_temp.best_span('black t-shirt', 1), 'color:black/1', '"black t-shirt": black at token 1');
select is(pg_temp.best_span('black t-shirt', 2), 'item_type:t_shirt/2', '"black t-shirt": t-shirt spans tokens 2-3');
select is(pg_temp.best_span('dress shoes', 1), 'item_type:dress_shoes/2', '"dress shoes" beats "dress"');
select is(pg_temp.best_span('כחול כהה', 1), 'color:navy/2', '"כחול כהה" beats "כחול"');
select is(pg_temp.best_span('הקפוצ''ונים', 1), 'item_type:hoodie/1', 'prefixed plural הקפוצ''ונים -> hoodie');
select is(pg_temp.best_span('שחורות', 1), 'color:black/1', 'שחורות -> black');
select is(pg_temp.best_span('מלה', 1), null, 'מלה (a variant of שמלה) does not match dress');
select is(pg_temp.best_span('חור', 1), null, 'חור does not match black');
select is(pg_temp.best_span('iphone', 1), null, 'a word with no alias has no span');
select is_empty(
  $$select 1 from public.fynd_search_spans(public.fynd_search_tokens('nike'), false)$$,
  'brand aliases are not spans when p_include_brands is false'
);
select isnt_empty(
  $$select 1 from public.fynd_search_spans(public.fynd_search_tokens('nike'), true) where kind = 'brand'$$,
  'brand aliases are spans when p_include_brands is true (7.5b)'
);
select is_empty(
  $$select 1 from public.fynd_search_spans(public.fynd_search_tokens(repeat('qz ', 24) || 'black'), false)$$,
  'only the first 24 tokens are scanned for spans'
);

-- ============================================================
-- 5. fynd_search_query_expanded
-- ============================================================

-- Drift guard: no alias hit -> exactly the 7.2 query.
select is_empty(
  $$select q from (values ('iphone'), ('summer'), ('ארוך'), ('zara'), ('nike air max'),
                          ('levis 501'), ('size 42'), ('the'), (''), (null), ('חולצתי'),
                          ('ב-100'), ('macbook pro 2020'), ('מחשב נייד'), ('אייפון'),
                          ('gap'), ('נייקי'), ('hole')) as v(q)
     where public.fynd_search_query_expanded(q) is distinct from public.fynd_search_query(q)$$,
  'queries with no alias hit equal fynd_search_query exactly'
);
select is(public.fynd_search_query_expanded(null), null, 'NULL query -> NULL (no text filter)');
select is(public.fynd_search_query_expanded('the a'), null, 'stopwords only -> NULL');
select is(
  public.fynd_search_query_expanded('hoodie קפוצ''ון'),
  public.fynd_search_query_expanded('hoodie'),
  '"hoodie קפוצ''ון" is one unit: equals "hoodie"'
);
select is(
  public.fynd_search_query_expanded('black white grey cream beige brown navy red green'),
  public.fynd_search_query_expanded('black white grey cream beige brown navy red'),
  '9 alias units: only the first 8 are used'
);
select is(
  public.fynd_search_query_expanded('black'),
  public.fynd_search_query_expanded('black black'),
  'a repeated alias word is used once'
);
select ok(
  public.fynd_search_query_expanded('trainers')::text like '%''sneakers''%',
  'trainers expands to sneakers'
);
select ok(
  public.fynd_search_query_expanded('dress shoes')::text not like '%gown%',
  '"dress shoes" does not expand to dress aliases'
);
select ok(
  public.fynd_search_query_expanded('black')::text not like '%''חור''%',
  'black does not expand to חור'
);
select ok(
  public.fynd_search_query_expanded('שחור')::text like '%''חור''%',
  'שחור keeps its own 7.2 variants (superset of 7.2)'
);
select is_empty(
  $$select l.id, v.q
      from public.listings l
     cross join (values ('trainers'), ('black t-shirt'), ('שחורות'), ('gray hoodie'), ('tee'),
                        ('dress shoes'), ('מעיל'), ('nike hoodie')) as v(q)
     where l.search_tsv @@ public.fynd_search_query(v.q)
       and not l.search_tsv @@ public.fynd_search_query_expanded(v.q)$$,
  'superset: every listing (dev data included) matched by the 7.2 query is matched by the expanded one'
);
select is_empty(
  $$select q from (values ('trainers'), ('black t-shirt'), ('הקפוצ''ונים'), ('dress shoes'),
                          (repeat('שחורות ', 40)))
                    as v(q)
     where position(':*' in public.fynd_search_query_expanded(q)::text) > 0$$,
  'the expanded query has no :* prefix matching'
);

-- Worst case: 24 distinct prefixed Hebrew alias words within 200 characters.
select ok(
  numnode(public.fynd_search_query_expanded(
    'ושחורות הלבנות כשהאפורות והכחולות מהירוקות ושמלות החצאיות והמעילים בתיקים וכובעים הסנדלים והמגפיים ושורטים וטרנינג מכנסיים הקרדיגנים והסוודרים וחולצות וגופיות ובלייזרים ופרחוניות ומשבצות'))
    < 400,
  'worst-case Hebrew query stays under 400 tsquery nodes'
);
select ok(
  numnode(public.fynd_search_query_expanded(
    'trainers sneakers boots heels flats loafers bag hat scarf belt black white grey cream beige brown navy blue green khaki red pink purple yellow orange'))
    < 400,
  'worst-case English query stays under 400 tsquery nodes'
);
select ok(
  numnode(public.fynd_search_query_expanded(repeat('black t-shirt dress shoes ', 20))) < 400,
  'a long repeated query stays bounded'
);

-- Lenient timing: 20 worst-case calls well under a second.
create function pg_temp.time_worst()
returns interval
language plpgsql
as $$
declare
  t0 timestamptz := clock_timestamp();
  x tsquery;
begin
  for i in 1..20 loop
    x := public.fynd_search_query_expanded(
      'ושחורות הלבנות כשהאפורות והכחולות מהירוקות ושמלות החצאיות והמעילים בתיקים וכובעים הסנדלים והמגפיים ושורטים וטרנינג מכנסיים הקרדיגנים והסוודרים וחולצות וגופיות ובלייזרים ופרחוניות ומשבצות'
      || repeat(' ', i % 2));
  end loop;
  return clock_timestamp() - t0;
end;
$$;
select ok(pg_temp.time_worst() < interval '1 second', '20 worst-case expansions take under a second');

-- ============================================================
-- 6. Through search_listings (viewer V)
-- ============================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"a7500000-0000-0000-0000-00000000000c","role":"authenticated"}';

select ok(
  pg_temp.found('sneakers qzalias') @> array['a75a0000-0000-0000-0000-000000000001', 'a75a0000-0000-0000-0000-000000000002']::uuid[],
  '"sneakers" finds the untagged "Vintage trainers" and the sneakers-tagged listing'
);
select ok(
  pg_temp.found('trainers qzalias') @> array['a75a0000-0000-0000-0000-000000000001', 'a75a0000-0000-0000-0000-000000000002']::uuid[],
  '"trainers" finds both too'
);
select ok(
  pg_temp.found('hoodie qzalias') @> array['a75a0000-0000-0000-0000-000000000003', 'a75a0000-0000-0000-0000-000000000004']::uuid[],
  '"hoodie" finds "Grey Hoodie" and "קפוצ''ון אפור"'
);
select ok(
  pg_temp.found('קפוצ''ון אפור qzalias') @> array['a75a0000-0000-0000-0000-000000000003', 'a75a0000-0000-0000-0000-000000000004']::uuid[],
  '"קפוצ''ון אפור" finds both'
);
select ok(
  pg_temp.found('gray hoodie qzalias') @> array['a75a0000-0000-0000-0000-000000000003', 'a75a0000-0000-0000-0000-000000000004']::uuid[],
  '"gray hoodie" finds both'
);
select ok(
  pg_temp.found('tee qzalias') @> array['a75a0000-0000-0000-0000-000000000005']::uuid[],
  '"tee" finds "Basic T-shirt"'
);
select ok(
  pg_temp.found('הסניקרס qzalias') @> array['a75a0000-0000-0000-0000-000000000001', 'a75a0000-0000-0000-0000-000000000002']::uuid[],
  'prefixed Hebrew alias הסניקרס finds both sneakers listings'
);
select ok(
  not (pg_temp.found('black qzalias') @> array['a75a0000-0000-0000-0000-000000000006']::uuid[]),
  'NEGATIVE: "black" does not find "חור בכיס"'
);
select ok(
  pg_temp.found('חור qzalias') @> array['a75a0000-0000-0000-0000-000000000006']::uuid[],
  'control: "חור" finds "חור בכיס"'
);
select ok(
  not (pg_temp.found('hoodie qzalias') && array['a75a0000-0000-0000-0000-000000000001', 'a75a0000-0000-0000-0000-000000000005']::uuid[]),
  'NEGATIVE: "hoodie" does not find the trainers or the T-shirt'
);
select ok(
  pg_temp.found('trainers qzalias') @> array['a75a0000-0000-0000-0000-000000000007']::uuid[],
  'before blocking, B''s "Vintage trainers" is found'
);
select throws_ok(
  $$select * from public.search_listings(p_query := 'trainers', p_color_ids := array[null]::uuid[])$$,
  '22023', null,
  'filter validation still runs (22023)'
);

insert into public.blocks (blocker_id, blocked_id)
values ('a7500000-0000-0000-0000-00000000000c', 'a7500000-0000-0000-0000-00000000000b');

select ok(
  not (pg_temp.found('trainers qzalias') @> array['a75a0000-0000-0000-0000-000000000007']::uuid[]),
  'V blocks B: B''s listing is suppressed for an alias query'
);
select ok(
  pg_temp.found('trainers qzalias') @> array['a75a0000-0000-0000-0000-000000000001']::uuid[],
  'V blocks B: A''s listing is still found'
);

-- ============================================================
-- 7. Access matrix (§2.4)
-- ============================================================

select isnt_empty(
  $$select alias_key from public.listing_attribute_term_aliases$$,
  'authenticated can read term aliases'
);
select throws_ok(
  $$insert into public.listing_attribute_term_aliases (alias_key, term_id, term_kind, alias)
    values ('qzclient', 'a1000002-0000-4000-8000-000000000001', 'color', 'qzclient')$$,
  '42501', null,
  'authenticated cannot insert term aliases'
);
select throws_ok(
  $$update public.listing_attribute_term_aliases set alias = 'Tee' where alias_key = 'tee'$$,
  '42501', null,
  'authenticated cannot update term aliases'
);
select throws_ok(
  $$delete from public.listing_attribute_term_aliases where alias_key = 'tee'$$,
  '42501', null,
  'authenticated cannot delete term aliases'
);

reset role;
select ok(
  exists(select 1 from public.listing_attribute_term_aliases where alias_key = 'tee' and alias = 'tee'),
  'the tee alias survived the client write attempts'
);

set local role anon;
select throws_ok(
  $$select * from public.listing_attribute_term_aliases$$,
  '42501', null,
  'anon cannot read term aliases'
);
select throws_ok(
  $$select public.fynd_search_query_expanded('trainers')$$,
  '42501', null,
  'anon cannot execute fynd_search_query_expanded'
);
reset role;

-- ============================================================
-- 8. Function privileges and attributes
-- ============================================================

select is_empty(
  $$select f from unnest(array[
       'public.fynd_match_forms(text, boolean)', 'public.fynd_member_token_query(text)',
       'public.fynd_alias_tsquery(text)', 'public.fynd_search_tokens(text)',
       'public.fynd_search_spans(text[], boolean)', 'public.fynd_search_query_expanded(text)']) as f
     where has_function_privilege('anon', f, 'execute')$$,
  'anon cannot execute any of the new search functions'
);
select is_empty(
  $$select f from unnest(array[
       'public.fynd_match_forms(text, boolean)', 'public.fynd_member_token_query(text)',
       'public.fynd_alias_tsquery(text)', 'public.fynd_search_tokens(text)',
       'public.fynd_search_spans(text[], boolean)', 'public.fynd_search_query_expanded(text)']) as f
     where not has_function_privilege('authenticated', f, 'execute')$$,
  'authenticated can execute every new search function (search_listings is SECURITY INVOKER)'
);
select is_empty(
  $$select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('fynd_match_forms', 'fynd_member_token_query', 'fynd_alias_tsquery',
                         'fynd_search_tokens', 'fynd_search_spans', 'fynd_search_query_expanded')
       and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false))$$,
  'every new search function is SECURITY INVOKER with search_path = '''''
);
select volatility_is('public', 'fynd_match_forms', array['text', 'boolean'], 'immutable', 'fynd_match_forms is IMMUTABLE');
select volatility_is('public', 'fynd_alias_tsquery', array['text'], 'immutable', 'fynd_alias_tsquery is IMMUTABLE');
select volatility_is('public', 'fynd_search_query_expanded', array['text'], 'stable', 'fynd_search_query_expanded is STABLE');
select ok(
  (select prosrc like '%public.fynd_search_query_expanded(p_query)%'
     from pg_proc where oid = 'public.search_listings(text, uuid, public.listing_condition, public.listing_size, bigint, bigint, public.search_sort, timestamptz, bigint, uuid, integer, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[])'::regprocedure),
  'search_listings uses fynd_search_query_expanded'
);

select * from finish();

rollback;
