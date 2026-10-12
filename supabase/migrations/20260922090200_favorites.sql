-- Favorites -- the durable record of what a user has saved.
--
-- DESIGN.md §14.1 puts Favorite in tier 2 alongside Price, and §16.5 tracks
-- the missing table as one of the gaps blocking that hierarchy. This closes
-- it.
--
-- Relationship to listing_events, stated explicitly so the two never drift
-- into duplicating each other:
--
--   * `favorites` is the source of truth for CURRENT STATE -- is this
--     listing saved right now. The feed reads it, the heart renders from it.
--   * `listing_events` is HISTORY -- a future recommender's training signal.
--     The 'favorite'/'unfavorite' labels are added below so that recording
--     that history later is a client change rather than a migration, but
--     NOTHING emits them in this slice. There is no duplicated state
--     because there is exactly one writer of each.

create table public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- The composite PK is the unique (user, listing) pair -- no separate
  -- surrogate id and no separate unique index needed. A double-tap race
  -- resolves to 23505 rather than two rows.
  primary key (user_id, listing_id)
);

-- The PK already indexes (user_id, listing_id) for "has THIS user favorited
-- THIS listing", which is what the feed asks. This covers the other
-- direction -- "how many favorites does this listing have" -- which a
-- future favorite count on the card or in ranking will want.
create index favorites_listing_id_idx on public.favorites (listing_id);

alter table public.favorites enable row level security;

create policy "Users read own favorites"
on public.favorites for select to authenticated
using (user_id = (select auth.uid()));

-- Only ACTIVE listings may be favorited. The subquery runs as the CALLER,
-- so RLS on public.listings applies to it too: another seller's draft is
-- already invisible here, and the explicit status check is the second,
-- independent reason the same rows are refused. Nobody can seed a favorite
-- against a draft, someone else's private row, or an invented id.
create policy "Users favorite active listings"
on public.favorites for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.listings l
     where l.id = listing_id
       and l.status = 'active'
  )
);

-- Unfavoriting stays possible even if the listing later leaves 'active'
-- (sold, removed). Deliberately NOT mirroring the insert policy's status
-- check: a user must always be able to clear their own saved item, and
-- trapping a favorite on a sold listing would be a bug, not a safeguard.
create policy "Users remove own favorites"
on public.favorites for delete to authenticated
using (user_id = (select auth.uid()));

-- pg_default_acl grants arwdDxtm to anon and authenticated on every new
-- relation in this schema, so the blanket revoke is what makes the grants
-- below load-bearing rather than decorative.
revoke all on public.favorites from anon, authenticated;

grant select, delete on public.favorites to authenticated;

-- Column allowlist: created_at is absent, so it is server-controlled and a
-- client cannot forge when something was saved. No UPDATE grant at all --
-- a favorite is inserted or deleted, never edited.
--
-- No RPC wrapper here, unlike record_listing_impression: that one existed
-- because the client had to be kept from asserting a user_id on a table it
-- held no privilege on. Here RLS pins user_id to auth.uid() on the way in,
-- the column allowlist covers created_at, and there is nothing else
-- server-derived -- so direct table access is already fully constrained,
-- the same way listings DELETE is.
grant insert (user_id, listing_id) on public.favorites to authenticated;

-- Schema-ready, unemitted. See the header note above.
alter type public.listing_event_type add value 'favorite';
alter type public.listing_event_type add value 'unfavorite';
