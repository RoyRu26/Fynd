-- pgTAP tests for the brand catalog (AI listing metadata plan, Phase 1b):
-- the approved seed, normalize_brand_key(), the alias uniqueness rules, the
-- access rules and search_brands(). Listing columns and brand resolution
-- are covered in listing_brand.sql.
--
-- Same conventions as the other suites: 4-arg throws_ok(sql, sqlstate,
-- null, description), SQLSTATE only, never message text.
--
-- Run with: pnpm exec supabase test db --local
create extension if not exists pgtap with schema extensions;

begin;

select plan(83);

-- ============================================================
-- 1. Seed
-- ============================================================

select is((select count(*)::int from public.brands), 120, 'the approved catalog has 120 brands');
select is((select count(*)::int from public.brand_aliases), 247, 'and 247 alias rows (each brand''s own name plus its extra spellings)');
select is((select count(*)::int from public.brands where retired_at is not null), 0, 'no brand is retired');

select is_empty(
  $$select 1 from public.brands b
     where not exists (select 1 from public.brand_aliases a where a.brand_id = b.id and a.alias_key = b.key)$$,
  'every brand has an alias row for its own normalized name'
);

select is(
  (select count(*)::int from public.brand_aliases a join public.brands b on b.id = a.brand_id
    where b.key in ('carhartt', 'carhartt wip', 'ralph lauren', 'us polo assn')),
  9,
  'the four Carhartt / Polo brands carry 9 alias rows between them'
);

-- Change 1 of the Phase 1b sign-off: Carhartt and Carhartt WIP are separate.
select is(
  (select string_agg(a.alias_key, ' | ' order by a.alias_key)
     from public.brand_aliases a join public.brands b on b.id = a.brand_id where b.name = 'Carhartt'),
  'carhartt | קארהארט',
  'Carhartt resolves from its own name and its Hebrew spelling only'
);

select is(
  (select string_agg(a.alias_key, ' | ' order by a.alias_key)
     from public.brand_aliases a join public.brands b on b.id = a.brand_id where b.name = 'Carhartt WIP'),
  'carhartt wip | carhartt work in progress',
  'Carhartt WIP resolves from its own name and "Carhartt Work In Progress"'
);

select isnt(
  (select id from public.brands where key = 'carhartt'),
  (select id from public.brands where key = 'carhartt wip'),
  'Carhartt and Carhartt WIP are different brands'
);

-- Change 2: U.S. Polo Assn. is its own brand with no generic "polo" alias.
select is(
  (select key from public.brands where name = 'U.S. Polo Assn.'),
  'us polo assn',
  'U.S. Polo Assn. gets the key the approved normalization produces'
);

select is(
  (select string_agg(a.alias_key, ' | ') from public.brand_aliases a join public.brands b on b.id = a.brand_id where b.name = 'U.S. Polo Assn.'),
  'us polo assn',
  'U.S. Polo Assn. has no alias other than its own name'
);

select is_empty(
  $$select 1 from public.brand_aliases where alias_key in ('polo', 'tommy', 'ck', 'ua', 'nb', 'on', 'essentials', 'mm6')$$,
  'no ambiguous short alias exists (polo, tommy, ck, ua, nb, on, essentials, mm6)'
);

select is(
  (select string_agg(a.alias_key, ' | ' order by a.alias_key)
     from public.brand_aliases a join public.brands b on b.id = a.brand_id where b.name = 'Ralph Lauren'),
  'polo by ralph lauren | polo ralph lauren | ralph lauren | ראלפ לורנ',
  'Polo Ralph Lauren stays an alias of Ralph Lauren'
);

select is(
  (select b.name from public.brand_aliases a join public.brands b on b.id = a.brand_id where a.alias_key = 'polo ralph lauren'),
  'Ralph Lauren',
  '"polo ralph lauren" resolves to Ralph Lauren, not to U.S. Polo Assn.'
);

