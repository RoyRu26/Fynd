-- pgTAP tests for the Hebrew search text functions (roadmap 7.2, spec §10.6
-- Phase 3a): fynd_text_normalize, fynd_token_variants, fynd_variants_text and
-- fynd_search_query. Production search (search_listings, search_tsv) is not
-- touched by 3a; matching is checked here against fixture strings, with a
-- document tsvector built the way §10.3 indexes a title:
--   to_tsvector('english', norm(t)) || to_tsvector('simple', variants_text(t))
--
-- Niqqud / cantillation inputs are written as E'\u....' escapes.
--
-- Same conventions as the other suites: 4-arg throws_ok(sql, sqlstate,
-- null, description), SQLSTATE only, never message text.
--
-- Run with: pnpm exec supabase test db --local
create extension if not exists pgtap with schema extensions;

begin;

select plan(114);

-- The §10.3 title tsvector for a fixture string.
create function pg_temp.doc(p text)
returns tsvector
language sql
immutable
as $$
  select to_tsvector('pg_catalog.english'::regconfig, public.fynd_text_normalize(p))
      || to_tsvector('pg_catalog.simple'::regconfig, public.fynd_variants_text(p));
$$;

-- ============================================================
-- 1. Function attributes
-- ============================================================

select volatility_is('public', 'fynd_text_normalize', array['text'], 'immutable', 'fynd_text_normalize is IMMUTABLE');
select volatility_is('public', 'fynd_token_variants', array['text'], 'immutable', 'fynd_token_variants is IMMUTABLE');
select volatility_is('public', 'fynd_variants_text', array['text'], 'immutable', 'fynd_variants_text is IMMUTABLE');
select volatility_is('public', 'fynd_search_query', array['text'], 'immutable', 'fynd_search_query is IMMUTABLE');

select has_function('public', 'fynd_text_normalize', array['text'], 'public.fynd_text_normalize(text) exists');
select has_function('public', 'fynd_token_variants', array['text'], 'public.fynd_token_variants(text) exists');
select has_function('public', 'fynd_variants_text', array['text'], 'public.fynd_variants_text(text) exists');
select has_function('public', 'fynd_search_query', array['text'], 'public.fynd_search_query(text) exists');

