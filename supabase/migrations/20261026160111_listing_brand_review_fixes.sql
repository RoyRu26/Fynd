-- Fixes from the Phase 1b security review (already-applied migrations are
-- left alone; each change below is a replacement of an object).
--
-- 1. search_brands had no input cap: a signed-in user could pass a
--    megabyte-long query and make the alias LIKE scan run for minutes. Input
--    over 400 bytes now returns nothing and the query is cut to 100
--    characters before normalizing (the longest brand name is far shorter).
--    Same signature, so grants are kept.
-- 2. Invisible formatting characters (zero-width space/joiners, bidi marks and
--    overrides, word joiner, BOM) survived in free-text brands, so
--    "Ni<ZWSP>ke" displayed as Nike but matched nothing, and an override
--    could reorder text on other people's screens. set_listing_attributes now
--    strips them, and listings_brand_text_valid refuses them (no existing row
--    contains one).

-- ---------- 1. search_brands ----------
create or replace function public.search_brands(p_query text, p_limit integer default 8)
returns table (id uuid, name text, matched_alias text)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select case
             when octet_length(coalesce(p_query, '')) > 400 then ''
             else public.normalize_brand_key(left(coalesce(p_query, ''), 100))
           end as key
  ),
  hits as (
    select b.id as brand_id,
           b.name as brand_name,
           a.alias as alias,
           a.alias_key as alias_key,
           case
             when a.alias_key = q.key then 0
             when a.alias_key like q.key || '%' then 1
             when a.alias_key like '% ' || q.key || '%' then 2
             else 3
           end as rank
      from q
      join public.brand_aliases a
        on q.key <> ''
       and (
         a.alias_key like q.key || '%'
         or a.alias_key like '% ' || q.key || '%'
         or (char_length(q.key) >= 3 and a.alias_key like '%' || q.key || '%')
       )
      join public.brands b on b.id = a.brand_id
     where b.retired_at is null
  ),
  best as (
    select distinct on (h.brand_id) h.brand_id, h.brand_name, h.alias, h.rank
      from hits h
     order by h.brand_id, h.rank, h.alias_key
  )
  select best.brand_id, best.brand_name, best.alias
    from best
   order by best.rank, best.brand_name
   limit greatest(1, least(coalesce(p_limit, 8), 20));
$$;

-- ---------- 2. brand_text: no invisible formatting characters ----------
alter table public.listings drop constraint listings_brand_text_valid;
alter table public.listings add constraint listings_brand_text_valid check (
  brand_text is null
  or (
    char_length(brand_text) between 1 and 60
    and brand_text = btrim(brand_text)
    and brand_text !~ '[[:cntrl:]]'
    and brand_text !~ '[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]'
  )
);

-- ---------- 2b. set_listing_attributes ----------
create or replace function public.set_listing_attributes(
  p_listing_id uuid,
  p_term_ids uuid[],
  p_keywords text[],
  p_brand_id uuid default null,
  p_brand_text text default null
)
returns table (resolved_brand_id uuid, resolved_brand_text text)
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
  v_brand_id uuid;
  v_brand_text text;
  v_brand_active boolean;
  v_brand_key text;
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

  -- Same idea for keywords and brand text: refuse oversized input before
  -- normalizing it (the CHECKs would reject it anyway, but only after
  -- regexp/group work proportional to the input).
  if cardinality(coalesce(p_keywords, '{}')) > 50
     or exists (select 1 from unnest(p_keywords) as k where octet_length(k) > 200) then
    raise exception 'Too many or too long keywords' using errcode = '22023';
  end if;

  if octet_length(coalesce(p_brand_text, '')) > 400 then
    raise exception 'That brand name is too long' using errcode = '22023';
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

  -- Brand. Free text is cleaned first (control characters dropped, whitespace
  -- collapsed); blank counts as "no text".
  -- Invisible formatting characters (zero-width spaces/joiners, bidi marks and
  -- overrides, word joiner, BOM) are dropped first: they make "Ni<ZWSP>ke"
  -- look like Nike while matching nothing, and an override can reorder text
  -- on other people's screens. Then whitespace is collapsed (a tab or newline
  -- between words is a word break), THEN any remaining control characters go.
  v_brand_text := nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(coalesce(p_brand_text, ''), '[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]', '', 'g'),
          '\s+', ' ', 'g'
        ),
        '[[:cntrl:]]', '', 'g'
      )
    ),
    ''
  );

  if p_brand_id is not null and v_brand_text is not null then
    raise exception 'Choose a known brand or type one, not both' using errcode = '22023';
  end if;

  if p_brand_id is not null then
    select b.retired_at is null
      into v_brand_active
      from public.brands b
     where b.id = p_brand_id;

    if not found then
      raise exception 'Unknown brand' using errcode = '22023';
    end if;

    -- A retired brand can't be newly chosen, but a listing that already has
    -- it can keep it while being edited.
    if not v_brand_active and not exists (
      select 1 from public.listings l where l.id = p_listing_id and l.brand_id = p_brand_id
    ) then
      raise exception 'That brand is no longer available' using errcode = '22023';
    end if;

    v_brand_id := p_brand_id;
  elsif v_brand_text is not null then
    if char_length(v_brand_text) > 60 then
      raise exception 'That brand name is too long' using errcode = '22023';
    end if;

    -- Any letter or digit in any script is enough for a custom brand.
    if v_brand_text !~ '[[:alnum:]]' then
      raise exception 'A brand name needs letters or numbers' using errcode = '22023';
    end if;

    -- Exact normalized alias match only: typing "nike", "NIKE" or "נייקי"
    -- becomes the Nike brand; "Nikee" stays as the seller's text. The
    -- normalized key only keeps a-z, 0-9 and Hebrew letters, so text in
    -- another script (Cyrillic, Arabic, Japanese ...) normalizes to '' and can
    -- never match an alias: it is simply kept as the seller's text.
    v_brand_key := public.normalize_brand_key(v_brand_text);
    if v_brand_key <> '' then
      select a.brand_id
        into v_brand_id
        from public.brand_aliases a
        join public.brands b on b.id = a.brand_id
       where a.alias_key = v_brand_key
         and b.retired_at is null;

      if found then
        v_brand_text := null;
      end if;
    end if;
  end if;

  delete from public.listing_attribute_values v where v.listing_id = p_listing_id;

  insert into public.listing_attribute_values (listing_id, term_id, kind, position)
  select p_listing_id,
         t.id,
         t.kind,
         (row_number() over (partition by t.kind order by u.ordinal) - 1)::smallint
    from unnest(v_term_ids) with ordinality as u(term_id, ordinal)
    join public.listing_attribute_terms t on t.id = u.term_id;

  update public.listings l
     set keywords = v_keywords,
         brand_id = v_brand_id,
         brand_text = v_brand_text
   where l.id = p_listing_id
     and (l.keywords, l.brand_id, l.brand_text)
         is distinct from (v_keywords, v_brand_id, v_brand_text);

  return query select v_brand_id, v_brand_text;
end;
$$;