select is(
  (select b.name from public.brand_aliases a join public.brands b on b.id = a.brand_id where a.alias_key = 'jordan'),
  'Jordan',
  'Jordan is its own brand, separate from Nike'
);

-- ============================================================
-- 2. normalize_brand_key
-- ============================================================

select is(public.normalize_brand_key('Stüssy'), 'stussy', 'diacritics are stripped (ü)');
select is(public.normalize_brand_key('Hermès'), 'hermes', 'diacritics are stripped (è)');
select is(public.normalize_brand_key('Aimé Leon Dore'), 'aime leon dore', 'diacritics are stripped (é)');
select is(public.normalize_brand_key('Fjällräven'), 'fjallraven', 'diacritics are stripped (ä)');
select is(public.normalize_brand_key('Levi''s'), 'levis', 'apostrophes are deleted');
select is(public.normalize_brand_key('Levi’s'), 'levis', 'typographic apostrophes are deleted');
select is(public.normalize_brand_key('H&M'), 'h and m', '& becomes " and "');
select is(public.normalize_brand_key('Pull & Bear'), 'pull and bear', 'spaces around & collapse');
select is(public.normalize_brand_key('J.Crew'), 'jcrew', 'periods are deleted, not turned into spaces');
select is(public.normalize_brand_key('J. Crew'), 'j crew', 'a space typed after the period is kept (so "J. Crew" is not "J.Crew")');
select is(public.normalize_brand_key('Off-White'), 'off white', 'hyphens become spaces');
select is(public.normalize_brand_key('  Dr.   Martens  '), 'dr martens', 'runs of whitespace collapse and edges are trimmed');
select is(public.normalize_brand_key('NIKE'), 'nike', 'case is folded');
select is(public.normalize_brand_key('ראלף'), 'ראלפ', 'Hebrew final letters are folded (ף -> פ)');
select is(public.normalize_brand_key('ג''ורדן'), 'גורדנ', 'the Hebrew geresh is deleted and ן is folded');
select is(public.normalize_brand_key('ＮＩＫＥ'), 'nike', 'fullwidth letters fold to plain ones (NFKD)');
select is(public.normalize_brand_key('!!! ???'), '', 'symbols alone normalize to the empty string');

-- ---- Unicode compatibility forms: NFKD runs BEFORE lowercasing ----
-- Before the fix these lost their first letter ("ike", "oka"): the
-- compatibility letter decomposed to an UPPERCASE plain letter after the
-- lowercasing step, and the leftover capital was then replaced by a space.
select is(public.normalize_brand_key('ℕike'), 'nike', 'double-struck ℕ normalizes like N (was "ike")');
select is(public.normalize_brand_key('ℍoka'), 'hoka', 'double-struck ℍ normalizes like H (was "oka")');
select is(public.normalize_brand_key('ﬁla'), 'fila', 'the fi ligature normalizes to "fi"');
select is(public.normalize_brand_key(E'\u212Aith'), 'kith', 'the Kelvin sign normalizes like K');

-- ---- Hebrew niqqud and cantillation are removed, not turned into spaces ----
select is(
  public.normalize_brand_key(E'\u05E0\u05B4\u05D9\u05D9\u05E7\u05B4\u05D9'),
  'נייקי',
  'a pointed spelling (נִייקִי) normalizes to the unpointed key (was "נ ייק י")'
);
select is(
  public.normalize_brand_key(E'\u05E0\u05D9\u0591\u05D9\u05E7\u05D9'),
  'נייקי',
  'a cantillation mark inside the word is removed too'
);
select is(
  public.normalize_brand_key(E'\u05E8\u05B8\u05D0\u05DC\u05B6\u05E3'),
  'ראלפ',
  'final-letter folding still works on a pointed word (ף -> פ)'
);
select is(
  public.normalize_brand_key(E'\u05D2\u05F3\u05D5\u05B9\u05E8\u05D3\u05B8\u05DF'),
  'גורדנ',
  'geresh is still deleted and ן still folded, with niqqud present'
);
select is(
  public.normalize_brand_key(E'\u05E6\u05D4\u05F4\u05DC'),
  'צהל',
  'gershayim is still deleted'
);
select is(
  public.normalize_brand_key(E'\u05D0\u05BE\u05D1'),
  'א ב',
  'the maqaf (Hebrew hyphen, U+05BE) is still a word break, not a deleted mark'
);
select is(
  public.normalize_brand_key(E'\uFB2A'),
  'ש',
  'a Hebrew presentation form (shin with shin dot) decomposes and loses its point'
);
select is(public.normalize_brand_key(null), '', 'NULL normalizes to the empty string');

