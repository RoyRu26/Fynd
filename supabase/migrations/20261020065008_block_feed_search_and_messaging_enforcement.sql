-- Wires the previous migration's `private.has_block_between` into every
-- surface ROADMAP 5.2 names: "their listings disappear from my feed/
-- search, and neither side can message the other. Enforced in RLS/RPCs,
-- not just the UI." Four existing objects each gain exactly one added
-- filter; nothing else about their shape changes.
--
-- Three are CREATE OR REPLACE (parameter lists and RETURNS TABLE shapes
-- are unchanged, so REPLACE is legal, unlike 20261019064633's DROP+CREATE
-- when feed_listings itself grew a parameter). The `messages` INSERT
-- policy is DROP + CREATE, since policies have no REPLACE form at all.

-- ============================================================
-- feed_listings
-- ============================================================
-- One added clause, same signature as 20261019064633 left it
-- (p_limit, p_cursor_created_at, p_cursor_id, p_include_own,
-- p_following_only). SECURITY INVOKER stays correct for the same reason
-- that migration's own header already established for the `follows`
-- subquery: a boolean check about a relationship the viewer is themselves
-- a party to crosses no privilege boundary RLS would otherwise need to
-- enforce on the function's behalf.
--
-- Calls `public.is_blocked_with(l.seller_id)`, NOT
-- `private.has_block_between(v_viewer, l.seller_id)` directly, even though
-- v_viewer IS auth.uid() and the two calls are semantically identical.
-- This is forced, not stylistic: `feed_listings` is SECURITY INVOKER, so
-- resolving a schema-qualified name inside its body happens under the
-- REAL caller's privileges, and `authenticated` deliberately holds no
-- USAGE on `private` (20260929090100's own precedent). Verified
-- empirically during review -- an earlier draft that called
-- `private.has_block_between` directly from here failed for every
-- `authenticated` caller with `permission denied for schema private`,
-- not a theoretical concern. `public.is_blocked_with` is itself SECURITY
-- DEFINER specifically so it can absorb that resolution on the caller's
-- behalf -- see its own migration's header for the full reasoning.

create or replace function public.feed_listings(
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
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_include_own boolean := coalesce(p_include_own, false);
  v_following_only boolean := coalesce(p_following_only, false);
  v_viewer uuid := (select auth.uid());
begin
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
    exists (
      select 1 from public.favorites f
       where f.listing_id = l.id
         and f.user_id = v_viewer
    )
  from public.listings l
  join public.profiles p on p.id = l.seller_id
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
      not v_following_only
      or exists (
        select 1 from public.follows f
         where f.follower_id = v_viewer
           and f.followed_id = l.seller_id
      )
    )
    -- ROADMAP 5.2: a blocked seller's listings disappear from the viewer's
    -- feed, in either direction -- the viewer blocked them, or they blocked
    -- the viewer. `v_include_own` already keeps this from ever evaluating
    -- against the viewer's own id when p_include_own is true (blocks are
    -- irreflexive -- blocks_not_self -- so has_block_between(v_viewer,
    -- v_viewer) is always false regardless), mirroring how the
    -- following-only clause above documents the same non-interaction with
    -- self-rows.
    and not public.is_blocked_with(l.seller_id)
    and (
      p_cursor_created_at is null
      or (l.created_at, l.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by l.created_at desc, l.id desc
  limit v_limit;
end;
$$;

-- No grant changes needed -- REPLACE preserves the existing ACL entries on
-- this exact signature untouched.

-- ============================================================
-- search_listings
-- ============================================================
-- Same one-clause addition, applied to BOTH sort branches (price and
-- newest) -- search_listings has exactly two, confirmed by reading the
-- real current function (20261018104807_search_listings_rpc.sql) rather
-- than assuming it from the plan.
--
-- HEADER CORRECTION, not just an added clause: that migration's own header
-- states, as part of its SECURITY INVOKER justification, that this
-- function "does not call auth.uid() or branch on the caller's identity
-- ANYWHERE in its body". That claim becomes literally false the moment
-- v_viewer is introduced below -- recorded here as a correction to the
-- earlier migration's prose, not silently left stale for a future reader
-- to trip over.
--
-- INVOKER REMAINS CORRECT even though the claim it rested on no longer
-- holds, for the same reason feed_listings' own header already
-- establishes for its own `follows`/now `blocks` lookups: reading
-- `auth.uid()` and calling a boolean-only helper that only ever answers a
-- question about a relationship the caller is themselves a party to does
-- not cross any privilege boundary the caller did not already have. The
-- helper returns strictly less information than a direct table read
-- would, by construction (see `private.has_block_between`'s own migration
-- header) -- so adding this one filter does not turn this function into
-- something that needs elevated privilege to do its job, and RLS staying
-- live over `public.listings` (`status = 'active'`, the exact set this
-- function already filters to explicitly) remains a free, genuine second
-- guarantee, not a decorative one.
--
-- Calls `public.is_blocked_with(l.seller_id)`, not
-- `private.has_block_between(v_viewer, l.seller_id)` directly -- forced by
-- the same mechanical constraint `feed_listings` hit: this function stays
-- SECURITY INVOKER, and `authenticated` holds no USAGE on `private`, so a
-- direct qualified reference from here fails name resolution for every
-- real caller (confirmed empirically: `permission denied for schema
-- private`). See `public.is_blocked_with`'s own migration header for why
-- IT is SECURITY DEFINER specifically to absorb that resolution.

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
      -- ROADMAP 5.2: same suppression as feed_listings, in either
      -- direction. Search deliberately keeps including the viewer's OWN
      -- listings (20261018104807's own header -- this is a catalog lookup
      -- utility, not a discovery feed), and blocks are irreflexive
      -- (blocks_not_self), so this can never suppress a viewer's own row.
      and not public.is_blocked_with(l.seller_id)
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
      and not public.is_blocked_with(l.seller_id)
      and (p_cursor_created_at is null or (l.created_at, l.id) < (p_cursor_created_at, p_cursor_id))
    order by l.created_at desc, l.id desc
    limit v_limit;
  end if;
end;
$$;

-- No grant changes needed -- REPLACE preserves the existing ACL entries on
-- this exact signature untouched.

-- ============================================================
-- get_or_create_listing_conversation
-- ============================================================
-- The block check is added ONLY to the "create a NEW conversation" branch,
-- never the resume branch -- confirmed against the real current function
-- (20260929090000_chat_conversations_and_messages.sql): it already has
-- exactly the "resume first, gate creation second" split the plan
-- described (resume lookup, then a listing-not-found / self-message /
-- not-active sequence of guards, then the insert). History must stay
-- readable after a block, same as it already stays readable after the
-- listing sells -- only STARTING fresh is gated, which is the behavior
-- that matches "neither side can message the other" without also
-- retroactively hiding a thread that already existed.
--
-- Raised as 42501, matching this plan's and the messages policy's choice
-- below -- a permission-denied class, not P0001/P0002 (which this function
-- otherwise uses for "not found"/"not available" business states). A
-- block is an authorization refusal, not a missing-resource one, so it
-- gets its own distinct SQLSTATE the client can map separately rather
-- than colliding with "listing not found" or "seller contacted
-- themselves".

create or replace function public.get_or_create_listing_conversation(
  p_listing_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer uuid := (select auth.uid());
  v_listing public.listings;
  v_id uuid;
begin
  if v_buyer is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- RESUME FIRST, gate creation second -- unchanged. No block check here:
  -- a buyer whose counterpart they later blocked (or who later blocked
  -- them) must still be able to reopen and read an existing thread.
  select c.id into v_id
    from public.conversations c
   where c.listing_id = p_listing_id
     and c.buyer_id = v_buyer;

  if v_id is not null then
    return v_id;
  end if;

  select * into v_listing
    from public.listings l
   where l.id = p_listing_id;

  if not found then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;

  if v_listing.seller_id is not distinct from v_buyer then
    raise exception 'You cannot message yourself about your own listing'
      using errcode = 'P0001';
  end if;

  if v_listing.status <> 'active' then
    raise exception 'Listing is not available' using errcode = 'P0002';
  end if;

  -- ROADMAP 5.2: a NEW conversation cannot be started while either side has
  -- blocked the other. Placed after the status/self-message guards (so
  -- those keep raising their own, more specific codes first) and before
  -- the insert, which is the only remaining way this branch could
  -- otherwise create a fresh thread.
  if private.has_block_between(v_buyer, v_listing.seller_id) then
    raise exception 'You cannot message this user' using errcode = '42501';
  end if;

  insert into public.conversations (listing_id, buyer_id, seller_id)
  values (p_listing_id, v_buyer, v_listing.seller_id)
  on conflict (listing_id, buyer_id) do nothing
  returning id into v_id;

  if v_id is null then
    select c.id into v_id
      from public.conversations c
     where c.listing_id = p_listing_id
       and c.buyer_id = v_buyer;
  end if;

  if v_id is null then
    raise exception 'Could not open a conversation' using errcode = 'P0001';
  end if;

  return v_id;
end;
$$;

-- No grant changes needed -- REPLACE preserves the existing ACL entries on
-- this exact signature untouched.

-- ============================================================
-- messages INSERT policy
-- ============================================================
-- Extends the existing membership EXISTS subquery with the block check,
-- reusing the SAME conversation row `c` the membership check already
-- looked up -- not a second, redundant subquery. This blocks a direct
-- INSERT into an EXISTING conversation once either participant has
-- blocked the other, which is what makes "neither side can message the
-- other" hold even for a thread that predates the block (the RPC above
-- only gates NEW conversations; this policy is what closes the "resume an
-- old thread and keep sending" gap that would otherwise leave open).
--
-- DROP + CREATE, not REPLACE -- policies have no CREATE OR REPLACE form at
-- all, matching 20260929090100's own precedent when it repointed this
-- exact policy at `private.message_send_allowed`.

drop policy "Participants send messages" on public.messages;

create policy "Participants send messages"
on public.messages for insert to authenticated
with check (
  messages.sender_id = (select auth.uid())
  and exists (
    select 1 from public.conversations c
     where c.id = messages.conversation_id
       and (select auth.uid()) in (c.buyer_id, c.seller_id)
       -- ROADMAP 5.2: reuses `c`, the conversation row this subquery
       -- already fetched for the membership check -- no second lookup.
       and not private.has_block_between(c.buyer_id, c.seller_id)
  )
  and private.message_send_allowed(messages.conversation_id, messages.client_nonce)
);
