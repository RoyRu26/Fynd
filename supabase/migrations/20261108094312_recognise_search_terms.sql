-- Query recognition for Explore's query chips (roadmap 7.5b). Builds on
-- 7.5a's alias table and helpers (20261102123038_search_term_aliases.sql
-- through 20261108091143_search_term_aliases_review_fixes.sql; all applied,
-- none edited) and DESIGN.md §14.2 "Query chips (7.5)".
--
-- WHY: a buyer types "black nike hoodie" and gets a text search. The words
-- name real filters (Color: Black, Brand: Nike, Item type: Hoodie); offering
-- them as chips turns a fuzzy text match into a precise structured filter
-- with one tap. This RPC only RECOGNISES: it reads the query and says which
-- active terms / brands it names and what the query reads like without the
-- matched words. It changes nothing and search_listings is untouched.
--
-- public.recognise_search_terms(p_query text) returns
--   (kind, term_id, brand_id, label, matched_text, query_without_match)
--   kind                 'brand' or an attribute kind ('color', 'item_type', ...)
--   term_id / brand_id   exactly one is set
--   label                the term label / brand name
--   matched_text         the input text the span covers (original spelling
--                        when it is whole whitespace chunks, else the
--                        normalized tokens)
--   query_without_match  the input with the covered whitespace chunks removed
--                        (original text, single spaces), '' when nothing is
--                        left, NULL when a chunk is only partly covered
--                        ("black/white") or chunks and tokens don't line up;
--                        the client then keeps its text and only adds the filter.
--
-- Rules (approved plan 7.5b):
--   - Same 200-character cut and normalization as search
--     (fynd_search_tokens); only the first 24 tokens; spans from
--     fynd_search_spans(tokens, true), so exact_first holds ("short dress"
--     is not Shorts) and Hebrew prefixes are recognised (החולצה -> Shirt).
--   - Brand aliases are used here for recognition only (Roy's D4); the text
--     expansion still ignores them.
--   - Greedy non-overlapping selection, longest span first, then exact, then
--     earliest, done SEPARATELY for terms and for brands, so one word can be
--     offered as both. One row per target.
--   - Only active terms (retired_at is null) and active brands.
--   - At most 6 rows, ordered by position in the query (terms before a brand
--     on the same word).
--   - NULL / empty / whitespace-only input -> no rows.
--
-- Access (§2.4): STABLE, SECURITY INVOKER (reads only tables authenticated
-- can already SELECT), search_path = '', EXECUTE revoked from public and
-- anon, granted to authenticated. Input is bounded: tokens and spans come
-- from the 200-character prefix; only the whitespace split of the raw input
-- (needed to keep the text after the cut) is linear in its length.

create function public.recognise_search_terms(p_query text)
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
  c_max_tokens constant int := 24;
  c_max_rows constant int := 6;
  v_cut text;
  v_cut_trimmed text;
  v_all_tokens text[];
  v_tokens text[];
  v_n int;
  v_chunks text[];
  v_prefix_chunks int := 0;
  v_chunk_first int[] := '{}';
  v_chunk_count int[] := '{}';
  v_chunk_tokens text[];
  v_concat text[] := '{}';
  v_aligned boolean;
  v_cov_term boolean[];
  v_cov_brand boolean[];
  v_targets text[] := '{}';
  v_target text;
  v_free boolean;
  v_last int;
  v_cf int;
  v_cl int;
  v_kept text[];
  v_matched text[];
  v_partial boolean;
  c int;
  j int;
  r record;
  -- Selected rows, parallel arrays.
  o_first int[] := '{}';
  o_is_brand boolean[] := '{}';
  o_kind text[] := '{}';
  o_term uuid[] := '{}';
  o_brand uuid[] := '{}';
  o_label text[] := '{}';
  o_matched text[] := '{}';
  o_without text[] := '{}';
begin
  if p_query is null then
    return;
  end if;

  v_all_tokens := public.fynd_search_tokens(p_query);
  v_n := least(cardinality(v_all_tokens), c_max_tokens);
  if v_n = 0 then
    return;
  end if;
  v_tokens := v_all_tokens[1:v_n];

  -- Whitespace chunks of the raw input. fynd_search_tokens' cut ends on
  -- whitespace, so the cut text's chunks are a prefix of these.
  v_chunks := regexp_split_to_array(
    regexp_replace(p_query, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '[[:space:]]+');
  v_cut := case
             when length(p_query) > 200
               then regexp_replace(left(p_query, 201), '[^[:space:]]*$', '')
             else p_query
           end;
  v_cut_trimmed := regexp_replace(v_cut, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if v_cut_trimmed <> '' then
    v_prefix_chunks := cardinality(regexp_split_to_array(v_cut_trimmed, '[[:space:]]+'));
  end if;

  -- Token range of each chunk inside the cut (each chunk is <= 200 chars).
  for c in 1 .. v_prefix_chunks loop
    v_chunk_tokens := public.fynd_search_tokens(v_chunks[c]);
    v_chunk_first := v_chunk_first || (cardinality(v_concat) + 1);
    v_chunk_count := v_chunk_count || cardinality(v_chunk_tokens);
    v_concat := v_concat || v_chunk_tokens;
  end loop;
  -- Normalizing chunk by chunk must give the same tokens as the whole input;
  -- if it ever doesn't, no removal is offered rather than a wrong one.
  v_aligned := v_concat = v_all_tokens;

  v_cov_term := array_fill(false, array[v_n]);
  v_cov_brand := array_fill(false, array[v_n]);

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

    v_target := case when r.is_brand then 'brand:' || r.brand_id::text else 'term:' || r.term_id::text end;
    continue when v_target = any(v_targets);

    v_free := true;
    for j in r.first_token .. v_last loop
      if (r.is_brand and v_cov_brand[j]) or (not r.is_brand and v_cov_term[j]) then
        v_free := false;
        exit;
      end if;
    end loop;
    continue when not v_free;

    for j in r.first_token .. v_last loop
      if r.is_brand then
        v_cov_brand[j] := true;
      else
        v_cov_term[j] := true;
      end if;
    end loop;
    v_targets := v_targets || v_target;

    -- matched_text / query_without_match.
    v_kept := '{}';
    v_matched := '{}';
    v_partial := not v_aligned;
    if v_aligned then
      for c in 1 .. cardinality(v_chunks) loop
        if c <= v_prefix_chunks and v_chunk_count[c] > 0 then
          v_cf := v_chunk_first[c];
          v_cl := v_cf + v_chunk_count[c] - 1;
          if v_cl < r.first_token or v_cf > v_last then
            v_kept := v_kept || v_chunks[c];
          elsif v_cf >= r.first_token and v_cl <= v_last then
            v_matched := v_matched || v_chunks[c];
          else
            v_partial := true;
            exit;
          end if;
        else
          -- A chunk with no tokens ("-", "&") or past the cut stays.
          v_kept := v_kept || v_chunks[c];
        end if;
      end loop;
    end if;

    o_first := o_first || r.first_token;
    o_is_brand := o_is_brand || r.is_brand;
    o_kind := o_kind || r.kind;
    o_term := array_append(o_term, r.term_id);
    o_brand := array_append(o_brand, r.brand_id);
    o_label := o_label || r.label;
    o_matched := o_matched || case
                   when v_partial then array_to_string(v_tokens[r.first_token:v_last], ' ')
                   else array_to_string(v_matched, ' ')
                 end;
    o_without := array_append(o_without, case when v_partial then null else array_to_string(v_kept, ' ') end);
  end loop;

  return query
  select x.kind, x.term_id, x.brand_id, x.label, x.matched_text, x.query_without_match
    from unnest(o_first, o_is_brand, o_kind, o_term, o_brand, o_label, o_matched, o_without)
           as x(first_token, is_brand, kind, term_id, brand_id, label, matched_text, query_without_match)
   order by x.first_token, x.is_brand, x.label
   limit c_max_rows;
end;
$$;

comment on function public.recognise_search_terms(text) is
  'Active attribute terms and brands named in a search query, for Explore''s query chips (roadmap 7.5b). <= 6 rows by position; query_without_match is the input without the matched words, NULL when not cleanly removable.';

revoke all on function public.recognise_search_terms(text) from public, anon;
grant execute on function public.recognise_search_terms(text) to authenticated;
