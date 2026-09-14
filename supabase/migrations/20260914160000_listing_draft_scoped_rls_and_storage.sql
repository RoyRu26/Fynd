-- Draft-scoped image RLS, listing_images integrity, and the private
-- listing-images Storage bucket + policies.
--
-- Phase 1 locked down the listings table itself. This migration extends the
-- same rule -- "an owned DRAFT is the only mutable state" -- to image rows
-- and to the Storage objects those rows point at.

-- ============================================================
-- 1. listing_images: direct DELETE becomes draft-scoped
-- ============================================================
-- The existing policy was owner-scoped only, so a seller could still remove
-- photos from an already-active listing through the ordinary REST path.
-- Phase 1 flagged this as a known temporary gap; this closes it.
--
-- INSERT/UPDATE need no policy work here: Phase 1 revoked both privileges
-- outright and dropped the (then-dead) policies. Attaching and reordering
-- are RPC-only from here on.

drop policy "Users can delete images from own listings" on public.listing_images;

create policy "Users can delete images from own draft listings"
on public.listing_images for delete to authenticated
using (
  exists (
    select 1 from public.listings l
     where l.id = listing_id
       and l.seller_id = (select auth.uid())
       and l.status = 'draft'
  )
);

-- ============================================================
-- 2. listing_images integrity
-- ============================================================

-- Global, not per-listing. One uploaded object can only ever back one image
-- row -- which is both a hard guarantee against double-attachment and the
-- idempotency anchor attach_listing_image keys its safe-retry behaviour off.
-- Paths embed a uuid, so cross-seller collisions are not a concern.
create unique index listing_images_storage_path_key
  on public.listing_images (storage_path);

-- Reordering rewrites every position in one statement, which transiently
-- collides on (listing_id, position) under a non-deferrable constraint.
-- Deferring the check to commit is what makes set_listing_image_order
-- possible at all. (It is also why client-side reorder provably cannot
-- work: PostgREST gives the client no transaction to defer within.)
alter table public.listing_images
  drop constraint listing_images_unique_position,
  add  constraint listing_images_unique_position
       unique (listing_id, "position") deferrable initially deferred;

-- ============================================================
-- 3. Private Storage bucket
-- ============================================================
-- Path convention: {seller_id}/{listing_id}/{image_uuid}.jpg
--
-- Segment 1 makes the owner checkable without a table lookup; segment 2 is
-- what lets both write policies verify draft status, and makes a future
-- orphan sweep a prefix-list-and-diff.
--
-- Private is correct for this slice: the only reader is the seller viewing
-- their own draft, via a signed URL. The public-feed read path is a
-- genuinely different problem (CDN caching, no per-image round trip) and is
-- deliberately left to be decided when the feed is built.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-images', 'listing-images', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

-- ============================================================
-- 4. Storage policies -- least privilege, split by command
-- ============================================================
-- storage.objects is RLS-enabled with zero existing policies, so absence of
-- a policy is already a denial. Notably there is NO UPDATE policy: objects
-- are immutable, and replacing a photo means delete + upload to a fresh
-- uuid path. That is also why no storage-wide grant changes are needed --
-- those would affect every future bucket, not just this one.
--
-- A note on how the listings subqueries below behave: they run as the
-- CALLER, so RLS on public.listings applies to them ("active OR own"). That
-- is deliberate and safe here -- another seller's draft is invisible, which
-- only ever makes these checks stricter for INSERT, and for DELETE is
-- immaterial because segment 1 already pins every path to the caller's own
-- prefix (see the walkthrough above the DELETE policy).

create policy "Sellers read own listing objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'listing-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- INSERT is the strict one: it demands a listing that currently exists, is
-- the caller's, and is still a draft. An object can therefore never be
-- CREATED under a nonexistent listing id, which is what keeps the DELETE
-- policy's orphan branch below reachable only as a consequence of deleting
-- a listing -- never as an entry point.
create policy "Sellers upload to own draft listings"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'listing-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.listings l
     where l.id::text = (storage.foldername(name))[2]
       and l.seller_id = (select auth.uid())
       and l.status = 'draft'
  )
);

-- DELETE tolerates the listing being ABSENT, because listings ->
-- listing_images cascades: deleting a whole draft removes the image rows but
-- leaves the objects behind. A policy that required status = 'draft' could
-- never authorise cleaning those up, so every deleted draft would strand its
-- photos permanently.
--
-- Why the `not exists` branch is safe -- segment 1 is checked
-- unconditionally, so a caller can only ever reach objects under their own
-- uid prefix, and the INSERT policy above means only they could have put
-- anything there:
--
--   {me}/{my draft}/x.jpg                    allowed  (first branch)
--   {me}/{my active listing}/x.jpg           denied   (exists, not a draft)
--   {me}/{deleted listing}/x.jpg             allowed  (my own orphan)
--   {other}/...            (any state)       denied   (segment 1)
--   {me}/{another seller's active}/x.jpg     denied   (listing exists)
--   {me}/{another seller's deleted}/x.jpg    allowed  -- but it is under MY
--                                            prefix, so it is mine to delete
--
-- l.id::text = <segment> is text-to-text, so a malformed segment simply
-- fails to match rather than raising a cast error. A path with fewer than
-- two segments yields a NULL segment 2, making exists false and not-exists
-- true -- deletable, but only by the prefix owner, and unreachable through
-- INSERT in the first place.
create policy "Sellers delete own draft or orphaned listing objects"
on storage.objects for delete to authenticated
using (
  bucket_id = 'listing-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (
    exists (
      select 1 from public.listings l
       where l.id::text = (storage.foldername(name))[2]
         and l.seller_id = (select auth.uid())
         and l.status = 'draft'
    )
    or not exists (
      select 1 from public.listings l
       where l.id::text = (storage.foldername(name))[2]
    )
  )
);