-- ---- the J. Crew spelling variant, and pointed Hebrew against the alias table ----
select is(
  (select b.name from public.brand_aliases a join public.brands b on b.id = a.brand_id where a.alias_key = 'j crew'),
  'J.Crew',
  '"J. Crew" (with a space) is an alias of J.Crew'
);

select is(
  (select count(distinct a.brand_id)::int from public.brand_aliases a
    where a.alias_key in (
      public.normalize_brand_key('J.Crew'),
      public.normalize_brand_key('J. Crew'),
      public.normalize_brand_key('JCrew'),
      public.normalize_brand_key('j crew')
    )),
  1,
  'J.Crew, J. Crew, JCrew and j crew all resolve to the same one brand'
);

select is(
  (select b.name from public.brand_aliases a join public.brands b on b.id = a.brand_id
    where a.alias_key = public.normalize_brand_key(E'\u05E0\u05B4\u05D9\u05D9\u05E7\u05B4\u05D9')),
  'Nike',
  'a pointed Hebrew spelling finds the plain Hebrew alias of Nike'
);

-- ============================================================
-- 3. Constraints (privileged writes; all rolled back)
-- ============================================================

select throws_ok(
  $$insert into public.brands (name, key) values ('Nike Duplicate', 'nike')$$,
  '23514', null,
  'a brand whose key is not the normalized name is refused'
);

select throws_ok(
  $$insert into public.brands (name, key) values ('NIKE', 'nike')$$,
  '23505', null,
  'a second brand that normalizes to an existing key is refused'
);

select throws_ok(
  $$insert into public.brands (name, key) values ('   ', '')$$,
  '23514', null,
  'a blank brand name is refused'
);

select throws_ok(
  $$insert into public.brand_aliases (alias_key, brand_id, alias)
    values ('nike', (select id from public.brands where key = 'adidas'), 'Nike')$$,
  '23505', null,
  'one normalized alias cannot resolve to two brands (Nike claimed for Adidas)'
);

select throws_ok(
  $$insert into public.brand_aliases (alias_key, brand_id, alias)
    values ('wrong key', (select id from public.brands where key = 'adidas'), 'Adidas Classic')$$,
  '23514', null,
  'an alias whose key is not the normalized alias text is refused'
);

select throws_ok(
  $$insert into public.brand_aliases (alias_key, brand_id, alias)
    values ('adidas classic', '00000000-0000-4000-8000-00000000dead', 'Adidas Classic')$$,
  '23503', null,
  'an alias for a nonexistent brand is refused'
);

-- ============================================================
-- 4. Access rules
-- ============================================================

set local role authenticated;

select is((select count(*)::int from public.brands), 120, 'authenticated can read brands');
select is((select count(*)::int from public.brand_aliases), 247, 'authenticated can read brand aliases');

select throws_ok(
  $$insert into public.brands (name, key) values ('Sneaky', 'sneaky')$$,
  '42501', null, 'authenticated cannot INSERT a brand'
);
select throws_ok(
  $$update public.brands set name = 'Hacked' where key = 'nike'$$,
  '42501', null, 'authenticated cannot UPDATE a brand'
);
select throws_ok(
  $$delete from public.brands where key = 'nike'$$,
  '42501', null, 'authenticated cannot DELETE a brand'
);
select throws_ok(
  $$insert into public.brand_aliases (alias_key, brand_id, alias)
    values ('sneaky', (select id from public.brands where key = 'nike'), 'Sneaky')$$,
  '42501', null, 'authenticated cannot INSERT an alias'
);
select throws_ok(
  $$delete from public.brand_aliases where alias_key = 'nike'$$,
  '42501', null, 'authenticated cannot DELETE an alias'
);

