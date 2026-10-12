-- feed_listings gains `size` and `is_favorited`.
--
-- DROP + CREATE rather than CREATE OR REPLACE: changing a function's
-- RETURNS TABLE shape is a return-type change, which replace refuses
-- ("cannot change return type of existing function"). publish_listing did
-- not need this because it returns the `listings` rowtype, which widened on
-- its own when the column was added.
--
-- Everything else is carried over verbatim and deliberately: the
-- coalesce-before-clamp on p_limit (LIMIT null means NO limit), the XOR
-- cursor validation (a half cursor otherwise silently returns page 1, which
-- presents as the feed looping forever), the CROSS JOIN LATERAL min-position
-- cover (position 0 may have been deleted), and SECURITY INVOKER so RLS
-- stays on as a second guarantee that a draft cannot leak.

drop function if exists public.feed_listings(integer, timestamptz, uuid, boolean);

create function public.feed_listings(
  p_limit integer default 10,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_include_own boolean default false
)
returns table (
  listing_id uuid,
  title text,
  price_amount bigint,
  currency text,
  condition public.listing_condition,
  size public.listing_size,
  created_at timestamptz,
  seller_id uuid,
  seller_username text,
  seller_display_name text,
  seller_avatar_path text,
  cover_storage_path text,
  is_favorited boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  -- coalesce BEFORE clamping. least(greatest(null,1),50) is null, and
  -- LIMIT null means NO LIMIT -- so an explicit null from a caller would
  -- return the entire feed in one response. PostgREST lets any argument be
  -- passed as null, so every parameter here is treated as hostile.
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_include_own boolean := coalesce(p_include_own, false);
  v_viewer uuid := (select auth.uid());
begin
  -- Both cursor halves, or neither. `x is null` is itself never null, so
  -- this is a plain boolean XOR. Enforced server-side rather than trusting
  -- the client's cursor type: a half-cursor would otherwise fall through to
  -- page 1, which presents as the feed looping the same cards forever.
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception 'A feed cursor needs both created_at and id, or neither'
      using errcode = 'P0001';
  end if;

  return query
  select
    l.id,
    l.title,
    l.price_amount,
    l.currency,
    l.condition,
    l.size,
    l.created_at,
    l.seller_id,
    p.username,
    p.display_name,
    p.avatar_path,
    cover.storage_path,
    -- Resolved here rather than in a second client round trip. Keyed on the
    -- favorites primary key (user_id, listing_id), so this is an index
    -- lookup per row -- the whole page still costs one query, never N+1.
    exists (
      select 1 from public.favorites f
       where f.listing_id = l.id
         and f.user_id = v_viewer
    )
  from public.listings l
  join public.profiles p on p.id = l.seller_id
  -- CROSS JOIN, not LEFT: a listing with zero images produces no row at all,
  -- which IS the "has at least one image" eligibility filter. `limit 1`
  -- after `order by position` is the min-position cover described above.
  cross join lateral (
    select li.storage_path
      from public.listing_images li
     where li.listing_id = l.id
     order by li."position"
     limit 1
  ) cover
  where l.status = 'active'
    and (v_include_own or l.seller_id is distinct from v_viewer)
    and (
      p_cursor_created_at is null
      or (l.created_at, l.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by l.created_at desc, l.id desc
  limit v_limit;
end;
$$;

revoke all    on function public.feed_listings(integer, timestamptz, uuid, boolean) from public;
revoke all    on function public.feed_listings(integer, timestamptz, uuid, boolean) from anon;
grant execute on function public.feed_listings(integer, timestamptz, uuid, boolean) to authenticated;
