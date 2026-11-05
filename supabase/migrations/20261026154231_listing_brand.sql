-- Listing brand (AI listing metadata plan, Phase 1b): brand columns on
-- listings, brand resolution inside set_listing_attributes, and the
-- search_brands() lookup that powers the Sell brand picker.
--
--   * A listing has AT MOST ONE of:
--       brand_id   a known brand from `brands`
--       brand_text free text for a brand not in the catalog
--     Never both (CHECK). Unknown text stays valid and never blocks a
--     listing; frequent texts can be promoted to brands by a later migration.
--   * No client write privilege on either column (same as keywords): the only
--     writer is set_listing_attributes, which is why resolution lives there.
--   * Resolution (set_listing_attributes): an explicit brand id wins; typed
--     text whose normalized form EXACTLY matches an alias of an active brand
--     is stored as that brand's id instead; anything else is kept as text.
--     No fuzzy matching, so text never silently becomes the wrong brand.
--
-- set_listing_attributes gains two trailing parameters. They default to NULL,
-- and the RPC replaces the listing's whole attribute set, so a call that
-- omits them clears the brand — exactly like omitting keywords clears
-- keywords. The old 3-argument function is dropped (a function, not data) so
-- there is no ambiguous overload for PostgREST.

-- ============================================================
-- Listing columns
-- ============================================================
alter table public.listings
  add column brand_id uuid references public.brands (id) on delete restrict,
  add column brand_text text,
  add constraint listings_brand_exclusive check (num_nonnulls(brand_id, brand_text) <= 1),
  add constraint listings_brand_text_valid check (
    brand_text is null
    or (
      char_length(brand_text) between 1 and 60
      and brand_text = btrim(brand_text)
      and brand_text !~ '[[:cntrl:]]'
    )
  );

create index listings_brand_id_idx on public.listings (brand_id) where brand_id is not null;

-- No INSERT/UPDATE column grant is added for either column, and none is
-- implied: listings uses column-level allowlists for client writes.

-- ============================================================
-- set_listing_attributes (now with brand)
-- ============================================================
drop function public.set_listing_attributes(uuid, uuid[], text[]);

create function public.set_listing_attributes(
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
  v_brand_text := nullif(
    btrim(regexp_replace(regexp_replace(coalesce(p_brand_text, ''), '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g')),
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

    v_brand_key := public.normalize_brand_key(v_brand_text);
    if v_brand_key = '' then
      raise exception 'A brand name needs letters or numbers' using errcode = '22023';
    end if;

    -- Exact normalized alias match only: typing "nike", "NIKE" or "נייקי"
    -- becomes the Nike brand; "Nikee" stays as the seller's text.
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

revoke all on function public.set_listing_attributes(uuid, uuid[], text[], uuid, text) from public, anon;
grant execute on function public.set_listing_attributes(uuid, uuid[], text[], uuid, text) to authenticated;

-- ============================================================
-- search_brands
-- ============================================================
-- Typeahead for the brand picker. SECURITY INVOKER: it reads `brands` and
-- `brand_aliases` through the caller's own SELECT grant, so signed-in users
-- only. The query is normalized exactly like names and aliases, so it works
-- for case, punctuation, accents and Hebrew final letters. The normalized
-- query contains only a-z, 0-9, Hebrew letters and spaces, so it can never
-- carry a LIKE wildcard.
--
-- Ranking (best match per brand): exact alias, alias starts with the query,
-- a word in the alias starts with it, then (3+ characters) contains. An empty
-- or symbol-only query returns nothing. Retired brands are never suggested.
create function public.search_brands(p_query text, p_limit integer default 8)
returns table (id uuid, name text, matched_alias text)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select public.normalize_brand_key(p_query) as key
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

revoke all on function public.search_brands(text, integer) from public, anon;
grant execute on function public.search_brands(text, integer) to authenticated;
