-- Search synonyms, performance fix 3 (roadmap 7.5a). Follows
-- 20261102123038_search_term_aliases.sql,
-- 20261108082741_search_term_aliases_precompute.sql and
-- 20261108082854_search_spans_plpgsql.sql (all applied; not edited).
--
-- WHY: the worst-case query (24 distinct prefixed Hebrew words, 186
-- characters) still took ~7 ms in fynd_search_query_expanded against the
-- plan's < 5 ms budget. ~3 ms of it was fynd_match_forms: as a LANGUAGE sql
-- function with a SET clause it is never inlined and its query (plus the
-- nested fynd_token_variants call) is set up again on every call (~130 us
-- per Hebrew token). As LANGUAGE plpgsql its statements' plans are cached
-- for the session, like 7.2's fynd_search_query.
--
-- Same signature, same result for every input, still IMMUTABLE PARALLEL
-- SAFE with search_path = '', so the stored first_forms column (082741)
-- stays valid and needs no recompute. Grants re-asserted.
--
-- The Hebrew letter range is written as \u05D0-\u05EA regex escapes.

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
  if p_token is null or p_token = '' then
    return '{}'::text[];
  end if;

  if p_token ~ '^[\u05D0-\u05EA]+$' then
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
  'Match forms of one normalized token (roadmap 7.5): Hebrew query = all variants, Hebrew alias = suffix forms only, other = token + english lexemes.';

revoke all on function public.fynd_match_forms(text, boolean) from public, anon;
grant execute on function public.fynd_match_forms(text, boolean) to authenticated;
