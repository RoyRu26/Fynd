-- Message history for one conversation thread (ROADMAP 1.3).
--
-- SECURITY INVOKER, unlike inbox_conversations / conversation_detail /
-- inbox_unread_count, which are all SECURITY DEFINER. Those three exist as
-- DEFINER specifically because they project a LISTING the caller may no
-- longer be able to SELECT (sold/removed) -- see their own migration's
-- header. This function returns ONLY rows from public.messages, which
-- carries no such dependency: "Participants read conversation messages" is
-- exactly the predicate this query needs, and it already admits exactly the
-- right rows for exactly the right caller. So RLS stays active here as a
-- free, independent second guarantee that a non-participant can never read
-- a thread -- the same reasoning feed_listings documents for why IT is
-- INVOKER unlike the chat read RPCs.
--
-- A non-participant (or a caller against a conversation id that does not
-- exist at all) gets zero rows back, not an error -- RLS USING denial
-- matches nothing silently, exactly like every other direct SELECT on
-- public.messages. This function adds no participant check of its own on
-- top, because INVOKER means there is nothing for such a check to bypass.
--
-- Keyset paginated on (created_at desc, id desc), matching
-- messages_conversation_created_idx's trailing order exactly -- newest
-- first, which is what an inverted FlatList wants with no client-side
-- reversal.

create or replace function public.conversation_messages(
  p_conversation_id uuid,
  p_limit integer default 30,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  client_nonce text,
  created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  -- coalesce BEFORE clamping -- least(greatest(null,1),100) is null, and
  -- `limit null` means NO LIMIT, so an explicit null from a caller would
  -- otherwise return the whole thread in one response. Every parameter here
  -- is treated as hostile, matching feed_listings/inbox_conversations.
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  -- Both cursor halves, or neither. A half cursor would otherwise compare
  -- against null, yield null, and silently return page 1 forever -- same
  -- XOR guard as feed_listings and inbox_conversations.
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception 'A message cursor needs both created_at and id, or neither'
      using errcode = 'P0001';
  end if;

  return query
  select
    m.id,
    m.conversation_id,
    m.sender_id,
    m.body,
    m.client_nonce,
    m.created_at
  from public.messages m
  where m.conversation_id = p_conversation_id
    and (
      p_cursor_created_at is null
      or (m.created_at, m.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by m.created_at desc, m.id desc
  limit v_limit;
end;
$$;

revoke all    on function public.conversation_messages(uuid, integer, timestamptz, uuid) from public;
revoke all    on function public.conversation_messages(uuid, integer, timestamptz, uuid) from anon;
grant execute on function public.conversation_messages(uuid, integer, timestamptz, uuid) to authenticated;
