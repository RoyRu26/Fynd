-- Query recognition, review fixes (roadmap 7.5b). Follows
-- 20261108094312_recognise_search_terms.sql (applied; not edited).
-- Same signatures, volatility and grants (re-asserted).
--
-- 1. Bounded work on huge input (MEDIUM, security). recognise_search_terms
--    split the WHOLE raw input on whitespace and walked every chunk once per
--    selected span (1 MB -> ~5 s, 5 MB -> ~77 s, ~1 MB rows back). Now:
--    (a) the raw input is first cut to 1000 characters. The app's search
--        box is capped at 200 (the length search and recognition read), so
--        1000 leaves room for any real paste while bounding the work;
--    (b) only the 200-character prefix that tokens come from is split into
--        chunks; the text after it (<= 800 characters) is appended to
--        query_without_match as ONE trimmed string, untouched;
--    (c) matched_text / query_without_match are computed only for the <= 6
--        rows returned.
--    Input over 1000 characters still gets its chips, but query_without_match
--    is NULL (no removal offered: the client keeps its text and only adds
--    the filter), so the output stays bounded and no text is silently lost.
-- 2. "Off-White hoodie" offered Color: White besides Brand: Off-White. A
--    term span that sits STRICTLY inside a longer selected brand span is
--    dropped. Same-length overlaps stay, so one word can still be offered as
--    both a term and a brand.
-- 3. Repeated words. "black black hoodie" removed only the first "black".
--    A later span that names an already-selected target (and doesn't
--    overlap another target of its type) now marks its tokens as covered by
--    that target too, so removal drops every chunk the target covers:
--    "black black hoodie" -> "hoodie", "hoodie black hoodie" -> "black".
--    matched_text stays the first selected span's text.
-- 4. "- black" left '-'. When no kept chunk (or the text after the cut) has
--    a token, query_without_match is ''.
-- 5. Perf (Low): fynd_search_spans normalized every brand alias and ran
--    fynd_match_forms (an english to_tsvector) over all of them on every
--    call (~13 ms; 57-187 ms cold). brand_aliases gets two STORED generated
--    columns, the same values fynd_search_spans computed on the fly:
--      search_key  = fynd_text_normalize(alias)
--      first_forms = fynd_match_forms(first word of search_key, false)
--    Both functions are IMMUTABLE with search_path = ''. ADD COLUMN ...
--    STORED rewrites the table, which computes them for every existing row
--    (no UPDATE needed, so brand_aliases' search-refresh triggers don't
--    fire). Clients still only SELECT brand_aliases; generated columns
--    can't be written. fynd_search_spans reads them; its results are
--    unchanged.
--
-- PRECOMPUTE INVARIANT (extends 20261108091143's): any change to
-- fynd_text_normalize, fynd_token_variants or fynd_match_forms must be
-- followed, in the same migration, by
--   update public.brand_aliases set alias = alias;
-- as well as the listing_attribute_term_aliases one. search_recognise.sql
-- checks stored == computed.

-- ============================================================
-- 1. brand_aliases: stored search key + first-word forms
-- ============================================================
alter table public.brand_aliases
  add column search_key text
    generated always as (public.fynd_text_normalize(alias)) stored,
  add column first_forms text[]
    generated always as (
      public.fynd_match_forms(split_part(public.fynd_text_normalize(alias), ' ', 1), false)) stored;

comment on column public.brand_aliases.search_key is
  'fynd_text_normalize(alias): the key query recognition matches against (roadmap 7.5b). Generated.';
comment on column public.brand_aliases.first_forms is
  'fynd_match_forms(first word of search_key, false), precomputed for fynd_search_spans (roadmap 7.5b). Generated.';

-- ============================================================
-- 2. fynd_search_spans: stored brand forms
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
    select 'brand', null::uuid, b.id, ba.alias, ba.search_key,
           ba.first_forms, false
      from public.brand_aliases ba
      join public.brands b on b.id = ba.brand_id
     where p_include_brands
       and b.retired_at is null
       and ba.search_key <> ''
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
-- 3. recognise_search_terms
-- ============================================================
-- Selection (one pass over the spans, longest first, then exact, then
-- earliest; terms and brands tracked separately). Each token records which
-- selected row of its type covers it (0 = none). A span is taken when every
-- token is uncovered or already covered by the SAME target; a new target
-- adds a row, a known one only extends its coverage. A term span strictly
-- inside a longer selected brand span is skipped.
-- Output (<= 6 rows by position): per row, over the prefix chunks only,
--   matched_text        the chunks of the row's first span (its tokens when a
--                       chunk is only partly inside);
--   query_without_match chunks with no token of the row are kept, chunks
--                       whose every token is the row's are dropped, a chunk
--                       in between makes it NULL; then the text after the
--                       cut is appended; '' when nothing kept has a token.
create or replace function public.recognise_search_terms(p_query text)
returns table (
  kind text,
  term_id uuid,
  brand_id uuid,
  label text,
  matched_text text,
  query_without_match text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  c_max_input constant int := 1000;
  c_max_tokens constant int := 24;
  c_max_rows constant int := 6;
  v_input text;
  v_over boolean;
  v_cut text;
  v_cut_trimmed text;
  v_rest text;
  v_rest_has_tokens boolean;
  v_all_tokens text[];
  v_tokens text[];
  v_n int;
  v_chunks text[] := '{}';
  v_chunk_first int[] := '{}';
  v_chunk_count int[] := '{}';
  v_chunk_tokens text[];
  v_concat text[] := '{}';
  v_aligned boolean;
  -- Per token: the selected row (1-based index into o_*) covering it, 0 = none.
  v_own_term int[];
  v_own_brand int[];
  -- Per token covered by a brand: that brand span's first token and length.
  v_bspan_first int[];
  v_bspan_len int[];
  v_targets text[] := '{}';
  v_target text;
  v_idx int;
  v_owner int;
  v_free boolean;
  v_last int;
  v_cf int;
  v_cl int;
  v_owned int;
  v_kept text[];
  v_kept_has_tokens boolean;
  v_matched text[];
  v_partial boolean;
  v_m_partial boolean;
  c int;
  j int;
  r record;
  -- Selected rows, parallel arrays.
  o_first int[] := '{}';
  o_last int[] := '{}';
  o_is_brand boolean[] := '{}';
  o_kind text[] := '{}';
  o_term uuid[] := '{}';
  o_brand uuid[] := '{}';
  o_label text[] := '{}';
begin
  if p_query is null then
    return;
  end if;

  -- (a) Hard cap first: nothing below reads past these 1000 characters.
  v_input := left(p_query, c_max_input);
  v_over := length(p_query) > c_max_input;

  v_all_tokens := public.fynd_search_tokens(v_input);
  v_n := least(cardinality(v_all_tokens), c_max_tokens);
  if v_n = 0 then
    return;
  end if;
  v_tokens := v_all_tokens[1:v_n];

  -- (b) fynd_search_tokens' 200-character cut, which ends on whitespace: its
  -- chunks carry every token; the rest is kept as one trimmed string.
  v_cut := case
             when length(v_input) > 200
               then regexp_replace(left(v_input, 201), '[^[:space:]]*$', '')
             else v_input
           end;
  v_cut_trimmed := regexp_replace(v_cut, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_rest := regexp_replace(substr(v_input, length(v_cut) + 1), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_rest_has_tokens := public.fynd_text_normalize(v_rest) <> '';
  if v_cut_trimmed <> '' then
    v_chunks := regexp_split_to_array(v_cut_trimmed, '[[:space:]]+');
  end if;

  -- Token range of each chunk (each chunk is <= 200 characters).
  for c in 1 .. cardinality(v_chunks) loop
    v_chunk_tokens := public.fynd_search_tokens(v_chunks[c]);
    v_chunk_first := v_chunk_first || (cardinality(v_concat) + 1);
    v_chunk_count := v_chunk_count || cardinality(v_chunk_tokens);
    v_concat := v_concat || v_chunk_tokens;
  end loop;
  -- Normalizing chunk by chunk must give the same tokens as the whole input;
  -- if it ever doesn't, no removal is offered rather than a wrong one.
  v_aligned := v_concat = v_all_tokens;

  v_own_term := array_fill(0, array[v_n]);
  v_own_brand := array_fill(0, array[v_n]);
  v_bspan_first := array_fill(0, array[v_n]);
  v_bspan_len := array_fill(0, array[v_n]);

  for r in
    select s.first_token, s.token_count, s.kind, s.term_id, s.brand_id,
           (s.brand_id is not null) as is_brand,
           coalesce(t.label, b.name) as label
      from public.fynd_search_spans(v_tokens, true) s
      left join public.listing_attribute_terms t on t.id = s.term_id
      left join public.listing_attribute_kinds k on k.kind = t.kind
      left join public.brands b on b.id = s.brand_id
     where (s.term_id is not null and t.id is not null and t.retired_at is null)
        or (s.brand_id is not null and b.id is not null and b.retired_at is null)
     order by s.token_count desc, s.exact desc, s.first_token, k.position, t.position, b.name, s.alias
  loop
    v_last := r.first_token + r.token_count - 1;
    continue when v_last > v_n;

    -- A term strictly inside a longer selected brand ("white" in Off-White).
    -- Longer spans come first, so that brand is already selected.
    continue when not r.is_brand
              and v_own_brand[r.first_token] <> 0
              and v_bspan_len[r.first_token] > r.token_count
              and v_last <= v_bspan_first[r.first_token] + v_bspan_len[r.first_token] - 1;

    v_target := case when r.is_brand then 'brand:' || r.brand_id::text else 'term:' || r.term_id::text end;
    v_idx := coalesce(array_position(v_targets, v_target), 0);

    v_free := true;
    for j in r.first_token .. v_last loop
      v_owner := case when r.is_brand then v_own_brand[j] else v_own_term[j] end;
      if v_owner <> 0 and v_owner <> v_idx then
        v_free := false;
        exit;
      end if;
    end loop;
    continue when not v_free;

    if v_idx = 0 then
      v_targets := v_targets || v_target;
      o_first := o_first || r.first_token;
      o_last := o_last || v_last;
      o_is_brand := o_is_brand || r.is_brand;
      o_kind := o_kind || r.kind;
      o_term := array_append(o_term, r.term_id);
      o_brand := array_append(o_brand, r.brand_id);
      o_label := o_label || r.label;
      v_idx := cardinality(v_targets);
    end if;

    for j in r.first_token .. v_last loop
      if r.is_brand then
        if v_own_brand[j] = 0 then
          v_own_brand[j] := v_idx;
          v_bspan_first[j] := r.first_token;
          v_bspan_len[j] := r.token_count;
        end if;
      else
        v_own_term[j] := v_idx;
      end if;
    end loop;
  end loop;

  -- (c) Text only for the rows returned.
  for v_idx in
    select x.idx::int
      from unnest(o_first, o_is_brand, o_label) with ordinality as x(f_tok, is_b, lbl, idx)
     order by x.f_tok, x.is_b, x.lbl
     limit c_max_rows
  loop
    -- matched_text: the chunks of the first span.
    v_matched := '{}';
    v_m_partial := not v_aligned;
    if v_aligned then
      for c in 1 .. cardinality(v_chunks) loop
        continue when v_chunk_count[c] = 0;
        v_cf := v_chunk_first[c];
        v_cl := v_cf + v_chunk_count[c] - 1;
        continue when v_cl < o_first[v_idx] or v_cf > o_last[v_idx];
        if v_cf >= o_first[v_idx] and v_cl <= o_last[v_idx] then
          v_matched := v_matched || v_chunks[c];
        else
          v_m_partial := true;
          exit;
        end if;
      end loop;
    end if;

    -- query_without_match: drop every chunk the target covers.
    v_kept := '{}';
    v_kept_has_tokens := false;
    v_partial := not v_aligned or v_over;
    if not v_partial then
      for c in 1 .. cardinality(v_chunks) loop
        if v_chunk_count[c] = 0 then
          -- A chunk with no tokens ("-", "&") stays.
          v_kept := v_kept || v_chunks[c];
          continue;
        end if;
        v_cf := v_chunk_first[c];
        v_cl := v_cf + v_chunk_count[c] - 1;
        v_owned := 0;
        for j in v_cf .. least(v_cl, v_n) loop
          if (case when o_is_brand[v_idx] then v_own_brand[j] else v_own_term[j] end) = v_idx then
            v_owned := v_owned + 1;
          end if;
        end loop;
        if v_owned = 0 then
          v_kept := v_kept || v_chunks[c];
          v_kept_has_tokens := true;
        elsif v_owned < v_chunk_count[c] then
          v_partial := true;
          exit;
        end if;
      end loop;
    end if;

    kind := o_kind[v_idx];
    term_id := o_term[v_idx];
    brand_id := o_brand[v_idx];
    label := o_label[v_idx];
    matched_text := case
                      when v_m_partial then array_to_string(v_tokens[o_first[v_idx]:o_last[v_idx]], ' ')
                      else array_to_string(v_matched, ' ')
                    end;
    query_without_match := case
                             when v_partial then null
                             when not v_kept_has_tokens and not v_rest_has_tokens then ''
                             else concat_ws(' ', nullif(array_to_string(v_kept, ' '), ''), nullif(v_rest, ''))
                           end;
    return next;
  end loop;
end;
$$;

comment on function public.recognise_search_terms(text) is
  'Active attribute terms and brands named in a search query, for Explore''s query chips (roadmap 7.5b). Reads at most 1000 characters; <= 6 rows by position; query_without_match is the input without the matched words, NULL when not cleanly removable or the input is over 1000 characters.';

revoke all on function public.recognise_search_terms(text) from public, anon;
grant execute on function public.recognise_search_terms(text) to authenticated;