select is_empty(
  $$select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('fynd_text_normalize', 'fynd_token_variants', 'fynd_variants_text', 'fynd_search_query')
       and (p.proconfig is distinct from array['search_path=""'] or p.proparallel <> 's')$$,
  'every 7.2 fynd_* function pins search_path = '''' and is PARALLEL SAFE'
);

-- ============================================================
-- 2. fynd_text_normalize
-- ============================================================

-- חוּלְצָה: dagesh/shuruk U+05BC, sheva U+05B0, qamats U+05B8.
select is(public.fynd_text_normalize(E'חוּלְצָה'), 'חולצה', 'normalize: niqqud is removed');
-- Cantillation: etnahta U+0591 and zaqef qatan U+0594.
select is(public.fynd_text_normalize(E'חו֑לצ֔ה'), 'חולצה', 'normalize: cantillation marks are removed');
select is(public.fynd_text_normalize(E'תל־אביב'), 'תל אביב', 'normalize: maqaf becomes a space');
select is(public.fynd_text_normalize(E'ג׳ינס'), 'גינס', 'normalize: geresh is removed');
select is(public.fynd_text_normalize(E'צה״ל'), 'צהל', 'normalize: gershayim is removed');
select is(public.fynd_text_normalize('ג''ינס'), 'גינס', 'normalize: an ASCII apostrophe between Hebrew letters is removed');
select is(public.fynd_text_normalize('צה"ל'), 'צהל', 'normalize: an ASCII quote between Hebrew letters is removed');
select is(public.fynd_text_normalize(E'ג’ינס'), 'גינס', 'normalize: a typographic apostrophe between Hebrew letters is removed');
select is(public.fynd_text_normalize('ג''ו''ב'), 'גוב', 'normalize: consecutive apostrophes between Hebrew letters are all removed');
select is(public.fynd_text_normalize('Levi''s'), 'levi s', 'normalize: an apostrophe between Latin letters becomes a space');
select is(public.fynd_text_normalize('ךםןףץ'), 'כמנפצ', 'normalize: final letters are folded');
select is(public.fynd_text_normalize('ארוך'), 'ארוכ', 'normalize: ארוך folds to ארוכ');
select is(public.fynd_text_normalize('ארוכים'), 'ארוכימ', 'normalize: ארוכים folds to ארוכימ');
select is(public.fynd_text_normalize('NIKE Air-Max 90!'), 'nike air max 90', 'normalize: lowercases and splits on punctuation');
select is(public.fynd_text_normalize(E'  hello,\t\n--  world ... '), 'hello world', 'normalize: whitespace / punctuation runs collapse and are trimmed');
select is(public.fynd_text_normalize('Café жёлтый'), 'café жёлтый', 'normalize: letters of other scripts are kept');
select is(public.fynd_text_normalize('!!! ... ???'), '', 'normalize: symbols only gives an empty string');
select is(public.fynd_text_normalize(null), '', 'normalize: NULL gives an empty string');
select is(
  public.fynd_text_normalize(public.fynd_text_normalize(E'NIKE חוּלְצָה ג׳ינס ארוך Levi''s!')),
  public.fynd_text_normalize(E'NIKE חוּלְצָה ג׳ינס ארוך Levi''s!'),
  'normalize: is idempotent'
);

-- NFKC (hardening migration).
-- U+FB2A is the presentation form shin + shin dot.
select is(public.fynd_text_normalize(E'\uFB2A\u05DE\u05DC\u05D4'), 'שמלה', 'normalize: NFKC folds the presentation form U+FB2A to plain shin');
select is(public.fynd_text_normalize('cafe' || E'\u0301'), public.fynd_text_normalize('café'), 'normalize: NFKC composes a decomposed accent');
select is(public.fynd_text_normalize(E'\uFF2E\uFF29\uFF2B\uFF25'), 'nike', 'normalize: NFKC folds fullwidth Latin');
-- Sof pasuq U+05C3 and paseq U+05C0 separate words (they sit inside the
-- U+0591-U+05C7 range, so they must become spaces before mark removal).
select is(public.fynd_text_normalize('חולצה' || E'\u05C3' || 'שמלה'), 'חולצה שמלה', 'normalize: sof pasuq splits words');
select is(public.fynd_text_normalize('חולצה' || E'\u05C0' || 'שמלה'), 'חולצה שמלה', 'normalize: paseq splits words');
-- Sheva U+05B0 between gimel and the apostrophe: niqqud removal runs first.
select is(public.fynd_text_normalize(E'\u05D2\u05B0''\u05D9\u05E0\u05E1'), 'גינס', 'normalize: niqqud before an apostrophe is removed, then the apostrophe');
select is(public.fynd_text_normalize(E'\u00A0\u00A0\u00A0'), '', 'normalize: NBSP only gives an empty string');
select is(public.fynd_text_normalize(E'\U0001F525\U0001F44D'), '', 'normalize: emoji only gives an empty string');
select is(public.fynd_text_normalize('NIKEחולצה'), 'nikeחולצה', 'normalize: a mixed Latin/Hebrew token stays one token');

-- ============================================================
-- 3. fynd_token_variants
-- ============================================================

select is(public.fynd_token_variants('חולצה'), '{חולצה,חולצ}'::text[], 'variants: חולצה');
select is(public.fynd_token_variants('החולצה'), '{החולצה,חולצה,החולצ,חולצ}'::text[], 'variants: החולצה (one prefix)');
select is(public.fynd_token_variants('והחולצה'), '{והחולצה,החולצה,חולצה,והחולצ,החולצ,חולצ}'::text[], 'variants: והחולצה (two prefixes)');
select is(public.fynd_token_variants('חולצות'), '{חולצות,חולצ}'::text[], 'variants: חולצות (ות plural)');
select is(public.fynd_token_variants('ארוכימ'), '{ארוכימ,ארוכ}'::text[], 'variants: ארוכימ (ימ plural)');
select is(public.fynd_token_variants('ארוכ'), '{ארוכ}'::text[], 'variants: ארוכ has no variants');
select is(public.fynd_token_variants('שמלה'), '{שמלה,מלה,שמל}'::text[], 'variants: שמלה (prefix over-match מלה is expected)');
select is(public.fynd_token_variants('מלה'), '{מלה}'::text[], 'variants: מלה keeps 3 letters');
select is(public.fynd_token_variants('בית'), '{בית}'::text[], 'variants: בית keeps 3 letters');
select is(public.fynd_token_variants('הבית'), '{הבית,בית}'::text[], 'variants: הבית');
select is(public.fynd_token_variants('כשהחולצות'), '{כשהחולצות,שהחולצות,החולצות,כשהחולצ,שהחולצ,החולצ}'::text[], 'variants: at most two prefixes are removed');
select is(public.fynd_token_variants('הההה'), '{הההה,ההה}'::text[], 'variants: הההה is deduped and stops at 3 letters');
select is(public.fynd_token_variants('nike'), '{nike}'::text[], 'variants: a Latin token is returned as-is');
select is(public.fynd_token_variants('90'), '{90}'::text[], 'variants: a number is returned as-is');
select is(public.fynd_token_variants('חולצה2'), '{חולצה2}'::text[], 'variants: a mixed Hebrew/digit token is returned as-is');
select is(public.fynd_token_variants('nikeחולצה'), '{nikeחולצה}'::text[], 'variants: a mixed Latin/Hebrew token is returned as-is');
select is(public.fynd_token_variants(''), '{}'::text[], 'variants: an empty token gives no variants');
select is(public.fynd_token_variants(null), '{}'::text[], 'variants: NULL gives no variants');

select cmp_ok(
  (select max(cardinality(public.fynd_token_variants(t)))
     from unnest(array['והחולצות','כשהחולצות','ומהשמלות','לבגדימ','שהחולצה','והבית','מכנסיימ','ההה','ווו','ומשכה']) as t),
  '=', 6,
  'variants: the maximum over a sample is exactly 6 (deviation c)'
);

-- Suffix / prefix length boundaries: each token sits exactly one letter
-- short of a rule's minimum, so an off-by-one would add a variant.
-- חנות: 4 letters, ות needs 5 (else חנ).
select is(public.fynd_token_variants('חנות'), '{חנות}'::text[], 'variants: חנות keeps ות (4 letters)');
-- מימ: 3 letters, ימ needs 5 (else מ), prefix מ needs 4 (else ימ).
select is(public.fynd_token_variants('מימ'), '{מימ}'::text[], 'variants: מימ keeps ימ and its prefix letter (3 letters)');
-- שנה: 3 letters, ה needs 4 (else שנ), prefix ש needs 4 (else נה).
select is(public.fynd_token_variants('שנה'), '{שנה}'::text[], 'variants: שנה keeps ה and its prefix letter (3 letters)');

select is_empty(
  $$select t, v
      from unnest(array['והחולצות','כשהחולצות','ומהשמלות','לבגדימ','שהחולצה','והבית','מכנסיימ','ההה','ווו','ומשכה','שמלה']) as t,
           unnest(public.fynd_token_variants(t)) as v
     where length(v) < 3$$,
  'variants: every variant of a 3+ letter Hebrew token has at least 3 letters'
);

-- ============================================================
-- 4. fynd_variants_text
-- ============================================================

-- שחורה starts with the prefix letter ש, so it also yields חורה / חור (the
-- same accepted prefix over-match as שמלה -> מלה).
select is(public.fynd_variants_text('חולצה שחורה'), 'חולצה חולצ שחורה חורה שחור חור', 'variants_text: every token expanded in order');
select is(public.fynd_variants_text('Nike החולצה'), 'nike החולצה חולצה החולצ חולצ', 'variants_text: normalizes first, Latin kept');
select is(public.fynd_variants_text(null), '', 'variants_text: NULL gives an empty string');

-- ============================================================
-- 5. fynd_search_query
-- ============================================================

select ok(public.fynd_search_query('') is null, 'query: empty text gives NULL (no text filter)');
select ok(public.fynd_search_query(null) is null, 'query: NULL gives NULL');
select ok(public.fynd_search_query('!!!') is null, 'query: symbols only give NULL');
select ok(public.fynd_search_query('the') is null, 'query: a lone English stopword gives NULL');
select ok(public.fynd_search_query('the a of') is null, 'query: only English stopwords give NULL');
select is(public.fynd_search_query('the hoodie'), public.fynd_search_query('hoodie'), 'query: English stopwords are skipped');
select is(public.fynd_search_query('חולצה')::text, $$'חולצה' | 'חולצ'$$, 'query: a Hebrew term is the OR of its variants');
select is(public.fynd_search_query('nike')::text, $$'nike'$$, 'query: identical english and simple parts collapse');
select is(public.fynd_search_query('hoodies')::text, $$'hoodi' | 'hoodies'$$, 'query: a Latin term is english OR simple');
select is(public.fynd_search_query('nike חולצה')::text, $$'nike' & ( 'חולצה' | 'חולצ' )$$, 'query: terms are ANDed');
-- Bounds (hardening migration).
select is(
  public.fynd_search_query(repeat('והחולצות ', 5000))::text,
  public.fynd_search_query('והחולצות')::text,
  'query: a huge repeated query is cut and deduped to one term'
);
select is(
  public.fynd_search_query('nike adidas puma reebok asics fila vans converse diesel levis')::text,
  public.fynd_search_query('nike adidas puma reebok asics fila vans converse')::text,
  'query: only the first 8 distinct terms are used'
);
select is(public.fynd_search_query('חולצה חולצה')::text, public.fynd_search_query('חולצה')::text, 'query: duplicate terms collapse');
-- Deviation (e): a lone Hebrew letter is skipped.
select ok(public.fynd_search_query('ב') is null, 'query: a lone Hebrew letter gives NULL');
select is(public.fynd_search_query('ה-iPhone')::text, public.fynd_search_query('iphone')::text, 'query: ה-iPhone does not require the lexeme ה');
select is_empty(
  $$select q from unnest(array['חולצה','והחולצה','nike','hoodies','nike חולצה','ארוכים','מלה']) as q
     where public.fynd_search_query(q)::text like '%:*%'$$,
  'query: never uses :* prefix matching'
);

-- ============================================================
-- 6. Matching (§10.5) against the title "חולצה שחורה"
-- ============================================================

select ok(public.fynd_search_query('חולצה') @@ pg_temp.doc('חולצה שחורה'), 'match: חולצה');
select ok(public.fynd_search_query('החולצה') @@ pg_temp.doc('חולצה שחורה'), 'match: החולצה (one prefix)');
select ok(public.fynd_search_query('והחולצה') @@ pg_temp.doc('חולצה שחורה'), 'match: והחולצה (two prefixes)');
select ok(public.fynd_search_query('חולצות') @@ pg_temp.doc('חולצה שחורה'), 'match: חולצות (shared stem)');
select ok(public.fynd_search_query(E'חוּלְצָה') @@ pg_temp.doc('חולצה שחורה'), 'match: חוּלְצָה with niqqud');
select ok(public.fynd_search_query('שחורה') @@ pg_temp.doc('חולצה שחורה'), 'match: the second title word');
select ok(
  public.fynd_search_query('nike חולצה') @@ (pg_temp.doc('Nike') || pg_temp.doc('חולצה שחורה')),
  'match: "nike חולצה" matches brand Nike + the title'
);
select ok(not (public.fynd_search_query('nike חולצה') @@ pg_temp.doc('חולצה שחורה')), 'no match: "nike חולצה" needs the brand too');
select ok(
  not (public.fynd_search_query('adidas חולצה') @@ (pg_temp.doc('Nike') || pg_temp.doc('חולצה שחורה'))),
  'no match: "adidas חולצה" against Nike'
);
select ok(public.fynd_search_query('חולצה ב-100') @@ pg_temp.doc('חולצה כחולה 100'), 'match: "חולצה ב-100" finds "חולצה כחולה 100"');
select ok(not (public.fynd_search_query('חולצה שמלה') @@ pg_temp.doc('חולצה שחורה')), 'no match: every term must match');

-- Final-letter case.
select ok(public.fynd_search_query('ארוכים') @@ pg_temp.doc('מעיל ארוך'), 'match: ארוכים finds מעיל ארוך');
select ok(public.fynd_search_query('ארוך') @@ pg_temp.doc('מעילים ארוכים'), 'match: ארוך finds מעילים ארוכים');
select ok(public.fynd_search_query('מעילים') @@ pg_temp.doc('מעיל ארוך'), 'match: מעילים finds מעיל');

-- English stemming.
select ok(public.fynd_search_query('hoodies') @@ pg_temp.doc('Grey hoodie'), 'match: hoodies finds hoodie');
select ok(public.fynd_search_query('hoodie') @@ pg_temp.doc('Grey hoodies'), 'match: hoodie finds hoodies');
select ok(public.fynd_search_query('the hoodie') @@ pg_temp.doc('Grey hoodie'), 'match: a stopword does not block a match');
select ok(public.fynd_search_query('NIKE') @@ pg_temp.doc('nike air max'), 'match: case-insensitive');

-- Negative and documented over-match.
select ok(not (public.fynd_search_query('חולצה') @@ pg_temp.doc('שמלה אדומה')), 'no match: חולצה does not find שמלה');
-- Accepted over-match (§10.5 known limits): שמלה also indexes מלה, because
-- ש is a prefix letter and 3 letters remain.
select ok(public.fynd_search_query('מלה') @@ pg_temp.doc('שמלה אדומה'), 'documented over-match: מלה finds שמלה');

-- Pinned known limits (if these start matching, update the docs).
select ok(not (public.fynd_search_query('חולצת') @@ pg_temp.doc('חולצה')), 'known limit: construct form חולצת does not find חולצה');
select ok(not (public.fynd_search_query('נשים') @@ pg_temp.doc('אישה')), 'known limit: irregular plural נשים does not find אישה');

-- ============================================================
-- 7. Privileges
-- ============================================================

set local role authenticated;

select is(public.fynd_text_normalize('ABC'), 'abc', 'authenticated can execute fynd_text_normalize');
select is(public.fynd_token_variants('הבית'), '{הבית,בית}'::text[], 'authenticated can execute fynd_token_variants');
select is(public.fynd_variants_text('הבית'), 'הבית בית', 'authenticated can execute fynd_variants_text');
select is(public.fynd_search_query('nike')::text, $$'nike'$$, 'authenticated can execute fynd_search_query');

reset role;
set local role anon;

select throws_ok($$select public.fynd_text_normalize('abc')$$, '42501', null, 'anon cannot execute fynd_text_normalize');
select throws_ok($$select public.fynd_token_variants('abc')$$, '42501', null, 'anon cannot execute fynd_token_variants');
select throws_ok($$select public.fynd_variants_text('abc')$$, '42501', null, 'anon cannot execute fynd_variants_text');
select throws_ok($$select public.fynd_search_query('abc')$$, '42501', null, 'anon cannot execute fynd_search_query');

reset role;

-- No default PUBLIC execute: proacl must be set (NULL means PUBLIC may
-- execute) and carry no EXECUTE entry for grantee 0 (PUBLIC).
select ok(
  (select p.proacl is not null
          and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
     from pg_proc p where p.oid = 'public.fynd_text_normalize(text)'::regprocedure),
  'PUBLIC has no EXECUTE on fynd_text_normalize'
);
select ok(
  (select p.proacl is not null
          and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
     from pg_proc p where p.oid = 'public.fynd_token_variants(text)'::regprocedure),
  'PUBLIC has no EXECUTE on fynd_token_variants'
);
select ok(
  (select p.proacl is not null
          and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
     from pg_proc p where p.oid = 'public.fynd_variants_text(text)'::regprocedure),
  'PUBLIC has no EXECUTE on fynd_variants_text'
);
select ok(
  (select p.proacl is not null
          and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
     from pg_proc p where p.oid = 'public.fynd_search_query(text)'::regprocedure),
  'PUBLIC has no EXECUTE on fynd_search_query'
);
select is_empty(
  $$select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('fynd_text_normalize', 'fynd_token_variants', 'fynd_variants_text', 'fynd_search_query')
       and p.prosecdef$$,
  'no 7.2 fynd_* function is SECURITY DEFINER'
);

select * from finish();

rollback;
