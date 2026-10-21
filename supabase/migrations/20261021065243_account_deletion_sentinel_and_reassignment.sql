-- ROADMAP 6.1b "Settings: account deletion" -- the higher-risk half of 6.1.
-- 6.1a (Settings screen, sign-out, notification toggles, privacy/terms
-- links, 050d401) already shipped; this is the self-service "delete my
-- account" machinery itself.
--
-- ============================================================
-- THE PROBLEM: `auth.users` CASCADE chains straight through to OTHER
-- PEOPLE'S data
-- ============================================================
-- Confirmed against the real `on delete` clauses across every migration in
-- this directory before writing a single line here (grepped, not assumed):
--
--   public.profiles.id            references auth.users(id)    on delete cascade   (20260829142345)
--   public.listings.seller_id     references public.profiles(id) on delete cascade (20260829142345)
--   public.conversations.buyer_id   references public.profiles(id) on delete cascade (20260929090000)
--   public.conversations.seller_id  references public.profiles(id) on delete cascade (20260929090000)
--   public.messages.sender_id     references public.profiles(id) on delete cascade (20260929090000)
--
-- Chained together: deleting a row from `auth.users` cascades to `profiles`,
-- which cascades to every `listings` row that user ever sold (including
-- completed, historical `sold` sales -- `remove_listing`'s own "sold is
-- permanent history" principle would be silently violated by a plain
-- cascade) and to every `conversations` row that user was ever a participant
-- in as EITHER buyer or seller -- which in turn cascades to EVERY message in
-- that conversation, including every message the OTHER, innocent participant
-- sent. A user deleting their own account would therefore delete strangers'
-- chat history and a seller's own historical sales record as a side effect
-- of a request that is only supposed to affect the requester. That is
-- someone else's data being destroyed by this user's own deletion request,
-- which is unacceptable regardless of how rarely account deletion is used.
--
-- ============================================================
-- What is DELIBERATELY left untouched, and why
-- ============================================================
-- * `reviews.listing_id` / `reviewer_id` / `reviewee_id` all `on delete
--   cascade` (20261020113819) -- confirmed, already deliberate: that
--   migration's own header says verbatim "a review about 'nobody,' 'from
--   nobody,' or 'about no listing' isn't meaningful... CASCADE is the only
--   choice that keeps every surviving row meaningful." Not revisited here.
-- * `reports.reporter_id` `on delete cascade` (20261020050442) -- confirmed,
--   already a documented, accepted 5.1 trade-off ("losing attribution when
--   the reporter's own account goes away is fine"). `listing_id` and
--   `reported_user_id` on that same table are already `on delete set null`
--   (moderation evidence must outlive its target) and are equally untouched.
-- * `listings.sold_to_user_id` is already `on delete set null`
--   (20261020073200, its own deliberate choice: a past sale is the SELLER's
--   permanent record and must survive the BUYER's account vanishing, only
--   forgetting who specifically). This migration's reassignment trigger
--   below does NOT touch this column -- it is left to keep behaving exactly
--   as 5.3 designed it, nulling out on the buyer's own cascade.
-- * `favorites` / `listing_events` / `follows` / `blocks` /
--   `ai_suggestion_calls` all cascade straight from `auth.users` and are
--   each already-documented, deliberate "pure current-state relationship
--   data with no evidentiary value" cascades (see their own migrations).
--   None of them point at data a SECOND, uninvolved party owns, so none of
--   them are in scope here either.
--
-- ============================================================
-- THE FIX: a sentinel "deleted user" + a BEFORE DELETE reassignment trigger
-- ============================================================
-- Deliberately NOT a change to any FK's `on delete` clause -- that would
-- affect every ordinary INSERT's referential-integrity story too, not just
-- the deletion path, and would still leave the four columns above pointing
-- at a vanished id (as NULL, if changed to SET NULL) which is wrong for
-- different reasons on each: a listing with no seller is not renderable, and
-- a conversation/message with no sender is not renderable either (same
-- "nothing left to render" problem 20261020113819 raised against SET NULL
-- for reviews).
--
-- Instead: one reserved, permanent sentinel profile
-- (00000000-0000-0000-0000-000000000001) exists from this migration onward.
-- A `BEFORE DELETE` trigger on `public.profiles` reassigns the departing
-- row's id to the sentinel's id in EXACTLY the four columns named above,
-- before Postgres's own CASCADE machinery ever evaluates what to do with
-- rows still pointing at the departing id. By the time CASCADE runs
-- (immediately after this BEFORE trigger returns), nothing in those four
-- columns references the departing id any more, so CASCADE finds nothing to
-- remove through them -- the listing/conversation/message rows survive,
-- now attributed to "Deleted user".
--
-- `public`, not `private`: mirrors `touch_conversation_last_message`'s own
-- precedent exactly (20260929090000) -- a trigger function is invoked by the
-- executor, never called by name, so it needs no PostgREST-reachability
-- protection the way `private.has_block_between`-style helpers do. It is
-- still EXECUTE-revoked from every role below, for the same reason that
-- trigger's own comment gives: leaving the default grant in place would
-- expose a SECURITY DEFINER function that writes to listings/conversations/
-- messages as a callable `POST /rest/v1/rpc/...` endpoint.
--
-- ============================================================
-- Two STRUCTURAL collisions this design would otherwise hit, found by
-- reasoning through what happens once MULTIPLE different departing users
-- all get reassigned to the SAME sentinel id -- SCOPE ADDED BEYOND THE
-- LITERAL TASK DESCRIPTION, flagged here explicitly rather than discovered
-- later as a production incident:
-- ============================================================
--
-- (1) `conversations_distinct_participants check (buyer_id <> seller_id)`.
-- Consider a conversation between real users A (buyer) and B (seller). A
-- deletes their account first: `buyer_id` becomes the sentinel. Later B
-- deletes theirs too: the trigger tries to set `seller_id` to the SAME
-- sentinel id on the SAME row, which now reads `buyer_id = seller_id =
-- sentinel` -- exactly what this CHECK exists to forbid, and the UPDATE
-- would raise 23514, aborting B's entire account deletion. Within a single
-- trigger firing this can never happen (one DELETE reassigns at most one of
-- the two columns on any given row, since the existing CHECK already
-- guarantees the departing id cannot equal both before this trigger ever
-- runs) -- the collision only appears across two SEPARATE deletions,
-- arbitrarily far apart in time, which is exactly the kind of case easy to
-- miss testing a single deletion in isolation. Fixed below by relaxing the
-- CHECK to tolerate the one specific case this design can legitimately
-- produce: both columns equal to the sentinel. This is the same shape
-- 20261020050442's own `reports_at_most_one_target` loosening from `= 1` to
-- `<= 1` already established in this codebase -- a CHECK loosened to admit
-- a legitimate post-cascade/post-reassignment state two independent writes
-- can produce, never to admit a client-reachable bad state (a REAL buyer and
-- a REAL seller can still never be the same person on one row).
--
-- (2) `conversations_listing_buyer_key unique (listing_id, buyer_id)`. Two
-- DIFFERENT real buyers, C and D, each separately message the same seller
-- about the same listing -- two ordinary, unremarkable conversation rows,
-- `(listing_id, buyer_id=C)` and `(listing_id, buyer_id=D)`. If BOTH C and D
-- later delete their accounts (independently, no coordination needed), both
-- rows' `buyer_id` becomes the sentinel, and the second reassignment
-- collides with the first on this exact unique index -- 23505, aborting
-- whichever of C/D deletes second. Unlike (1), this is not a rare multi-step
-- sequence requiring a prior reassignment on the SAME row -- it only needs
-- two unrelated buyers who separately, ordinarily contacted the same
-- seller about the same item, which is a completely normal shape for a
-- popular listing. Fixed below by making the unique index PARTIAL --
-- excluding rows whose `buyer_id` is the sentinel from the uniqueness
-- check -- mirroring `reports_unique_reporter_listing`'s own partial-index
-- precedent (`where listing_id is not null`) for the identical reason: the
-- invariant ("one conversation per real buyer per listing") still holds for
-- every real buyer; only the sentinel, which is never actually a
-- participant in any real conversation, is exempted. This requires
-- `get_or_create_listing_conversation`'s own `on conflict (listing_id,
-- buyer_id)` clause to be widened with a matching `where` predicate --
-- Postgres only infers a partial unique index as an ON CONFLICT arbiter when
-- the clause's own predicate matches the index's exactly -- recreated below,
-- unchanged apart from that one clause, since "never edit an already-applied
-- migration" means this has to be a fresh `create or replace function`, not
-- an edit to 20260929090000's own file. The predicate is always true for
-- every REAL caller (the sentinel is not authenticatable and therefore never
-- calls this RPC as itself), so no legitimate caller's behavior changes.
--
-- A third, lower-probability sibling of (2) was considered and fixed
-- defensively for the same reason, at near-zero cost: `messages_conversation
-- _sender_nonce_key unique (conversation_id, sender_id, client_nonce)`. Two
-- different original senders in the same conversation could in principle
-- have generated the identical `client_nonce` text (it is sender-chosen
-- free-form text 8-64 characters, not a guaranteed-random UUID -- see that
-- column's own migration comment) -- astronomically unlikely in practice
-- given real nonce entropy, but structurally the same shape as (2), and
-- nothing else references this index in an ON CONFLICT clause, so making it
-- partial (excluding the sentinel) costs nothing and closes the same class
-- of latent reassignment-time failure.

-- ============================================================
-- 1. The sentinel account
-- ============================================================
-- A fixed, well-known, permanently-reserved uuid -- never a value any real
-- signup could ever be assigned (auth.users ids are server-generated random
-- UUIDv4s; this is a hand-picked, structurally impossible-to-collide
-- constant, same category of reserved id as the seeded category uuids in
-- 20261018100200_categories.sql).
--
-- Column list is DELIBERATELY WIDER than the shape every pgTAP fixture in
-- this repo uses for a direct `auth.users` insert (reports.sql/blocks.sql/
-- reviews.sql's own fixtures). Those are fine leaving `confirmation_token`/
-- `recovery_token`/`email_change_token_new` NULL (no column default --
-- confirmed via information_schema -- so omitting them leaves them NULL,
-- unlike the several other nullable token columns that DO have a `''`
-- default and so are fine to omit) because those rows live only inside a
-- rolled-back pgTAP transaction that never calls the Admin API against
-- them. This row is PERMANENT, and `supabase.auth.admin.listUsers()` /
-- `getUserById()` scan the ENTIRE table on every call -- verified live
-- against a real local stack that leaving those three columns NULL (as an
-- earlier version of this migration did) makes BOTH calls fail outright
-- with `500 unexpected_failure`, project-wide, forever, for every user, not
-- just the sentinel (`sql: Scan error on column index 3, name
-- "confirmation_token": converting NULL to string is unsupported` in the
-- GoTrue log) -- including breaking Supabase Studio's own Authentication ->
-- Users page. A real signup's application code (not a DB default) writes
-- `''` into these three; explicitly matching that here is what a raw SQL
-- insert has to do instead.
--
-- `encrypted_password` is deliberately NOT a real bcrypt hash. A real hash
-- would be an unused credential sitting in the database for no reason; this
-- value cannot even be PARSED as bcrypt (`$2a$`/`$2b$`/... prefix format).
-- Verified live, end to end, with the fix above in place: a lookup by id or
-- by listing no longer 500s, GoTrue's own user-lookup step now succeeds
-- same as for any real user, and a login attempt against this email
-- proceeds to the actual password check -- which then fails deterministically
-- on the unparseable hash, the intended mechanism, rather than never
-- reaching password verification at all (which is what the 500 above was
-- actually masking before this fix).
--
-- ============================================================
-- CRITICAL, caught by ROADMAP 6.4's full-schema security audit: `email_
-- confirmed_at` must be set at creation, not left NULL
-- ============================================================
-- This repo's local Auth config runs with `enable_confirmations = false`
-- (supabase/config.toml), which also governs how GoTrue treats a plain
-- `POST /auth/v1/signup` call against an email that already exists but has
-- never been confirmed: it does NOT reject it -- it treats the row as "an
-- abandoned signup, let this complete it," silently accepting a brand-new
-- attacker-supplied password and handing back a FULLY VALID, FULLY
-- AUTHENTICATED SESSION for that user id. No knowledge of the bogus
-- `encrypted_password` above is needed at all -- this path never checks it.
-- Verified live, end to end, against this exact row before this fix: an
-- anonymous `POST /auth/v1/signup` with this email and an arbitrary
-- password returned HTTP 200 with a real access token whose `sub` was this
-- sentinel's id. Because this id is the permanent reassignment target of
-- EVERY account deletion's `listings`/`conversations`/`messages` rows
-- (forever, across the whole lifetime of this product), that session would
-- let an attacker read every conversation any deleted user was ever part
-- of (via the ordinary "participants read own conversations" RLS, now
-- satisfied), send new messages into those threads as "Deleted user," and
-- take ownership of every reassigned listing -- turning the exact
-- protection this migration exists to provide into the privacy breach
-- itself.
--
-- The fix: `email_confirmed_at` set to a real, non-null timestamp AT
-- CREATION, not left to default NULL the way an unconfirmed real signup's
-- row would read. Verified live: with this column populated, the identical
-- signup call against this email now correctly returns `422
-- user_already_exists` instead of a session -- GoTrue's signup-merge
-- behavior above is specifically scoped to NULL (never-confirmed) rows,
-- and an already-confirmed existing email hits its ordinary "already
-- registered" rejection instead, the same as any real user's email would.
-- `confirmed_at` is a generated column derived from this one -- nothing
-- else to set.
--
-- Residual, accepted: `POST /auth/v1/recover` against this email still
-- returns 200 (GoTrue's deliberate anti-enumeration behavior -- it always
-- does, for any email) and does generate a real `recovery_token` row.
-- Unlike the signup path above, this requires the attacker to actually
-- RECEIVE that token via email to do anything with it -- and this email's
-- domain, `fynd.invalid`, is the IANA-reserved `.invalid` TLD (RFC 2606),
-- structurally guaranteed to never resolve to a real mail exchanger in any
-- real deployment, so no such email can ever actually be delivered outside
-- a local dev stack's own mail-capture tooling. Not hardened further here;
-- revisit only if this project ever points its Auth config at a real SMTP
-- provider that could somehow still accept mail for an unresolvable domain.
--
-- `on conflict (id) do nothing` makes the whole block safe to re-run (this
-- migration is applied once per environment but the insert should never
-- error if it somehow runs twice).
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, confirmation_token, recovery_token, email_change_token_new
)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'deleted-user@fynd.invalid',
  '$SENTINEL$NOT-A-REAL-HASH$NEVER-AUTHENTICATES$',
  now(),
  now(),
  now(),
  '',
  '',
  ''
)
on conflict (id) do nothing;

-- `handle_new_user` (20260829142345's `after insert on auth.users` trigger)
-- fires on the insert above exactly like it would for any real signup and
-- creates `public.profiles (id)` with every other column NULL -- so the
-- anonymization below is a plain UPDATE, not a second INSERT path to keep in
-- sync with that trigger's own column list. On a re-run where the insert
-- above did nothing (conflict), this UPDATE still runs and is itself a
-- harmless no-op against already-anonymized values.
update public.profiles
   set display_name = 'Deleted user',
       username = null,
       bio = null,
       avatar_path = null
 where id = '00000000-0000-0000-0000-000000000001';

-- ============================================================
-- 2. Structural fix (1) -- conversations_distinct_participants, relaxed
-- ============================================================
-- See the header note above. `<>`, widened with a single named-literal
-- exception, not loosened generically -- a REAL buyer and a REAL seller can
-- still never be the same person on one row; only the one legitimate
-- post-reassignment state (both columns independently reassigned to the
-- sentinel, by two unrelated deletions, possibly years apart) is admitted.
alter table public.conversations
  drop constraint conversations_distinct_participants;

alter table public.conversations
  add constraint conversations_distinct_participants
    check (
      buyer_id <> seller_id
      or buyer_id = '00000000-0000-0000-0000-000000000001'
    );

-- ============================================================
-- 3. Structural fix (2) -- conversations_listing_buyer_key, made partial
-- ============================================================
-- Was a plain `unique (listing_id, buyer_id)` table constraint
-- (20260929090000). A table-level UNIQUE constraint cannot carry a WHERE
-- clause -- only a standalone unique INDEX can -- so this has to be dropped
-- and recreated as an index, not altered in place.
alter table public.conversations
  drop constraint conversations_listing_buyer_key;

create unique index conversations_listing_buyer_key
  on public.conversations (listing_id, buyer_id)
  where buyer_id <> '00000000-0000-0000-0000-000000000001';

-- get_or_create_listing_conversation, recreated UNCHANGED apart from the
-- on conflict clause's new `where` predicate, which must match the partial
-- index above exactly for Postgres to infer it as the arbiter. Every other
-- line is copied verbatim from the REAL current body -- confirmed by
-- reading it, not the original 20260929090000 version: 20261020065008
-- already widened this same function with the `private.has_block_between`
-- check below, which must be preserved here too, or this migration would
-- silently regress 5.2's block enforcement back out of this function.
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

  -- ROADMAP 5.2 (20261020065008): a NEW conversation cannot be started
  -- while either side has blocked the other. Copied verbatim from that
  -- migration's own widening of this function.
  if private.has_block_between(v_buyer, v_listing.seller_id) then
    raise exception 'You cannot message this user' using errcode = '42501';
  end if;

  -- `where` predicate added to match conversations_listing_buyer_key's new
  -- partial shape (see this migration's header, fix (2)). Always true for
  -- every real caller -- v_buyer is auth.uid(), and the sentinel is not
  -- authenticatable, so it can never reach this RPC as itself.
  insert into public.conversations (listing_id, buyer_id, seller_id)
  values (p_listing_id, v_buyer, v_listing.seller_id)
  on conflict (listing_id, buyer_id) where buyer_id <> '00000000-0000-0000-0000-000000000001' do nothing
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

revoke all    on function public.get_or_create_listing_conversation(uuid) from public;
revoke all    on function public.get_or_create_listing_conversation(uuid) from anon;
grant execute on function public.get_or_create_listing_conversation(uuid) to authenticated;

-- ============================================================
-- 4. Structural fix (3), defensive -- messages_conversation_sender_nonce_key, made partial
-- ============================================================
-- Already a standalone unique INDEX (not a table constraint), so this is a
-- straight drop/recreate with no RPC to update -- nothing anywhere issues an
-- `on conflict` against this index.
drop index public.messages_conversation_sender_nonce_key;

create unique index messages_conversation_sender_nonce_key
  on public.messages (conversation_id, sender_id, client_nonce)
  where sender_id <> '00000000-0000-0000-0000-000000000001';

-- ============================================================
-- 5. The reassignment trigger
-- ============================================================
-- SECURITY DEFINER is load-bearing here for the exact reason
-- `touch_conversation_last_message` needs it (20260929090000's own header):
-- a BEFORE DELETE trigger declared SECURITY INVOKER runs as whichever role
-- fired the deleting statement, and `authenticated` holds no UPDATE grant on
-- `listings`/`conversations`/`messages` outside their own narrow RPCs --
-- these three UPDATEs would raise 42501, and because this is a BEFORE
-- trigger IN THE SAME STATEMENT, the entire DELETE (and therefore the whole
-- account deletion) would abort with it.
--
-- `BEFORE DELETE`, not `AFTER`: the reassignment must land before Postgres
-- evaluates CASCADE for this row's own outgoing FK (profiles.id references
-- auth.users(id) on delete cascade is what fires this trigger's OWN delete
-- in the first place, via the auth.users deletion -- CASCADE from auth.users
-- to profiles happens first, which is what invokes this trigger; CASCADE
-- FROM profiles to listings/conversations/messages happens immediately
-- after this trigger returns, which is the step this trigger exists to
-- starve of anything left to cascade through).
create or replace function public.reassign_departing_user_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sentinel constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  -- Defensive, not load-bearing: nothing in this schema ever deletes the
  -- sentinel's own auth.users row (it is not a real user's account, and no
  -- UI path reaches it), so this branch should be unreachable in practice.
  -- If it is ever hit anyway, skip the reassignment entirely rather than
  -- reassigning the sentinel's own rows to itself -- a no-op that would
  -- otherwise look like a real update to the audit/trigger log for no
  -- reason, and would be wrong the moment the sentinel is ever deleted for
  -- real (there would be nothing left to reassign TO).
  if old.id = v_sentinel then
    return old;
  end if;

  update public.listings
     set seller_id = v_sentinel
   where seller_id = old.id;

  update public.conversations
     set buyer_id = v_sentinel
   where buyer_id = old.id;

  update public.conversations
     set seller_id = v_sentinel
   where seller_id = old.id;

  update public.messages
     set sender_id = v_sentinel
   where sender_id = old.id;

  -- BEFORE DELETE: returning anything other than NULL lets the delete
  -- proceed. Returning `old` (rather than NULL) is the documented
  -- convention for "proceed unmodified" on a row-level BEFORE trigger.
  return old;
end;
$$;

-- No grant to any role -- mirrors touch_conversation_last_message's own
-- precedent and reasoning exactly: a trigger function is invoked by the
-- executor, never called by name, so EXECUTE is never required for it to
-- fire, and leaving the default PUBLIC grant in place would expose a
-- SECURITY DEFINER function that writes to listings/conversations/messages
-- as a callable `POST /rest/v1/rpc/reassign_departing_user_rows` endpoint.
revoke all on function public.reassign_departing_user_rows() from public;
revoke all on function public.reassign_departing_user_rows() from anon;
revoke all on function public.reassign_departing_user_rows() from authenticated;

create trigger profiles_reassign_before_delete
before delete on public.profiles
for each row
execute function public.reassign_departing_user_rows();
