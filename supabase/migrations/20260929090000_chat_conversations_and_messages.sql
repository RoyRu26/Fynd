-- Private 1:1 buyer/seller conversations, and the messages inside them.
--
-- Shape: two tables with DIRECT participant columns, not a
-- conversation_members join table. Fynd's chat is strictly 1:1 and anchored
-- to (listing, buyer, seller), so direct columns make every RLS predicate a
-- single-table comparison with no join -- which matters because that
-- predicate sits on the hot path of every message read AND of every Realtime
-- event, where realtime.apply_rls re-evaluates it per change per subscriber.
-- A members table would make both an `exists` subquery, and would make the
-- 1:1 invariant ("exactly two members, one buyer one seller") inexpressible
-- declaratively.
--
-- Not a dead end: if group chat ever arrives the path is additive and
-- mechanical -- create conversation_members, backfill two rows per
-- conversation from these columns, move the policies to a membership
-- predicate, drop the columns. The reverse direction is the hard one.
--
-- seller_id is DENORMALIZED from listings, and that is sound only because
-- listings.seller_id has no UPDATE column grant (the allowlist in
-- 20260914151000 is title/description/price_amount/condition, widened to
-- size in 20260922090100) -- so listing ownership can never change through
-- any client path. If that ever changes, this denormalization becomes
-- unsound and must be revisited.
--
-- Both participant FKs target public.profiles, not auth.users. The house has
-- both patterns (listings.seller_id -> profiles, favorites.user_id ->
-- auth.users); profiles is the right target whenever the row is joined for
-- DISPLAY, which is exactly what the inbox and thread header do.
--
-- This migration is Phase 1: tables, RLS, grants, the last-message trigger,
-- and the two WRITE RPCs. The read RPCs (inbox_conversations,
-- conversation_detail, inbox_unread_count) and the Realtime publication are
-- deliberately separate, later migrations.

-- ============================================================
-- conversations
-- ============================================================

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,

  -- NOT NULL with a default, never nullable. Nullable would be a trap twice
  -- over: `order by last_message_at desc` is NULLS FIRST in PostgreSQL, so
  -- every freshly-opened empty conversation would sort to the TOP of the
  -- inbox; and the keyset predicate `(last_message_at, id) < (cursor,
  -- cursor)` yields NULL for a NULL left side, so those same rows would
  -- vanish from page 2 onward -- paginating into a hole. Stamped at
  -- creation; the trigger below only ever moves it forward.
  last_message_at timestamptz not null default now(),
  -- Truncated preview, written by the trigger. A 2000-character message
  -- must not ride along in every inbox row's payload.
  last_message_body text,
  -- For PREVIEW AND DISPLAY ONLY -- never as an unread predicate. See the
  -- note on the messages table below for why that distinction is
  -- load-bearing. `is null` here is also the exact, free test for "this
  -- thread has no messages yet", which the inbox RPC will use to keep
  -- curiosity-taps out of the seller's inbox.
  --
  -- Its own FK, with `set null` rather than cascade: a deleted account must
  -- not take the whole conversation with it.
  last_message_sender_id uuid references public.profiles (id) on delete set null,

  -- Written ONLY by mark_conversation_read(). Clients hold no UPDATE grant
  -- on this table at all, which is what makes "a participant cannot mark the
  -- other side as read" structural rather than policy-enforced.
  --
  -- Why not column grants plus RLS: a policy cannot express "only your own
  -- side". USING sees the OLD row and WITH CHECK sees the NEW row, and no
  -- policy expression has access to both -- so "seller_last_read_at did not
  -- change" is simply not writable as a predicate. A buyer granted
  -- update (buyer_last_read_at, seller_last_read_at) could write either.
  buyer_last_read_at timestamptz,
  seller_last_read_at timestamptz,

  created_at timestamptz not null default now(),

  -- The natural key AND the get-or-create concurrency arbiter. seller_id is
  -- deliberately absent: it is functionally dependent on listing_id, so
  -- including it would be redundant and could only mask drift.
  constraint conversations_listing_buyer_key unique (listing_id, buyer_id),
  -- `<>` is correct here, unlike the auth.uid() comparisons in the RPCs
  -- below: both columns are NOT NULL, so the NULL-silently-skips-the-check
  -- trap cannot apply. A seller contacting themselves is refused at the
  -- table, independently of the RPC's own guard.
  constraint conversations_distinct_participants check (buyer_id <> seller_id)
);

