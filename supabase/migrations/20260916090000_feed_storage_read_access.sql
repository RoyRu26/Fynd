-- Home feed read access for listing images.
--
-- Until now the Storage SELECT policy was owner-scoped:
--
--     (storage.foldername(name))[1] = auth.uid()::text
--
-- so a buyer could not read ANY other seller's image object -- no signed
-- URL, no download. That blocks the discovery feed entirely.
--
-- The obvious widening -- "allow it when path segment 2 names an active
-- listing" -- is WRONG, and the reason is not visible from the path
-- convention alone:
--
--   The upload pipeline is `upload object` THEN `attach_listing_image`.
--   A failure between those two steps deliberately leaves the object in
--   place with NO listing_images row pointing at it (an orphan is safer
--   than a row pointing at a missing file -- see images.ts). Those orphans
--   are photos the seller uploaded and then did NOT attach: retries,
--   rejects, changes of mind. If that listing were later published, a
--   path-only rule would silently expose every one of them to every
--   authenticated user.
--
-- So cross-seller access is granted on the ATTACHMENT, never on the path:
-- there must be a real listing_images row whose storage_path equals this
-- exact object's name, whose parent listing is active. The path's listing
-- segment is not treated as evidence of anything.

drop policy "Sellers read own listing objects" on storage.objects;

create policy "Sellers read own objects and attached active listing images"
on storage.objects for select to authenticated
using (
  bucket_id = 'listing-images'
  and (
    -- Own objects in any state. Drafts stay private to their seller, and
    -- orphans from a failed attach stay readable to the seller who uploaded
    -- them -- which is also what lets the client clean them up later.
    (storage.foldername(name))[1] = (select auth.uid())::text
    -- Or: this exact object is attached to a listing that is active.
    -- Keyed on storage_path, which carries a UNIQUE index
    -- (listing_images_storage_path_key), so this is an index lookup.
    --
    -- The subquery runs as the CALLER, so RLS on listing_images and
    -- listings applies to it as well: another seller's draft images are
    -- already invisible here, and the explicit status = 'active' below is
    -- the second, independent reason the same rows are excluded.
    or exists (
      select 1
        from public.listing_images li
        join public.listings l on l.id = li.listing_id
       where li.storage_path = storage.objects.name
         and l.status = 'active'
    )
  )
);