-- ============================================================
-- 5. search_brands
-- ============================================================

select is((select name from public.search_brands('nike') limit 1), 'Nike', 'search: an exact name finds the brand');
select is((select name from public.search_brands('NIKE ') limit 1), 'Nike', 'search: case and edge whitespace do not matter');
select is((select name from public.search_brands('h&m') limit 1), 'H&M', 'search: punctuation is normalized like names are');
select is((select name from public.search_brands('stussy') limit 1), 'Stüssy', 'search: accents are matched without typing them');
select is((select name from public.search_brands('נייקי') limit 1), 'Nike', 'search: a Hebrew transliteration finds the brand');
select is(
  (select name from public.search_brands(E'\u05E0\u05B4\u05D9\u05D9\u05E7\u05B4\u05D9') limit 1),
  'Nike',
  'search: a pointed Hebrew query finds the brand'
);
select is((select matched_alias from public.search_brands('נייק') limit 1), 'נייקי', 'search: a Hebrew prefix finds it and reports the alias that matched');
select is(
  (select name from public.search_brands('carhartt') order by (name = 'Carhartt') desc limit 1),
  'Carhartt',
  'search: "carhartt" finds regular Carhartt'
);
select is(
  (select string_agg(name, ' | ' order by name) from public.search_brands('carhartt')),
  'Carhartt | Carhartt WIP',
  'search: "carhartt" offers Carhartt and Carhartt WIP as distinct brands'
);
select is((select name from public.search_brands('carhartt') limit 1), 'Carhartt', 'search: the exact match ranks first');
select is(
  (select string_agg(name, ' | ' order by name) from public.search_brands('polo')),
  'Ralph Lauren | U.S. Polo Assn.',
  'search: "polo" is offered both brands rather than picking one'
);
select is((select count(*)::int from public.search_brands('qzxqzx')), 0, 'search: an unknown query returns nothing');
select is(
  (select count(*)::int from public.search_brands(repeat('ab ', 1000000))),
  0,
  'search: a megabyte-long query is refused outright (and returns at once)'
);
select is((select count(*)::int from public.search_brands('')), 0, 'search: an empty query returns nothing');
select is((select count(*)::int from public.search_brands('!!!')), 0, 'search: a symbol-only query returns nothing');
select is((select count(*)::int from public.search_brands(null)), 0, 'search: a NULL query returns nothing');
select is((select count(*)::int from public.search_brands('a', 3)), 3, 'search: the limit is respected');
select is((select count(*)::int from public.search_brands('a', 0)), 1, 'search: a limit below 1 is raised to 1');
select is((select count(*)::int from public.search_brands('a', 1000)), 20, 'search: a limit above 20 is capped at 20');

-- Retired brands are never suggested.
reset role;
update public.brands set retired_at = now() where key = 'nike';
set local role authenticated;

select is((select count(*)::int from public.search_brands('nike') where name = 'Nike'), 0, 'search: a retired brand is not suggested');

-- ============================================================
-- 6. anon gets nothing
-- ============================================================

set local role anon;

select throws_ok($$select count(*) from public.brands$$, '42501', null, 'anon cannot read brands');
select throws_ok($$select count(*) from public.brand_aliases$$, '42501', null, 'anon cannot read brand aliases');
select throws_ok($$select * from public.search_brands('nike')$$, '42501', null, 'anon cannot execute search_brands');
select throws_ok($$select public.normalize_brand_key('nike')$$, '42501', null, 'anon cannot execute normalize_brand_key');

select * from finish();

rollback;
