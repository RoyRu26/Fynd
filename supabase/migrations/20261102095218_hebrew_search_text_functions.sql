-- Hebrew search text functions (roadmap 7.2; spec §10.6 Phase 3a).
--
-- Adds four pure functions that the Phase 3b search rebuild (roadmap 7.3)
-- will use to index listings and to parse search queries:
--
--   fynd_text_normalize(text)  -> text      §10.1 normalization
--   fynd_token_variants(text)  -> text[]    §10.2 prefix forms + suffix stems
--   fynd_variants_text(text)   -> text      every token's variants, joined
--   fynd_search_query(text)    -> tsquery   §10.4 query builder (NULL = no filter)
--
-- This is NOT real Hebrew morphology. It is a fixed set of rules for prefix
-- letters (ו ה ב ל מ ש כ), the plural endings ות / ים, the feminine ה ending
-- and final-letter folding, in plain SQL with no dictionary or extension.
--
-- Production search is untouched: search_listings and listings.search_tsv
-- keep working exactly as before. Nothing calls these functions yet.
--
-- Why public, with grants: these are pure text functions over their argument
-- and touch no table, so exposing them leaks nothing (same reasoning as
-- normalize_brand_key). 7.3's search_listings is SECURITY INVOKER and the
-- search_tsv trigger runs as the writing user, i.e. as authenticated, which
-- has no USAGE on the private schema, so the functions must live in public.
-- EXECUTE is revoked from public and anon and granted to authenticated only.
--
-- IMMUTABLE + search_path = '': every function pins search_path, names its
-- text-search configs as 'pg_catalog.<name>'::regconfig and calls its
-- siblings as public.fynd_*, so the result never depends on the caller's
-- search_path. That makes IMMUTABLE honest enough for a trigger-maintained
-- tsvector and index expressions. Caveat: lower() and the [:alnum:] class
-- follow the database's ICU locale, so an ICU library upgrade could in
-- principle change results for unusual characters. After an ICU upgrade,
-- re-run 7.3's search_tsv backfill.
--
-- Non-ASCII characters in regexes and translate() are written as \uXXXX
-- escapes (regex escapes, or E'' strings), never as literal combining marks.
--
-- Deviations from the literal spec (approved):
--   (a) fynd_search_query skips Latin terms that are English stopwords
--       (to_tsvector('english', term) is empty), so "the hoodie" = "hoodie".
--       The spec's english || simple form would have kept "the" via simple
--       and required it to match; the spec's intent was to skip stopwords.
--   (b) When the english and simple parts of a Latin term are identical
--       (e.g. "nike"), only one is kept.
--   (c) §10.2 says "9 variants at most"; the real maximum is 6 (three prefix
--       forms, one stem each).
--   (d) fynd_token_variants expects an already-normalized token (lowercase,
--       finals folded); fynd_variants_text and fynd_search_query normalize
--       first.
--
-- Known limits (documented, pinned in search_text.sql):
--   - irregular plurals don't match (אישה / נשים);
--   - the construct form doesn't match (חולצת vs חולצה);
--   - possessive endings don't match (חולצתי);
--   - יים handling is partial (נעליים -> נעלי, not נעל);
--   - prefix removal can over-match a real first letter (שמלה also yields
--     מלה, so a query for מלה matches שמלה); the 3-letter minimum and the
--     two-prefix cap keep this bounded;
--   - at most two prefix letters are removed (כשהחולצות keeps ה in החולצות).

-- ============================================================
-- 1. fynd_text_normalize
-- ============================================================
-- In order: lowercase; maqaf U+05BE -> space; drop niqqud / cantillation /
-- points U+0591-U+05C7; drop geresh U+05F3 and gershayim U+05F4; drop an
-- apostrophe or quote (' " ` U+2018 U+2019 U+201C U+201D) between two Hebrew
-- letters (lookahead, so ג'ו'ב works); fold finals ךםןףץ -> כמנפצ; collapse
-- every run of non-letters/digits (any script) to one space; trim.
create function public.fynd_text_normalize(p_text text)
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
              replace(lower(coalesce(p_text, '')), E'־', ' '),
              '[֑-ׇ]', '', 'g'
            ),
            '[׳״]', '', 'g'
          ),
          '([א-ת])[''"`‘’“”](?=[א-ת])', '\1', 'g'
        ),
        E'ךםןףץ',
        E'כמנפצ'
      ),
      '[^[:alnum:]]+', ' ', 'g'
    )
  );
$$;

