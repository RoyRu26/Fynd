-- Reports -- user-filed reports against a listing or another user.
-- ROADMAP 5.1 "Report a listing or user (reason + note) from the feed
-- 'more' menu, listing detail and profiles." §5 is "Trust & safety" --
-- this is the first table in that milestone, and the first moderation-
-- shaped table in the app at all.
--
-- One table, not two (`listing_reports` + `user_reports`), with an XOR
-- CHECK picking exactly one target. A report against a listing and a
-- report against a person are the same write path (one reporter, one
-- reason, one optional note) and will be the same admin query surface
-- later ("show me open reports, newest first") -- splitting that into two
-- near-duplicate tables would just mean two insert policies, two RLS
-- definitions, and a UNION at read time for no benefit. The CHECK is the
-- mechanism that keeps a row from quietly meaning both, or neither.
--
-- READ POLICY: THERE IS NONE. Not owner-scoped like `favorites`' "Users
-- read own favorites" -- no SELECT policy and no SELECT grant to anon or
-- authenticated AT ALL. ROADMAP's own words are "insert-only for users",
-- which is a stronger claim than "read your own": a reporter should not
-- even be able to confirm their own report still exists, let alone read
-- anyone else's, since that could leak who-reported-whom or let a bad
-- actor fingerprint what gets them flagged. `service_role` bypasses RLS by
-- default and is the only reader today. There is no admin role or screen
-- anywhere in this app yet -- building one is explicitly out of scope for
-- this item; a future admin surface reads via `service_role` (an Edge
-- Function or dashboard), not by this table ever growing a SELECT policy
-- for `authenticated`.
--
-- Self-reporting is blocked in the INSERT policy's WITH CHECK, mirroring
-- `follows_not_self`'s belt-and-suspenders style: a CHECK constraint and an
-- RLS policy doing two independent jobs rather than one covering for the
-- other. Here the self-check can't be a table CHECK constraint (it needs
-- to look up the listing's `seller_id`, which only RLS's WITH CHECK can
-- join against), so the "both layers independently refuse the bad case"
-- shape instead shows up as the WITH CHECK clause being the only gate, with
-- the listing's own RLS-filtered visibility as the second, independent
-- reason a forged/invented target is refused (same belt-and-suspenders
-- shape `favorites_user_favorite_active_listings` already uses).
--
-- Two partial unique indexes -- one per target column -- exist purely as
-- the same cheap duplicate-tap guard `favorites`/`follows` get for free from
-- their composite primary keys (this table needs a surrogate `id` instead,
-- since exactly one of the two target columns is set per row, so a
-- composite PK across both doesn't work). This is NOT rate limiting. A
-- determined bad actor can still file unlimited reports against different
-- targets, or wait and refile against the same one after... nothing, since
-- there's no expiry here either. Real cross-target rate limiting, shaped
-- like 4.2's message-send throttle, is explicitly NOT built in this slice --
-- flagged here as a deliberate, known deferral for a later trust & safety
-- pass, not a silent gap.
create type public.report_reason as enum (
  'spam',
  'prohibited_item',
  'scam_or_fraud',
  'inappropriate_content',
  'harassment',
  'other'
);

create table public.reports (
  id bigint generated always as identity primary key,
  -- reporter_id cascades -- losing attribution when the reporter's own
  -- account goes away is fine. listing_id/reported_user_id do NOT: both
  -- are SET NULL, not CASCADE, because a report is moderation evidence
  -- ("this listing was reported 5 times before it was removed/the seller
  -- vanished") that must survive the thing it was filed against being
  -- deleted. This is the exact bug class 20261019113250_ai_suggestion_calls.sql
  -- already caught and fixed once in this repo (a CASCADE there let a user
  -- erase their own rate-limit history by deleting the draft it was
  -- recorded against) -- not currently exploitable here (sellers can only
  -- self-delete DRAFT listings, and there is no self-service account
  -- deletion anywhere in this app yet), but fixing it now costs nothing and
  -- avoids the same landmine resurfacing the moment either of those ships.
  reporter_id uuid not null references auth.users (id) on delete cascade,
  listing_id uuid references public.listings (id) on delete set null,
  reported_user_id uuid references auth.users (id) on delete set null,
  reason public.report_reason not null,
  note text,
  created_at timestamptz not null default now(),

  -- AT MOST one target here, not exactly one -- deliberately looser than
  -- it first looks. `ON DELETE SET NULL` above performs an internal
  -- UPDATE, and CHECK constraints re-run on every UPDATE, not just INSERT
  -- (caught live during review: with `= 1`, cascading a listing's deletion
  -- made its own report row fail reports_exactly_one_target the instant
  -- listing_id went to null, since reported_user_id was never set on that
  -- row either -- the SET NULL fix above was actively self-defeating until
  -- this was loosened). "Exactly one, at insert time" is still enforced --
  -- by the INSERT policy's WITH CHECK below, whose two-armed OR structure
  -- can only ever admit a listing-with-no-user row or a user-with-no-
  -- listing row, never both-null or both-set. This CHECK's only remaining
  -- job is the invariant RLS can't cover: "both columns set" must never be
  -- allowed, at insert OR afterward, under ANY role including service_role
  -- (which bypasses RLS entirely) -- `<= 1` still rejects that in every
  -- case, while tolerating the legitimate both-null state a historical
  -- row can genuinely reach post-cascade.
  constraint reports_at_most_one_target check (
    (listing_id is not null)::int + (reported_user_id is not null)::int <= 1
  ),
  -- 'other' is the one reason that gives the reporter no structure to lean
  -- on, so it is the one reason a note is mandatory for -- every other
  -- reason is already self-explanatory from its label. A plain
  -- `char_length(btrim(note)) > 0` check is not enough: `btrim` with no
  -- explicit character argument only strips 0x20 (ASCII space), so a note
  -- that is only a tab, newline, or no-break space would pass that check
  -- while being functionally content-free. The regex rejects any note that
  -- is entirely whitespace -- POSIX [:space:] (space/tab/newline/CR/FF/VT)
  -- plus chr(160) (U+00A0, no-break space) appended explicitly, built via
  -- concatenation rather than a literal Unicode character in this file's
  -- own source (verified live during review against a tab-only and a
  -- no-break-space-only note, both correctly rejected).
  constraint reports_other_reason_requires_note
    check (
      reason <> 'other'
      or (note is not null and note !~ ('^[[:space:]' || chr(160) || ']*$'))
    ),
  constraint reports_note_length
    check (note is null or char_length(note) <= 1000)
);

-- One partial unique index per target column, not a single composite one
-- across both -- each row only ever populates one of the two columns (per
-- the XOR check above), so a unique index over `(reporter_id, listing_id)`
-- would never collide on a row whose `listing_id` is null regardless of how
-- many times A reports B-the-user, and vice versa. See the header note for
-- why this is a duplicate-tap guard, not rate limiting.
create unique index reports_unique_reporter_listing
  on public.reports (reporter_id, listing_id) where listing_id is not null;
create unique index reports_unique_reporter_user
  on public.reports (reporter_id, reported_user_id) where reported_user_id is not null;

-- Lookup indexes for whichever target column is set -- a future admin
-- surface's "show me every report against this listing / this user".
create index reports_listing_id_idx on public.reports (listing_id) where listing_id is not null;
create index reports_reported_user_id_idx on public.reports (reported_user_id) where reported_user_id is not null;

alter table public.reports enable row level security;

-- No SELECT policy at all. See the header note above -- this is deliberate
-- and stronger than every other table's read shape in this codebase.

create policy "Users file reports as themselves, never against their own target"
on public.reports for insert to authenticated
with check (
  reporter_id = (select auth.uid())
  and (
    (listing_id is not null and reported_user_id is null and exists (
       select 1 from public.listings l
        where l.id = listing_id and l.seller_id <> (select auth.uid())
    ))
    or
    (reported_user_id is not null and listing_id is null and reported_user_id <> (select auth.uid()))
  )
);

-- pg_default_acl grants arwdDxtm to anon and authenticated on every new
-- relation in this schema, so the blanket revoke is what makes the grant
-- below load-bearing rather than decorative.
revoke all on public.reports from anon, authenticated;

-- The table-level revoke above does NOT touch the identity column's
-- backing sequence -- pg_default_acl grants rwU on every new sequence too,
-- independently of the table grant, and Postgres does not require a
-- caller to hold any privilege on a column's identity sequence in order to
-- insert into the column itself (advancing it happens internally). Left
-- alone, this would contradict this table's own "not even a reporter can
-- confirm their own report still exists" claim: any anon/authenticated
-- caller could run `select last_value from public.reports_id_seq` and
-- infer total report volume and filing velocity from the counter, with no
-- row-level access needed at all. Revoked explicitly, verified live
-- during review that this breaks nothing (an authenticated INSERT still
-- succeeds with zero privilege on the sequence) while anon/authenticated
-- both get a clean permission-denied reading it directly.
revoke all on public.reports_id_seq from anon, authenticated;

-- Column allowlist: `reporter_id` is included (unlike `favorites.created_at`
-- or `follows.created_at`, which are server-controlled and absent) because,
-- mirroring `favorites.user_id`/`follows.follower_id`, the client sets it
-- explicitly to its own id and the WITH CHECK above verifies the match --
-- same shape as every other owner-pinned column in this codebase, not a
-- server-default trigger. `created_at` is absent -- server-controlled.
-- No SELECT, UPDATE, or DELETE grant to anon/authenticated at all --
-- "insert-only for users" per ROADMAP. service_role bypasses RLS by
-- default and is the only reader today; there is no admin screen in this
-- app yet and building one is explicitly out of scope for this item.
grant insert (reporter_id, listing_id, reported_user_id, reason, note) on public.reports to authenticated;
