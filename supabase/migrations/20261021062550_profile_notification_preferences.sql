-- ROADMAP 6.1a "Settings" (lower-risk half; account deletion is a separate,
-- later 6.1b pass and is NOT part of this migration).
--
-- Adds three per-profile notification-preference toggles so the Settings
-- screen's switches persist a REAL preference rather than being dead UI.
--
-- Why now, ahead of push notifications: ROADMAP 5.5 "Push notifications" is
-- deferred and not built yet -- there is no delivery mechanism that reads
-- these columns today. But 6.1's Settings screen needs somewhere real to
-- write a toggle's value, and shipping the columns now means 5.5, whenever
-- it lands, reads an existing, already-populated preference instead of
-- 6.1 leaving a dangling future-migration dependency on 5.5. The columns are
-- additive and inert until a notification sender exists to consult them.
--
-- Defaults are `true` (opt-out, not opt-in) -- the conventional default for
-- this class of preference, and it means every existing row is immediately
-- well-formed with no backfill step.
--
-- No RLS policy change: "Users can update own profile" (`for update to
-- authenticated using (auth.uid() = id) with check (auth.uid() = id)`,
-- defined in 20260829142345_initial_marketplace_schema.sql) already scopes
-- UPDATE to the caller's own row, and that scoping applies to any column the
-- caller has column-level UPDATE privilege on -- which is exactly what the
-- grant below adds. Only the column-privilege allowlist
-- (20261014112232_profile_bio_and_avatars.sql's pattern) needs extending.

alter table public.profiles
  add column notify_new_message  boolean not null default true,
  add column notify_new_review   boolean not null default true,
  add column notify_new_follower boolean not null default true;

-- Column-level UPDATE allowlist, same convention as
-- 20261014112232_profile_bio_and_avatars.sql's `grant update (username,
-- display_name, bio, avatar_path) on public.profiles to authenticated` --
-- table-level UPDATE was already revoked there, so this only needs to add
-- the three new columns to the existing allowlist, not repeat the revoke.
grant update (notify_new_message, notify_new_review, notify_new_follower)
  on public.profiles to authenticated;
