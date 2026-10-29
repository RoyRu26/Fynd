-- Follow-up to 20261026154640_listing_brand_hardening.sql (already applied
-- locally).
--
-- set_listing_attributes rejected free-text brands in any script the approved
-- brand key does not cover: normalize_brand_key() keeps only a-z, 0-9 and
-- Hebrew letters, so a brand typed in Cyrillic, Arabic, Japanese ... normalized
-- to '' and was refused with 22023. Unknown brand text must stay valid and
-- never block a listing. Now only text with no letter or digit in ANY script
-- ("???") is refused; text whose key is empty skips the alias lookup (it
-- cannot match one) and is kept as the seller's own text. Otherwise
-- identical; `create or replace` keeps the existing EXECUTE grants
-- (authenticated only).

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
  -- Whitespace first (a tab or newline between words is a word break), THEN
  -- any remaining control characters are dropped.
  v_brand_text := nullif(
    btrim(regexp_replace(regexp_replace(coalesce(p_brand_text, ''), '\s+', ' ', 'g'), '[[:cntrl:]]', '', 'g')),
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
