-- Moves the message send guard out of the exposed API surface.
--
-- 20260929090000 put message_send_allowed in `public` because that is where
-- everything else lives. The consequence was not intended: PostgREST exposes
-- every function in the schemas listed in config.toml's
-- `[api] schemas = ["public", "graphql_public"]`, so a SECURITY DEFINER
-- helper that the messages INSERT policy needs `authenticated` to EXECUTE
-- was simultaneously reachable as an ordinary RPC endpoint
-- (POST /rest/v1/rpc/message_send_allowed).
--
-- That is a probing side-channel independent of the policy's own membership
-- predicate: a caller could ask "am I rate-limited in conversation X" or
-- "does nonce N already exist for me in conversation X" for ANY conversation
-- id, including ones they are not a participant of. It leaks little -- both
-- answers are degenerate for a thread you are not in -- but it is a surface
-- with no reason to exist, and the only thing keeping it narrow was the
-- function's own auth.uid() derivation rather than any boundary.
--
-- The fix is placement, not logic: the body is unchanged apart from being
-- re-qualified. A schema outside `[api] schemas` has no PostgREST route at
-- all, while a policy expression -- which is evaluated inside the database,
-- against a function referenced by OID in the stored parse tree -- is
-- entirely unaffected.
--
-- Deliberately NOT done here: replacing the direct message INSERT with a
-- send RPC. The approved architecture is direct INSERT constrained by RLS,
-- column grants, CHECK constraints and a trigger; this migration preserves
-- that exactly.

-- ============================================================
-- private schema
-- ============================================================
-- Not in config.toml's `[api] schemas`, and not in its
-- `extra_search_path = ["public", "extensions"]` either -- so nothing here
-- is routable, and nothing here is resolvable by an unqualified name in a
-- PostgREST request.
--
-- The first schema in this project other than `public`, so it establishes
-- the convention: `private` holds objects that exist ONLY to be called from
-- inside the database (policy expressions, triggers, other functions) and
-- must never become an endpoint.

create schema if not exists private;

-- PostgreSQL 15+ grants no privileges on a newly created schema to PUBLIC,
-- so this is belt and braces rather than a correction. Stated explicitly
-- because the whole point of this schema is that its contents are
-- unreachable, and that property should be visible in the migration rather
-- than inherited from a version-dependent default.
revoke all on schema private from public;

-- NOTE: `authenticated` is deliberately NOT granted USAGE on this schema.
-- A policy expression stores the function by OID in its parse tree, so
-- evaluating it requires EXECUTE on the function but no name lookup, and
-- therefore no schema USAGE. Withholding USAGE means `authenticated` cannot
-- resolve `private.anything` by name at all -- asserted in chat.sql, because
-- this is exactly the kind of privilege assumption that should be measured
-- rather than believed.

-- ============================================================
-- private.message_send_allowed
-- ============================================================
-- Body carried over verbatim from 20260929090000 apart from the schema
-- qualification. Still SECURITY DEFINER, still STABLE, still
-- `set search_path = ''` with every object fully qualified, and still
-- accepting NO sender parameter -- the sender is auth.uid(), so a caller
-- cannot ask about anyone else's rate state.
--
-- SECURITY DEFINER remains load-bearing for a second reason beyond privilege:
-- PostgreSQL will not allow a policy on public.messages to contain a
-- subquery that reads public.messages --
--
--     ERROR: infinite recursion detected in policy for relation "messages"
--
-- -- so bypassing RLS here is what makes the guard expressible in the policy
-- at all, rather than forcing the send path into an RPC.

create or replace function private.message_send_allowed(
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
    -- recipient.
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

-- PostgreSQL grants EXECUTE on every new function to PUBLIC by its own
-- built-in default (independently of the pg_default_acl entries, which are
-- scoped to nsp=public and therefore do not reach this schema). anon and
-- authenticated are implicitly members of PUBLIC, so revoking PUBLIC is what
-- removes it from both.
revoke all on function private.message_send_allowed(uuid, text) from public;

-- The one privilege strictly required for policy evaluation, and nothing
-- else. A policy expression is evaluated as the CALLER, so EXECUTE is
-- checked at runtime -- unlike the trigger function in the previous
-- migration, which the executor invokes and which therefore needs no grant.
grant execute on function private.message_send_allowed(uuid, text) to authenticated;

-- ============================================================
-- Repoint the policy, then retire the public helper
-- ============================================================
-- In this order because the policy depends on the function: dropping the
-- public function first would either fail or require a CASCADE that silently
-- took the policy with it, leaving messages with no INSERT policy at all --
-- which, with RLS enabled, would deny every send rather than fail loudly.

drop policy "Participants send messages" on public.messages;

create policy "Participants send messages"
on public.messages for insert to authenticated
with check (
  messages.sender_id = (select auth.uid())
  and exists (
    select 1 from public.conversations c
     where c.id = messages.conversation_id
       and (select auth.uid()) in (c.buyer_id, c.seller_id)
  )
  -- Fully qualified, and no longer reachable as an endpoint.
  and private.message_send_allowed(messages.conversation_id, messages.client_nonce)
);

drop function public.message_send_allowed(uuid, text);
