-- ROADMAP 5.4 "Reviews" -- `conversation_detail` grows one new output
-- column, `can_review`, so the conversation screen can render its own
-- "Leave a review for {name}" CTA without a second round trip.
--
-- ============================================================
-- Why the CTA has to live on the CONVERSATION screen, not listing detail
-- ============================================================
-- A buyer cannot reliably read a SOLD listing's own detail row directly:
-- `listings`' SELECT RLS is `status = 'active' or seller_id = auth.uid()`
-- (20260829142345), which a buyer who is neither the seller nor looking at
-- an active listing never satisfies once it flips to 'sold'. They can only
-- ever reach that listing's data through `conversation_detail`/`inbox_
-- conversations`, which are SECURITY DEFINER specifically so a sold or
-- removed listing's thread still renders for the buyer (see 20260929090200's
-- own header). Putting the review CTA on listing detail would therefore
-- silently fail to render it for the buyer's side half the time it matters
-- most -- `conversation_detail` is the only place both parties can
-- reliably learn "this sale is reviewable."
--
-- ============================================================
-- Verified empirically before writing this as a DROP+CREATE: does
-- `CREATE OR REPLACE FUNCTION` let a new trailing output column be
-- appended to an existing `RETURNS TABLE(...)` set-returning function
-- without dropping it first?
-- ============================================================
-- Tested directly against the local stack with a throwaway function
-- (`returns table (a int, b int)` replaced in place by `returns table (a
-- int, b int, c boolean)`): Postgres rejects it outright --
--   ERROR:  cannot change return type of existing function
--   DETAIL:  Row type defined by OUT parameters is different.
--   HINT:  Use DROP FUNCTION ... first.
-- So appending a column is NOT possible via plain CREATE OR REPLACE, even
-- though every other property of the function (name, argument list) is
-- unchanged -- PostgreSQL treats the OUT-parameter row type as part of the
-- function's identity for this purpose. This is the same situation
-- `mark_listing_sold` hit in 20261020073200 for an arity change (not a
-- return-type change, but the same remedy): `drop function` first, then
-- `create or replace`, so exactly one `conversation_detail(uuid)` is ever
-- callable, never two overloads coexisting.
--
-- Confirmed against the REAL current body (20260929090200_chat_read_rpcs.sql)
-- before writing this DROP, not assumed -- every existing column, join,
-- and the P0002 not-found/not-yours guard below are copied verbatim; only
-- `can_review` is new.
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
  --
  -- Checked live during review: as the schema stands today,
  -- `conversations.listing_id` is `on delete cascade` to `listings`
  -- (20260929090000), so a conversation row cannot actually outlive the
  -- listing it names -- deleting the listing deletes the conversation with
  -- it, meaning this LEFT JOIN's "listing is gone, conversation survives"
  -- case cannot occur under the CURRENT schema, and this function's own
  -- preexisting comment below (inherited, predating this change) claiming
  -- a hard-deleted listing must still let the thread render does not hold
  -- today either. Left as a LEFT JOIN + `coalesce` anyway, deliberately:
  -- it costs nothing, fails safe (false, never an error or NULL) if that
  -- FK's `on delete` behavior is ever loosened later (e.g. a future
  -- "delete my account/listing" feature choosing SET NULL instead of
  -- CASCADE to preserve conversation history, the same way `reports` and
  -- `ai_suggestion_calls` already chose SET NULL over CASCADE for
  -- analogous reasons elsewhere in this schema), and this comment is what
  -- stops a future reader from re-trusting the inherited claim below at
  -- face value the way this migration briefly did.
  can_review boolean
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
    )
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