-- One index per side rather than one on (buyer_id, seller_id): the inbox
-- reads "my conversations, newest activity first" from whichever side the
-- caller is on, and the trailing (last_message_at desc, id desc) is the
-- keyset order, so each side's inbox page is an index-ordered scan.
--
-- Note the `or` across the two columns in the inbox query will not use a
-- single ordered scan -- PostgreSQL will BitmapOr the two indexes and then
-- sort. That is irrelevant at this volume. If it ever matters, the fix is a
-- UNION ALL of two separately-ordered, separately-limited branches,
-- re-limited at the top. Recorded so it need not be rediscovered.
create index conversations_buyer_idx
  on public.conversations (buyer_id, last_message_at desc, id desc);

create index conversations_seller_idx
  on public.conversations (seller_id, last_message_at desc, id desc);

-- Backs get_or_create's resume lookup and the cascade from listings.
create index conversations_listing_idx on public.conversations (listing_id);

-- The cascade from listings is reachable but currently harmless: the
-- listings DELETE policy is restricted to (own AND status = 'draft'), and a
-- conversation can only be CREATED against an 'active' listing, so the
-- cascade can only ever fire on a draft, which by construction has no
-- conversations. Worth stating, because relaxing that policy later would
-- quietly become "a seller can erase a buyer's chat history".

-- ============================================================
-- messages
-- ============================================================

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  -- A client-supplied per-sender idempotency token. Safe to accept because
  -- it is neither an identity claim nor an ordering key -- it is only ever
  -- compared for equality against this sender's own prior sends.
  --
  -- `text`, not `uuid`, for the same reason listing_events.session_id is:
  -- the client has no guaranteed UUID generator (expo-crypto is not a
  -- dependency), and a nonce needs local uniqueness, not unpredictability.
  --
  -- What it buys: a committed INSERT whose response is lost, followed by a
  -- user-initiated retry, would otherwise produce a permanent duplicate row
  -- -- and there is deliberately no UPDATE or DELETE grant here to clean one
  -- up. With the nonce, the retry re-sends the same token, hits the unique
  -- index below, and raises 23505, which the client treats as success.
  client_nonce text not null,
  created_at timestamptz not null default now(),

  -- TWO constraints, not one. `char_length(btrim(body)) between 1 and 2000`
  -- alone would bound only the TRIMMED length: 'a' || repeat(E'\n', 100000)
  -- trims to length 1, passes, and stores 100001 characters.
  constraint messages_body_length check (char_length(body) between 1 and 2000),
  constraint messages_body_present check (btrim(body) <> ''),
  constraint messages_client_nonce_shape
    check (char_length(client_nonce) between 8 and 64)
);

-- Serves message pagination, the unread count, AND the rate-limit subquery
-- in the insert policy below -- so the flood guard costs no extra index on
-- the most frequently written table in the app.
create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc, id desc);

-- Scoped per conversation AND PER SENDER. client_nonce is sender-local
-- idempotency, so the opposite participant must never be able to collide
-- with the same token in the same thread: a two-column index would hand them
-- a spurious 23505, which the client's retry contract treats as success --
-- SILENTLY DROPPING a real message. The third column is what licenses
-- treating 23505 as "this exact send already landed".
create unique index messages_conversation_sender_nonce_key
  on public.messages (conversation_id, sender_id, client_nonce);

-- ============================================================
-- message_send_allowed
-- ============================================================
-- The flood guard and its idempotent-retry escape hatch, extracted into a
-- SECURITY DEFINER function because PostgreSQL WILL NOT allow a policy on
-- public.messages to contain a subquery that reads public.messages:
--
--     ERROR: infinite recursion detected in policy for relation "messages"
--
-- Verified empirically against this migration, not assumed. Evaluating such
-- a subquery would re-enter RLS on the same relation, so Postgres refuses
-- outright. SECURITY DEFINER bypasses RLS and therefore terminates the
-- recursion, which is the only way to keep the guard in the policy rather
-- than abandoning direct INSERT for a send RPC.
--
-- It accepts NO sender parameter: the sender is auth.uid(), so a caller
-- cannot ask about anyone else's rate state. (auth.uid() still resolves to
-- the caller inside a DEFINER function -- it reads the request.jwt.claims
-- GUC, which is session state and unaffected by the role switch.)
--
-- `stable`, so within one statement it sees a consistent snapshot, while
-- successive INSERTs in the same transaction each see their predecessors --
-- which is what lets the 31st send in a minute actually trip.

