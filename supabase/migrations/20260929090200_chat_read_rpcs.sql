-- The three read paths for chat: the inbox page, one thread's header, and
-- the tab badge.
--
-- All three are SECURITY DEFINER, and that is a correctness requirement
-- rather than a convenience. The listings SELECT policy is
--
--     using (status = 'active' or auth.uid() = seller_id)
--
-- so the moment a seller marks an item sold, reserved or removed, the BUYER
-- can no longer see that listing row. A SECURITY INVOKER function joining
-- public.listings would therefore silently drop the conversation from the
-- buyer's inbox -- losing precisely the thread they most need to re-read
-- ("I bought this, where do we meet?"). A `left join` does not rescue it
-- either: RLS filters the row before the join, so the conversation would
-- survive with a null title, which is a different bug wearing the same hat.
--
-- The feed_listings precedent does NOT transfer. That function is INVOKER
-- because it only ever returns rows the caller may already read, so RLS is a
-- free second guarantee. These three deliberately return a PROJECTION of a
-- listing the caller may no longer SELECT, which is exactly what DEFINER is
-- for.
--
-- Because DEFINER bypasses RLS, the participant predicate written inside
-- each function IS the entire security boundary. Each one therefore states
-- it explicitly against the base table and rejects a null viewer outright,
-- rather than relying on `c.buyer_id = null` failing closed by accident --
-- failing closed by accident is not a boundary.
--
-- None of the three returns buyer_last_read_at or seller_last_read_at. Read
-- receipts are out of scope, the client never needs the raw timestamps (it
-- gets unread_count instead), and shipping data while not rendering it is
-- how a feature leaks. Nor do they touch auth.users: everything about the
-- other participant comes from public.profiles, which is already publicly
-- readable by design.

-- ============================================================
-- inbox_conversations
-- ============================================================
-- Keyset paginated on (last_message_at desc, id desc), matching the
-- conversations_buyer_idx / conversations_seller_idx trailing order.

