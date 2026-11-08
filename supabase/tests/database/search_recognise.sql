-- pgTAP tests for query recognition (roadmap 7.5b):
-- public.recognise_search_terms, which powers Explore's query chips.
--
-- Read-only RPC over the seeded taxonomy and brand catalogue; the only writes
-- are a term and a brand retired inside this transaction, and everything is
-- rolled back. Real terms are looked up by (kind, slug), brands by key.
--
-- Same conventions as the other suites: 4-arg throws_ok(sql, sqlstate,
-- null, description), SQLSTATE only, never message text.
--
-- Run with: pnpm exec supabase test db --local
create extension if not exists pgtap with schema extensions;

begin;

select plan(66);

-- ============================================================
-- Helpers
-- ============================================================

-- 'kind:label' per row, in the RPC's own order.
create function pg_temp.rec(p_query text)
returns text[]
language sql
stable
as $$
  select coalesce(array_agg(r.kind || ':' || r.label), '{}')
    from public.recognise_search_terms(p_query) r;
$$;

-- query_without_match of the row with this label.
create function pg_temp.without(p_query text, p_label text)
returns text
language sql
stable
as $$
  select r.query_without_match from public.recognise_search_terms(p_query) r where r.label = p_label;
$$;

-- matched_text of the row with this label.
create function pg_temp.matched(p_query text, p_label text)
returns text
language sql
stable
as $$
  select r.matched_text from public.recognise_search_terms(p_query) r where r.label = p_label;
$$;

-- ============================================================
-- 1. Shape, attributes and privileges
-- ============================================================

