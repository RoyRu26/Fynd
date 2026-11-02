-- Hebrew search text hardening (roadmap 7.2 review follow-up).
--
-- Replaces two of the four functions from
-- 20261102095218_hebrew_search_text_functions.sql in place (same signatures,
-- still IMMUTABLE PARALLEL SAFE with search_path = ''):
--
--   fynd_text_normalize(text)  -> text
--   fynd_search_query(text)    -> tsquery
--
-- fynd_token_variants and fynd_variants_text are unchanged.
--
-- 1. fynd_search_query is bounded. Building the tsquery is quadratic in the
--    number of terms (each AND re-copies the query built so far), and the
--    function is callable via /rpc by any authenticated user: 20k terms were
--    measured at 75 s. It now:
--      - truncates the input to 200 characters (left(p_query, 200)); when the
--        cut lands inside a word, that partial word is dropped too, so a cut
--        never turns "hoodie" into a required "hoo";
--      - dedupes terms, keeping first-occurrence order ("חולצה חולצה" =
--        "חולצה");
--      - uses at most the first 8 distinct terms that survive skipping.
--    fynd_text_normalize and fynd_variants_text stay unbounded: their cost is
--    linear in the input, and their 7.3 inputs are CHECK-capped (title <= 120,
--    description <= 5000 characters).
--
-- 2. fynd_text_normalize starts with lower(normalize(text, NFKC)), so Hebrew
--    presentation forms (e.g. U+FB2A shin with shin dot), decomposed accents
--    (e + U+0301 -> é) and fullwidth Latin (ＮＩＫＥ -> nike) fold to their plain
--    forms. Sof pasuq U+05C3 and paseq U+05C0 become a space, like maqaf
--    U+05BE, before the U+0591-U+05C7 mark removal (they are word separators,
--    not marks). normalize() is IMMUTABLE in pg_proc, so the IMMUTABLE claim
--    still holds.
--
-- 3. Deviation (e) (approved): fynd_search_query skips Hebrew terms of a
--    single letter, so "חולצה ב-100" and "ה-iPhone" don't require the lexeme
--    'ב' / 'ה' (a detached prefix letter that no title indexes on its own).
--
-- IMMUTABLE caveat (extends the one in the 7.2 migration): results depend on
-- the ICU library (lower(), [:alnum:]), PostgreSQL's Unicode normalization
-- tables (normalize()) and the English stopword / snowball files
-- (to_tsvector('english')). After a PostgreSQL major upgrade or an ICU
-- upgrade, re-run 7.3's search_tsv backfill.
--
-- Every non-ASCII character in regexes and translate() is written as a
-- \uXXXX escape (regex escapes, or E'' strings); this file contains no literal
-- Hebrew letters or combining marks in code.
--
-- Grants: CREATE OR REPLACE keeps the existing ACL (EXECUTE for authenticated
-- only; revoked from public and anon). They are re-asserted below anyway so
-- this file is self-describing.

-- ============================================================
-- 1. fynd_text_normalize
-- ============================================================
-- In order: NFKC; lowercase; maqaf U+05BE, paseq U+05C0 and sof pasuq U+05C3
-- -> space; drop niqqud / cantillation / points U+0591-U+05C7; drop geresh
-- U+05F3 and gershayim U+05F4; drop an apostrophe or quote
-- (' " ` U+2018 U+2019 U+201C U+201D) between two Hebrew letters (lookahead,
-- so ג'ו'ב works); fold finals U+05DA U+05DD U+05DF U+05E3 U+05E5 ->
-- U+05DB U+05DE U+05E0 U+05E4 U+05E6; collapse every run of
-- non-letters/digits (any script) to one space; trim.
create or replace function public.fynd_text_normalize(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      translate(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              translate(
                lower(normalize(coalesce(p_text, ''), NFKC)),
                E'\u05BE\u05C0\u05C3',
                '   '
              ),
              '[\u0591-\u05C7]', '', 'g'
            ),
            '[\u05F3\u05F4]', '', 'g'
          ),
          '([\u05D0-\u05EA])[''"`\u2018\u2019\u201C\u201D](?=[\u05D0-\u05EA])', '\1', 'g'
        ),
        E'\u05DA\u05DD\u05DF\u05E3\u05E5',
        E'\u05DB\u05DE\u05E0\u05E4\u05E6'
      ),
      '[^[:alnum:]]+', ' ', 'g'
    )
  );
