-- Search synonyms, review fixes (roadmap 7.5a). Follows
-- 20261102123038_search_term_aliases.sql,
-- 20261108082741_search_term_aliases_precompute.sql,
-- 20261108082854_search_spans_plpgsql.sql and
-- 20261108082950_search_match_forms_plpgsql.sql (all applied; not edited).
-- search_listings is untouched.
--
-- 1. Superset at the 8-term cap (MUST). 7.2's fynd_search_query uses the
--    first 8 distinct non-skipped WORDS; the expansion counted a multi-word
--    span as one unit, so "dress shoes alpha ... foxtrot golf" ANDed 'golf',
--    which 7.2 never uses. fynd_search_query_expanded now walks the tokens
--    with 7.2's rules first and cuts them at the token where 7.2 reaches its
--    8th term; spans are found only inside that prefix, so every unit's
--    sub-query is implied by the 7.2 query. A span whose words are all
--    skipped by 7.2 (no 7.2 sub-query) adds nothing. The 8-unit cap stays as
--    a size bound (dropping a conjunct only widens the result).
-- 2. exact_first (Should). English stemming made plain words hit plural
--    names: "short dress" -> Shorts, "wide leg jeans" -> Leggings. Rows with
--    exact_first = true match a query word only through their own literal
--    words (first word: the stored first_forms; later words: in
--    fynd_search_spans). The query side keeps its stems, so "shorts" still
--    hits Shorts but "short" does not. Flagged rows: shorts, tights,
--    leggings, kicks, slides, pumps, flats, oxfords ("oxford shirt").
-- 3. Input caps on the /rpc-callable helpers (Low): fynd_search_spans reads
--    at most p_tokens[1:24] of a one-dimensional array and ignores tokens
--    longer than 200 characters; fynd_match_forms returns '{}' for a token
--    longer than 200 characters. Real inputs are unaffected (fynd_search_tokens
--    cuts the query at 200 characters; alias keys are <= 60).
-- 4. One-word members are added as their lexemes, skipping any lexeme
--    already among the unit's top-level OR parts ('check' | 'check').
-- 5. <= 16 alias rows per term is enforced by a constraint trigger.
--
-- PRECOMPUTE INVARIANT: first_forms and member_query are STORED generated
-- columns. Any change to fynd_token_variants, fynd_match_forms,
-- fynd_alias_word_forms, fynd_member_token_query or fynd_alias_tsquery must
-- be followed, in the same migration, by
--   update public.listing_attribute_term_aliases set alias_key = alias_key;
-- (an UPDATE recomputes every stored generated column). search_aliases.sql
-- checks stored == computed.

-- ============================================================
-- 1. fynd_match_forms: long tokens have no forms
-- ============================================================
create or replace function public.fynd_match_forms(p_token text, p_is_query boolean)
returns text[]
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_variants text[];
  v_form text;
  v_result text[] := '{}';
begin
  -- Empty, NULL and over-long tokens (> 200 characters, callable via /rpc)
  -- have no forms.
  if p_token is null or p_token = '' or length(p_token) > 200 then
    return '{}'::text[];
  end if;

  if p_token ~ '^[א-ת]+$' then
    v_variants := public.fynd_token_variants(p_token);
    if p_is_query then
      return v_variants;
    end if;
    -- Alias side: suffix forms only (variants the token starts with).
    foreach v_form in array v_variants loop
      if left(p_token, length(v_form)) = v_form then
        v_result := v_result || v_form;
      end if;
    end loop;
    return v_result;
  end if;

  return array(
    select distinct x.form
      from unnest(array[p_token]
             || tsvector_to_array(to_tsvector('pg_catalog.english'::regconfig, p_token))) as x(form)
     order by x.form);
end;
$$;

comment on function public.fynd_match_forms(text, boolean) is
  'Match forms of one normalized token (roadmap 7.5): Hebrew query = all variants, Hebrew alias = suffix forms only, other = token + english lexemes. Tokens over 200 characters have none.';

