-- ROADMAP 2.2 "Search backend": a text-search + filter + sort RPC over
-- active listings, the data boundary the Explore tab (2.3, next) will
-- consume.
--
-- ============================================================
-- search_tsv: GENERATED ALWAYS ... STORED, not computed inline per query
-- ============================================================
-- A generated STORED column, not a plain expression re-evaluated in every
-- WHERE clause, for one concrete reason: GIN-indexability. Postgres can only
-- build an index over a value that actually exists in a row -- either a real
-- column or a stored generated one -- not over an arbitrary expression
-- recomputed at query time unless that expression is wrapped in an
-- expression index, which would have to be repeated (and kept in sync by
-- hand) everywhere the same tsvector is needed. STORED also means
-- `to_tsvector` runs once, at write time, rather than being recomputed on
-- every single row scanned by every single search query -- a workload this
-- RPC is specifically trying to make cheap.
--
-- ============================================================
-- Two-argument to_tsvector('english', ...), never the one-argument form
-- ============================================================
-- A generated column's expression is REQUIRED to be IMMUTABLE (verified:
-- Postgres rejects `generated always as (...) stored` with
-- "generation expression is not immutable" otherwise). The one-argument
-- `to_tsvector(text)` form resolves its configuration from the
-- `default_text_search_config` GUC at call time, which can change per
-- session/role/database -- so it is only ever STABLE, never IMMUTABLE, and
-- is rejected here. The two-argument form `to_tsvector('english', text)`
-- takes the configuration as a literal argument, has nothing left to vary
-- call-to-call, and IS IMMUTABLE -- which is why it, and not the shorter
-- form used elsewhere in ad-hoc queries, is the only form that can appear
-- in this column's definition.
--
-- ============================================================
-- Two explicit query branches, not one query with a CASE in ORDER BY
-- ============================================================
-- `search_listings` has two sort modes with genuinely different physical
-- orderings: newest-first wants `(status, created_at desc, id desc)`
-- (already served by `listings_feed_idx`, added for the Home feed), and
-- price-ascending wants `(status, price_amount, id)` (the new
-- `listings_search_price_idx` below). A single query whose `ORDER BY` is
-- built from a `CASE WHEN p_sort = 'price' THEN price_amount ELSE ... END`
-- expression is opaque to the planner -- it cannot prove that expression
-- matches either index's leading columns, so it falls back to a sort over
-- the whole filtered row set every time, for both sort modes. Two
-- hard-coded `ORDER BY` clauses, one per branch, each written against a
-- real column list, is what lets the planner choose the matching index for
-- whichever branch actually runs.
--
-- ============================================================
-- SECURITY INVOKER is correct here
-- ============================================================
-- feed_listings is SECURITY INVOKER specifically because it only reads rows
-- the caller may already read; it personalizes with `is_favorited` and
-- `p_include_own`, both scoped by `auth.uid()`, but RLS staying active is an
-- extra belt-and-suspenders guarantee on top of that personalization, not a
-- load-bearing part of it. `search_listings` is a strictly simpler case: it
-- unconditionally filters to `status = 'active'`, the exact set RLS already
-- lets every authenticated caller see (the "Active listings are publicly
-- readable" policy from the initial schema), and it does not call
-- `auth.uid()` or branch on the caller's identity ANYWHERE in its body --
-- there is no personalization at all to reason about, no own-listing
-- exclusion, no favorite flag. There is therefore no privileged lookup this
-- function needs that the caller could not already perform directly, which
-- is exactly the condition under which SECURITY DEFINER would be the wrong,
-- over-privileged choice. SECURITY INVOKER keeps RLS live as the actual
-- enforcement mechanism, not a redundant one.
--
-- ============================================================
-- The viewer's OWN active listings are deliberately included, not excluded
-- ============================================================
-- feed_listings excludes the caller's own listings by default because Home
-- is a "discover what other people are selling" surface -- seeing your own
-- card in your own discovery feed is a bug, not a feature. Search/Explore is
-- a different kind of surface: it is a catalog lookup utility a seller
-- reaches for to find a SPECIFIC live listing (checking how their own
-- listing reads next to similar ones, confirming it is really live after
-- publishing, re-finding it to share a link). There is no "own_id" parameter
-- here at all, unlike feed_listings' `p_include_own` -- there is nothing to
-- opt into or out of, because exclusion was never the right default for
-- this surface in the first place.
--
-- ============================================================
-- Price sort is ascending-only
-- ============================================================
-- ROADMAP 2.2 names the two sort modes as "newest" and "price" (singular,
-- no direction), and ascending is the natural reading for a price sort on a
-- second-hand marketplace: a buyer sorting by price is bargain-hunting, and
-- cheapest-first is what every comparable marketplace defaults to. A
-- direction parameter (`p_price_direction` or a `price_desc` variant of the
-- enum) can be added later without disturbing this shape; nothing here
-- forecloses it.
--
-- ============================================================
-- No relevance / ts_rank sort mode
-- ============================================================
-- ROADMAP 2.2 literally enumerates the sort modes as "newest, price" --
-- there is no third "relevance" mode in scope. `p_query` is therefore a pure
-- FILTER here (rows either match the tsquery or they do not), never a
-- ranking signal; `ts_rank`/`ts_rank_cd` are not computed or exposed. This
-- keeps both branches' `ORDER BY` purely over indexed columns (see above) --
-- a relevance sort would need its own third branch, its own index strategy
-- (GIN alone does not accelerate an ORDER BY ts_rank(...) the way a B-tree
-- does a column sort), and is explicitly out of scope until the roadmap
-- asks for it.
--
-- ============================================================
-- Category filter's two-clause semantics
-- ============================================================
-- `cat.id = p_category_id or cat.parent_id = p_category_id` relies on the
-- invariant 20261018100200_categories.sql's own header documents: every
-- listing's `category_id` always points at a LEAF row, never a bare
-- top-level row. So when `p_category_id` names a leaf, `cat.id =
-- p_category_id` is the direct match; when it names a top-level group (a
-- row with `parent_id is null`), no listing's `category_id` can equal that
-- top-level id directly (the invariant forbids it), so the match instead
-- has to go through `cat.parent_id = p_category_id` -- "this listing's leaf
-- category's parent is the group the caller asked for". Both clauses are
-- needed together to support filtering by either granularity Explore (2.3)
-- will want to offer (a top-level chip like "Women", or a specific leaf like
-- "Women > Dresses") from a single parameter, without the caller having to
-- know in advance whether an id is a leaf or a group.

alter table public.listings
  add column search_tsv tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored;

create index listings_search_tsv_idx on public.listings using gin (search_tsv);
create index listings_category_id_idx on public.listings (category_id);
create index listings_search_price_idx on public.listings (status, price_amount, id);

create type public.search_sort as enum ('newest', 'price');

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
  p_limit             integer default 20
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
  -- coalesce BEFORE clamping, exactly feed_listings' own precedent:
  -- least(greatest(null,1),50) is null, and LIMIT null means NO LIMIT.
  -- PostgREST lets any argument be passed as null, so every parameter here
  -- is treated as hostile.
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_sort   public.search_sort := coalesce(p_sort, 'newest');
  v_query  text := nullif(btrim(coalesce(p_query, '')), '');
  v_tsquery tsquery := case when v_query is null then null
                            else websearch_to_tsquery('english', v_query) end;
begin
  if p_price_min is not null and p_price_max is not null and p_price_min > p_price_max then
    raise exception 'price_min cannot be greater than price_max' using errcode = 'P0001';
  end if;

  if v_sort = 'price' then
    -- Both cursor halves for THIS mode, or neither -- a half cursor would
    -- otherwise silently fall through to page 1, which presents as the
    -- results looping forever. The cross-mode checks below additionally
    -- reject a cursor shaped for the OTHER sort mode, since a p_cursor_price
    -- paired with sort = newest (or vice versa) is meaningless, not just
    -- incomplete.
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
    -- CROSS JOIN, not LEFT: a listing with zero images produces no row at
    -- all, which IS the "has at least one image" eligibility filter --
    -- same discipline as feed_listings. `limit 1` after `order by position`
    -- picks the MINIMUM-position image, not position 0 (a deleted cover
    -- photo leaves gaps; see feed_listings_rpc's own header for the full
    -- reasoning).
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
      and (p_cursor_created_at is null or (l.created_at, l.id) < (p_cursor_created_at, p_cursor_id))
    order by l.created_at desc, l.id desc
    limit v_limit;
  end if;
end;
$$;

revoke all    on function public.search_listings(
  text, uuid, public.listing_condition, public.listing_size, bigint, bigint,
  public.search_sort, timestamptz, bigint, uuid, integer
) from public;
revoke all    on function public.search_listings(
  text, uuid, public.listing_condition, public.listing_size, bigint, bigint,
  public.search_sort, timestamptz, bigint, uuid, integer
) from anon;
grant execute on function public.search_listings(
  text, uuid, public.listing_condition, public.listing_size, bigint, bigint,
  public.search_sort, timestamptz, bigint, uuid, integer
) to authenticated;
