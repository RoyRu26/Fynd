-- Search over attributes, part 2: search_listings filters and Hebrew-aware
-- text matching (roadmap 7.3, spec §10.3 / §10.6 step 2). Builds on
-- 20261102101334_search_attributes_index.sql (the search document) and 7.2's
-- public.fynd_search_query.
--
-- Changes against the previous body
-- (20261020065008_block_feed_search_and_messaging_enforcement.sql), which is
-- otherwise carried forward verbatim (return shape, both sort branches,
-- cursor validation, limit clamp, status = 'active', cover requirement,
-- category semantics, block filter, SECURITY INVOKER, STABLE,
-- search_path = ''):
--
-- 1. Text: websearch_to_tsquery('english') is replaced by
--    public.fynd_search_query(p_query). NULL (blank input, or only stopwords
--    / single Hebrew letters) means no text filter, as before for blank.
--
-- 2. Seven optional filters, appended after the existing 11 parameters:
--      p_brand_ids      listings.brand_id = any(ids). A free-text brand
--                       (brand_text) is not matched here; it is reachable
--                       through text search.
--      p_item_type_ids, p_color_ids, p_style_ids, p_material_ids,
--      p_pattern_ids, p_fit_ids
--                       the listing has a listing_attribute_values row of
--                       that kind whose term_id is in the array.
--    OR within one array, AND across arrays and with every other filter. An
--    empty array is the same as NULL (no filter). A term id of another kind
--    simply matches nothing.
--
-- 3. Caps: every array must be 1-D, hold at most 20 ids and no NULL element,
--    else 22023 'Too many or invalid filter values'. Checked before anything
--    else runs.
--
-- No relevance ranking: the existing newest / price sorts are unchanged.
--
-- The old 11-argument function is DROPPED, not overloaded: two overloads
-- that both accept the named call would make PostgREST answer PGRST203
-- (ambiguous). Grants are re-issued for the new signature.

drop function public.search_listings(
  text, uuid, public.listing_condition, public.listing_size, bigint, bigint,
  public.search_sort, timestamptz, bigint, uuid, integer
);