revoke all on function public.fynd_match_forms(text, boolean) from public, anon;
grant execute on function public.fynd_match_forms(text, boolean) to authenticated;

-- ============================================================
-- 2. fynd_alias_word_forms + exact_first
-- ============================================================
-- Forms of one alias word: the word itself when the row is exact_first,
-- else fynd_match_forms(word, false).
create function public.fynd_alias_word_forms(p_token text, p_exact boolean)
returns text[]
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
begin
  if p_exact then
    if p_token is null or p_token = '' or length(p_token) > 200 then
      return '{}'::text[];
    end if;
    return array[p_token];
  end if;
  return public.fynd_match_forms(p_token, false);
end;
$$;

comment on function public.fynd_alias_word_forms(text, boolean) is
  'Match forms of one alias word (roadmap 7.5): the word only when exact, else fynd_match_forms(word, false).';

revoke all on function public.fynd_alias_word_forms(text, boolean) from public, anon;
grant execute on function public.fynd_alias_word_forms(text, boolean) to authenticated;

alter table public.listing_attribute_term_aliases
  add column exact_first boolean not null default false;

comment on column public.listing_attribute_term_aliases.exact_first is
  'When true, query words match this alias only through its literal words (no English stems), so "short" does not hit "shorts".';

alter table public.listing_attribute_term_aliases
  alter column first_forms
    set expression as (public.fynd_alias_word_forms(split_part(alias_key, ' ', 1), exact_first));

-- Stems that are common words of their own: short, tight, leg, kick, slide,
-- pump, flat, oxford ("oxford shirt"). Guarded so a missing key fails.
do $flag$
declare
  v_rows integer;
begin
  update public.listing_attribute_term_aliases a
     set exact_first = true
    from public.listing_attribute_terms t
   where t.id = a.term_id
     and (t.kind, t.slug, a.alias_key) in (
       ('item_type', 'shorts',      'shorts'),
       ('item_type', 'leggings',    'leggings'),
       ('item_type', 'leggings',    'tights'),
       ('item_type', 'sneakers',    'kicks'),
       ('item_type', 'sandals',     'slides'),
       ('item_type', 'heels',       'pumps'),
       ('item_type', 'flats',       'flats'),
       ('item_type', 'dress_shoes', 'oxfords'));
  get diagnostics v_rows = row_count;
  if v_rows <> 8 then
    raise exception 'exact_first: expected 8 rows, flagged %', v_rows;
  end if;
end
$flag$;

-- fynd_match_forms changed (long tokens only): recompute every stored
-- generated column (see PRECOMPUTE INVARIANT above).
update public.listing_attribute_term_aliases set alias_key = alias_key;

-- ============================================================
-- 3. <= 16 alias rows per term
-- ============================================================
create function public.fynd_alias_term_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.listing_attribute_term_aliases a
       where a.term_id = new.term_id) > 16 then
    raise exception 'A term has more than 16 alias rows' using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke all on function public.fynd_alias_term_limit() from public, anon, authenticated;

create constraint trigger listing_attribute_term_aliases_max_per_term
  after insert or update of term_id on public.listing_attribute_term_aliases
  for each row execute function public.fynd_alias_term_limit();