create or replace function public.message_send_allowed(
  p_conversation_id uuid,
  p_client_nonce text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- Idempotent-retry escape hatch, evaluated FIRST. A lost response on a
    -- committed write leaves the client retrying the same nonce; if that
    -- sender is also over the cap, the count below alone would raise 42501,
    -- which the client's duplicate-send predicate does not recognise -- so a
    -- message that DID land would look permanently failed. Admitting the
    -- identical triple lets it reach
    -- messages_conversation_sender_nonce_key and raise 23505 instead.
    --
    -- This grants nothing: the only row it admits is one the unique index is
    -- certain to reject. RLS WITH CHECK is evaluated BEFORE constraints and
    -- indexes (the ordering favorites.sql documents, where a WITH CHECK
    -- denial pre-empts a foreign key), which is exactly why the hatch is
    -- needed for that 23505 to be reachable at all.
    exists (
      select 1 from public.messages m
       where m.conversation_id = p_conversation_id
         and m.sender_id = (select auth.uid())
         and m.client_nonce = p_client_nonce
    )
    -- Minimum safety architecture. NOT a hard security boundary -- it is
    -- racy under true concurrency, since two simultaneous inserts both read
    -- the pre-count -- but it bounds a flood to ~30/minute per thread, which
    -- is the only protection a v1 with no block, mute, or report offers a
    -- recipient. Blocking and reporting are genuinely additive later (a
    -- table plus one predicate); the absence of ANY bound is not, because it
    -- leaves the recipient no mitigation whatsoever.
    --
    -- Scoped per CONVERSATION rather than globally per sender on purpose: it
    -- targets "flooding one person" precisely, and it rides
    -- messages_conversation_created_idx, which pagination already needs.
    or (
      select count(*) from public.messages m
       where m.conversation_id = p_conversation_id
         and m.sender_id = (select auth.uid())
         and m.created_at > now() - interval '1 minute'
    ) < 30;
$$;

revoke all    on function public.message_send_allowed(uuid, text) from public;
revoke all    on function public.message_send_allowed(uuid, text) from anon;
-- Unlike the trigger function, this one DOES need EXECUTE: a policy
-- expression is evaluated as the caller, so the privilege is checked. Called
-- directly it reveals only whether the caller's OWN sends are capped in a
-- given thread, which membership is separately enforced against anyway.
grant execute on function public.message_send_allowed(uuid, text) to authenticated;

-- ============================================================
-- Row level security
-- ============================================================

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "Participants read own conversations"
on public.conversations for select to authenticated
using ((select auth.uid()) in (buyer_id, seller_id));

-- No INSERT policy (get_or_create_listing_conversation is the sole writer),
-- no UPDATE policy (mark_conversation_read and the trigger are the only
-- writers), no DELETE policy. Each omission matches a missing grant below:
-- a policy for a command the client holds no privilege on could never be
-- evaluated, and a dead policy that implies RLS is the active gate is worse
-- than no policy at all.

create policy "Participants read conversation messages"
on public.messages for select to authenticated
using (
  exists (
    select 1 from public.conversations c
     where c.id = messages.conversation_id
       and (select auth.uid()) in (c.buyer_id, c.seller_id)
  )
);

-- References to the proposed new row are qualified `messages.*` throughout.
-- Not strictly required here (the subquery is over `conversations`, which has
-- no column of these names, so a bare reference would resolve outward
-- correctly -- the same reason the favorites insert policy gets away with a
-- bare `listing_id`), but written explicitly because the guard clause below
-- used to contain a self-referencing subquery where the collision WAS real,
-- and the qualification is what makes the intent unambiguous either way.
--
-- Precedent for qualifying the new row by table name:
-- 20260916090000_feed_storage_read_access.sql's `storage.objects.name`.
create policy "Participants send messages"
on public.messages for insert to authenticated
with check (
  messages.sender_id = (select auth.uid())
  and exists (
    select 1 from public.conversations c
     where c.id = messages.conversation_id
       and (select auth.uid()) in (c.buyer_id, c.seller_id)
  )
  -- The flood guard and the idempotent-retry escape hatch. Extracted into a
  -- DEFINER function because a policy on messages may not read messages --
  -- see that function's header for the exact error and why.
  and public.message_send_allowed(messages.conversation_id, messages.client_nonce)
);

-- The membership subquery in each policy runs as the CALLER, so
-- conversations' own SELECT policy applies to it too -- the same defence in
-- depth the favorites insert policy relies on.

-- ============================================================
-- Grants
-- ============================================================

-- pg_default_acl grants arwdDxtm to anon and authenticated on every new
-- relation in this schema, so the blanket revokes are what make the grants
-- below load-bearing rather than decorative.
revoke all on public.conversations from anon, authenticated;

-- A column allowlist on SELECT, not merely on writes. The only consumer of
-- this grant is the messages policies' own membership subquery, which
-- references exactly these three columns; everything the UI renders will
-- come from the later DEFINER read RPCs. So the *_last_read_at timestamps
-- never reach the wire -- read receipts are out of scope for v1, and
-- shipping the data while not rendering it is how a feature leaks.
grant select (id, buyer_id, seller_id) on public.conversations to authenticated;

-- No INSERT, UPDATE or DELETE grant of any kind. The RPCs below and the
-- trigger are the only writers.

revoke all on public.messages from anon, authenticated;

grant select on public.messages to authenticated;

-- Column allowlist: id and created_at are absent, so both are
-- server-controlled and a client can neither choose a message's identity nor
-- forge when it was sent. No UPDATE or DELETE grant at all -- messages are
-- append-only for v1, which is also why neither has a policy above.
grant insert (conversation_id, sender_id, body, client_nonce)
  on public.messages to authenticated;

-- ============================================================
-- touch_conversation_last_message
-- ============================================================
-- SECURITY DEFINER IS LOAD-BEARING HERE, not boilerplate.
--
-- A trigger function declared without it runs as SECURITY INVOKER, so
-- current_user is the role that ran the triggering statement -- and every
-- statement inside is privilege-checked against that role. `authenticated`
-- deliberately holds NO update grant on conversations (see above), so the
-- UPDATE below would raise 42501; and because this is an AFTER trigger in
-- the same transaction, THE MESSAGE INSERT WOULD ROLL BACK WITH IT. Sending
-- would be completely broken, not merely degraded.
--
-- public.set_updated_at() is not a counterexample: it only mutates NEW and
-- issues no SQL of its own.
--
-- A trigger, not logic inside a send RPC, because a trigger covers every
-- writer forever and cannot be bypassed -- strictly stronger than a function
-- the client is asked to call.

create or replace function public.touch_conversation_last_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Monotonic by the WHERE clause, not by the SET: when two participants
  -- send at once and the later-stamped message happens to commit first, the
  -- preview must not be dragged backwards.
  update public.conversations c
     set last_message_at = new.created_at,
         last_message_body = left(new.body, 140),
         last_message_sender_id = new.sender_id
   where c.id = new.conversation_id
     and c.last_message_at <= new.created_at;

  -- AFTER trigger: the return value is ignored.
  return null;
end;
$$;

-- All three grantees must be revoked SEPARATELY. pg_default_acl on this
-- database grants EXECUTE on every new public function to PUBLIC, anon,
-- authenticated and service_role, and `revoke ... from public` does NOT
-- remove the direct anon or authenticated grants -- they are distinct
-- grantees, exactly as 20260914160100_listing_rpcs.sql records.
--
-- Unlike every other function here, authenticated gets NO grant back: a
-- trigger function is invoked by the executor, never called by name, so
-- EXECUTE is not required for the trigger to fire -- and leaving the default
-- grant in place would expose a DEFINER function that writes to
-- conversations as a callable PostgREST endpoint. chat.sql asserts the
-- absence of that privilege directly (it caught this exact omission).
revoke all on function public.touch_conversation_last_message() from public;
revoke all on function public.touch_conversation_last_message() from anon;
revoke all on function public.touch_conversation_last_message() from authenticated;

create trigger messages_touch_conversation
after insert on public.messages
for each row
execute function public.touch_conversation_last_message();

-- last_message_at is set from new.created_at rather than now() on purpose:
-- the unread predicate, the keyset cursor, and the message's own created_at
-- must all be the same instant, or a conversation can end up ordered by a
-- timestamp that no message actually carries.

-- ============================================================
-- get_or_create_listing_conversation
-- ============================================================
-- SECURITY DEFINER because the caller holds no INSERT privilege on
-- conversations at all -- the same shape as record_listing_impression and
-- attach_listing_image, each the sole writer of its table.
--
-- The signature accepts NO participant ids. buyer is auth.uid() and seller
-- is read from the listing row, so a caller can neither assert who they are
-- nor choose who they are contacting.
--
-- Returns uuid, NOT the conversations rowtype: the row carries
-- buyer_last_read_at and seller_last_read_at, read receipts are out of scope
-- for v1, and shipping the data while not rendering it is how a feature
-- leaks. The client only needs an id to navigate; the thread header will
-- come from conversation_detail in Phase 2.

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

  -- RESUME FIRST, gate creation second. The status check below must not
  -- apply to a conversation that already exists, or a buyer whose item has
  -- since been marked sold would be locked out of their own history. The
  -- rule is "you may always continue a thread; you may only start one on an
  -- active listing".
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

  -- is distinct from, never <>: a NULL on either side makes <> yield NULL,
  -- the IF is not taken, and the check is silently skipped. v_buyer is
  -- already known non-null here, but the habit is the point -- this is the
  -- guard that stops a seller opening a thread with themselves, and the
  -- table's own conversations_distinct_participants CHECK is the second,
  -- independent reason the same row is refused.
  if v_listing.seller_id is not distinct from v_buyer then
    raise exception 'You cannot message yourself about your own listing'
      using errcode = 'P0001';
  end if;

  if v_listing.status <> 'active' then
    raise exception 'Listing is not available' using errcode = 'P0002';
  end if;

  -- No `for update` lock, and the reason is worth recording. Under READ
  -- COMMITTED a concurrent caller's INSERT blocks on
  -- conversations_listing_buyer_key until the first commits, then yields
  -- zero rows; its NEXT statement takes a fresh snapshot and therefore sees
  -- the committed row. The unique index is the arbiter, so serialising the
  -- listing row would add contention without adding correctness.
  --
  -- The contrast with attach_listing_image is instructive: there the thing
  -- being serialised is max(position) + 1, which no constraint can arbitrate,
  -- so that function genuinely needs its lock.
  insert into public.conversations (listing_id, buyer_id, seller_id)
  values (p_listing_id, v_buyer, v_listing.seller_id)
  on conflict (listing_id, buyer_id) do nothing
  returning id into v_id;

  if v_id is null then
    -- Lost the race: read the winner.
    select c.id into v_id
      from public.conversations c
     where c.listing_id = p_listing_id
       and c.buyer_id = v_buyer;
  end if;

  if v_id is null then
    -- Unreachable under READ COMMITTED, which is all PostgREST exposes. Kept
    -- because returning NULL here would surface in the client as a
    -- navigation to /conversation/undefined, which is a far worse failure
    -- than an explicit error.
    raise exception 'Could not open a conversation' using errcode = 'P0001';
  end if;

  return v_id;
end;
$$;

revoke all    on function public.get_or_create_listing_conversation(uuid) from public;
revoke all    on function public.get_or_create_listing_conversation(uuid) from anon;
grant execute on function public.get_or_create_listing_conversation(uuid) to authenticated;

-- ============================================================
-- mark_conversation_read
-- ============================================================
-- SECURITY DEFINER and the ONLY writer of the read timestamps, which is what
-- makes "a client cannot mark the other participant's side as read"
-- structural: there is no UPDATE grant on conversations for any client.
--
-- p_up_to lets the caller say HOW FAR it has read. With a bare now(), a
-- message that committed at T but has not yet been delivered to the device
-- would be marked read at T+1 -- the user never saw it, and it would be
-- unread-invisible forever. The client passes the created_at of the newest
-- message it actually rendered. The signature still accepts no caller
-- identity.

create or replace function public.mark_conversation_read(
  p_conversation_id uuid,
  p_up_to timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := (select auth.uid());
  v_conversation public.conversations;
  -- Clamped to now() so a client cannot mark the future as read and
  -- permanently zero its own unread count. coalesce BEFORE least, for the
  -- same reason feed_listings coalesces before clamping its limit: an
  -- explicit null from a caller must land on the default, and
  -- least(null, now()) is null.
  v_up_to timestamptz := least(coalesce(p_up_to, now()), now());
begin
  if v_viewer is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_conversation
    from public.conversations c
   where c.id = p_conversation_id;

  if not found then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;

  -- greatest(), so a late call from a backgrounded screen cannot drag the
  -- read point backwards and resurrect already-read messages as unread.
  -- '-infinity' rather than a nullable comparison, so the first call on a
  -- never-read conversation still advances.
  if v_conversation.buyer_id is not distinct from v_viewer then
    update public.conversations
       set buyer_last_read_at =
             greatest(coalesce(buyer_last_read_at, '-infinity'::timestamptz), v_up_to)
     where id = p_conversation_id;
  elsif v_conversation.seller_id is not distinct from v_viewer then
    update public.conversations
       set seller_last_read_at =
             greatest(coalesce(seller_last_read_at, '-infinity'::timestamptz), v_up_to)
     where id = p_conversation_id;
  else
    -- DEFINER bypasses RLS, so this branch is the entire boundary on a
    -- conversation the caller is not part of.
    raise exception 'Not your conversation' using errcode = '42501';
  end if;
end;
$$;

revoke all    on function public.mark_conversation_read(uuid, timestamptz) from public;
revoke all    on function public.mark_conversation_read(uuid, timestamptz) from anon;
grant execute on function public.mark_conversation_read(uuid, timestamptz) to authenticated;
