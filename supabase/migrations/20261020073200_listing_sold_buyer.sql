-- ROADMAP 5.3 "Mark sold to a buyer": "When marking sold, pick the buyer
-- from people who messaged about the listing." This is the deferred half
-- of `mark_listing_sold` that 20261013165513_listing_status_transitions.sql
-- deliberately left out -- that migration's own header says so verbatim:
-- "No buyer_id on mark_listing_sold -- that is ROADMAP 5.3, later."
--
-- Confirmed against the REAL current body of `mark_listing_sold(uuid)`
-- before writing this DROP/replace (read in full, not assumed): it locks
-- the row `for update`, checks `seller_id is distinct from auth.uid()`,
-- checks `status in ('active', 'reserved')`, then does a bare
-- `update ... set status = 'sold'`. Every one of those checks is kept
-- verbatim below; only the buyer plumbing is new.
--
-- ============================================================
-- Why `sold_to_user_id` is a new DURABLE COLUMN, not derived from
-- `conversations` on read
-- ============================================================
-- The buyer could in principle be inferred at render time by joining
-- `conversations` on `listing_id` -- no new column needed, if there were
-- always EXACTLY ONE conversation on a sold listing. There usually isn't:
-- a popular listing can have zero conversations (sold outside the app, or
-- to someone who never messaged) or several (multiple interested buyers,
-- only one of whom actually bought it). Both are the normal case, not an
-- edge case, which is exactly the ambiguity this column exists to resolve
-- -- the moment of marking sold is the one time a human (the seller) can
-- actually disambiguate which conversation, if any, was the real sale, and
-- that answer must be captured then or it is lost forever (new messages
-- keep arriving, re-ordering "most recent").
--
-- It also has to be durable for a reason beyond this feature: ROADMAP 5.4
-- "Reviews" is the very next roadmap item, and a review needs a durable
-- buyer record to attach to -- "which specific person bought this, that I
-- can now leave a review about" is not a question "the most recent
-- conversation at render time" can keep answering correctly as more
-- messages and more listings accumulate.
--
-- ============================================================
-- Why nullable, and why `on delete set null` rather than `on delete
-- cascade`
-- ============================================================
-- Nullable: a seller who sold outside the app (a friend, a local pickup
-- arranged by phone, anyone who never sent a single in-app message) must
-- still be able to mark the listing sold. `mark_listing_sold` has never
-- required a buyer -- making one mandatory now would be a UX regression
-- relative to today, not merely a missing enhancement. `p_buyer_id`
-- therefore defaults to `null` and the column stays optional at the
-- database level too (the CHECK below only constrains what a NON-null value
-- must look like, never forcing one to exist).
--
-- `on delete set null`, not `on delete cascade`: the natural reflex for a
-- "soft" relationship like this is `set null`, but it is worth spelling out
-- why `cascade` would be actively wrong here, not just unnecessary. This FK
-- points FROM the seller's own listing row TO the buyer's profile. A
-- cascade fires on deletion of the REFERENCED row (the buyer's profile),
-- and would delete the REFERENCING row (the seller's listing) -- i.e. the
-- buyer later deleting their account would silently delete the seller's
-- own, unrelated sale history. That is never acceptable: the listing isn't
-- the buyer's to take down, and a past sale is the seller's own permanent
-- record (same "sold is terminal, permanent history" principle
-- 20261013165513 already applies to `remove_listing` never accepting
-- 'sold'). `set null` preserves the listing and the fact that it sold,
-- only forgetting WHO specifically, which is the correct amount of data
-- loss when the buyer's account is gone.
--
-- ============================================================
-- A BLOCKED buyer still appears in the picker and can still be recorded --
-- deliberate, not an oversight
-- ============================================================
-- ROADMAP 5.2 "Block" stops FUTURE contact; it does not erase the past --
-- existing conversations with a since-blocked user stay open and visible
-- (`get_or_create_listing_conversation`'s own resume-first logic is
-- unaffected by a block, and nothing in 20261020065008 hides existing
-- messages). A real sale that happened through messaging before the block
-- is a legitimate historical fact the seller must be able to record,
-- exactly consistent with that "stop future contact, don't erase the past"
-- precedent -- so neither `mark_listing_sold` nor `listing_conversation_buyers`
-- below filters on `private.has_block_between` at all. The picker shows no
-- "blocked" indicator either: the seller already knows who they blocked,
-- and a label here would only be useful for re-litigating the block from
-- the wrong screen.
--
-- FLAGGED FOR ROADMAP 5.4 "Reviews" (the very next item), not a defect
-- here: this choice safely and correctly commits to `sold_to_user_id`
-- staying populated regardless of a later block, which is right for THIS
-- item -- but if 5.4's review-submission RPC follows this codebase's own
-- established pattern of gating NEW actions through
-- `private.has_block_between` (exactly as the `messages` INSERT policy and
-- `get_or_create_listing_conversation` already do), a seller could
-- complete a sale, then immediately block the buyer, and keep the sale on
-- record while unilaterally shutting off that buyer's ability to leave a
-- review -- an asymmetry with no cost to the seller and no trace tying the
-- block's timing to the review window. Whoever designs 5.4 should decide
-- explicitly whether review eligibility is blind to block state
-- (symmetric with how this item treats `sold_to_user_id`) or snapshotted
-- at sale time rather than checked at submission time -- not inherit this
-- item's choice by default without making that call on purpose.

alter table public.listings
  add column sold_to_user_id uuid references public.profiles (id) on delete set null;

-- Mirrors `listings_complete_when_not_draft`'s own shape: a structural
-- invariant on the table, not merely something the RPC happens to enforce
-- -- so it holds even for a future privileged writer that bypasses
-- `mark_listing_sold` entirely, the same discipline section 3 of
-- listings.sql tests for that constraint.
alter table public.listings
  add constraint listings_sold_to_only_when_sold
    check (sold_to_user_id is null or status = 'sold');

-- `is distinct from`, never `<>`: the whole point of this CHECK is to
-- reject `sold_to_user_id = seller_id`, and `<>` would silently let a NULL
-- `sold_to_user_id` (the overwhelmingly common case) slide through for the
-- wrong reason -- it happens to be correct here too since NULL is legal,
-- but the habit is what 20260929090000's own `get_or_create_listing_
-- conversation` comment calls out, and a `<>` here would be a trap for
-- the next column added to this same CHECK.
alter table public.listings
  add constraint listings_sold_to_not_seller
    check (sold_to_user_id is distinct from seller_id);

-- Partial index, mirroring `listing_images_listing_id_idx`'s discipline of
-- indexing only what is actually queried: nothing today looks up "all
-- listings sold to user X" at any volume yet, but ROADMAP 5.4 "Reviews"
-- (the very next item, see above) almost certainly will, and the `where`
-- clause keeps the index from carrying every never-sold or sold-with-no-
-- buyer row for free.
create index listings_sold_to_user_id_idx
  on public.listings (sold_to_user_id) where sold_to_user_id is not null;

-- ============================================================
-- mark_listing_sold -- widened with an optional p_buyer_id
-- ============================================================
-- `drop function` first, not `create or replace`: the old signature is
-- `mark_listing_sold(uuid)` and the new one is `mark_listing_sold(uuid,
-- uuid default null)`. PostgreSQL overloads functions by argument types,
-- so leaving the old 1-arg function in place alongside a new 2-arg one
-- would create TWO callable overloads -- `replace` only ever replaces an
-- EXACT signature match, it does not widen one in place. Dropping first is
-- what makes `markListingSold(listingId, null)` resolve to this single new
-- function rather than silently keeping the old no-buyer-tracking body
-- reachable forever under a `p_listing_id`-only call.
drop function if exists public.mark_listing_sold(uuid);

create or replace function public.mark_listing_sold(
  p_listing_id uuid,
  p_buyer_id   uuid default null
)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing public.listings;
begin
  select * into v_listing from public.listings
   where id = p_listing_id
   for update;

  if not found then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;

  if v_listing.seller_id is distinct from (select auth.uid()) then
    raise exception 'Not your listing' using errcode = '42501';
  end if;

  if v_listing.status not in ('active', 'reserved') then
    raise exception 'Only an active or reserved listing can be marked as sold' using errcode = 'P0001';
  end if;

  -- This guard (and the absence, anywhere in this schema, of any RPC that
  -- transitions a listing OUT of 'sold') is what makes 'sold' terminal.
  -- ROADMAP 5.4's `reviews` table leans on that invariant directly: its
  -- natural key is `unique (listing_id, reviewer_id)` alone, with no
  -- status/round-trip component, which is only correct because a listing
  -- cannot be sold, then un-sold, then sold again to a different buyer. If
  -- a future migration ever adds such a transition, `reviews_unique_
  -- listing_reviewer` (20261020113819) must be revisited first.

  if p_buyer_id is not null then
    -- `is not distinct from`, not `=`: the seller id is already known
    -- non-null here (every listing has one), but the habit matters more
    -- than this one call site -- see the header note on
    -- `listings_sold_to_not_seller` above.
    if p_buyer_id is not distinct from v_listing.seller_id then
      raise exception 'The buyer cannot be the seller' using errcode = 'P0001';
    end if;

    -- THE listing-scoped check -- not seller-scoped. Deliberately filters
    -- by BOTH `listing_id = p_listing_id` AND `buyer_id = p_buyer_id`:
    -- someone who messaged this seller about a DIFFERENT listing they also
    -- own must still be rejected here. Treating "messaged this seller
    -- about anything" as sufficient would let a seller credit a sale to a
    -- buyer who never actually expressed interest in THIS item, which
    -- defeats the whole point of sourcing the picker from the listing's
    -- own conversations rather than from the seller's contacts in general.
    if not exists (
      select 1 from public.conversations c
       where c.listing_id = p_listing_id and c.buyer_id = p_buyer_id
    ) then
      raise exception 'The selected buyer never messaged about this listing' using errcode = 'P0001';
    end if;

    -- No `private.has_block_between` check here, and none should be added
    -- -- see the header note above: a blocked buyer who genuinely bought
    -- the item must still be recordable as the sale's buyer.
  end if;

  update public.listings
     set status = 'sold', sold_to_user_id = p_buyer_id
   where id = p_listing_id
   returning * into v_listing;

  return v_listing;
end;
$$;

-- All three grantees revoked separately, same discipline every RPC in
-- this codebase follows (pg_default_acl grants arwdDxtm-equivalent EXECUTE
-- to anon/authenticated on every new function, and `revoke ... from
-- public` does not reach those direct grants).
revoke all    on function public.mark_listing_sold(uuid, uuid) from public;
revoke all    on function public.mark_listing_sold(uuid, uuid) from anon;
grant execute on function public.mark_listing_sold(uuid, uuid) to authenticated;

-- ============================================================
-- listing_conversation_buyers -- who may be picked as the buyer
-- ============================================================
-- Why this has to be its own SECURITY DEFINER RPC rather than a direct
-- client query against `conversations` filtered by `listing_id`, despite
-- the seller already having RLS SELECT visibility into their own
-- conversations ("Participants read own conversations", `(select
-- auth.uid()) in (buyer_id, seller_id)"): this is a COLUMN-GRANT gap, not
-- an RLS gap. Confirmed against the REAL current grant statement in
-- 20260929090000_chat_conversations_and_messages.sql before asserting
-- this -- it reads exactly:
--
--     grant select (id, buyer_id, seller_id) on public.conversations to authenticated;
--
-- `listing_id` is not in that allowlist at all. RLS would happily let the
-- seller's own row through, but PostgREST/PostgreSQL rejects the query
-- before RLS is even the deciding factor: a client `select` naming
-- `listing_id`, or filtering `.eq('listing_id', ...)` (which also requires
-- read privilege on the column to evaluate), fails with 42501 regardless
-- of which rows RLS would have allowed. That narrow grant is itself
-- deliberate (that migration's own comment: the only existing consumer of
-- it is the `messages` policies' membership subquery, and every other
-- column -- including `listing_id` -- was intentionally left for a future
-- DEFINER read RPC, which `inbox_conversations`/`conversation_detail`
-- already are and this is the same pattern a third time). Widening the
-- grant to include `listing_id` would be a much bigger, unreviewed change
-- than adding one more narrowly-scoped DEFINER function.
--
-- Returns exactly what the picker UI needs to render one row per buyer --
-- display name, username, avatar path, and a last-message preview/time --
-- ordered most-recent-first so the likely buyer surfaces first without the
-- client re-sorting. No `blocked` flag: see the header note above on why
-- a blocked buyer is deliberately indistinguishable here from any other.
create or replace function public.listing_conversation_buyers(p_listing_id uuid)
returns table (
  buyer_id           uuid,
  buyer_display_name text,
  buyer_username     text,
  buyer_avatar_path  text,
  last_message_at    timestamptz,
  last_message_body  text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seller uuid := (select auth.uid());
begin
  if v_seller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Ownership gate first, using the listings row directly rather than
  -- trusting conversations.seller_id alone -- mirrors every other RPC in
  -- this file's own "select the row, then check seller_id is distinct
  -- from auth.uid()" shape, just phrased as an `exists` since nothing else
  -- here needs the listing row's other columns.
  if not exists (
    select 1 from public.listings l where l.id = p_listing_id and l.seller_id = v_seller
  ) then
    raise exception 'Not your listing' using errcode = '42501';
  end if;

  return query
    select c.buyer_id, p.display_name, p.username, p.avatar_path,
           c.last_message_at, c.last_message_body
      from public.conversations c
      join public.profiles p on p.id = c.buyer_id
     where c.listing_id = p_listing_id
     order by c.last_message_at desc, c.id desc;
end;
$$;

revoke all    on function public.listing_conversation_buyers(uuid) from public;
revoke all    on function public.listing_conversation_buyers(uuid) from anon;
grant execute on function public.listing_conversation_buyers(uuid) to authenticated;