-- ============================================================
-- 4. fynd_search_spans: capped input, exact_first
-- ============================================================
create or replace function public.fynd_search_spans(p_tokens text[], p_include_brands boolean)
returns table (
  first_token integer,
  token_count integer,
  kind text,
  term_id uuid,
  brand_id uuid,
  alias text,
  exact boolean
)
language plpgsql
stable
parallel safe
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with qt as materialized (
    select t.tok, t.i::int as i, public.fynd_match_forms(t.tok, true) as forms
      from unnest(case when array_ndims(p_tokens) = 1 then p_tokens[1:24] end)
             with ordinality as t(tok, i)
     where t.i <= 24
       and length(t.tok) <= 200
  ),
  cand as materialized (
    select a.term_kind as kind, a.term_id, null::uuid as brand_id, a.alias, a.alias_key as key,
           a.first_forms, a.exact_first
      from public.listing_attribute_term_aliases a
    union all
    select 'brand', null::uuid, b.id, ba.alias, x.key,
           public.fynd_match_forms(split_part(x.key, ' ', 1), false), false
      from public.brand_aliases ba
      join public.brands b on b.id = ba.brand_id
     cross join lateral (select public.fynd_text_normalize(ba.alias) as key) x
     where p_include_brands
       and b.retired_at is null
       and x.key <> ''
  ),
  hit as (
    select q1.i, c.*, string_to_array(c.key, ' ') as toks,
           cardinality(string_to_array(c.key, ' ')) as k
      from qt q1
      join cand c on c.first_forms && q1.forms
  )
  select h.i, h.k, h.kind, h.term_id, h.brand_id, h.alias,
         array_to_string((select array_agg(q.tok order by q.i) from qt q
                           where q.i between h.i and h.i + h.k - 1), ' ') = h.key
    from hit h
   where h.i + h.k - 1 <= (select max(q.i) from qt q)
     and not exists (
       select 1
         from unnest(h.toks) with ordinality as x(tok, j)
        where x.j > 1
          and not exists (
            select 1 from qt q2
             where q2.i = h.i + x.j::int - 1
               and q2.forms && public.fynd_alias_word_forms(x.tok, h.exact_first)));
end;
$$;

comment on function public.fynd_search_spans(text[], boolean) is
  'Alias spans over the first 24 normalized query tokens (roadmap 7.5; tokens over 200 characters ignored): term aliases, plus active brand aliases when p_include_brands.';

revoke all on function public.fynd_search_spans(text[], boolean) from public, anon;
grant execute on function public.fynd_search_spans(text[], boolean) to authenticated;

-- ============================================================
-- 5. fynd_search_query_expanded
-- ============================================================
-- (a) 7.2's walk: per token its 7.2 sub-query (fynd_search_query of the
--     word); distinct words that produce one are 7.2 terms. The tokens are
--     cut after the word that is 7.2's 8th term.
-- (b) Spans over the cut tokens; best per first token as before.
-- (c) Units left to right, as before: a span unit is (AND of its words'
--     distinct 7.2 sub-queries) OR its term's members, skipped when the
--     words have no 7.2 sub-query; a single word is its 7.2 sub-query.
--     Repeated unit keys are skipped. One-word members (a pure OR of
--     lexemes) are added lexeme by lexeme, skipping lexemes already among
--     the unit's top-level OR parts.
-- With no span, the result equals fynd_search_query(p_query).
create or replace function public.fynd_search_query_expanded(p_query text)
returns tsquery
language plpgsql
stable
parallel safe
security invoker
set search_path = ''
as $$
declare
  c_max_terms constant int := 8;   -- 7.2's term cap
  c_max_units constant int := 8;   -- size bound only
  c_max_members constant int := 16;
  v_tokens text[];
  v_n int;
  v_word_query tsquery[];
  v_seen text[] := '{}';
  v_terms int := 0;
  v_span_count int[];
  v_span_term uuid[];
  r record;
  i int := 1;
  j int;
  v_k int;
  v_key text;
  v_used_keys text[] := '{}';
  v_used int := 0;
  v_span_words text[];
  v_member tsquery;
  v_members text[];
  v_lexemes text[];
  v_lex text;
  v_sub tsquery;
  v_result tsquery;