create function public.search_listings(
  p_query             text default null,
  p_category_id       uuid default null,
  p_condition         public.listing_condition default null,
  p_size              public.listing_size default null,
  p_price_min         bigint default null,
  p_price_max         bigint default null,
  p_sort              public.search_sort default 'newest',
  p_cursor_created_at timestamptz default null,
  p_cursor_price      bigint default null,
  p_cursor_id         uuid default null,
  p_limit             integer default 20,
  p_brand_ids         uuid[] default null,
  p_item_type_ids     uuid[] default null,
  p_color_ids         uuid[] default null,
  p_style_ids         uuid[] default null,
  p_material_ids      uuid[] default null,
  p_pattern_ids       uuid[] default null,
  p_fit_ids           uuid[] default null
)
returns table (
  listing_id          uuid,
  title               text,
  price_amount        bigint,
  currency            text,
  condition           public.listing_condition,
  size                public.listing_size,
  category_id         uuid,
  created_at          timestamptz,
  cover_storage_path  text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_sort   public.search_sort := coalesce(p_sort, 'newest');
  v_tsquery tsquery := public.fynd_search_query(p_query);
  v_brand_ids     uuid[] := nullif(p_brand_ids, '{}');
  v_item_type_ids uuid[] := nullif(p_item_type_ids, '{}');
  v_color_ids     uuid[] := nullif(p_color_ids, '{}');
  v_style_ids     uuid[] := nullif(p_style_ids, '{}');
  v_material_ids  uuid[] := nullif(p_material_ids, '{}');
  v_pattern_ids   uuid[] := nullif(p_pattern_ids, '{}');
  v_fit_ids       uuid[] := nullif(p_fit_ids, '{}');
begin
  if exists (
    select 1
      from (values (v_brand_ids), (v_item_type_ids), (v_color_ids), (v_style_ids),
                   (v_material_ids), (v_pattern_ids), (v_fit_ids)) as f(ids)
     where f.ids is not null
       and (array_ndims(f.ids) > 1
            or cardinality(f.ids) > 20
            or exists (select 1 from unnest(f.ids) as x(id) where x.id is null))
  ) then
    raise exception 'Too many or invalid filter values' using errcode = '22023';
  end if;

  if p_price_min is not null and p_price_max is not null and p_price_min > p_price_max then
    raise exception 'price_min cannot be greater than price_max' using errcode = 'P0001';
  end if;

  if v_sort = 'price' then
    if (p_cursor_price is null) <> (p_cursor_id is null) then
      raise exception 'A price-sort cursor needs both price and id, or neither' using errcode = 'P0001';
    end if;
    if p_cursor_created_at is not null then
      raise exception 'A created_at cursor cannot be used with sort = price' using errcode = 'P0001';
    end if;

    return query
    select
      l.id, l.title, l.price_amount, l.currency, l.condition, l.size,
      l.category_id, l.created_at, cover.storage_path
    from public.listings l
    join public.categories cat on cat.id = l.category_id
    cross join lateral (
      select li.storage_path
        from public.listing_images li
       where li.listing_id = l.id
       order by li."position"
       limit 1
    ) cover
    where l.status = 'active'
      and (v_tsquery is null or l.search_tsv @@ v_tsquery)
      and (p_category_id is null or cat.id = p_category_id or cat.parent_id = p_category_id)
      and (p_condition is null or l.condition = p_condition)
      and (p_size is null or l.size = p_size)
      and (p_price_min is null or l.price_amount >= p_price_min)
      and (p_price_max is null or l.price_amount <= p_price_max)
      and (v_brand_ids is null or l.brand_id = any(v_brand_ids))
      and (v_item_type_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'item_type' and v.term_id = any(v_item_type_ids)))
      and (v_color_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'color' and v.term_id = any(v_color_ids)))
      and (v_style_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'style' and v.term_id = any(v_style_ids)))
      and (v_material_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'material' and v.term_id = any(v_material_ids)))
      and (v_pattern_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'pattern' and v.term_id = any(v_pattern_ids)))
      and (v_fit_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'fit' and v.term_id = any(v_fit_ids)))
      -- ROADMAP 5.2: same suppression as feed_listings, in either
      -- direction. Search deliberately keeps including the viewer's OWN
      -- listings (20261018104807's own header -- this is a catalog lookup
      -- utility, not a discovery feed), and blocks are irreflexive
      -- (blocks_not_self), so this can never suppress a viewer's own row.
      and not public.is_blocked_with(l.seller_id)
      and (p_cursor_price is null or (l.price_amount, l.id) > (p_cursor_price, p_cursor_id))
    order by l.price_amount asc, l.id asc
    limit v_limit;

  else
    if (p_cursor_created_at is null) <> (p_cursor_id is null) then
      raise exception 'A newest-sort cursor needs both created_at and id, or neither' using errcode = 'P0001';
    end if;
    if p_cursor_price is not null then
      raise exception 'A price cursor cannot be used with sort = newest' using errcode = 'P0001';
    end if;

    return query
    select
      l.id, l.title, l.price_amount, l.currency, l.condition, l.size,
      l.category_id, l.created_at, cover.storage_path
    from public.listings l
    join public.categories cat on cat.id = l.category_id
    cross join lateral (
      select li.storage_path
        from public.listing_images li
       where li.listing_id = l.id
       order by li."position"
       limit 1
    ) cover
    where l.status = 'active'
      and (v_tsquery is null or l.search_tsv @@ v_tsquery)
      and (p_category_id is null or cat.id = p_category_id or cat.parent_id = p_category_id)
      and (p_condition is null or l.condition = p_condition)
      and (p_size is null or l.size = p_size)
      and (p_price_min is null or l.price_amount >= p_price_min)
      and (p_price_max is null or l.price_amount <= p_price_max)
      and (v_brand_ids is null or l.brand_id = any(v_brand_ids))
      and (v_item_type_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'item_type' and v.term_id = any(v_item_type_ids)))
      and (v_color_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'color' and v.term_id = any(v_color_ids)))
      and (v_style_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'style' and v.term_id = any(v_style_ids)))
      and (v_material_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'material' and v.term_id = any(v_material_ids)))
      and (v_pattern_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'pattern' and v.term_id = any(v_pattern_ids)))
      and (v_fit_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'fit' and v.term_id = any(v_fit_ids)))
      and not public.is_blocked_with(l.seller_id)
      and (p_cursor_created_at is null or (l.created_at, l.id) < (p_cursor_created_at, p_cursor_id))
    order by l.created_at desc, l.id desc
    limit v_limit;
  end if;
end;
$$;

revoke all on function public.search_listings(
  text, uuid, public.listing_condition, public.listing_size, bigint, bigint,
  public.search_sort, timestamptz, bigint, uuid, integer,
  uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[]
) from public, anon;
grant execute on function public.search_listings(
  text, uuid, public.listing_condition, public.listing_size, bigint, bigint,
  public.search_sort, timestamptz, bigint, uuid, integer,
  uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[]
) to authenticated;