$$;

comment on function public.fynd_text_normalize(text) is
  'Search normalization (spec §10.1): NFKC, lowercase, strip niqqud/geresh, fold Hebrew finals, collapse non-alphanumerics. NULL -> ''''.';

revoke all on function public.fynd_text_normalize(text) from public, anon;
grant execute on function public.fynd_text_normalize(text) to authenticated;

-- ============================================================
-- 2. fynd_search_query
-- ============================================================
-- Input is cut to 200 characters (dropping a word the cut lands inside), then
-- normalized. One sub-query per distinct term, first occurrence order, ANDed:
--   single Hebrew letter : skipped (deviation e);
--   Hebrew-only term     : OR of plainto_tsquery('simple', v) over its variants;
--   any other term       : skipped if it is an English stopword, else
--                          plainto_tsquery('english') || plainto_tsquery('simple')
--                          (just one when they are identical).
-- At most 8 terms that produce a sub-query are used; the rest are ignored.
-- NULL when no term remains (no text filter). No :* prefix matching.
create or replace function public.fynd_search_query(p_query text)
returns tsquery
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  c_max_chars constant int := 200;
  c_max_terms constant int := 8;
  v_query text;
  v_term text;
  v_seen text[] := '{}';
  v_used int := 0;
  v_variant text;
  v_part tsquery;
  v_sub tsquery;
  v_english tsquery;
  v_simple tsquery;
  v_result tsquery;
begin
  if p_query is null then
    return null;
  end if;

  if length(p_query) > c_max_chars then
    -- Keep 200 characters; if character 201 continues a word, drop that
    -- partial word as well.
    v_query := regexp_replace(left(p_query, c_max_chars + 1), '[^[:space:]]*$', '');
  else
    v_query := p_query;
  end if;

  foreach v_term in array string_to_array(public.fynd_text_normalize(v_query), ' ') loop
    continue when v_term = '' or v_term = any(v_seen);
    v_seen := v_seen || v_term;
    v_sub := null;

    if v_term ~ '^[\u05D0-\u05EA]+$' then
      -- Deviation (e): a lone Hebrew letter (detached prefix) is skipped.
      continue when length(v_term) = 1;
      foreach v_variant in array public.fynd_token_variants(v_term) loop
        v_part := plainto_tsquery('pg_catalog.simple'::regconfig, v_variant);
        continue when numnode(v_part) = 0;
        v_sub := case when v_sub is null then v_part else v_sub || v_part end;
      end loop;
    else
      -- Deviation (a): English stopwords are skipped, not required via simple.
      continue when length(to_tsvector('pg_catalog.english'::regconfig, v_term)) = 0;
      v_english := plainto_tsquery('pg_catalog.english'::regconfig, v_term);
      v_simple := plainto_tsquery('pg_catalog.simple'::regconfig, v_term);
      -- Deviation (b): identical parts collapse to one.
      v_sub := case when v_english = v_simple then v_english else v_english || v_simple end;
    end if;

    continue when v_sub is null or numnode(v_sub) = 0;
    v_result := case when v_result is null then v_sub else v_result && v_sub end;
    v_used := v_used + 1;
    exit when v_used >= c_max_terms;
  end loop;

  return v_result;
end;
$$;

comment on function public.fynd_search_query(text) is
  'Search box text -> tsquery (spec §10.4): first 200 chars, first 8 distinct terms; Hebrew variants OR-ed per term, English+simple for other terms, terms AND-ed. NULL = no text filter.';

revoke all on function public.fynd_search_query(text) from public, anon;
grant execute on function public.fynd_search_query(text) to authenticated;
