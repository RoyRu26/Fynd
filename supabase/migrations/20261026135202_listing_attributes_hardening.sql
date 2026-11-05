-- Hardening for listing attributes (AI listing metadata plan, Phase 1a),
-- from the security review of 20261026085745_listing_attributes.sql. Kept
-- as a follow-up migration because that one is already applied locally.
--
-- 1. set_listing_attributes refuses an oversized keyword array (> 50
--    elements) or any keyword over 200 bytes with 22023 before doing any
--    normalization work. Otherwise identical; `create or replace` keeps the
--    existing EXECUTE grants (authenticated only).
-- 2. listing_attribute_value_applies is no longer client-callable. Its only
--    callers are the validate trigger (reached only through the SECURITY
--    DEFINER RPC or privileged writes) and the SECURITY DEFINER prune
--    trigger, which run as the function owner.
--
-- listing_keywords_valid deliberately KEEPS its authenticated EXECUTE grant:
-- the listings CHECK constraint calls it on every direct draft UPDATE, which
-- runs as the seller. Pinned by a pgTAP test.

create or replace function public.set_listing_attributes(
  p_listing_id uuid,
  p_term_ids uuid[],
  p_keywords text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_seller_id uuid;
  v_status public.listing_status;
  v_term_ids uuid[] := coalesce(p_term_ids, '{}');
  v_keywords text[];
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select l.seller_id, l.status
    into v_seller_id, v_status
    from public.listings l
   where l.id = p_listing_id
   for update;

  if not found then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;

  if v_seller_id <> v_user_id then
    raise exception 'Only the seller can edit this listing' using errcode = '42501';
  end if;

  if v_status not in ('draft', 'active', 'reserved') then
    raise exception 'This listing can no longer be edited' using errcode = 'P0001';
  end if;

  -- Sanity cap far above any legitimate request (the per-kind maxima sum to
  -- 11), so an oversized array is refused before any lookups run.
  if cardinality(v_term_ids) > 50 then
    raise exception 'Too many attribute values' using errcode = '22023';
  end if;

  -- Same idea for keywords: refuse an oversized array or huge strings
  -- before normalizing them (the CHECKs would reject them anyway, but only
  -- after regexp/group work proportional to the input).
  if cardinality(coalesce(p_keywords, '{}')) > 50
     or exists (select 1 from unnest(p_keywords) as k where octet_length(k) > 200) then
    raise exception 'Too many or too long keywords' using errcode = '22023';
  end if;

  if exists (select 1 from unnest(v_term_ids) as x where x is null) then
    raise exception 'Attribute values cannot be empty' using errcode = '22023';
  end if;

  if cardinality(v_term_ids) <> (select count(distinct x) from unnest(v_term_ids) as x) then
    raise exception 'The same attribute value was given twice' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(v_term_ids) as x
     where not exists (select 1 from public.listing_attribute_terms t where t.id = x)
  ) then
    raise exception 'Unknown attribute value' using errcode = '22023';
  end if;

  if exists (
    select 1
      from unnest(v_term_ids) as x
      join public.listing_attribute_terms t on t.id = x
     where t.retired_at is not null
       and not exists (
         select 1 from public.listing_attribute_values v
          where v.listing_id = p_listing_id
            and v.term_id = x
       )
  ) then
    raise exception 'That attribute value is no longer available' using errcode = '22023';
  end if;

  if exists (
    select 1
      from unnest(v_term_ids) as x
      join public.listing_attribute_terms t on t.id = x
      join public.listing_attribute_kinds k on k.kind = t.kind
     group by k.kind, k.max_values
    having count(*) > k.max_values
  ) then
    raise exception 'Too many values for one attribute' using errcode = '22023';
  end if;

  -- Keywords: trim, lowercase, collapse inner whitespace, drop empties, and
  -- dedupe keeping each keyword's first position. The listings CHECK
  -- constraints then validate the result.
  select coalesce(array_agg(d.keyword order by d.first_ordinal), '{}')
    into v_keywords
    from (
      select n.keyword, min(n.ordinal) as first_ordinal
        from (
          select lower(regexp_replace(btrim(u.raw), '\s+', ' ', 'g')) as keyword, u.ordinal
            from unnest(coalesce(p_keywords, '{}')) with ordinality as u(raw, ordinal)
        ) n
       where n.keyword <> ''
       group by n.keyword
    ) d;

  delete from public.listing_attribute_values v where v.listing_id = p_listing_id;

  insert into public.listing_attribute_values (listing_id, term_id, kind, position)
  select p_listing_id,
         t.id,
         t.kind,
         (row_number() over (partition by t.kind order by u.ordinal) - 1)::smallint
    from unnest(v_term_ids) with ordinality as u(term_id, ordinal)
    join public.listing_attribute_terms t on t.id = u.term_id;

  update public.listings l
     set keywords = v_keywords
   where l.id = p_listing_id
     and l.keywords is distinct from v_keywords;
end;
$$;

revoke execute on function public.listing_attribute_value_applies(text, uuid, uuid) from authenticated;
