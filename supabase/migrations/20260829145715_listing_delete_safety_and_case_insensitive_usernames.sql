-- ============================================================
-- LISTING DELETE SAFETY
-- ============================================================
-- Sellers could previously hard-delete a listing in any status. Once other
-- tables (favorites, orders, ai analyses, ...) reference listings by id,
-- deleting a non-draft listing risks destroying history that must be kept.
-- Non-draft listings must be retired through a status transition (e.g.
-- removed) instead of a destructive delete. Ownership is still required.

alter policy "Users can delete own listings"
on public.listings
using (
  auth.uid() = seller_id
  and status = 'draft'
);

-- ============================================================
-- CASE-INSENSITIVE USERNAMES
-- ============================================================
-- "Roy" and "roy" must occupy the same username namespace.
--
-- Chosen approach: a unique index on lower(username), not citext.
-- citext would change the column's underlying type and require enabling
-- an extension in every environment the schema is applied to. A functional
-- unique index enforces the same case-insensitive constraint at the
-- database level without touching the column type, the existing
-- username_length check constraint, or generated TypeScript types.
-- Future lookups can filter with lower(username) = lower($1) or ilike.

alter table public.profiles
drop constraint if exists profiles_username_key;

create unique index profiles_username_lower_idx
on public.profiles (lower(username));
