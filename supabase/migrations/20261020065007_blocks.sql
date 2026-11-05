-- Blocks -- the durable, directed "A blocks B" relationship. ROADMAP 5.2:
-- "Block a user: their listings disappear from my feed/search, and
-- neither side can message the other. Enforced in RLS/RPCs, not just the
-- UI." This migration is the table and its own self-contained rules
-- (RLS, the symmetric helper, the follow-severing side effect); the
-- feed/search/messaging enforcement itself is the next migration,
-- 20261020065008, since it edits several already-existing functions and
-- is easier to review as its own unit.
--
-- ============================================================
-- CASCADE, not SET NULL -- the opposite of `reports`' own choice
-- ============================================================
-- 20261020050442_reports.sql made listing_id/reported_user_id SET NULL
-- specifically because a report is moderation EVIDENCE ("this listing was
-- reported 5 times before it was removed") that must outlive the thing it
-- was filed against. A block row carries no such evidentiary value -- it is
-- pure CURRENT-STATE relationship data, exactly like `follows`
-- (follower_id/followed_id both CASCADE) and `favorites`
-- (user_id/listing_id both CASCADE), not like `reports`. The question a
-- block row answers is only ever "is this edge active right now", never
-- "what happened historically" -- so once either party's account is gone,
-- the edge has nothing left to mean, and keeping a dangling half-row around
-- (a blocker_id or blocked_id pointing at a deleted account) would only
-- cost every future query an extra "is this user still real" check for no
-- benefit. CASCADE is therefore the correct choice here, deliberately
-- different from `reports`, not an oversight of its precedent.
--
-- ============================================================
-- THE central design decision: owner-scoped SELECT, one direction only
-- ============================================================
-- A user can read rows where THEY are the blocker (to manage/unblock their
-- own blocklist, e.g. a future "Blocked users" settings screen). They can
-- NEVER read rows where they are the blocked_id -- confirming "you've been
-- blocked by this specific person" is a real retaliation-risk surface in a
-- marketplace (a blocked seller who can prove it was blocked now has a
-- confirmed grievance target), and every mainstream blocking feature
-- deliberately keeps this ambiguous: the blocked party sees absence (their
-- messages stop landing, that seller's listings stop showing up), never a
-- "you have been blocked" confirmation. This is also why `feed_listings`,
-- `search_listings`, and the messaging RPCs/policy (next migration) all go
-- through the symmetric `private.has_block_between()` boolean helper below
-- for their own "is EITHER direction blocked" filtering need, instead of
-- ever reading `blocks` rows directly -- a SECURITY DEFINER helper that
-- returns only a boolean can safely answer "is there a block between these
-- two people, in either direction" for filtering purposes without ever
-- letting the blocked party learn WHICH direction it was, which a direct
-- row read of their own would immediately reveal.
--
-- This is a deliberately STRONGER privacy shape than `follows`' own
-- "Follows are publicly readable" policy (20261019061403_follows.sql) --
-- follows and blocks look structurally identical (a directed edge between
-- two users) but are opposite in sensitivity: a follow is public social
-- identity a stranger legitimately needs to see (a follower/following
-- list screen), while a block is adversarial and must never be
-- confirmable by the party it targets.
--
-- ============================================================
-- private.has_block_between -- why it lives in `private` and returns only a boolean
-- ============================================================
-- Lives in the `private` schema (established by
-- 20260929090100_chat_message_guard_private_schema.sql for exactly this
-- shape of helper: a SECURITY DEFINER function that exists only to be
-- called from policy expressions, RPCs, and triggers, and must never
-- become an ordinary PostgREST endpoint). `private` is in neither
-- config.toml's `[api] schemas` nor its `extra_search_path`, and
-- `authenticated`/`anon` hold no USAGE on it (see that migration's own
-- header for why that specifically is what makes `private.anything`
-- unresolvable BY NAME to a client, while a policy expression -- which
-- stores the function by OID, not by name -- is unaffected).
--
-- It returns ONLY a boolean, deliberately never which side blocked which
-- or when. If it returned the row, or even just "true because A blocked
-- B" vs "true because B blocked A", it would be a side door around the
-- owner-scoped SELECT policy above: a caller could reconstruct exactly the
-- fact that policy exists to hide. SECURITY DEFINER is load-bearing for the
-- same reason `private.message_send_allowed` needs it: it reads
-- `public.blocks` directly, bypassing the SELECT policy, which is the only
-- way a symmetric "either direction" check can exist at all given that
-- policy's one-direction-only shape.
--
-- `public.is_blocked_with` is the thin, client-callable wrapper the mobile
-- app actually calls (e.g. to hide "Message seller" proactively), and it
-- is SECURITY DEFINER too -- NOT SECURITY INVOKER, despite adding no
-- privilege of its own semantically ("is auth.uid() involved in a block
-- with this other id" is a question about the caller's own relationships,
-- not a lookup of someone else's). This is a MECHANICAL requirement, not
-- a privilege-widening choice: `private` deliberately withholds schema
-- USAGE from `authenticated`/`anon` (20260929090100's own precedent), and
-- schema-qualified name resolution -- "look up `private.has_block_between`
-- in the catalog" -- is checked against the USAGE privilege of whichever
-- role is ACTUALLY EXECUTING the lookup, which for a SECURITY INVOKER
-- function is the real caller. Verified empirically during review: an
-- earlier draft of this migration made this function (and, worse,
-- `feed_listings`/`search_listings` themselves) call
-- `private.has_block_between` directly while staying INVOKER, and it
-- failed for the `authenticated` role with exactly
-- `permission denied for schema private` the moment any of those ran --
-- not a theoretical concern. SECURITY DEFINER switches the executing role
-- to this function's OWNER for the duration of its body, so the internal
-- reference resolves under the owner's privileges instead, which is also
-- exactly why `get_or_create_listing_conversation` (next migration, itself
-- DEFINER already) can call `private.has_block_between` directly with no
-- such wrapper needed -- it already runs as its owner.
--
-- ============================================================
-- Blocking severs a pre-existing mutual follow -- SCOPE ADDED BEYOND ROADMAP 5.2's LITERAL WORDING, flagged for review
-- ============================================================
-- ROADMAP 5.2 only names feed/search suppression and messaging as the
-- enforced behaviors. The follow-severing trigger and the amended
-- `follows` INSERT policy below are both EXTRA, reasoned-necessary scope
-- this migration adds on top of that literal wording -- flagged here
-- explicitly as something worth a second look, not slipped in quietly:
--
--   * Without severing an existing mutual follow, a block would coexist
--     with a stale "A follows B" / "B follows A" edge -- cosmetically
--     wrong (a blocked relationship showing up as a follow in a
--     follower/following list screen) and a minor information leak (the
--     blocked party's follower count would still silently include someone
--     who no longer wants any connection to them).
--   * Without ALSO closing the `follows` INSERT policy, the trigger alone
--     is close to pointless: either party could immediately tap "Follow"
--     again right after being severed, trivially recreating the exact
--     edge the block just removed. The amended policy below is what makes
--     the severing durable rather than a one-time cosmetic cleanup.
--
-- `private.unfollow_on_block` is SECURITY DEFINER because the acting user
-- (whichever of blocker_id/blocked_id actually ran the INSERT) holds no
-- DELETE grant on the OTHER side's follow row -- `follows`' own DELETE
-- policy is owner-scoped to `follower_id = (select auth.uid())`, which a
-- block between A and B does not satisfy for whichever direction isn't the
-- acting user's own row. Bypassing RLS is therefore required to delete
-- both directions (A-follows-B and B-follows-A) from a single trigger
-- firing as whichever of the two actually called INSERT.

create table public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  -- Mirrors `follows_not_self` exactly: `<>` is sufficient and correct
  -- because both columns are NOT NULL, so there is no NULL-silently-skips
  -- trap to guard against with `is distinct from`.
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

-- The PK already indexes (blocker_id, blocked_id) for "does A block B" /
-- "list everyone A has blocked" -- the blocker-side lookup, which is also
-- exactly the shape the SELECT policy below exposes. This covers the other
-- direction, needed by `private.has_block_between`'s `blocker_id = p_b`
-- arm and by the cascade-on-delete path, mirroring
-- `follows_followed_id_idx`'s identical precedent.
create index blocks_blocked_id_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;

-- Owner-scoped, one direction only. See the header note above for why this
-- is the central decision this table makes, and why it is deliberately
-- the OPPOSITE shape from `follows`' public read.
create policy "Users read their own blocklist"
on public.blocks for select to authenticated
using (blocker_id = (select auth.uid()));

create policy "Users block as themselves"
on public.blocks for insert to authenticated
with check (blocker_id = (select auth.uid()));

create policy "Users unblock their own blocks"
on public.blocks for delete to authenticated
using (blocker_id = (select auth.uid()));

-- pg_default_acl grants arwdDxtm to anon and authenticated on every new
-- relation in this schema, so the blanket revoke is what makes the grants
-- below load-bearing rather than decorative.
revoke all on public.blocks from anon, authenticated;

grant select on public.blocks to authenticated;
-- created_at is absent -- server-controlled, mirroring follows.created_at.
grant insert (blocker_id, blocked_id) on public.blocks to authenticated;
grant delete on public.blocks to authenticated;
-- No UPDATE grant: block/unblock only, mirrors follows exactly -- a block
-- is created or deleted, never edited.

-- ============================================================
-- private.has_block_between
-- ============================================================
-- Symmetric, direction-agnostic. See the header note above for why it
-- lives in `private`, why it is SECURITY DEFINER, and why it returns ONLY
-- a boolean.
create or replace function private.has_block_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks b
     where (b.blocker_id = p_a and b.blocked_id = p_b)
        or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;

-- PostgreSQL grants EXECUTE on every new function to PUBLIC by its own
-- built-in default, independently of pg_default_acl (which is scoped to
-- nsp=public and does not reach this schema) -- same discipline
-- `private.message_send_allowed` already established. anon and
-- authenticated are implicitly members of PUBLIC, so revoking PUBLIC
-- removes it from both before re-granting to authenticated specifically.
revoke all on function private.has_block_between(uuid, uuid) from public;
grant execute on function private.has_block_between(uuid, uuid) to authenticated;

-- ============================================================
-- public.is_blocked_with
-- ============================================================
-- Client-callable wrapper for UI purposes (e.g. hiding "Message seller").
-- SECURITY DEFINER here too, same as the helper above -- see the header
-- note's full explanation. NOT because this function needs any extra
-- privilege semantically (it only ever asks about the CALLER's own
-- relationships, auth.uid() is always one side of the pair); DEFINER is
-- required purely so the `private.has_block_between` reference below
-- resolves under THIS function's own owner, not under whichever role is
-- actually calling it -- an earlier INVOKER draft of this exact function
-- failed live with "permission denied for schema private" the moment
-- feed_listings/search_listings (themselves INVOKER) tried to call it as
-- `authenticated`.
create or replace function public.is_blocked_with(p_other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_block_between((select auth.uid()), p_other_user_id);
$$;

revoke all on function public.is_blocked_with(uuid) from public, anon;
grant execute on function public.is_blocked_with(uuid) to authenticated;

-- ============================================================
-- private.unfollow_on_block -- SCOPE ADDED BEYOND ROADMAP 5.2, see header note above
-- ============================================================
create or replace function private.unfollow_on_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.follows f
   where (f.follower_id = new.blocker_id and f.followed_id = new.blocked_id)
      or (f.follower_id = new.blocked_id and f.followed_id = new.blocker_id);
  return null;
end;
$$;

-- No grant to any role: a trigger function is invoked by the executor,
-- never called by name, so EXECUTE is not required for it to fire --
-- mirroring `touch_conversation_last_message`'s identical precedent and
-- its own note on why leaving the default PUBLIC grant in place would
-- expose a DEFINER function that writes to `follows` as a callable
-- endpoint.
revoke all on function private.unfollow_on_block() from public, anon, authenticated;

create trigger blocks_sever_follows
after insert on public.blocks
for each row execute function private.unfollow_on_block();

-- ============================================================
-- follows' INSERT policy, amended -- SCOPE ADDED BEYOND ROADMAP 5.2, see header note above
-- ============================================================
-- Without this, the trigger above is close to pointless: either party
-- could immediately re-follow right after being severed, trivially
-- recreating the exact edge the block just removed. Confirmed against the
-- REAL current policy (20261019061403_follows.sql's "Users follow as
-- themselves", `with check (follower_id = (select auth.uid()))`) before
-- writing this DROP, rather than assuming the plan's guess at its text --
-- it matched.
drop policy "Users follow as themselves" on public.follows;

create policy "Users follow as themselves"
on public.follows for insert to authenticated
with check (
  follower_id = (select auth.uid())
  and not private.has_block_between(follower_id, followed_id)
);
