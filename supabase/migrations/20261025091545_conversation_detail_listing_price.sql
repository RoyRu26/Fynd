-- SCREENS.md Task 6 "Chat" -- `conversation_detail` grows two new output
-- columns, `listing_price_amount` and `listing_currency`, so the thread's
-- new pinned listing strip (2d's own spec: thumbnail + title + price +
-- "View") can render a price without a second round trip to a `listings`
-- row the viewer may not even hold SELECT privilege on once it is sold.
--
-- Same DROP+CREATE remedy as 20261020113820 (`can_review`) and
-- 20261025090146 (`inbox_conversations`'s `seller_id`), for the identical
-- reason: appending an output column is not possible via plain CREATE OR
-- REPLACE (verified there against the real Postgres error). The argument
-- list is unchanged, so `public.conversation_detail(uuid)` remains the one
-- and only signature.
--
-- Both new columns are nullable, matching `listing_title`/`listing_status`/
-- `cover_storage_path` immediately above them in the same SELECT list: all
-- five come from the same `left join public.listings l`, so a hard-deleted
-- listing (the reason that join is LEFT in the first place -- see this
-- function's header in 20260929090200) leaves all five null together, never
-- some null and some not.
--
-- Confirmed against the REAL current body (20261020113820_conversation_
-- detail_can_review.sql, the most recent prior definition) before writing
-- this DROP, not assumed -- every existing column, join, and the
-- participation/P0002 guard are copied verbatim; only the two price columns
-- and their one added SELECT expression are new.
drop function if exists public.conversation_detail(uuid);

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
  other_avatar_path text,
  -- True exactly when: the listing is sold with a recorded buyer, the
  -- viewer and the other participant are precisely that sale's
  -- seller/buyer pair (not merely two people who happened to message about
  -- this listing -- see `listings_sold_to_user_id`'s own buyer-disambiguation
  -- reasoning in 20261020073200), AND the viewer has not already reviewed
  -- this sale. `coalesce(..., false)` rather than leaving it nullable: `l`
  -- is joined via the pre-existing `left join public.listings l` below, so
  -- every sub-expression touching `l.*` would evaluate to NULL rather than
  -- FALSE if that row were ever absent -- a NULL "maybe you can review" is
  -- not a value this boolean should ever surface to the client.
  can_review boolean,
  -- bigint, matching listings.price_amount itself (every other RPC that
  -- projects this column -- feed_listings, search_listings -- declares it
  -- bigint too, not integer).
  listing_price_amount bigint,
  listing_currency text
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
    other.avatar_path,
    coalesce(
      l.status = 'sold'
      and l.sold_to_user_id is not null
      and (
        (v_viewer = l.seller_id       and other.id = l.sold_to_user_id)
        or
        (v_viewer = l.sold_to_user_id and other.id = l.seller_id)
      )
      and not exists (
        select 1 from public.reviews r
         where r.listing_id = l.id and r.reviewer_id = v_viewer
      ),
      false
    ),
    l.price_amount,
    l.currency
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
