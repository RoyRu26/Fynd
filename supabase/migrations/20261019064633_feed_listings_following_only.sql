-- feed_listings gains p_following_only, backing ROADMAP 3.2's "For you" /
-- "Following" toggle on Home.
--
-- A 5th parameter on the existing RPC, not a new one: the RETURNS TABLE
-- shape and the (created_at, id) DESC keyset-cursor contract are entirely
-- unchanged -- only one extra WHERE clause is needed, so a second RPC would
-- just be this same function with a parallel maintenance burden. DROP +
-- CREATE rather than CREATE OR REPLACE because the PARAMETER list grows,
-- which postgres refuses under REPLACE just as it refuses a RETURNS TABLE
-- shape change -- see this function's own 20260922090300 header for that
-- precedent.
--
-- SECURITY INVOKER stays correct with the new filter: `follows` is publicly
-- readable (`using (true)`, 20261019061403_follows.sql), so the viewer-
-- follows subquery below reads nothing the invoker couldn't already read
-- directly -- it crosses no privilege boundary RLS would otherwise need to
-- enforce on the function's behalf.
--
-- Self-follow-impossible, by construction, never by filtering here: `follows`
-- carries `constraint follows_not_self check (follower_id <> followed_id)`,
-- so a row `follows (v_viewer, v_viewer)` can never exist, and therefore
-- `l.seller_id in (select followed_id from follows where follower_id =
-- v_viewer)` can never match `l.seller_id = v_viewer`. This means
-- `p_include_own = true` combined with `p_following_only = true` can never
-- leak the viewer's own listing through the "following" filter -- it is
-- still excluded by `v_include_own` unless explicitly asked for, but even if
-- that logic changed, this filter alone could never surface it. Backed by a
-- pgTAP regression case in supabase/tests/database/feed.sql, not by extra
-- code here.

drop function if exists public.feed_listings(integer, timestamptz, uuid, boolean);

create function public.feed_listings(
  p_limit integer default 10,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_include_own boolean default false,
  p_following_only boolean default false
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
  v_following_only boolean := coalesce(p_following_only, false);
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
    -- "Following" scope: only listings from sellers the viewer follows. A
    -- correlated EXISTS, not an IN against a materialized list, so the plan
    -- can use follows' own (follower_id, followed_id) primary key per row
    -- rather than building the whole following-set up front.
    and (
      not v_following_only
      or exists (
        select 1 from public.follows f
         where f.follower_id = v_viewer
           and f.followed_id = l.seller_id
      )
    )
    and (
      p_cursor_created_at is null
      or (l.created_at, l.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by l.created_at desc, l.id desc
  limit v_limit;
end;
$$;

revoke all    on function public.feed_listings(integer, timestamptz, uuid, boolean, boolean) from public;
revoke all    on function public.feed_listings(integer, timestamptz, uuid, boolean, boolean) from anon;
grant execute on function public.feed_listings(integer, timestamptz, uuid, boolean, boolean) to authenticated;
