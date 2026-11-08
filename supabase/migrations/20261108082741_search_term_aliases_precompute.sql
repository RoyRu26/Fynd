-- Search synonyms, performance fix (roadmap 7.5a). Follows
-- 20261102123038_search_term_aliases.sql (applied; not edited).
--
-- WHY: the 7.5a plan budgets < 5 ms per fynd_search_query_expanded call and
-- names the fallback if it is slower: store the alias match forms. Measured
-- after 123038: ~18-27 ms per call, because fynd_search_spans ran
-- fynd_match_forms (an english to_tsvector per alias) over all ~311 alias
-- rows on every call, and the expansion rebuilt every member tsquery.
--
-- 1. listing_attribute_term_aliases gets two STORED generated columns, both
--    pure functions of alias_key (IMMUTABLE, search_path = ''):
--      first_forms  = fynd_match_forms(first word of alias_key, false)
--      member_query = fynd_alias_tsquery(alias_key): the AND of
--                     fynd_member_token_query over the alias's words
--    Clients still only SELECT this table; generated columns can't be
--    written. Same IMMUTABLE caveat as 7.2: after a PostgreSQL major or ICU
--    upgrade, recompute them (e.g. UPDATE ... SET alias_key = alias_key).
-- 2. fynd_search_spans reads first_forms for term aliases (brand aliases,
--    used only by 7.5b recognition, are still computed on the fly; later
--    words of a candidate alias are computed only for rows whose first word
--    matched).
-- 3. fynd_search_query_expanded ORs the stored member_query values, and
--    skips a member whose tsquery text equals the 7.2 sub-query or an
--    earlier member (123038 could repeat e.g. 'black' | 'black').
-- Same signatures, volatility and grants (re-asserted).

-- ============================================================
-- 1. fynd_alias_tsquery + stored columns
-- ============================================================
create function public.fynd_alias_tsquery(p_alias_key text)
returns tsquery
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_tok text;
  v_part tsquery;
  v_result tsquery;
begin
  foreach v_tok in array string_to_array(coalesce(p_alias_key, ''), ' ') loop
    v_part := public.fynd_member_token_query(v_tok);
    continue when v_part is null or numnode(v_part) = 0;
    v_result := case when v_result is null then v_part else v_result && v_part end;
  end loop;
  return v_result;
end;
$$;

comment on function public.fynd_alias_tsquery(text) is
  'Normalized alias key -> AND of fynd_member_token_query over its words (roadmap 7.5).';

revoke all on function public.fynd_alias_tsquery(text) from public, anon;
grant execute on function public.fynd_alias_tsquery(text) to authenticated;

alter table public.listing_attribute_term_aliases
  add column first_forms text[]
    generated always as (public.fynd_match_forms(split_part(alias_key, ' ', 1), false)) stored,
  add column member_query tsquery
    generated always as (public.fynd_alias_tsquery(alias_key)) stored;

-- ============================================================
-- 2. fynd_search_spans: stored first-word forms
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
language sql
stable
parallel safe
security invoker
set search_path = ''
as $$
  with qt as materialized (
    select t.tok, t.i::int as i, public.fynd_match_forms(t.tok, true) as forms
      from unnest(coalesce(p_tokens, '{}'::text[])) with ordinality as t(tok, i)
     where t.i <= 24
  ),
  cand as materialized (
    select a.term_kind as kind, a.term_id, null::uuid as brand_id, a.alias, a.alias_key as key,
           a.first_forms
      from public.listing_attribute_term_aliases a
    union all
    select 'brand', null::uuid, b.id, ba.alias, x.key,
           public.fynd_match_forms(split_part(x.key, ' ', 1), false)
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
               and q2.forms && public.fynd_match_forms(x.tok, false)));
$$;

revoke all on function public.fynd_search_spans(text[], boolean) from public, anon;
grant execute on function public.fynd_search_spans(text[], boolean) to authenticated;

-- ============================================================
-- 3. fynd_search_query_expanded: stored member queries, deduped
-- ============================================================
create or replace function public.fynd_search_query_expanded(p_query text)
returns tsquery
language plpgsql
stable
parallel safe
security invoker
set search_path = ''
as $$
declare
  c_max_units constant int := 8;
  c_max_members constant int := 16;
  v_tokens text[];
  v_n int;
  v_span_count int[];
  v_span_term uuid[];
  r record;
  i int := 1;
  v_k int;
  v_key text;
  v_used_keys text[] := '{}';
  v_used int := 0;
  v_member tsquery;
  v_members text[];
  v_sub tsquery;
  v_result tsquery;
begin
  v_tokens := public.fynd_search_tokens(p_query);
  v_n := cardinality(v_tokens);
  if v_n = 0 then
    return null;
  end if;

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

  while i <= v_n and v_used < c_max_units loop
    v_k := v_span_count[i];

    if v_k > 0 then
      v_key := 'term:' || v_span_term[i]::text;
      v_sub := null;
      if not v_key = any(v_used_keys) then
        v_sub := public.fynd_search_query(array_to_string(v_tokens[i:i + v_k - 1], ' '));
        v_members := case when v_sub is null then '{}'::text[] else array[v_sub::text] end;
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
          v_sub := case when v_sub is null then v_member else v_sub || v_member end;
        end loop;
      end if;
      i := i + v_k;
    else
      v_key := v_tokens[i];
      v_sub := null;
      if not v_key = any(v_used_keys) then
        v_sub := public.fynd_search_query(v_key);
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

revoke all on function public.fynd_search_query_expanded(text) from public, anon;
grant execute on function public.fynd_search_query_expanded(text) to authenticated;
