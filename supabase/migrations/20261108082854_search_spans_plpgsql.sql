-- Search synonyms, performance fix 2 (roadmap 7.5a). Follows
-- 20261102123038_search_term_aliases.sql and
-- 20261108082741_search_term_aliases_precompute.sql (both applied; not
-- edited).
--
-- WHY: with the stored forms, fynd_search_query_expanded still spent ~2-3 ms
-- per call PLANNING fynd_search_spans: a LANGUAGE sql function with a SET
-- clause is never inlined, and its CTE query is re-planned on every call.
-- As LANGUAGE plpgsql, RETURN QUERY's plan is cached for the session.
-- Same signature, result, STABLE, SECURITY INVOKER, search_path = '' and
-- grants (re-asserted); the query text is unchanged from 082741.

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
end;
$$;

comment on function public.fynd_search_spans(text[], boolean) is
  'Alias spans over the first 24 normalized query tokens (roadmap 7.5): term aliases, plus active brand aliases when p_include_brands.';

revoke all on function public.fynd_search_spans(text[], boolean) from public, anon;
grant execute on function public.fynd_search_spans(text[], boolean) to authenticated;
