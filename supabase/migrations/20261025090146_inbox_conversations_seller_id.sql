-- SCREENS.md Task 6 "Inbox" -- `inbox_conversations` grows one new output
-- column, `seller_id`, so the Inbox screen can filter its own rows into
-- "Buying" / "Selling" without a second round trip or a precomputed flag
-- that could drift out of meaning.
--
-- Mirrors `conversation_detail`'s own `can_review` precedent
-- (20261020113820): "no isBuyer/isSeller flag is returned -- the client
-- already knows its own user id and can compare." That comment is itself
-- the design this migration follows through on for the inbox: `seller_id`
-- (and the already-returned `other_participant_id`/implicit viewer id) is
-- everything the client needs -- `viewerId === seller_id` is Selling,
-- otherwise Buying. No new privacy surface: the viewer already has full,
-- DEFINER-gated read access to every column of their OWN conversation row
-- (see this function's header in 20260929090200 for why it is DEFINER at
-- all), and `seller_id` is one of exactly two participant columns on that
-- row -- `buyer_id` is the only other one, and is already fully recoverable
-- today as "whichever side `other_participant_id` is NOT, when it isn't the
-- viewer's own id" rather than genuinely withheld, so adding `seller_id`
-- explicitly does not cross a boundary the function did not already sit on.
--
-- `c.seller_id`, not `l.seller_id`: the former is a plain NOT NULL column
-- already on the FROM table (`conversations c`), so it costs nothing extra
-- to select. The latter would come from the `left join public.listings l`
-- below, which -- per 20261020113820's own correction of this function's
-- inherited "hard-deleted listing" rationale -- cannot actually be null
-- today (`conversations.listing_id` is `on delete cascade` to `listings`,
-- so a conversation cannot outlive the listing it names; see that
-- migration's header for the full note). Reading off `c.seller_id` directly
-- is simply the more direct of two columns that happen to agree, not a
-- defense against a null `l.seller_id` that cascade already rules out.
--
-- Same DROP+CREATE remedy as 20261020113820, verified there against the
-- real Postgres error ("cannot change return type of existing function...
-- Use DROP FUNCTION ... first"): appending an output column is not
-- possible via plain CREATE OR REPLACE. The argument list is unchanged, so
-- `public.inbox_conversations(integer, timestamptz, uuid)` remains the one
-- and only signature -- no overload, and every existing caller (the
-- pgTAP suite, the generated TS types) keeps resolving the same function.
--
-- Confirmed against the REAL current body (20260929090200_chat_read_rpcs.sql)
-- before writing this DROP, not assumed -- every existing column, join, and
-- the participation/empty-thread predicate are copied verbatim; only
-- `seller_id` is new.
drop function if exists public.inbox_conversations(integer, timestamptz, uuid);

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
  unread_count integer,
  seller_id uuid
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
    unread.n,
    c.seller_id
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
