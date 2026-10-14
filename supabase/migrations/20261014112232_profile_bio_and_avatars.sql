-- ROADMAP 1.7 "Edit profile + avatars."
--
-- Three independent additions, landed together because all three are the
-- same gap: `profiles` grew without ever getting the writable-column
-- privilege allowlist `20260914151000_listings_column_privilege_allowlist.sql`
-- gave `listings`, and avatars have never had anywhere to upload to.
--
-- ============================================================
-- 1. bio
-- ============================================================
-- Nullable, same convention as display_name: NULL means "not set," and when
-- present the TRIMMED value must be <= 160 characters. Unlike display_name
-- there is no minimum -- an empty/whitespace-only bio is normalized to NULL
-- client-side (see profile/profile.ts's normalizeBio) rather than rejected,
-- since "no bio" and "empty bio" are the same thing and there is no reason
-- to make the database the one place that distinction is enforced.

alter table public.profiles add column bio text;

alter table public.profiles add constraint profiles_bio_length
  check (bio is null or char_length(btrim(bio)) <= 160);

-- ============================================================
-- 2. Writable-column privilege allowlist for profiles
-- ============================================================
-- Audited on the running local DB before this migration: pg_class.relacl
-- showed anon and authenticated both holding full table-level privileges
-- (arwdDxtm) on profiles, and pg_attribute.attacl was NULL on every column --
-- zero true column-level grants exist. Exactly the same situation
-- the listings migration documented, for the same reason: a column-level
-- REVOKE alone would be a no-op without the blanket table-level REVOKE
-- first, since a statement succeeds if EITHER table-level or column-level
-- privilege is satisfied.
--
-- Before this migration, "Users can update own profile" (auth.uid() = id)
-- was the ONLY gate on UPDATE -- meaning an authenticated user could set
-- `created_at` on their own row through the ordinary REST path (updated_at
-- is overwritten by the set_updated_at trigger regardless, and id has no
-- legitimate reason to be client-writable at all once rows are created only
-- by handle_new_user).

revoke all on public.profiles from anon, authenticated;

-- SELECT stays table-level for both roles; RLS ("Profiles are publicly
-- readable", `using (true)`) does the actual scoping -- unchanged from
-- before this migration.
grant select on public.profiles to anon, authenticated;

-- Column-level UPDATE allowlist. `id`, `created_at`, and `updated_at` are
-- deliberately excluded: `id` is assigned once by handle_new_user and never
-- legitimately changes, `created_at` is server-owned, and `updated_at` is
-- owned by the set_updated_at trigger. There is no INSERT grant at all --
-- rows are created exclusively by handle_new_user's SECURITY DEFINER
-- trigger, never by a direct client INSERT.
grant update (username, display_name, bio, avatar_path) on public.profiles to authenticated;

-- ============================================================
-- 3. avatars Storage bucket + policies
-- ============================================================
-- Path convention: {user_id}/{image_id}.jpg -- two segments, not three like
-- listing-images, because an avatar has no parent listing to scope against.
-- Segment 1 is what both write policies check against auth.uid().
--
-- Deliberately simpler than listing-images: no draft/active lifecycle, so
-- no EXISTS subquery against another table is needed in any policy. No
-- UPDATE policy either -- objects are immutable, and replacing an avatar is
-- delete + upload to a fresh image id, same convention as listing-images.
--
-- The SELECT policy is the one deliberate, documented departure from
-- listing-images' own precedent: ANY authenticated user may read ANY
-- avatar object, not just their own. This is intentional, not an oversight
-- -- avatars have no private/draft state to protect (unlike a seller's
-- unpublished listing photos), and every other screen that renders someone
-- else's avatar (seller profile, inbox, listing detail, feed) needs to
-- resolve a signed URL for a storage_path it does not own.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

create policy "Authenticated users can read any avatar"
on storage.objects for select to authenticated
using (bucket_id = 'avatars');

create policy "Users upload their own avatar"
on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users delete their own avatar objects"
on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
