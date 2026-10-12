-- The Home discovery feed query boundary.
--
-- An RPC rather than direct PostgREST, for a concrete reason: the cover
-- image is the LOWEST-POSITION image, not position = 0. Removing a photo
-- leaves gaps (0,1,3 -- documented and intentional), and positions are only
-- renormalised on an explicit reorder. So a seller who deletes their cover
-- photo has no position-0 row, and a PostgREST `.eq(position, 0)` filter
-- would silently drop that listing out of the feed entirely. PostgREST
-- cannot express "the row with the minimum position per parent".
--
-- An RPC rather than a view, because a view without security_invoker = true
-- runs as its owner and silently bypasses RLS -- a footgun next to a table
-- whose entire security model is RLS.
--
-- SECURITY INVOKER, unlike the three existing DEFINER RPCs: this one only
-- reads rows the caller may already read, so RLS stays active as a second,
-- independent guarantee that a draft can never leak through it.

-- The keyset index. (status, created_at desc) is a strict prefix of this, so
-- the old index is redundant once this exists -- dropping it removes write
-- amplification rather than losing a plan.
drop index if exists public.listings_status_created_at_idx;

create index listings_feed_idx
  on public.listings (status, created_at desc, id desc);

create or replace function public.feed_listings(
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
  created_at timestamptz,
  seller_id uuid,
  seller_username text,
  seller_display_name text,
  seller_avatar_path text,
  cover_storage_path text
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
    l.created_at,
    l.seller_id,
    p.username,
    p.display_name,
    p.avatar_path,
    cover.storage_path
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
    and (v_include_own or l.seller_id is distinct from (select auth.uid()))
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
