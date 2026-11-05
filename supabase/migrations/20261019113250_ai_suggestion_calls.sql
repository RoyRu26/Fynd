-- ROADMAP 4.2 "Suggest-from-photos Edge Function": the rate-limit ledger.
--
-- The Edge Function itself (supabase/functions/suggest-listing/) calls
-- Anthropic on the user's behalf using a server-side secret, so there is no
-- RLS boundary stopping a user from invoking it as many times as they like.
-- This table plus `record_ai_suggestion_attempt` below is that boundary:
-- every call the function makes must first pass through the RPC, which
-- counts recent attempts and only lets a new one through under the limit.
--
-- A SECURITY DEFINER RPC rather than a raw client INSERT, for the same
-- reason record_listing_impression (20260916090100) is one: the Edge
-- Function runs with the user's own JWT (never the service role key, by
-- design -- see that file's header), so without a DEFINER function the
-- client-held role would need its own INSERT grant on this table, which
-- would let it write arbitrary rows (fabricate attempts, backdate them,
-- write for another user) directly over PostgREST. Routing every write
-- through the RPC means the table itself can stay effectively
-- insert-nothing for every client role.

create table public.ai_suggestion_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Nullable, ON DELETE SET NULL -- NOT on delete cascade. The limit this
  -- table enforces is per-USER, not per-listing, so a row's survival must
  -- not depend on the listing it was recorded against still existing.
  -- `on delete cascade` here was a real bug: a user could burn their
  -- 24h quota against one draft, delete that draft (RLS already permits
  -- deleting any of your own drafts -- ordinary, expected behavior, not a
  -- privilege escalation), and the cascade would silently delete their own
  -- ledger rows along with it, resetting their count to zero. Verified
  -- live during review: 3 calls against a draft, delete the draft, the
  -- same user's 24h count dropped from 3 to 0. SET NULL keeps the row (and
  -- therefore the count) alive regardless of what happens to the listing.
  listing_id uuid references public.listings (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Supports both the per-user 24h count the RPC performs and a future "how
-- many calls did this listing receive" lookup, without a second index --
-- recent-first per user is the access pattern that actually happens.
create index ai_suggestion_calls_user_id_created_at_idx
  on public.ai_suggestion_calls (user_id, created_at desc);

alter table public.ai_suggestion_calls enable row level security;

-- Lets a user see their own call history (e.g. a future "AI suggestions
-- used today" UI affordance). Not required by 4.2 itself, but costs
-- nothing and mirrors favorites'/follows' owner-scoped SELECT convention.
create policy "Users read own ai suggestion calls"
on public.ai_suggestion_calls for select to authenticated
using (user_id = (select auth.uid()));

-- pg_default_acl grants arwdDxtm to anon and authenticated on every new
-- relation in this schema, so this blanket revoke is what makes the grant
-- below load-bearing. No insert/update/delete grant to any client role at
-- all -- the only writer is record_ai_suggestion_attempt below, and it
-- runs as the table owner (SECURITY DEFINER), not as the caller.
revoke all on public.ai_suggestion_calls from anon, authenticated;
grant select on public.ai_suggestion_calls to authenticated;

-- ============================================================
-- record_ai_suggestion_attempt
-- ============================================================
-- Called once per Edge Function invocation, BEFORE the Anthropic API is
-- ever reached. Returns whether this attempt is allowed and, if so, how
-- many more remain in the current rolling 24h window.
--
-- The limit (20 calls / user / rolling 24h) is generous for legitimate use
-- of a feature a seller might use a handful of times per draft, while
-- bounding exposure given Haiku 4.5's low per-call cost -- see ROADMAP 4.1's
-- model choice for the cost reasoning this budget assumes.
--
-- Accepted risk, not a gap: deleting one's own account (auth.users ON
-- DELETE CASCADE) and signing up again also resets this quota, same as any
-- purely per-account rate limit. Not worth defending against here -- the
-- listing_id-cascade bypass above was a real bug precisely because it cost
-- nothing to exploit (delete a draft, a completely ordinary action); this
-- one costs an actual new account.
--
-- pg_advisory_xact_lock serialises concurrent calls from the SAME user
-- (hashtextextended keyed on their uid) for the lifetime of this
-- transaction, so two requests racing in parallel are counted one after
-- the other rather than both reading the same "19 so far" snapshot and
-- both proceeding. The lock is scoped to one user's hash, so it never
-- blocks other users' concurrent calls. Verified by hand against two real
-- concurrent psql sessions (session 2 blocked on session 1's lock until
-- commit); pgTAP itself can't demonstrate this -- a single script's
-- statements run strictly sequentially in one session, so a "two rapid
-- calls" assertion there would pass identically with this lock deleted
-- entirely. The suite's own version of that case is honest about testing
-- count-then-insert monotonicity, not concurrency.
create or replace function public.record_ai_suggestion_attempt(p_listing_id uuid)
returns table (allowed boolean, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_count   integer;
  v_limit   constant integer := 20;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Ownership + draft-status must be re-checked here, independently of
  -- whatever the Edge Function already checked before calling this RPC:
  -- this function is SECURITY DEFINER and reachable directly over
  -- PostgREST by any authenticated caller, so it cannot assume its only
  -- caller is the trusted Edge Function. Collapsed into one generic 42501,
  -- matching the Edge Function's own "not_found" response collapsing
  -- exists-but-not-mine with doesn't-exist -- this RPC must not become a
  -- side channel that tells a caller which one it was.
  if not exists (
    select 1 from public.listings l
     where l.id = p_listing_id
       and l.seller_id = v_user_id
       and l.status = 'draft'
  ) then
    raise exception 'Listing not found' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select count(*) into v_count
    from public.ai_suggestion_calls c
   where c.user_id = v_user_id
     and c.created_at > now() - interval '24 hours';

  if v_count >= v_limit then
    return query select false, 0;
    return;
  end if;

  insert into public.ai_suggestion_calls (user_id, listing_id)
  values (v_user_id, p_listing_id);

  return query select true, (v_limit - v_count - 1);
end;
$$;

revoke all    on function public.record_ai_suggestion_attempt(uuid) from public;
revoke all    on function public.record_ai_suggestion_attempt(uuid) from anon;
grant execute on function public.record_ai_suggestion_attempt(uuid) to authenticated;