select has_function('public', 'recognise_search_terms', array['text'], 'recognise_search_terms(text) exists');
select volatility_is('public', 'recognise_search_terms', array['text'], 'stable', 'recognise_search_terms is STABLE');
select ok(
  (select not p.prosecdef and coalesce(p.proconfig @> array['search_path=""'], false)
     from pg_proc p where p.oid = 'public.recognise_search_terms(text)'::regprocedure),
  'recognise_search_terms is SECURITY INVOKER with search_path = '''''
);
select ok(
  not has_function_privilege('anon', 'public.recognise_search_terms(text)', 'execute'),
  'anon has no EXECUTE on recognise_search_terms'
);
select ok(
  has_function_privilege('authenticated', 'public.recognise_search_terms(text)', 'execute'),
  'authenticated can EXECUTE recognise_search_terms'
);
-- A NULL proacl means the default ACL, which grants EXECUTE to PUBLIC.
select ok(
  (select p.proacl is not null
          and not exists (select 1 from aclexplode(p.proacl) a
                           where a.grantee = 0 and a.privilege_type = 'EXECUTE')
     from pg_proc p where p.oid = 'public.recognise_search_terms(text)'::regprocedure),
  'PUBLIC has no EXECUTE on recognise_search_terms (explicit ACL, no PUBLIC entry)'
);

-- brand_aliases' stored generated columns equal what they are computed from.
select is(
  (select count(*)::int from public.brand_aliases ba
    where ba.search_key is distinct from public.fynd_text_normalize(ba.alias)
       or ba.first_forms is distinct from
            public.fynd_match_forms(split_part(public.fynd_text_normalize(ba.alias), ' ', 1), false)),
  0,
  'brand_aliases.search_key / first_forms: stored == computed'
);
select ok(
  (select bool_and(a.attgenerated = 's')
     from pg_attribute a
    where a.attrelid = 'public.brand_aliases'::regclass
      and a.attname in ('search_key', 'first_forms')),
  'brand_aliases.search_key and first_forms are STORED generated columns'
);

set local role anon;
select throws_ok(
  $$select * from public.recognise_search_terms('black')$$,
  '42501', null,
  'anon cannot execute recognise_search_terms'
);
reset role;

-- Everything below runs as a signed-in user.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7510000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 2. Recognition
-- ============================================================

select is(
  pg_temp.rec('Black Nike hoodie'),
  array['color:Black', 'brand:Nike', 'item_type:Hoodie'],
  '"Black Nike hoodie" -> Color Black, Brand Nike, Item type Hoodie, in query order'
);
select is(
  (select array_agg(r.term_id is not null and r.brand_id is null or r.term_id is null and r.brand_id is not null)
     from public.recognise_search_terms('Black Nike hoodie') r),
  array[true, true, true],
  'exactly one of term_id / brand_id is set on every row'
);
select is(
  (select r.term_id from public.recognise_search_terms('Black Nike hoodie') r where r.kind = 'color'),
  (select t.id from public.listing_attribute_terms t where t.kind = 'color' and t.slug = 'black'),
  'the color row carries the black term id'
);
select is(
  (select r.brand_id from public.recognise_search_terms('Black Nike hoodie') r where r.kind = 'brand'),
  (select b.id from public.brands b where b.key = 'nike'),
  'the brand row carries the Nike brand id'
);
select is(pg_temp.without('Black Nike hoodie', 'Black'), 'Nike hoodie', 'removing black leaves "Nike hoodie"');
select is(pg_temp.without('Black Nike hoodie', 'Nike'), 'Black hoodie', 'removing Nike leaves "Black hoodie"');
select is(pg_temp.matched('Black Nike hoodie', 'Black'), 'Black', 'matched_text keeps the original casing');
select is(
  pg_temp.without('  Black   Nike	hoodie ', 'Hoodie'),
  'Black Nike',
  'query_without_match joins the remaining chunks with single spaces'
);
select is(pg_temp.without('hoodie', 'Hoodie'), '', 'removing the only word leaves an empty query');

select ok(
  pg_temp.rec('black/white tee') @> array['color:Black', 'item_type:T-shirt'],
  '"black/white tee" -> Black and T-shirt'
);
select ok(
  (select r.query_without_match is null
     from public.recognise_search_terms('black/white tee') r where r.label = 'Black'),
  '"black/white": black is only part of a chunk -> no removal (NULL)'
);
select is(pg_temp.without('black/white tee', 'T-shirt'), 'black/white', 'tee is a whole chunk and is removable');

select is(pg_temp.rec('trench coat'), array['item_type:Coat'], 'a two-word alias is one span');
select is(pg_temp.without('trench coat sale', 'Coat'), 'sale', 'a two-word span removes both chunks');

select is(pg_temp.rec('short dress'), array['item_type:Dress'], '"short dress" -> Dress only, not Shorts (exact_first)');
select is(pg_temp.rec('shorts'), array['item_type:Shorts'], '"shorts" -> Shorts');

select is(pg_temp.rec('החולצה'), array['item_type:Shirt'], 'החולצה (prefixed) -> Shirt');
select is(pg_temp.rec('הקפוצ''ונים'), array['item_type:Hoodie'], 'הקפוצ''ונים (prefix + plural) -> Hoodie');
select is(pg_temp.rec('שחורות'), array['color:Black'], 'שחורות -> Black');
select is(pg_temp.rec('שָׁחוֹר'), array['color:Black'], 'niqqud is ignored: שָׁחוֹר -> Black');
select is(pg_temp.without('שָׁחוֹר ז''קט', 'Black'), 'ז''קט', 'Hebrew removal keeps the original text of the rest');
select ok(not (pg_temp.rec('מלה') @> array['item_type:Dress']), 'מלה does not give Dress');

select is(pg_temp.rec('nike nike'), array['brand:Nike'], 'one row per target');

-- ============================================================
-- 2b. Brand spans, repeated words, leftovers, whitespace
-- ============================================================

select is(
  pg_temp.rec('Off-White hoodie'),
  array['brand:Off-White', 'item_type:Hoodie'],
  '"Off-White hoodie": no Color White inside the longer brand span'
);
select is(pg_temp.without('Off-White hoodie', 'Off-White'), 'hoodie', 'removing Off-White leaves "hoodie"');
select is(pg_temp.without('Off-White hoodie', 'Hoodie'), 'Off-White', 'removing Hoodie leaves "Off-White"');
select ok(
  pg_temp.rec('white nike') @> array['color:White', 'brand:Nike'],
  'a term next to (not inside) a brand is still offered'
);

select is(pg_temp.without('black black hoodie', 'Black'), 'hoodie', '"black black hoodie": removing Black drops both');
select is(pg_temp.matched('black black hoodie', 'Black'), 'black', 'matched_text is the first span');
select is(pg_temp.without('hoodie black hoodie', 'Hoodie'), 'black', '"hoodie black hoodie": removing Hoodie drops both');
select is(pg_temp.without('hoodie black hoodie', 'Black'), 'hoodie hoodie', 'the other target keeps both repeats');
select is(pg_temp.without('nike nike', 'Nike'), '', 'a repeated brand is removed everywhere');
select is(pg_temp.without('coat trench coat', 'Coat'), '', 'a repeat inside / beside a longer span of the same target');

select is(pg_temp.without('- black', 'Black'), '', '"- black": no token left -> empty, not "-"');
select is(pg_temp.without('& black -', 'Black'), '', 'only token-less chunks left -> empty');
select is(pg_temp.without('black - hoodie', 'Black'), '- hoodie', 'a token-less chunk stays when a word is left');

select is(pg_temp.without('   black   ', 'Black'), '', 'leading/trailing spaces around the only word -> empty');
select is(pg_temp.without('  black  nike  ', 'Black'), 'nike', 'leading/trailing/multiple spaces are dropped');
select is(pg_temp.matched('   Black   ', 'Black'), 'Black', 'matched_text has no surrounding spaces');
select is(pg_temp.without(E'black\n\tnike', 'Black'), 'nike', 'tabs and newlines split words too');

-- ============================================================
-- 3. Retired terms and brands
-- ============================================================

reset role;
update public.listing_attribute_terms set retired_at = now() where kind = 'item_type' and slug = 'hoodie';
update public.brands set retired_at = now() where key = 'nike';
set local role authenticated;

select is(pg_temp.rec('Black Nike hoodie'), array['color:Black'], 'a retired term and a retired brand are not returned');
select is(pg_temp.rec('נייקי'), '{}'::text[], 'an alias of a retired brand is not returned');
select is(pg_temp.rec('hoody'), '{}'::text[], 'an alias of a retired term is not returned');

-- ============================================================
-- 4. Bounds and empty input
-- ============================================================

select is_empty($$select * from public.recognise_search_terms(null)$$, 'NULL input -> no rows');
select is_empty($$select * from public.recognise_search_terms('')$$, 'empty input -> no rows');
select is_empty($$select * from public.recognise_search_terms('   ')$$, 'whitespace-only input -> no rows');
select is_empty($$select * from public.recognise_search_terms('iphone')$$, 'a query naming nothing -> no rows');

select is_empty(
  $$select * from public.recognise_search_terms(repeat('qzpad ', 40) || 'black')$$,
  'a word after the 200-character cut is not recognised'
);
select is_empty(
  $$select * from public.recognise_search_terms(repeat('qz ', 24) || 'black')$$,
  'only the first 24 tokens are scanned'
);
select is(
  pg_temp.without('black ' || repeat('qzpad ', 40) || 'tail', 'Black'),
  rtrim(repeat('qzpad ', 40)) || ' tail',
  'over 200 characters: the text after the cut is kept in query_without_match'
);
select is(
  (select count(*)::int from public.recognise_search_terms('black white grey cream beige brown navy red pink')),
  6,
  'at most 6 rows'
);
select is(
  pg_temp.rec('black white grey cream beige brown navy red pink'),
  array['color:Black', 'color:White', 'color:Grey', 'color:Cream', 'color:Beige', 'color:Brown'],
  'the 6 rows are the earliest in the query'
);

-- Raw input is capped at 1000 characters; only the 200-character prefix is
-- split into chunks and the rest is appended as one trimmed string.
select is(
  pg_temp.without('black ' || repeat('qz ', 300), 'Black'),
  rtrim(repeat('qz ', 300)),
  'under 1000 characters: the text after the cut is appended, trimmed'
);
select is(
  pg_temp.without('black ' || repeat('qz ', 70) || 'a   b', 'Black'),
  rtrim(repeat('qz ', 70)) || ' a   b',
  'the text after the cut is kept untouched (inner spacing too)'
);
select is(
  pg_temp.rec('black white grey ' || repeat('x ', 5000)),
  array['color:Black', 'color:White', 'color:Grey'],
  'a many-chunk input (> 2000 chunks) is still recognised from its prefix'
);
select ok(
  (select count(*) <= 6
          and bool_and(r.query_without_match is null)
          and max(length(r.matched_text)) <= 200
     from public.recognise_search_terms('black white grey ' || repeat('black x ', 3000)) r),
  'over 1000 characters: <= 6 rows, no removal (NULL), bounded matched_text'
);
select ok(
  (select count(*) <= 6 and coalesce(max(length(r.query_without_match)), 0) <= 1000
     from public.recognise_search_terms('black white grey ' || repeat('y ', 490)) r),
  'just under the cap: query_without_match stays within 1000 characters'
);

select * from finish();

rollback;