create or replace function public.inbox_conversations(
  p_limit integer default 20,
  p_cursor_last_message_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  conversation_id uuid,
  listing_id uuid,
  listing_title text,
  listing_status public.listing_status,
  cover_storage_path text,
  other_participant_id uuid,
  other_username text,
  other_display_name text,
  other_avatar_path text,
  last_message_at timestamptz,
  last_message_body text,
  last_message_sender_id uuid,
  unread_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := (select auth.uid());
  -- coalesce BEFORE clamping. least(greatest(null,1),50) is null, and
  -- `limit null` means NO LIMIT -- so an explicit null from a caller would
  -- otherwise return every conversation they have in one response.
  -- PostgREST lets any argument be passed as null, so every parameter here
  -- is treated as hostile.
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if v_viewer is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- XOR: both halves or neither. A half cursor would otherwise compare
  -- against null, yield null, and silently return page 1 forever.
  if (p_cursor_last_message_at is null) <> (p_cursor_id is null) then
    raise exception 'An inbox cursor needs both last_message_at and id, or neither'
      using errcode = 'P0001';
  end if;

  return query
  select
    c.id,
    c.listing_id,
    l.title,
    l.status,
    cover.storage_path,
    other.id,
    other.username,
    other.display_name,
    other.avatar_path,
    c.last_message_at,
    c.last_message_body,
    c.last_message_sender_id,
    unread.n
  from public.conversations c
  -- The other participant, whichever side the viewer is not on.
  join public.profiles other
    on other.id = case when c.buyer_id = v_viewer then c.seller_id else c.buyer_id end
  -- The read point that applies to THIS viewer.
  cross join lateral (
    select case when c.buyer_id = v_viewer then c.buyer_last_read_at
                else c.seller_last_read_at end as read_at
  ) v_read
  -- Unread is the COUNT OF INCOMING MESSAGES after the viewer's read point,
  -- never a function of last_message_sender_id. Deriving it from "who sent
  -- the newest message" would erase older unread messages the instant the
  -- viewer replies: A sends, the viewer never reads it, the viewer later
  -- sends from another device, and the thread would read as caught up while
  -- A was never seen.
  --
  -- `is distinct from`, not `<>`: with `<>` a null on either side yields
  -- null, the row is dropped, and the count silently under-reports.
  --
  -- The `limit 100` sits INSIDE the subquery so it bounds the index scan
  -- itself; least(count(*), 99) would still walk every row. 99+ is all the
  -- UI can render, so scanning past 100 is work nobody sees.
  cross join lateral (
    select count(*)::integer as n
      from (
        select 1
          from public.messages m
         where m.conversation_id = c.id
           and m.sender_id is distinct from v_viewer
           and (v_read.read_at is null or m.created_at > v_read.read_at)
         limit 100
      ) capped
  ) unread
  -- LEFT, deliberately: the listing may have been hard-deleted, and the
  -- conversation must still render with a null title rather than vanish.
  left join public.listings l on l.id = c.listing_id
  -- LEFT lateral, unlike feed_listings' CROSS JOIN LATERAL: the feed uses
  -- the cover as an eligibility filter ("no photo, no card"), but an inbox
  -- row with no resolvable photo must still appear. Minimum position, not
  -- position 0 -- a listing whose first photo was deleted still has a cover.
  left join lateral (
    select li.storage_path
      from public.listing_images li
     where li.listing_id = c.listing_id
     order by li."position"
     limit 1
  ) cover on true
  -- THE SECURITY BOUNDARY. Explicit, on the base table, because DEFINER
  -- means RLS is not going to do it.
  where v_viewer in (c.buyer_id, c.seller_id)
    -- An empty thread is visible only to whoever opened it. Without this,
    -- every curiosity-tap on "Message seller" would plant a blank row in
    -- the seller's inbox. Asked as "does any message exist" rather than
    -- `last_message_sender_id is null`, so it stays true to its name even
    -- though the two happen to coincide today.
    and (
      c.buyer_id = v_viewer
      or exists (select 1 from public.messages m2 where m2.conversation_id = c.id)
    )
    and (
      p_cursor_last_message_at is null
      or (c.last_message_at, c.id) < (p_cursor_last_message_at, p_cursor_id)
    )
  order by c.last_message_at desc, c.id desc
  limit v_limit;
end;
$$;

revoke all    on function public.inbox_conversations(integer, timestamptz, uuid) from public;
revoke all    on function public.inbox_conversations(integer, timestamptz, uuid) from anon;
grant execute on function public.inbox_conversations(integer, timestamptz, uuid) to authenticated;

-- ============================================================
-- conversation_detail
-- ============================================================
-- The thread header: who, about what, and what state that listing is in.
-- Same DEFINER reasoning as the inbox -- a sold listing's thread must still
-- open.

create or replace function public.conversation_detail(
  p_conversation_id uuid
)
returns table (
  conversation_id uuid,
  listing_id uuid,
  listing_title text,
  listing_status public.listing_status,
  cover_storage_path text,
  other_participant_id uuid,
  other_username text,
  other_display_name text,
  other_avatar_path text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := (select auth.uid());
begin
  if v_viewer is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- One combined check, so "no such conversation" and "not your
  -- conversation" are EXTERNALLY INDISTINGUISHABLE. Both raise P0002 from
  -- this single branch rather than from two, because distinguishing them
  -- would confirm the existence of conversations the caller is not in.
  if not exists (
    select 1
      from public.conversations c
     where c.id = p_conversation_id
       and v_viewer in (c.buyer_id, c.seller_id)
  ) then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;

  -- No isBuyer/isSeller flag is returned: the client already knows its own
  -- user id and can compare, and an unused boolean is a field that will
  -- drift out of meaning.
  return query
  select
    c.id,
    c.listing_id,
    l.title,
    l.status,
    cover.storage_path,
    other.id,
    other.username,
    other.display_name,
    other.avatar_path
  from public.conversations c
  join public.profiles other
    on other.id = case when c.buyer_id = v_viewer then c.seller_id else c.buyer_id end
  left join public.listings l on l.id = c.listing_id
  left join lateral (
    select li.storage_path
      from public.listing_images li
     where li.listing_id = c.listing_id
     order by li."position"
     limit 1
  ) cover on true
  where c.id = p_conversation_id
    -- Restated, not merely implied by the guard above: this is the predicate
    -- that actually scopes the returned row.
    and v_viewer in (c.buyer_id, c.seller_id);
end;
$$;

revoke all    on function public.conversation_detail(uuid) from public;
revoke all    on function public.conversation_detail(uuid) from anon;
grant execute on function public.conversation_detail(uuid) to authenticated;

-- ============================================================
-- inbox_unread_count
-- ============================================================
-- The Inbox tab badge. Counts CONVERSATIONS with at least one unread
-- incoming message, not unread messages -- a badge of "3" means three
-- threads need attention, which is what a user acts on.
--
-- Not derivable from inbox_conversations: that returns one page, and a
-- conversation on page 3 still has to count. Not expressible in PostgREST
-- either, because which read column applies depends on which side the
-- viewer is on, and a filter cannot branch on that.

create or replace function public.inbox_unread_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := (select auth.uid());
  v_count integer;
begin
  if v_viewer is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Bounded at 100 for the same reason as the per-row count: the badge can
  -- only render 99+, so enumerating a 400-thread backlog is work nobody
  -- sees. The limit is inside the subquery, so it stops the scan rather
  -- than just the arithmetic.
  select count(*)::integer into v_count
    from (
      select 1
        from public.conversations c
       cross join lateral (
         select case when c.buyer_id = v_viewer then c.buyer_last_read_at
                     else c.seller_last_read_at end as read_at
       ) v_read
       where v_viewer in (c.buyer_id, c.seller_id)
         -- `exists`, so one thread with forty unread messages counts once.
         -- An empty thread can never satisfy this, so a freshly opened
         -- conversation is never unread -- no special case needed.
         and exists (
           select 1
             from public.messages m
            where m.conversation_id = c.id
              and m.sender_id is distinct from v_viewer
              and (v_read.read_at is null or m.created_at > v_read.read_at)
         )
       limit 100
    ) capped;

  return v_count;
end;
$$;

revoke all    on function public.inbox_unread_count() from public;
revoke all    on function public.inbox_unread_count() from anon;
grant execute on function public.inbox_unread_count() to authenticated;