begin
  v_tokens := public.fynd_search_tokens(p_query);
  v_n := cardinality(v_tokens);
  if v_n = 0 then
    return null;
  end if;

  -- (a) 7.2's walk and cut.
  v_word_query := array_fill(null::tsquery, array[v_n]);
  for j in 1..v_n loop
    if v_tokens[j] = any(v_seen) then
      v_word_query[j] := v_word_query[array_position(v_tokens, v_tokens[j])];
      continue;
    end if;
    v_seen := v_seen || v_tokens[j];
    v_sub := public.fynd_search_query(v_tokens[j]);
    continue when v_sub is null or numnode(v_sub) = 0;
    v_word_query[j] := v_sub;
    v_terms := v_terms + 1;
    if v_terms >= c_max_terms then
      v_n := j;
      exit;
    end if;
  end loop;
  v_tokens := v_tokens[1:v_n];

  -- (b) Spans.
  v_span_count := array_fill(0, array[v_n]);
  v_span_term := array_fill(null::uuid, array[v_n]);

  for r in
    select distinct on (s.first_token) s.first_token, s.token_count, s.term_id
      from public.fynd_search_spans(v_tokens, false) s
      join public.listing_attribute_terms t on t.id = s.term_id
      join public.listing_attribute_kinds k on k.kind = t.kind
     order by s.first_token, s.token_count desc, s.exact desc, k.position, t.position, s.alias
  loop
    v_span_count[r.first_token] := r.token_count;
    v_span_term[r.first_token] := r.term_id;
  end loop;

  -- (c) Units.
  while i <= v_n and v_used < c_max_units loop
    v_k := v_span_count[i];
    v_sub := null;

    if v_k > 0 then
      v_key := 'term:' || v_span_term[i]::text;
      if not v_key = any(v_used_keys) then
        -- = fynd_search_query(the covered words).
        v_span_words := '{}';
        for j in i .. i + v_k - 1 loop
          continue when v_word_query[j] is null or v_tokens[j] = any(v_span_words);
          v_span_words := v_span_words || v_tokens[j];
          v_sub := case when v_sub is null then v_word_query[j] else v_sub && v_word_query[j] end;
        end loop;

        if v_sub is not null then
          v_members := array[v_sub::text];
          v_lexemes := case when v_sub::text ~ '^''[^'']*''( \| ''[^'']*'')*$'
                            then array(select m[1] from regexp_matches(v_sub::text, '''([^'']*)''', 'g') as m)
                            else '{}'::text[] end;
          for v_member in
            select a.member_query
              from public.listing_attribute_term_aliases a
             where a.term_id = v_span_term[i]
             order by a.alias_key
             limit c_max_members
          loop
            continue when v_member is null or numnode(v_member) = 0
                       or v_member::text = any(v_members);
            v_members := v_members || v_member::text;
            if v_member::text ~ '^''[^'']*''( \| ''[^'']*'')*$' then
              -- One-word member: a pure OR of lexemes.
              foreach v_lex in array array(
                  select m[1] from regexp_matches(v_member::text, '''([^'']*)''', 'g') as m) loop
                continue when v_lex = any(v_lexemes);
                v_lexemes := v_lexemes || v_lex;
                v_sub := v_sub || quote_literal(v_lex)::tsquery;
              end loop;
            else
              v_sub := v_sub || v_member;
            end if;
          end loop;
        end if;
      end if;
      i := i + v_k;
    else
      v_key := v_tokens[i];
      if not v_key = any(v_used_keys) then
        v_sub := v_word_query[i];
      end if;
      i := i + 1;
    end if;

    continue when v_sub is null or numnode(v_sub) = 0;
    v_used_keys := v_used_keys || v_key;
    v_result := case when v_result is null then v_sub else v_result && v_sub end;
    v_used := v_used + 1;
  end loop;

  return v_result;
end;
$$;

comment on function public.fynd_search_query_expanded(text) is
  'fynd_search_query plus term-alias expansion (roadmap 7.5); used by search_listings. Always a superset of fynd_search_query (same 8-term cut); equal to it when no alias matches. NULL = no text filter.';

revoke all on function public.fynd_search_query_expanded(text) from public, anon;
grant execute on function public.fynd_search_query_expanded(text) to authenticated;
