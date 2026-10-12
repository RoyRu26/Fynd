-- pgTAP tests for conversations and messages (Chat v1, Phase 1).
--
-- Run with: pnpm exec supabase test db --local
--
-- Same conventions as the other suites: 4-arg throws_ok(sql, sqlstate,
-- null, description) -- the 3-arg form's third argument is the expected
-- MESSAGE, not a description -- and SQLSTATE assertions only, never message
-- text. An RLS USING denial matches zero rows silently rather than raising,
-- so those cases are asserted by row survival / counts, checked under
-- `reset role` where the denied caller could not see the answer themselves.
-- An INSERT denied by WITH CHECK does raise 42501, so throws_ok is correct
-- there.
--
-- Two suite-specific notes:
--
--   * now() is the TRANSACTION start time and is therefore constant for this
--     whole file. That is what makes the flood-guard assertions
--     deterministic (all 30 saturating rows fall in the same one-minute
--     window), and it is why the out-of-order trigger test and the read
--     monotonicity tests pass EXPLICIT timestamps instead of relying on
--     successive defaults, which would all be identical.
--
--   * conversations carries only a COLUMN-level select grant
--     (id, buyer_id, seller_id), so a client cannot read listing_id or the
--     last_message_*/*_last_read_at columns at all -- the UI gets those from
--     the Phase 2 DEFINER read RPCs. Tests therefore resolve conversation
--     ids through the chat_conv lookup below (populated as the connecting
--     superuser) rather than filtering by listing_id in a client session,
--     and every assertion about a non-granted column runs under `reset role`.
create extension if not exists pgtap with schema extensions;

begin;

select plan(134);

-- ============================================================
-- FIXTURES
-- ============================================================
-- S is the seller, B the buyer, C an uninvolved third party -- so "only the
-- two participants" is tested from the outside rather than assumed.
-- Suite UUID namespace is f5… (f1 profiles, f2 listings, f3 feed,
-- f4 favorites), so this file can never collide with another suite.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('f5000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-chat-a@test.dev', 'x', now(), now()),
  ('f5000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-chat-b@test.dev', 'x', now(), now()),
  ('f5000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-chat-c@test.dev', 'x', now(), now());

insert into public.listings
  (id, seller_id, title, description, price_amount, condition, size, status)
values
  ('aaaa5000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-00000000000a',
   'Chat active one', 'CHAT_ACT_1', 1000, 'good', 'alpha_m', 'active'),
  ('aaaa5000-0000-0000-0000-000000000002', 'f5000000-0000-0000-0000-00000000000a',
   'Chat active two', 'CHAT_ACT_2', 2000, 'good', 'eu_shoe_42', 'active'),
  ('aaaa5000-0000-0000-0000-000000000003', 'f5000000-0000-0000-0000-00000000000a',
   'Chat draft', 'CHAT_DRAFT', 3000, 'good', null, 'draft'),
  ('aaaa5000-0000-0000-0000-000000000004', 'f5000000-0000-0000-0000-00000000000a',
   'Chat will sell', 'CHAT_SOLD', 4000, 'good', 'alpha_l', 'active');

-- Act as B (the buyer) from here.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000b","role":"authenticated"}';

-- ============================================================
-- 1. get_or_create_listing_conversation
-- ============================================================

select isnt(
  (select public.get_or_create_listing_conversation('aaaa5000-0000-0000-0000-000000000001')),
  null,
  'a buyer can open a conversation on an active listing'
);

-- Resume, not duplicate -- the whole point of the function. The unique index
-- is what makes it race-safe without a row lock.
select is(
  (select public.get_or_create_listing_conversation('aaaa5000-0000-0000-0000-000000000001')),
  (select public.get_or_create_listing_conversation('aaaa5000-0000-0000-0000-000000000001')),
  'calling it again returns the SAME conversation rather than creating a second'
);

select throws_ok(
  $$select public.get_or_create_listing_conversation('aaaa5000-0000-0000-0000-00000000dead')$$,
  'P0002', null,
  'a listing id that does not exist is refused'
);

select throws_ok(
  $$select public.get_or_create_listing_conversation('aaaa5000-0000-0000-0000-000000000003')$$,
  'P0002', null,
  'a DRAFT listing cannot be contacted -- it is not available'
);

-- Open the second conversation now, so the flood-guard section later has a
-- dedicated thread to saturate without poisoning anything else.
select isnt(
  (select public.get_or_create_listing_conversation('aaaa5000-0000-0000-0000-000000000004')),
  null,
  'a second conversation opens on another active listing'
);

reset role;

select is(
  (select count(*)::int from public.conversations
    where listing_id = 'aaaa5000-0000-0000-0000-000000000001'),
  1,
  'exactly one conversation row exists after two calls for the same listing'
);

-- Both participants are derived server-side: buyer from auth.uid(), seller
-- from the listing row. Neither is supplied by the caller.
select is(
  (select c.buyer_id from public.conversations c
    where c.listing_id = 'aaaa5000-0000-0000-0000-000000000001'),
  'f5000000-0000-0000-0000-00000000000b'::uuid,
  'buyer_id is derived from auth.uid(), not from the caller'
);

select is(
  (select c.seller_id from public.conversations c
    where c.listing_id = 'aaaa5000-0000-0000-0000-000000000001'),
  'f5000000-0000-0000-0000-00000000000a'::uuid,
  'seller_id is derived from the listing row, not from the caller'
);

-- Conversation-id lookup for the client sessions below. Needed because
-- listing_id is deliberately outside the client's column allowlist, so a
-- client session cannot find a conversation by the listing it belongs to.
create temp table chat_conv as
select
  (select c.id from public.conversations c
    where c.listing_id = 'aaaa5000-0000-0000-0000-000000000001') as conv1,
  (select c.id from public.conversations c
    where c.listing_id = 'aaaa5000-0000-0000-0000-000000000004') as conv4;

grant select on chat_conv to authenticated;

-- ============================================================
-- 2. A seller cannot contact themselves
-- ============================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select throws_ok(
  $$select public.get_or_create_listing_conversation('aaaa5000-0000-0000-0000-000000000002')$$,
  'P0001', null,
  'a seller cannot open a conversation with themselves about their own listing'
);

-- ============================================================
-- 3. Resume survives the listing leaving 'active'
-- ============================================================
-- The status gate applies to CREATION only. A buyer whose item has since
-- sold must never be locked out of their own history -- that thread is the
-- one they most need ("I bought this, where do we meet?").

reset role;
update public.listings set status = 'sold'
 where id = 'aaaa5000-0000-0000-0000-000000000004';

set local role authenticated;
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select is(
  (select public.get_or_create_listing_conversation('aaaa5000-0000-0000-0000-000000000004')),
  (select conv4 from chat_conv),
  'an existing conversation is still returned after the listing is marked sold'
);

-- But a DIFFERENT buyer cannot START one on the now-sold listing.
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select throws_ok(
  $$select public.get_or_create_listing_conversation('aaaa5000-0000-0000-0000-000000000004')$$,
  'P0002', null,
  'a NEW conversation cannot be STARTED on a sold listing -- only resumed'
);

-- ============================================================
-- 4. conversations: constraints, and what clients may not do
-- ============================================================

reset role;

select throws_ok(
  $$insert into public.conversations (listing_id, buyer_id, seller_id)
    values ('aaaa5000-0000-0000-0000-000000000002',
            'f5000000-0000-0000-0000-00000000000a',
            'f5000000-0000-0000-0000-00000000000a')$$,
  '23514', null,
  'buyer_id = seller_id is refused by the table itself, independently of the RPC'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000b","role":"authenticated"}';

-- The RPC is the sole writer. No INSERT/UPDATE/DELETE grant exists, which is
-- also why none of those commands has a policy -- a dead policy that implies
-- RLS is the active gate is worse than no policy at all.
select throws_ok(
  $$insert into public.conversations (listing_id, buyer_id, seller_id)
    values ('aaaa5000-0000-0000-0000-000000000002',
            'f5000000-0000-0000-0000-00000000000b',
            'f5000000-0000-0000-0000-00000000000a')$$,
  '42501', null,
  'a client cannot INSERT a conversation directly -- the RPC is the only writer'
);

select throws_ok(
  $$update public.conversations set seller_id = seller_id where true$$,
  '42501', null,
  'a client cannot UPDATE a conversation -- not even its own'
);

select throws_ok(
  $$delete from public.conversations where true$$,
  '42501', null,
  'a client cannot DELETE a conversation'
);

-- The read-receipt timestamps and the preview are outside the SELECT column
-- allowlist, so they can never reach the wire. Read receipts are out of
-- scope for v1, and shipping data while not rendering it is how a feature
-- leaks; the inbox gets its preview from a DEFINER RPC instead.
select throws_ok(
  $$select buyer_last_read_at from public.conversations$$,
  '42501', null,
  'buyer_last_read_at is not readable by a client -- outside the column allowlist'
);

select throws_ok(
  $$select seller_last_read_at from public.conversations$$,
  '42501', null,
  'seller_last_read_at is likewise not readable by a client'
);

select throws_ok(
  $$select last_message_body from public.conversations$$,
  '42501', null,
  'last_message_body is not readable directly -- the inbox RPC projects it instead'
);

-- B participates in both conversations (listings 1 and 4).
select is(
  (select count(*)::int from public.conversations),
  2,
  'a participant sees exactly their own conversations'
);

set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select is(
  (select count(*)::int from public.conversations),
  0,
  'an uninvolved third party sees no conversations at all'
);

-- ============================================================
-- 5. messages: sending
-- ============================================================

set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000b","role":"authenticated"}';

-- THIS is the assertion that proves the column-scoped
-- `grant select (id, buyer_id, seller_id) on conversations` does not break
-- the insert policy's own membership subquery. If column privileges were
-- enforced differently for policy-internal references, this fails first.
select lives_ok(
  $$insert into public.messages (conversation_id, sender_id, body, client_nonce)
    values ((select conv1 from chat_conv),
            'f5000000-0000-0000-0000-00000000000b', 'Is this still available?', 'nonce-b-0001')$$,
  'the buyer can send a message into their own conversation'
);

set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select lives_ok(
  $$insert into public.messages (conversation_id, sender_id, body, client_nonce)
    values ((select conv1 from chat_conv),
            'f5000000-0000-0000-0000-00000000000a', 'Yes it is.', 'nonce-a-0001')$$,
  'the seller can reply in the same conversation'
);

-- A third party may well know the conversation id (ids are not secrets) but
-- is not a participant. WITH CHECK raises, so this is directly testable.
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select throws_ok(
  $$insert into public.messages (conversation_id, sender_id, body, client_nonce)
    values ((select conv1 from chat_conv),
            'f5000000-0000-0000-0000-00000000000c', 'let me in', 'nonce-c-0001')$$,
  '42501', null,
  'a third party cannot forge themselves into a conversation they are not part of'
);

set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select throws_ok(
  $$insert into public.messages (conversation_id, sender_id, body, client_nonce)
    values ((select conv1 from chat_conv),
            'f5000000-0000-0000-0000-00000000000a', 'impersonation', 'nonce-b-0002')$$,
  '42501', null,
  'sender_id cannot be forged -- RLS pins it to auth.uid()'
);

select throws_ok(
  $$insert into public.messages (id, conversation_id, sender_id, body, client_nonce)
    values (gen_random_uuid(), (select conv1 from chat_conv),
            'f5000000-0000-0000-0000-00000000000b', 'x', 'nonce-b-0003')$$,
  '42501', null,
  'id is not client-writable -- a client cannot choose a message identity'
);

select throws_ok(
  $$insert into public.messages (conversation_id, sender_id, body, client_nonce, created_at)
    values ((select conv1 from chat_conv),
            'f5000000-0000-0000-0000-00000000000b', 'x', 'nonce-b-0004', now())$$,
  '42501', null,
  'created_at is not client-writable -- a client cannot forge when a message was sent'
);

-- Messages are append-only for v1: no UPDATE or DELETE grant, and therefore
-- deliberately no UPDATE or DELETE policy.
select throws_ok(
  $$update public.messages set body = 'edited' where true$$,
  '42501', null,
  'messages cannot be edited -- there is no UPDATE grant'
);

select throws_ok(
  $$delete from public.messages where true$$,
  '42501', null,
  'messages cannot be deleted -- there is no DELETE grant'
);

-- ============================================================
-- 6. messages: body and nonce constraints
-- ============================================================

select throws_ok(
  $$insert into public.messages (conversation_id, sender_id, body, client_nonce)
    values ((select conv1 from chat_conv),
            'f5000000-0000-0000-0000-00000000000b', '', 'nonce-b-0005')$$,
  '23514', null,
  'an empty body is refused'
);

select throws_ok(
  $$insert into public.messages (conversation_id, sender_id, body, client_nonce)
    values ((select conv1 from chat_conv),
            'f5000000-0000-0000-0000-00000000000b', '   ', 'nonce-b-0006')$$,
  '23514', null,
  'a whitespace-only body is refused by messages_body_present'
);

-- The reason there are TWO body constraints rather than one. A single
-- `char_length(btrim(body)) between 1 and 2000` would bound only the TRIMMED
-- length, so this row -- which trims to one character -- would pass and
-- store 100001 characters.
select throws_ok(
  $$insert into public.messages (conversation_id, sender_id, body, client_nonce)
    values ((select conv1 from chat_conv),
            'f5000000-0000-0000-0000-00000000000b', 'a' || repeat(E'\n', 100000), 'nonce-b-0007')$$,
  '23514', null,
  'a body that TRIMS to one character but stores 100001 is refused by messages_body_length'
);

select throws_ok(
  $$insert into public.messages (conversation_id, sender_id, body, client_nonce)
    values ((select conv1 from chat_conv),
            'f5000000-0000-0000-0000-00000000000b', repeat('x', 2001), 'nonce-b-0008')$$,
  '23514', null,
  'a 2001-character body is refused'
);

select lives_ok(
  $$insert into public.messages (conversation_id, sender_id, body, client_nonce)
    values ((select conv1 from chat_conv),
            'f5000000-0000-0000-0000-00000000000b', repeat('x', 2000), 'nonce-b-0009')$$,
  'a 2000-character body is accepted -- the boundary is inclusive'
);

select throws_ok(
  $$insert into public.messages (conversation_id, sender_id, body, client_nonce)
    values ((select conv1 from chat_conv),
            'f5000000-0000-0000-0000-00000000000b', 'short nonce', 'tiny')$$,
  '23514', null,
  'a client_nonce shorter than 8 characters is refused'
);

-- ============================================================
-- 7. messages: reading
-- ============================================================

select is(
  (select count(*)::int from public.messages),
  3,
  'a participant reads every message in their own conversation'
);

set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select is(
  (select count(*)::int from public.messages),
  0,
  'a third party reads no messages at all'
);

-- ============================================================
-- 8. The last-message trigger
-- ============================================================
-- The section that catches the SECURITY DEFINER defect. A trigger function
-- without it runs as the invoking role, whose UPDATE on conversations is
-- refused (no grant) with 42501 -- and since this is an AFTER trigger in the
-- same transaction, the message INSERT would roll back with it. Every
-- lives_ok above would already have failed; these pin the actual effect.
--
-- All assertions run under `reset role` because last_message_* is outside
-- the client column allowlist.

reset role;

select is(
  (select length(c.last_message_body) from public.conversations c
    where c.id = (select conv1 from chat_conv)),
  140,
  'the preview is truncated to 140 characters, not the full 2000'
);

select is(
  (select c.last_message_sender_id from public.conversations c
    where c.id = (select conv1 from chat_conv)),
  'f5000000-0000-0000-0000-00000000000b'::uuid,
  'last_message_sender_id tracks whoever sent the newest message'
);

select is(
  (select c.last_message_at from public.conversations c
    where c.id = (select conv1 from chat_conv)),
  (select max(m.created_at) from public.messages m
    where m.conversation_id = (select conv1 from chat_conv)),
  'last_message_at equals the newest message created_at exactly -- not now()'
);

-- Out-of-order commit: a message stamped EARLIER than the current preview
-- must not drag it backwards. Inserted here under `reset role` because
-- created_at is deliberately not client-writable.
insert into public.messages (conversation_id, sender_id, body, client_nonce, created_at)
values ((select conv1 from chat_conv),
        'f5000000-0000-0000-0000-00000000000a', 'stale arrival', 'nonce-a-0099',
        now() - interval '1 hour');

select is(
  (select c.last_message_sender_id from public.conversations c
    where c.id = (select conv1 from chat_conv)),
  'f5000000-0000-0000-0000-00000000000b'::uuid,
  'an out-of-order older message does NOT overwrite the preview sender'
);

select isnt(
  (select c.last_message_body from public.conversations c
    where c.id = (select conv1 from chat_conv)),
  'stale arrival',
  'an out-of-order older message does NOT regress the preview body'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000b","role":"authenticated"}';

-- A trigger function is invoked by the executor, never called by name, so it
-- needs no EXECUTE grant -- and withholding it keeps a DEFINER function that
-- writes to conversations from being a reachable PostgREST endpoint.
--
-- Asserted on the privilege itself rather than with throws_ok: calling it
-- directly raises 0A000 ("trigger functions can only be called as triggers")
-- because PostgreSQL checks the trigger context BEFORE the EXECUTE
-- privilege -- measured, not assumed. That makes a throws_ok on 42501 wrong,
-- and a throws_ok on 0A000 would pass even if the grant were mistakenly
-- present. has_function_privilege tests the invariant that actually matters.
select ok(
  not has_function_privilege(
    'authenticated', 'public.touch_conversation_last_message()', 'execute'
  ),
  'authenticated holds no EXECUTE on the trigger function -- it is not a reachable endpoint'
);

-- ============================================================
-- 9. client_nonce idempotency and the flood guard
-- ============================================================

select throws_ok(
  $$insert into public.messages (conversation_id, sender_id, body, client_nonce)
    values ((select conv1 from chat_conv),
            'f5000000-0000-0000-0000-00000000000b', 'duplicate send', 'nonce-b-0001')$$,
  '23505', null,
  'resending the same nonce raises 23505 -- which the client treats as "already landed"'
);

-- The nonce is SENDER-local. A two-column (conversation, nonce) index would
-- hand the opposite participant a spurious 23505, which the retry contract
-- treats as success -- silently dropping a real message.
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select lives_ok(
  $$insert into public.messages (conversation_id, sender_id, body, client_nonce)
    values ((select conv1 from chat_conv),
            'f5000000-0000-0000-0000-00000000000a', 'same nonce, other sender', 'nonce-b-0001')$$,
  'the opposite participant may independently use the same nonce -- no collision'
);

-- Saturate the DEDICATED conversation (listing 4) so these assertions cannot
-- poison the ones above.
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $do$
declare
  v_conv uuid := (select conv4 from chat_conv);
begin
  for i in 1..30 loop
    insert into public.messages (conversation_id, sender_id, body, client_nonce)
    values (v_conv, 'f5000000-0000-0000-0000-00000000000b',
            'flood ' || i, 'nonce-flood-' || lpad(i::text, 3, '0'));
  end loop;
end
$do$;

select throws_ok(
  $$insert into public.messages (conversation_id, sender_id, body, client_nonce)
    values ((select conv4 from chat_conv),
            'f5000000-0000-0000-0000-00000000000b', 'over the cap', 'nonce-flood-031')$$,
  '42501', null,
  'the 31st new message within a minute is refused by the flood guard'
);

-- The reason the guard carries an escape hatch. Without it this would raise
-- 42501, which the client's duplicate-send predicate does not recognise --
-- so a message that DID land would look permanently failed and the retry
-- would never resolve.
select throws_ok(
  $$insert into public.messages (conversation_id, sender_id, body, client_nonce)
    values ((select conv4 from chat_conv),
            'f5000000-0000-0000-0000-00000000000b', 'flood 1', 'nonce-flood-001')$$,
  '23505', null,
  'retrying an already-committed nonce while OVER the cap reaches 23505, not 42501'
);

-- Per-CONVERSATION, not global per sender. This is also the assertion that
-- fails loudly if the guard ever stops distinguishing the proposed row from
-- its own scan -- the self-reference that made an inline policy impossible.
select lives_ok(
  $$insert into public.messages (conversation_id, sender_id, body, client_nonce)
    values ((select conv1 from chat_conv),
            'f5000000-0000-0000-0000-00000000000b', 'different thread', 'nonce-b-0010')$$,
  'a sender at the cap in one thread can still send in another -- the guard is per-conversation'
);

-- ============================================================
-- 9a. The guard is not part of the API surface
-- ============================================================
-- The guard must be callable by the INSERT policy and by nothing else.
-- PostgREST exposes every function in config.toml's
-- `[api] schemas = ["public", "graphql_public"]`, so living in `public` made
-- it an ordinary RPC endpoint and a probing side-channel ("am I rate-limited
-- in conversation X", "does nonce N exist for me in X") for any conversation
-- id, independent of the policy's membership predicate. It now lives in
-- `private`, which is in neither `[api] schemas` nor `extra_search_path`.
--
-- config.toml is not readable from SQL, so these assert the DB-level half:
-- nothing by that name remains in an exposed schema, and `authenticated`
-- cannot even resolve the private schema by name.
--
-- Run under `reset role` for a reason that is itself part of the result:
-- as `authenticated` these introspection queries fail outright with
-- "permission denied for schema private", because resolving
-- `private.message_send_allowed(...)` to check its ACL is a name lookup and
-- therefore needs the USAGE this role does not have. They are assertions
-- ABOUT authenticated's privileges, not assertions made BY authenticated, so
-- the privileged connecting role is the correct vantage point.
reset role;

select is(
  (select count(*)::int from pg_proc
    where proname = 'message_send_allowed'
      and pronamespace = 'public'::regnamespace),
  0,
  'the guard no longer exists in public -- it has no PostgREST route'
);

select is(
  (select count(*)::int from pg_proc
    where proname = 'message_send_allowed'
      and pronamespace = 'private'::regnamespace),
  1,
  'the guard lives in the private schema instead'
);

-- Withholding USAGE is what makes `private.anything` unresolvable by name to
-- a client, while a policy expression -- which stores the function by OID --
-- keeps working. Measured rather than assumed, because "a policy needs no
-- schema USAGE" is exactly the kind of privilege assumption that should be
-- proven by the suite that depends on it.
select ok(
  not has_schema_privilege('authenticated', 'private', 'usage'),
  'authenticated holds no USAGE on the private schema -- it cannot look the guard up by name'
);

-- EXECUTE is the one privilege the policy genuinely requires, so it must
-- still be present. Together with the assertion above: callable by the
-- policy, unreachable by name, unroutable by PostgREST.
select ok(
  has_function_privilege(
    'authenticated', 'private.message_send_allowed(uuid, text)', 'execute'
  ),
  'authenticated retains EXECUTE on the guard -- policy evaluation needs it'
);

-- The guard still runs as DEFINER and STABLE after the move, which is what
-- lets it read public.messages without re-entering the messages policy.
select ok(
  (select p.prosecdef and p.provolatile = 's' from pg_proc p
    where p.proname = 'message_send_allowed'
      and p.pronamespace = 'private'::regnamespace),
  'the relocated guard is still SECURITY DEFINER and STABLE'
);

-- Back to the buyer for the read-state section below.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000b","role":"authenticated"}';

-- ============================================================
-- 10. mark_conversation_read
-- ============================================================

select lives_ok(
  $$select public.mark_conversation_read((select conv1 from chat_conv), now())$$,
  'a participant can mark their own side read'
);

reset role;

select isnt(
  (select c.buyer_last_read_at from public.conversations c
    where c.id = (select conv1 from chat_conv)),
  null,
  'the buyer''s own read timestamp advanced'
);

select is(
  (select c.seller_last_read_at from public.conversations c
    where c.id = (select conv1 from chat_conv)),
  null,
  'the buyer marking read left the SELLER''s side completely untouched'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select lives_ok(
  $$select public.mark_conversation_read((select conv1 from chat_conv), now())$$,
  'the other participant marks their own, separate side'
);

-- Monotonic. A late call from a backgrounded screen must not drag the read
-- point backwards and resurrect already-read messages as unread.
select lives_ok(
  $$select public.mark_conversation_read((select conv1 from chat_conv), now() - interval '1 day')$$,
  'sanity: a late call with an EARLIER p_up_to is accepted without error'
);

reset role;

select ok(
  (select c.seller_last_read_at from public.conversations c
    where c.id = (select conv1 from chat_conv)) > now() - interval '1 hour',
  'an earlier p_up_to did NOT regress the stored read timestamp -- greatest() holds'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- Clamped to now(), so a client cannot mark the FUTURE as read and
-- permanently zero its own unread count.
select lives_ok(
  $$select public.mark_conversation_read((select conv1 from chat_conv), now() + interval '10 years')$$,
  'sanity: a far-future p_up_to is accepted without error'
);

reset role;

select ok(
  (select c.seller_last_read_at from public.conversations c
    where c.id = (select conv1 from chat_conv)) <= now(),
  'a far-future p_up_to is CLAMPED to now() -- the future cannot be marked read'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000c","role":"authenticated"}';

-- DEFINER bypasses RLS, so the in-function membership branch is the entire
-- boundary here.
select throws_ok(
  $$select public.mark_conversation_read((select conv1 from chat_conv))$$,
  '42501', null,
  'a third party cannot mark someone else''s conversation read'
);

select throws_ok(
  $$select public.mark_conversation_read('cccc5000-0000-0000-0000-00000000dead')$$,
  'P0002', null,
  'marking a conversation that does not exist is refused'
);

-- ============================================================
-- PHASE 2 FIXTURES -- read RPCs
-- ============================================================
-- A dedicated cast, so the inbox/unread assertions are not entangled with
-- the read state and message volume Phase 1's sections accumulated on
-- conv1/conv4. D sells, E buys; C (already created) stays the uninvolved
-- third party.
--
-- D's profile gets a username and display name; E's are left NULL on
-- purpose, so the seller's view of the buyer exercises the nullable
-- participant path that the generated RPC types cannot express.

reset role;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('f5000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-chat-d@test.dev', 'x', now(), now()),
  ('f5000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-chat-e@test.dev', 'x', now(), now());

update public.profiles
   set username = 'p2_seller', display_name = 'P2 Seller'
 where id = 'f5000000-0000-0000-0000-00000000000d';

insert into public.listings
  (id, seller_id, title, description, price_amount, condition, size, status)
values
  ('aaaa5000-0000-0000-0000-000000000010', 'f5000000-0000-0000-0000-00000000000d',
   'P2 main', 'CHAT_P2_MAIN', 1000, 'good', 'alpha_m', 'active'),
  ('aaaa5000-0000-0000-0000-000000000011', 'f5000000-0000-0000-0000-00000000000d',
   'P2 empty', 'CHAT_P2_EMPTY', 2000, 'good', 'alpha_l', 'active'),
  ('aaaa5000-0000-0000-0000-000000000012', 'f5000000-0000-0000-0000-00000000000d',
   'P2 sold', 'CHAT_P2_SOLD', 3000, 'good', 'alpha_s', 'active'),
  -- Deliberately imageless, so cover_storage_path has a genuine NULL to
  -- produce. Inserted privileged, which is how an active row can exist with
  -- no photos at all (publish_listing would have required one).
  ('aaaa5000-0000-0000-0000-000000000013', 'f5000000-0000-0000-0000-00000000000d',
   'P2 noimage', 'CHAT_P2_NOIMG', 4000, 'good', 'one_size', 'active');

-- 'P2 main' has NO position 0: its first photo was removed, leaving 1 and 2.
-- The cover must be position 1 -- the MINIMUM present, not position 0, which
-- is the exact case that rules out a .eq(position, 0) filter on the client.
insert into public.listing_images (listing_id, storage_path, "position")
values
  ('aaaa5000-0000-0000-0000-000000000010', 'p2/main-second.jpg', 2),
  ('aaaa5000-0000-0000-0000-000000000010', 'p2/main-first.jpg', 1),
  ('aaaa5000-0000-0000-0000-000000000011', 'p2/empty-cover.jpg', 0),
  ('aaaa5000-0000-0000-0000-000000000012', 'p2/sold-cover.jpg', 0);

-- E opens all four threads through the real RPC, so buyer/seller derivation
-- is the production one rather than a hand-built row.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000e","role":"authenticated"}';

create temp table p2_conv as
select
  public.get_or_create_listing_conversation('aaaa5000-0000-0000-0000-000000000010') as cv10,
  public.get_or_create_listing_conversation('aaaa5000-0000-0000-0000-000000000011') as cv11,
  public.get_or_create_listing_conversation('aaaa5000-0000-0000-0000-000000000012') as cv12,
  public.get_or_create_listing_conversation('aaaa5000-0000-0000-0000-000000000013') as cv13;

reset role;
grant select on p2_conv to authenticated;

-- Backdate last_message_at BEFORE inserting the backdated messages. The
-- trigger is monotonic (`where c.last_message_at <= new.created_at`), so a
-- past-dated message against a conversation stamped now() would be ignored
-- and the preview would stay NULL. Seeding an old value first lets each
-- ascending insert update the row exactly as it would have in real time --
-- measured, not assumed; the first attempt at these fixtures produced a
-- silently NULL preview.
update public.conversations
   set last_message_at = '2026-01-01 00:00:00+00'
 where id in (select cv10 from p2_conv union all select cv11 from p2_conv
              union all select cv12 from p2_conv union all select cv13 from p2_conv);

insert into public.messages (conversation_id, sender_id, body, client_nonce, created_at)
values
  -- cv10: two INCOMING messages for E. Two, so the badge can be shown to
  -- count conversations rather than messages.
  ((select cv10 from p2_conv), 'f5000000-0000-0000-0000-00000000000d',
   'cv10 incoming A1', 'nonce-p2-cv10-a1', '2026-02-01 08:00:00+00'),
  ((select cv10 from p2_conv), 'f5000000-0000-0000-0000-00000000000d',
   'cv10 incoming A2', 'nonce-p2-cv10-a2', '2026-02-01 09:00:00+00'),
  -- cv12: one incoming, on the listing that will be marked sold.
  ((select cv12 from p2_conv), 'f5000000-0000-0000-0000-00000000000d',
   'cv12 incoming', 'nonce-p2-cv12-a1', '2026-02-02 10:00:00+00'),
  -- cv13: E's OWN message only, so "my outgoing message alone is not
  -- unread" has somewhere to be true -- and it is incoming for D.
  ((select cv13 from p2_conv), 'f5000000-0000-0000-0000-00000000000e',
   'cv13 my own', 'nonce-p2-cv13-b1', '2026-02-03 10:00:00+00');

-- cv11 stays EMPTY. Stamped newest so the inbox ordering below is fully
-- determined; body and sender remain NULL, which is what an empty thread
-- genuinely looks like.
update public.conversations
   set last_message_at = '2026-02-04 10:00:00+00'
 where id = (select cv11 from p2_conv);

-- Resulting state, for E (all read markers still NULL):
--   cv11  2026-02-04  empty        unread 0
--   cv13  2026-02-03  own only     unread 0
--   cv12  2026-02-02  1 incoming   unread 1
--   cv10  2026-02-01  2 incoming   unread 2
-- so 3 unread MESSAGES across 2 unread CONVERSATIONS.

set local role authenticated;
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000e","role":"authenticated"}';

-- ============================================================
-- 11. inbox_conversations -- participation boundary
-- ============================================================
-- DEFINER bypasses RLS, so the in-function predicate is the whole boundary.
-- These assert it directly rather than trusting it.

select is(
  (select count(*)::int from public.inbox_conversations(50)),
  4,
  'a participant sees exactly their own conversations in the inbox'
);

select is(
  (select string_agg(i.listing_title, ','
      order by i.last_message_at desc, i.conversation_id desc)
     from public.inbox_conversations(50) i),
  'P2 empty,P2 noimage,P2 sold,P2 main',
  'the inbox is ordered by last activity, newest first'
);

-- The buyer's own profile is NULL on both name columns, so the seller's view
-- of them is the nullable participant case.
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000d","role":"authenticated"}';

select is(
  (select count(*)::int from public.inbox_conversations(50)),
  3,
  'the seller sees their own three threads -- not the buyer''s empty one'
);

select is(
  (select i.other_username from public.inbox_conversations(50) i
    where i.listing_title = 'P2 main'),
  null,
  'a participant with no username comes back NULL rather than erroring'
);

select is(
  (select i.other_display_name from public.inbox_conversations(50) i
    where i.listing_title = 'P2 main'),
  null,
  'and so does a NULL display_name -- the generated type cannot express this'
);

set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000e","role":"authenticated"}';

select is(
  (select i.other_display_name from public.inbox_conversations(50) i
    where i.listing_title = 'P2 main'),
  'P2 Seller',
  'the other participant''s public profile is joined in, costing no extra query'
);

-- The third party is in none of these conversations.
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select is(
  (select count(*)::int from public.inbox_conversations(50)),
  0,
  'a third party cannot enumerate anyone else''s conversations through the inbox'
);

-- ============================================================
-- 12. Empty threads
-- ============================================================
-- A curiosity-tap on "Message seller" must not plant a blank row in the
-- seller's inbox, but the opener has to be able to find their way back to it.

set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000e","role":"authenticated"}';

select ok(
  exists(select 1 from public.inbox_conversations(50) i where i.listing_title = 'P2 empty'),
  'the buyer who opened an empty thread does see it'
);

select is(
  (select i.last_message_body from public.inbox_conversations(50) i
    where i.listing_title = 'P2 empty'),
  null,
  'an empty thread has a NULL preview body -- another genuinely nullable return field'
);

select is(
  (select i.last_message_sender_id from public.inbox_conversations(50) i
    where i.listing_title = 'P2 empty'),
  null,
  'and a NULL last_message_sender_id'
);

select is(
  (select i.unread_count from public.inbox_conversations(50) i
    where i.listing_title = 'P2 empty'),
  0,
  'an empty thread is never unread'
);

set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000d","role":"authenticated"}';

select ok(
  not exists(select 1 from public.inbox_conversations(50) i where i.listing_title = 'P2 empty'),
  'the seller does NOT see a buyer-created thread that has no messages yet'
);

-- Send the first message; now it is a real conversation for both sides.
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000e","role":"authenticated"}';

insert into public.messages (conversation_id, sender_id, body, client_nonce)
values ((select cv11 from p2_conv), 'f5000000-0000-0000-0000-00000000000e',
        'now it is real', 'nonce-p2-cv11-b1');

set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000d","role":"authenticated"}';

select ok(
  exists(select 1 from public.inbox_conversations(50) i where i.listing_title = 'P2 empty'),
  'once the first message is sent, the seller sees the thread'
);

-- ============================================================
-- 13. Sold and otherwise invisible listings
-- ============================================================
-- The reason all three RPCs are DEFINER.

reset role;
update public.listings set status = 'sold'
 where id = 'aaaa5000-0000-0000-0000-000000000012';

set local role authenticated;
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000e","role":"authenticated"}';

-- Establish that ordinary listing RLS really does hide it from the buyer, so
-- the next assertions are about DEFINER rather than coincidence.
select is(
  (select count(*)::int from public.listings
    where id = 'aaaa5000-0000-0000-0000-000000000012'),
  0,
  'sanity: the buyer can no longer SELECT the sold listing through normal RLS'
);

select ok(
  exists(select 1 from public.inbox_conversations(50) i where i.listing_title = 'P2 sold'),
  'the thread survives in the BUYER''s inbox after the listing is sold -- with its title'
);

select is(
  (select i.listing_status from public.inbox_conversations(50) i
    where i.listing_title = 'P2 sold'),
  'sold'::public.listing_status,
  'and carries the listing status, so the row can show "Sold"'
);

select is(
  (select d.listing_status from public.conversation_detail((select cv12 from p2_conv)) d),
  'sold'::public.listing_status,
  'a sold listing''s thread still resolves through conversation_detail'
);

set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000d","role":"authenticated"}';

select ok(
  exists(select 1 from public.inbox_conversations(50) i where i.listing_title = 'P2 sold'),
  'and it survives in the SELLER''s inbox too'
);

-- ============================================================
-- 14. Cover resolution
-- ============================================================

set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000e","role":"authenticated"}';

select is(
  (select i.cover_storage_path from public.inbox_conversations(50) i
    where i.listing_title = 'P2 main'),
  'p2/main-first.jpg',
  'the cover is the MINIMUM attached position, not position 0'
);

-- An imageless listing must yield a row with a null cover, NOT a dropped
-- row. This is why the cover lateral is LEFT, unlike feed_listings' CROSS
-- JOIN LATERAL, where a missing photo is an eligibility failure.
select ok(
  exists(select 1 from public.inbox_conversations(50) i where i.listing_title = 'P2 noimage'),
  'a conversation about a listing with no images still appears in the inbox'
);

select is(
  (select i.cover_storage_path from public.inbox_conversations(50) i
    where i.listing_title = 'P2 noimage'),
  null,
  'and its cover_storage_path is NULL rather than the row being missing'
);

select is(
  (select d.cover_storage_path from public.conversation_detail((select cv13 from p2_conv)) d),
  null,
  'conversation_detail likewise returns a NULL cover rather than no row'
);

-- Storage policies are untouched in this phase: signing a sold listing's
-- cover will still fail for the buyer on the client, which a later client
-- phase handles with a fallback tile. Recorded here so the NULL above is not
-- confused with that separate, deliberate gap.

-- ============================================================
-- 15. conversation_detail -- indistinguishable failure modes
-- ============================================================

select is(
  (select count(*)::int from public.conversation_detail((select cv10 from p2_conv))),
  1,
  'a participant gets exactly one row from conversation_detail'
);

-- Both of the next two raise the SAME code from the SAME branch. If they
-- differed, the error itself would confirm whether a conversation exists.
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select throws_ok(
  $$select * from public.conversation_detail((select cv10 from p2_conv))$$,
  'P0002', null,
  'a non-participant gets P0002 from conversation_detail -- never the row'
);

select throws_ok(
  $$select * from public.conversation_detail('cccc5000-0000-0000-0000-00000000dead')$$,
  'P0002', null,
  'a nonexistent conversation gets the SAME P0002 -- the two are indistinguishable'
);

-- Neither read surface may carry the read-receipt timestamps. Asserted
-- against the declared OUT parameter names, so adding one later fails here.
reset role;

select ok(
  (select not (p.proargnames && array['buyer_last_read_at', 'seller_last_read_at'])
     from pg_proc p
    where p.proname = 'inbox_conversations'
      and p.pronamespace = 'public'::regnamespace),
  'inbox_conversations does not return either read timestamp'
);

select ok(
  (select not (p.proargnames && array['buyer_last_read_at', 'seller_last_read_at'])
     from pg_proc p
    where p.proname = 'conversation_detail'
      and p.pronamespace = 'public'::regnamespace),
  'conversation_detail does not return either read timestamp'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000e","role":"authenticated"}';

-- ============================================================
-- 16. Keyset pagination and limit handling
-- ============================================================

select throws_ok(
  $$select * from public.inbox_conversations(10, now(), null)$$,
  'P0001', null,
  'a half cursor (last_message_at without id) is rejected rather than silently returning page 1'
);

select throws_ok(
  $$select * from public.inbox_conversations(10, null, 'cccc5000-0000-0000-0000-00000000dead')$$,
  'P0001', null,
  'a half cursor (id without last_message_at) is rejected too'
);

select lives_ok(
  $$select * from public.inbox_conversations(10, null, null)$$,
  'both cursor halves null is the normal first page'
);

select is(
  (select count(*)::int from public.inbox_conversations(2)),
  2,
  'p_limit is honoured'
);

-- least(greatest(null,1),50) is null, and `limit null` means NO limit --
-- so an explicit null must land on the default instead of propagating.
select is(
  (select count(*)::int from public.inbox_conversations(null)),
  4,
  'an explicit p_limit => null falls back to the default, never becoming unbounded'
);

select is(
  (select count(*)::int from public.inbox_conversations(999)),
  4,
  'p_limit above the cap is clamped rather than rejected'
);

select is(
  (select count(*)::int from public.inbox_conversations(0)),
  1,
  'p_limit => 0 is clamped up to 1'
);

select is(
  (select count(*)::int from public.inbox_conversations(-5)),
  1,
  'a negative p_limit is clamped up to 1'
);

-- Page 2 continues exactly where page 1 stopped: no row repeated, none
-- skipped. The cursor is derived from page 1 the way the client does it.
select is(
  (
    select string_agg(i.listing_title, ','
        order by i.last_message_at desc, i.conversation_id desc)
      from (
        select p1.last_message_at, p1.conversation_id
          from public.inbox_conversations(2) p1
         order by p1.last_message_at asc, p1.conversation_id asc
         limit 1
      ) cur
      cross join lateral public.inbox_conversations(2, cur.last_message_at, cur.conversation_id) i
  ),
  'P2 sold,P2 main',
  'the keyset cursor returns the next page with no gap and no duplicate'
);

-- ============================================================
-- 17. Unread semantics -- the authoritative definition
-- ============================================================
-- Unread is the existence/count of INCOMING messages after the viewer's read
-- point. It is never derived from last_message_sender_id.

select is(
  (select i.unread_count from public.inbox_conversations(50) i
    where i.listing_title = 'P2 main'),
  2,
  'unread_count is correct with a NULL last_read_at -- the first message is not pre-read'
);

select is(
  (select i.unread_count from public.inbox_conversations(50) i
    where i.listing_title = 'P2 noimage'),
  0,
  'a thread containing only MY OWN outgoing message is not unread'
);

-- 3 unread messages (2 in cv10, 1 in cv12) across 2 unread conversations.
select is(
  (select public.inbox_unread_count()),
  2,
  'the badge counts unread CONVERSATIONS, not unread messages -- 2, not 3'
);

-- THE SCENARIO. Incoming A1/A2 are still unread; the viewer now sends B, so
-- they are the most recent sender. A last_message_sender_id-based predicate
-- would call this caught up and silently bury A1 and A2.
insert into public.messages (conversation_id, sender_id, body, client_nonce)
values ((select cv10 from p2_conv), 'f5000000-0000-0000-0000-00000000000e',
        'cv10 my reply B', 'nonce-p2-cv10-b1');

select is(
  (select i.last_message_sender_id from public.inbox_conversations(50) i
    where i.listing_title = 'P2 main'),
  'f5000000-0000-0000-0000-00000000000e'::uuid,
  'sanity: the viewer is now the most recent sender in that thread'
);

select is(
  (select i.unread_count from public.inbox_conversations(50) i
    where i.listing_title = 'P2 main'),
  2,
  'the thread REMAINS unread after the viewer replies without advancing their read marker'
);

select is(
  (select public.inbox_unread_count()),
  2,
  'and it still counts toward the badge'
);

-- Now actually advance the read marker past A1 and A2.
select lives_ok(
  $$select public.mark_conversation_read((select cv10 from p2_conv))$$,
  'the viewer marks the thread read'
);

select is(
  (select i.unread_count from public.inbox_conversations(50) i
    where i.listing_title = 'P2 main'),
  0,
  'once the read marker advances past the incoming messages, unread becomes zero'
);

select is(
  (select public.inbox_unread_count()),
  1,
  'and the badge drops to the one conversation still unread'
);

-- The same message is unread from the other side, which is what proves the
-- read point is resolved per viewer rather than per conversation.
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000d","role":"authenticated"}';

select is(
  (select i.unread_count from public.inbox_conversations(50) i
    where i.listing_title = 'P2 noimage'),
  1,
  'the buyer''s message is unread for the SELLER -- unread is per viewer'
);

-- ============================================================
-- 18. Read-RPC function ACLs
-- ============================================================

reset role;

select ok(
  has_function_privilege('authenticated', 'public.inbox_conversations(integer, timestamptz, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.inbox_conversations(integer, timestamptz, uuid)', 'execute'),
  'inbox_conversations: EXECUTE for authenticated only'
);

select ok(
  has_function_privilege('authenticated', 'public.conversation_detail(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.conversation_detail(uuid)', 'execute'),
  'conversation_detail: EXECUTE for authenticated only'
);

select ok(
  has_function_privilege('authenticated', 'public.inbox_unread_count()', 'execute')
  and not has_function_privilege('anon', 'public.inbox_unread_count()', 'execute'),
  'inbox_unread_count: EXECUTE for authenticated only'
);

select ok(
  (select bool_and(p.prosecdef) from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('inbox_conversations', 'conversation_detail', 'inbox_unread_count')),
  'all three read RPCs are SECURITY DEFINER -- which is what keeps sold listings visible'
);

-- ============================================================
-- 19. Realtime publication
-- ============================================================
-- What SQL can and cannot prove here is worth stating plainly: pgTAP can
-- assert the WAL-level configuration Realtime depends on, but it cannot
-- prove websocket delivery or that apply_rls dropped a row for a particular
-- subscriber. Those are exercised by a live multi-client run, not faked
-- here. These assertions cover the configuration half only.

reset role;

select is(
  (select count(*)::int from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'),
  1,
  'public.messages is published to supabase_realtime, so INSERTs reach the WAL stream'
);

-- Publishing conversations would broadcast every last_message_* UPDATE the
-- trigger makes -- the same information twice, from two streams, with no
-- ordering guarantee -- and would put buyer/seller_last_read_at on the wire,
-- which every read RPC was shaped to avoid.
select is(
  (select count(*)::int from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversations'),
  0,
  'public.conversations is deliberately NOT published'
);

select is(
  (select count(*)::int from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'),
  1,
  'messages is the ONLY published table -- nothing else was swept in'
);

-- DEFAULT, not FULL. An INSERT WAL record already carries the whole new
-- tuple, so v1 needs nothing more; FULL would additionally write OLD tuples
-- -- private message bodies -- for every UPDATE/DELETE, in exchange for
-- nothing on an append-only table.
select is(
  (select c.relreplident::text from pg_class c
    where c.relname = 'messages' and c.relnamespace = 'public'::regnamespace),
  'd',
  'messages keeps REPLICA IDENTITY DEFAULT -- no OLD tuples on the WAL'
);

-- DEFAULT re-identifies rows by primary key, so apply_rls needs one to exist.
select ok(
  exists(
    select 1 from pg_constraint
     where conrelid = 'public.messages'::regclass and contype = 'p'
  ),
  'messages has a primary key, which is what REPLICA IDENTITY DEFAULT relies on'
);

-- Publication membership is NOT authorization: apply_rls re-evaluates the
-- table's SELECT policies per subscriber, per row. So the invariants that
-- actually gate delivery are the same ones Phase 1 established, and they
-- must still hold unchanged after publishing.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'messages' and cmd = 'SELECT'),
  1,
  'the messages SELECT policy still exists -- it is what apply_rls evaluates for each subscriber'
);

select ok(
  has_table_privilege('authenticated', 'public.messages', 'select'),
  'authenticated still holds the table SELECT that apply_rls probes with -- no new grant was needed'
);

select ok(
  not has_table_privilege('anon', 'public.messages', 'select'),
  'anon still holds NO select on messages, so an unauthenticated socket can receive nothing'
);

-- Publishing a table must not have relaxed the write side either.
select ok(
  not has_table_privilege('authenticated', 'public.messages', 'update')
  and not has_table_privilege('authenticated', 'public.messages', 'delete'),
  'messages remains append-only for clients after publication -- still no UPDATE or DELETE'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000e","role":"authenticated"}';

-- The row-level half of the delivery boundary, re-asserted post-publication
-- from both sides: a participant still sees their own conversation's
-- messages, and a third party still sees none. These are the predicates
-- apply_rls will run per subscriber.
select ok(
  (select count(*) from public.messages m
    where m.conversation_id = (select cv10 from p2_conv)) > 0,
  'a participant still reads their own conversation''s messages after publication'
);

set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select is(
  (select count(*)::int from public.messages
    where conversation_id = (select cv10 from p2_conv)),
  0,
  'a third party still reads none of them -- which is what apply_rls will drop for them'
);

-- ============================================================
-- 20. Cascades
-- ============================================================

reset role;

select ok(
  (select count(*) from public.messages
    where conversation_id = (select conv4 from chat_conv)) > 0,
  'sanity: the saturated conversation has messages before it is deleted'
);

delete from public.conversations where id = (select conv4 from chat_conv);

select is(
  (select count(*)::int from public.messages
    where conversation_id = (select conv4 from chat_conv)),
  0,
  'deleting a conversation cascades its messages away, leaving no orphans'
);

-- Deleting a listing takes its conversations with it. Reachable through the
-- client DELETE policy only for a DRAFT, which by construction can have no
-- conversations -- so this is harmless today, and asserted here so that a
-- future relaxation of that policy is a visible decision rather than a
-- silent "a seller can erase a buyer's chat history".
delete from public.listings where id = 'aaaa5000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.conversations
    where listing_id = 'aaaa5000-0000-0000-0000-000000000001'),
  0,
  'deleting a listing cascades its conversations away'
);

-- ============================================================
-- 21. anon
-- ============================================================
-- Stronger than "sees no rows": anon holds no privilege on either table, so
-- reads are refused outright rather than silently returning empty.

set local role anon;

select throws_ok(
  $$select count(*) from public.conversations$$,
  '42501', null,
  'anon cannot read conversations at all -- no grant, so not even an empty result'
);

select throws_ok(
  $$select count(*) from public.messages$$,
  '42501', null,
  'anon cannot read messages at all'
);

select throws_ok(
  $$insert into public.messages (conversation_id, sender_id, body, client_nonce)
    values ('cccc5000-0000-0000-0000-00000000dead',
            'f5000000-0000-0000-0000-00000000000b', 'x', 'nonce-anon-01')$$,
  '42501', null,
  'anon cannot send a message'
);

select throws_ok(
  $$select public.get_or_create_listing_conversation('aaaa5000-0000-0000-0000-000000000002')$$,
  '42501', null,
  'anon cannot open a conversation -- EXECUTE is revoked from anon separately from PUBLIC'
);

select throws_ok(
  $$select public.mark_conversation_read('cccc5000-0000-0000-0000-00000000dead')$$,
  '42501', null,
  'anon cannot mark anything read'
);

-- The read RPCs are DEFINER and therefore bypass RLS entirely, so EXECUTE
-- being revoked from anon is the only thing standing between an
-- unauthenticated caller and every conversation in the database.
select throws_ok(
  $$select * from public.inbox_conversations(50)$$,
  '42501', null,
  'anon cannot execute inbox_conversations'
);

select throws_ok(
  $$select * from public.conversation_detail('cccc5000-0000-0000-0000-00000000dead')$$,
  '42501', null,
  'anon cannot execute conversation_detail'
);

select throws_ok(
  $$select public.inbox_unread_count()$$,
  '42501', null,
  'anon cannot execute inbox_unread_count'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"f5000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select * from finish();

rollback;
