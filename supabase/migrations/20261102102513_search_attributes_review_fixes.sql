-- Search over attributes, review fixes (roadmap 7.3). Follows
-- 20261102101334_search_attributes_index.sql and
-- 20261102101440_search_listings_attribute_filters.sql (both already applied;
-- not edited).
--
-- 1. public.fynd_text_tsvector(text): EXECUTE revoked from authenticated.
--    Its only callers are the owner-run search_tsv trigger functions in
--    schema private (SECURITY DEFINER), so no client role needs it. A
--    client's direct draft UPDATE and set_listing_attributes (also SECURITY
--    DEFINER) still rebuild the document: the triggers run as the owner.
--
-- 2. anon can no longer read listings.search_tsv. The document embeds
--    catalog text (brand aliases, attribute terms) from tables anon cannot
--    read, contradicting plan §2.4. anon held a TABLE-level SELECT on
--    public.listings, which a column-level REVOKE cannot narrow, so the
--    table-level grant is revoked and SELECT is re-granted on an explicit
--    column allowlist: every current column except search_tsv (read from the
--    live table when this was written). RLS is unchanged (anon still sees
--    active rows only). No client code reads listings before sign-in (the
--    (app) group redirects unauthenticated users to (auth)/welcome).
--    NOTE: a column added to public.listings later is NOT readable by anon
--    unless it is added to anon's allowlist explicitly. authenticated keeps
--    its table-level SELECT (RLS limits it to active rows and own rows).
--
-- 3. public.search_listings: same 18-argument signature and body, except the
--    v_tsquery := public.fynd_search_query(p_query) assignment moves from
--    DECLARE into the body, after the 22023 filter-array checks and the
--    price check, so "checked before anything else runs" (101440, item 3)
--    is now true. Grants are re-asserted.
--
-- Behaviour notes (documentation only, nothing changes here):
--   - websearch syntax is gone with websearch_to_tsquery: quotes are
--     ignored; "or" is a stopword, so its neighbours are ANDed; "-nike"
--     now REQUIRES nike, because "-" becomes a space.
--   - set_listing_attributes with a brand or keyword change rebuilds the
--     listing's document up to 3 times in one call (the listings row
--     trigger, then the DELETE and INSERT statement triggers on
--     listing_attribute_values). Cheap at current scale.

-- ============================================================
-- 1. fynd_text_tsvector: owner-only
-- ============================================================
revoke execute on function public.fynd_text_tsvector(text) from authenticated;

-- ============================================================
-- 2. anon: column allowlist on public.listings, without search_tsv
-- ============================================================
revoke select on public.listings from anon;
grant select (
  id, seller_id, title, description, price_amount, currency, condition,
  status, created_at, updated_at, size, category_id, sold_to_user_id,
  keywords, brand_id, brand_text
) on public.listings to anon;

-- ============================================================
-- 3. search_listings: validation before the query is parsed
-- ============================================================
create or replace function public.search_listings(
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
  v_tsquery tsquery;
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

  v_tsquery := public.fynd_search_query(p_query);

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