comment on function public.fynd_text_normalize(text) is
  'Search normalization (spec §10.1): lowercase, strip niqqud/geresh, fold Hebrew finals, collapse non-alphanumerics. NULL -> ''''.';

revoke all on function public.fynd_text_normalize(text) from public, anon;
grant execute on function public.fynd_text_normalize(text) to authenticated;

-- ============================================================
-- 2. fynd_token_variants
-- ============================================================
-- Input: ONE already-normalized token. Non-Hebrew tokens (anything outside
-- U+05D0-U+05EA) come back unchanged. Hebrew tokens: prefix forms P0, P1, P2
-- (drop a leading ו ה ב ל מ ש כ while at least 3 letters remain, at most
-- twice), then one suffix stem per prefix form (drop ות or ימ, else ה, while
-- at least 3 letters remain). Deduped, ordered by first occurrence: prefix
-- forms first, then stems.
create function public.fynd_token_variants(p_token text)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_token is null or p_token = '' then '{}'::text[]
    when p_token !~ '^[א-ת]+$' then array[p_token]
    else (
      select array_agg(d.v order by d.o)
      from (
        select x.v, min(x.o) as o
        from (select p_token as p0) a
        cross join lateral (
          select case
            when a.p0 ~ '^[והבלמשכ]' and length(a.p0) >= 4
              then substr(a.p0, 2)
          end as p1
        ) b
        cross join lateral (
          select case
            when b.p1 ~ '^[והבלמשכ]' and length(b.p1) >= 4
              then substr(b.p1, 2)
          end as p2
        ) c
        cross join lateral unnest(array[a.p0, b.p1, c.p2]) with ordinality as f(form, i)
        cross join lateral (
          values
            (f.form, f.i),
            (case
               -- ות (feminine plural) or ימ (masculine plural, finals folded)
               when f.form ~ '(ות|ימ)$' and length(f.form) >= 5
                 then left(f.form, -2)
               -- ה (feminine singular)
               when f.form ~ 'ה$' and length(f.form) >= 4
                 then left(f.form, -1)
             end,
             f.i + 3)
        ) as x(v, o)
        where x.v is not null
        group by x.v
      ) d
    )
  end;
$$;

comment on function public.fynd_token_variants(text) is
  'Hebrew prefix forms + suffix stems of one NORMALIZED token (spec §10.2, max 6). Non-Hebrew tokens are returned as-is.';

revoke all on function public.fynd_token_variants(text) from public, anon;
grant execute on function public.fynd_token_variants(text) to authenticated;

-- ============================================================
-- 3. fynd_variants_text
-- ============================================================
-- Normalizes, then joins every token's variants with spaces, in token order.
-- Feeds to_tsvector('simple', ...) in 7.3's search_tsv.
create function public.fynd_variants_text(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    (select string_agg(array_to_string(public.fynd_token_variants(t.tok), ' '), ' ' order by t.i)
       from unnest(string_to_array(public.fynd_text_normalize(p_text), ' ')) with ordinality as t(tok, i)
      where t.tok <> ''),
    ''
  );
$$;

comment on function public.fynd_variants_text(text) is
  'Normalized text with every token expanded to its fynd_token_variants, space-joined (spec §10.3).';

revoke all on function public.fynd_variants_text(text) from public, anon;
grant execute on function public.fynd_variants_text(text) to authenticated;

-- ============================================================
-- 4. fynd_search_query
-- ============================================================
-- One sub-query per normalized term, ANDed together:
--   Hebrew-only term : OR of plainto_tsquery('simple', v) over its variants;
--   any other term   : skipped if it is an English stopword, else
--                      plainto_tsquery('english') || plainto_tsquery('simple')
--                      (just one when they are identical).
-- Empty sub-queries are skipped; NULL when no term remains (no text filter).
-- Matching is exact lexeme against lexeme: no :* prefix matching.
create function public.fynd_search_query(p_query text)
returns tsquery
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_term text;
  v_variant text;
  v_part tsquery;
  v_sub tsquery;
  v_english tsquery;
  v_simple tsquery;
  v_result tsquery;
begin
  foreach v_term in array string_to_array(public.fynd_text_normalize(p_query), ' ') loop
    continue when v_term = '';
    v_sub := null;

    if v_term ~ '^[א-ת]+$' then
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
  end loop;

  return v_result;
end;
$$;

comment on function public.fynd_search_query(text) is
  'Search box text -> tsquery (spec §10.4): Hebrew variants OR-ed per term, English+simple for other terms, terms AND-ed. NULL = no text filter.';

revoke all on function public.fynd_search_query(text) from public, anon;
grant execute on function public.fynd_search_query(text) to authenticated;
