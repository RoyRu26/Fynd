-- Raw interaction events, and the only path that writes them.
--
-- Introduced now rather than alongside a future ranker because impressions
-- are only observable at the moment they happen: every day without this
-- table is permanently unrecoverable signal. The model can wait; the
-- recording cannot.
--
-- Deliberately narrow. No jsonb metadata blob, no device/IP/user-agent, no
-- coarse location -- none of it is needed yet, and a blob is how an event
-- table stops being queryable. New signals get real columns when a real
-- consumer exists.

-- An enum, not free text: extensible via ALTER TYPE ... ADD VALUE (in its
-- own migration -- PostgreSQL will not let a value be added and then used in
-- the same transaction), while still generating a proper union type in
-- database.ts, consistent with the two enums already in this schema.
--
-- 'open' is schema-ready but UNEMITTED in this slice: there is no listing
-- detail route yet. Defining it now means adding detail later is a client
-- change, not a migration.
create type public.listing_event_type as enum ('impression', 'open');

create table public.listing_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  event_type public.listing_event_type not null,
  -- An opaque client token, one per app launch. `text`, not `uuid`: the
  -- client has no guaranteed UUID generator (expo-crypto was deliberately
  -- not added in Phase 3, and the fallback id format is not a UUID), and
  -- this is never joined -- only grouped on for deduplication.
  session_id text not null,
  -- ZERO-BASED ABSOLUTE rank across every page loaded in this feed session,
  -- NOT the index within its page: item 0 of page 2 after a 10-item page 1
  -- is 10. Position-bias correction is table stakes for any future ranker,
  -- and a per-page index would make every page look like it started at 0.
  feed_position integer,
  created_at timestamptz not null default now(),
  constraint listing_events_session_id_length
    check (char_length(session_id) between 8 and 64),
  constraint listing_events_feed_position_nonnegative
    check (feed_position is null or feed_position >= 0)
);

create index listing_events_listing_created_idx
  on public.listing_events (listing_id, created_at desc);

create index listing_events_user_created_idx
  on public.listing_events (user_id, created_at desc);

-- Server-side deduplication backstop. The client also keeps a per-session
-- Set so a repeat never becomes a network call at all; this is what makes a
-- remount, a retry, or two devices racing impossible to double-count.
-- A new app launch is a new session and correctly counts as a new impression.
create unique index listing_events_impression_unique
  on public.listing_events (user_id, listing_id, session_id)
  where event_type = 'impression';

alter table public.listing_events enable row level security;

-- SELECT only. No INSERT policy is created: the client holds no INSERT
-- privilege (see the grants below), so such a policy could never be
-- evaluated, and a dead policy that implies RLS is the active gate is worse
-- than no policy at all.
create policy "Users read own events"
on public.listing_events for select to authenticated
using (user_id = (select auth.uid()));

-- pg_default_acl auto-grants arwdDxtm to anon and authenticated on every new
-- relation in this schema, so the blanket revoke is what makes the grant
-- below load-bearing rather than decorative.
revoke all on public.listing_events from anon, authenticated;

grant select on public.listing_events to authenticated;

-- No INSERT grant, no column allowlist, no UPDATE, no DELETE. The RPC below
-- is the sole writer, which makes the table append-only for every client and
-- makes id/created_at server-controlled by construction rather than by an
-- allowlist that has to be maintained.

-- ============================================================
-- record_listing_impression
-- ============================================================
-- SECURITY DEFINER because the caller has no write privilege on the table at
-- all -- the same shape as attach_listing_image, which is likewise the sole
-- writer of listing_images.
--
-- The signature accepts NO user parameter, so a caller cannot assert whose
-- impression this is; auth.uid() is the only source. (auth.uid() still
-- resolves to the caller inside a DEFINER function: it reads the
-- request.jwt.claims GUC, which is session state and unaffected by the role
-- switch.)

create or replace function public.record_listing_impression(
  p_listing_id uuid,
  p_session_id text,
  p_feed_position integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_session_id is null or char_length(p_session_id) not between 8 and 64 then
    raise exception 'A session token is required' using errcode = 'P0001';
  end if;

  if p_feed_position is not null and p_feed_position < 0 then
    raise exception 'Feed position must be non-negative' using errcode = 'P0001';
  end if;

  -- Eligibility must match the feed contract exactly -- active AND at least
  -- one attached image -- so the signal cannot be seeded with drafts,
  -- imageless listings that could never have been shown, other sellers'
  -- private rows, or invented ids.
  if not exists (
    select 1
      from public.listings l
     where l.id = p_listing_id
       and l.status = 'active'
       and exists (
         select 1 from public.listing_images li where li.listing_id = l.id
       )
  ) then
    raise exception 'Listing is not available' using errcode = 'P0002';
  end if;

  insert into public.listing_events (
    user_id, listing_id, event_type, session_id, feed_position
  )
  values (v_user_id, p_listing_id, 'impression', p_session_id, p_feed_position)
  -- Bare DO NOTHING, with no conflict target, catches ANY unique violation
  -- including one raised by the PARTIAL index above -- an explicit target
  -- would have to restate that index's WHERE predicate. So a repeated
  -- impression is a silent no-op rather than a 23505 the client would have
  -- to distinguish from a genuine failure.
  on conflict do nothing;
end;
$$;

revoke all    on function public.record_listing_impression(uuid, text, integer) from public;
revoke all    on function public.record_listing_impression(uuid, text, integer) from anon;
grant execute on function public.record_listing_impression(uuid, text, integer) to authenticated;
