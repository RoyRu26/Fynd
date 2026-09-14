-- Server-controlled listing RPCs: attach_listing_image,
-- set_listing_image_order, publish_listing.
--
-- All three are SECURITY DEFINER PostgREST RPCs rather than Edge Functions:
-- each is pure data validation over rows the database already holds, so it
-- is transactional by construction, needs no secrets, adds no deploy
-- surface, and is testable with the pgTAP harness that already exists.
-- Edge Functions earn their keep when external calls or server-only secrets
-- are involved -- that is the AI phase, deliberately not this one.
--
-- Shared hardening, applied identically to all three:
--
--   * `set search_path = ''` + every object fully qualified. Stricter than
--     the existing handle_new_user, which pins search_path = public.
--   * The signature never accepts a caller identity. Only ids come in; the
--     caller is derived from auth.uid() inside the function, so a caller
--     cannot assert who they are.
--   * Ownership is compared with IS DISTINCT FROM, never <>. With <>, a NULL
--     auth.uid() yields NULL, the IF is not taken, and the ownership check is
--     silently SKIPPED.
--   * `for update` on the listing row, so concurrent calls serialise.
--   * EXECUTE revoked from PUBLIC *and* anon separately. pg_default_acl on
--     this database grants EXECUTE on every new public function to PUBLIC,
--     anon, authenticated and service_role automatically -- verified, not
--     assumed -- and REVOKE ... FROM PUBLIC does not remove the direct anon
--     grant. They are distinct grantees; both must be revoked.
--
-- SECURITY DEFINER bypasses RLS (the owning `postgres` role has BYPASSRLS),
-- so the in-function ownership check is the only thing standing between a
-- caller and someone else's row -- hence writing it defensively against NULL.

-- ============================================================
-- attach_listing_image
-- ============================================================
-- The sole write path into listing_images: Phase 1 revoked direct INSERT
-- from the client entirely. That is what makes the 10-photo cap below
-- authoritative -- a count cap cannot be expressed as a CHECK constraint,
-- and would be meaningless if the client could also insert directly.

create or replace function public.attach_listing_image(
  p_listing_id   uuid,
  p_storage_path text
)
returns public.listing_images
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing         public.listings;
  v_existing        public.listing_images;
  v_row             public.listing_images;
  v_count           integer;
  v_next            integer;
  v_expected_prefix text;
  c_max_photos      constant integer := 10;
begin
  if p_storage_path is null or btrim(p_storage_path) = '' then
    raise exception 'A storage path is required' using errcode = 'P0001';
  end if;

  -- Lock the listing: serialises concurrent attaches so position allocation
  -- and the photo cap cannot race.
  select * into v_listing from public.listings
   where id = p_listing_id
   for update;

  if not found then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;

  if v_listing.seller_id is distinct from (select auth.uid()) then
    raise exception 'Not your listing' using errcode = '42501';
  end if;

  if v_listing.status <> 'draft' then
    raise exception 'Photos can only be attached to a draft' using errcode = 'P0001';
  end if;

  -- The path must sit under the caller's own uid AND under this listing.
  -- Checked here as well as in the Storage INSERT policy: the policy governs
  -- who may create the object, this governs which listing row may claim it.
  v_expected_prefix := (select auth.uid())::text || '/' || p_listing_id::text || '/';
  if left(p_storage_path, length(v_expected_prefix)) <> v_expected_prefix then
    raise exception 'Storage path does not belong to this listing' using errcode = '42501';
  end if;

  -- Safe retry. The client's upload -> attach sequence can be interrupted
  -- (app killed mid-flight) and retried; the same path attached twice returns
  -- the existing row rather than erroring or duplicating. Backed by the
  -- global unique index on storage_path.
  select * into v_existing from public.listing_images
   where storage_path = p_storage_path;

  if found then
    if v_existing.listing_id <> p_listing_id then
      raise exception 'That object is attached to another listing' using errcode = '42501';
    end if;
    return v_existing;
  end if;

  -- The object must actually exist. Without this a phantom row could be
  -- attached, and publish_listing would count it as a real photo.
  if not exists (
    select 1 from storage.objects
     where bucket_id = 'listing-images' and name = p_storage_path
  ) then
    raise exception 'No uploaded file at that path' using errcode = 'P0001';
  end if;

  select count(*) into v_count
    from public.listing_images where listing_id = p_listing_id;

  if v_count >= c_max_photos then
    raise exception 'A listing can have at most % photos', c_max_photos
      using errcode = 'P0001';
  end if;

  -- Position is allocated server-side, under the row lock taken above. The
  -- client never supplies one. Gaps left by removals are fine: ordering is
  -- by position, and set_listing_image_order renormalises to 0..n-1.
  select coalesce(max("position") + 1, 0) into v_next
    from public.listing_images where listing_id = p_listing_id;

  insert into public.listing_images (listing_id, storage_path, "position")
  values (p_listing_id, p_storage_path, v_next)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all    on function public.attach_listing_image(uuid, text) from public;
revoke all    on function public.attach_listing_image(uuid, text) from anon;
grant execute on function public.attach_listing_image(uuid, text) to authenticated;

-- ============================================================
-- set_listing_image_order
-- ============================================================
-- Requires the COMPLETE set of image ids, not a partial rearrangement:
-- a partial array cannot express a total order, and renormalising around
-- absent rows would silently collide with them.

create or replace function public.set_listing_image_order(
  p_listing_id uuid,
  p_image_ids  uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing public.listings;
  v_total   integer;
begin
  if p_image_ids is null or array_length(p_image_ids, 1) is null then
    raise exception 'No image order provided' using errcode = 'P0001';
  end if;

  -- Duplicates would leave two images fighting for one position and strand a
  -- third at its old index.
  if (select count(distinct x) from unnest(p_image_ids) as x)
     <> array_length(p_image_ids, 1) then
    raise exception 'Duplicate image ids' using errcode = 'P0001';
  end if;

  select * into v_listing from public.listings
   where id = p_listing_id
   for update;

  if not found then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;

  if v_listing.seller_id is distinct from (select auth.uid()) then
    raise exception 'Not your listing' using errcode = '42501';
  end if;

  if v_listing.status <> 'draft' then
    raise exception 'Photos can only be reordered on a draft' using errcode = 'P0001';
  end if;

  -- Cross-owner / cross-listing defence: every id must belong to THIS
  -- listing. Without it the definer context would happily rewrite the
  -- position of another seller's image.
  if exists (
    select 1 from unnest(p_image_ids) as pid
     where not exists (
       select 1 from public.listing_images li
        where li.id = pid and li.listing_id = p_listing_id
     )
  ) then
    raise exception 'Image does not belong to this listing' using errcode = '42501';
  end if;

  select count(*) into v_total
    from public.listing_images where listing_id = p_listing_id;

  if v_total <> array_length(p_image_ids, 1) then
    raise exception 'Image order must include every image' using errcode = 'P0001';
  end if;

  -- Every position is rewritten in one statement. This is only legal because
  -- listing_images_unique_position is DEFERRABLE INITIALLY DEFERRED: the
  -- intermediate states collide, the final state does not.
  update public.listing_images li
     set "position" = ord.idx - 1
    from unnest(p_image_ids) with ordinality as ord(image_id, idx)
   where li.id = ord.image_id
     and li.listing_id = p_listing_id;
end;
$$;

revoke all    on function public.set_listing_image_order(uuid, uuid[]) from public;
revoke all    on function public.set_listing_image_order(uuid, uuid[]) from anon;
grant execute on function public.set_listing_image_order(uuid, uuid[]) to authenticated;

-- ============================================================
-- publish_listing
-- ============================================================
-- The only path from 'draft' to 'active'. The client holds no INSERT or
-- UPDATE privilege on listings.status at all (Phase 1), so this function is
-- the entire transition surface.

create or replace function public.publish_listing(p_listing_id uuid)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing     public.listings;
  v_image_count integer;
begin
  select * into v_listing from public.listings
   where id = p_listing_id
   for update;

  if not found then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;

  if v_listing.seller_id is distinct from (select auth.uid()) then
    raise exception 'Not your listing' using errcode = '42501';
  end if;

  -- `for update` above serialises concurrent publishes, so the second caller
  -- reaches this check after the first has committed and sees a non-draft.
  if v_listing.status <> 'draft' then
    raise exception 'Only drafts can be published' using errcode = 'P0001';
  end if;

  -- Trimmed, matching listings_title_length exactly, so the constraint and
  -- this validation agree rather than silently diverging.
  if v_listing.title is null or char_length(btrim(v_listing.title)) < 3 then
    raise exception 'A title of at least 3 characters is required' using errcode = 'P0001';
  end if;

  if v_listing.price_amount is null or v_listing.price_amount <= 0 then
    raise exception 'A price greater than zero is required' using errcode = 'P0001';
  end if;

  if v_listing.condition is null then
    raise exception 'A condition is required' using errcode = 'P0001';
  end if;

  select count(*) into v_image_count
    from public.listing_images where listing_id = p_listing_id;

  if v_image_count < 1 then
    raise exception 'At least one photo is required' using errcode = 'P0001';
  end if;

  -- Attachments are trustworthy at creation time (attach_listing_image
  -- verifies the object exists), but an object can be deleted afterwards
  -- while the listing is still a draft -- the remove flow deletes the DB row
  -- first and the object second, and a crash between the two inverts that.
  -- Re-verify here, so a published listing can never reference a file that
  -- is not there.
  if exists (
    select 1 from public.listing_images li
     where li.listing_id = p_listing_id
       and not exists (
         select 1 from storage.objects o
          where o.bucket_id = 'listing-images'
            and o.name = li.storage_path
       )
  ) then
    raise exception 'A photo is missing its uploaded file' using errcode = 'P0001';
  end if;

  update public.listings set status = 'active'
   where id = p_listing_id
   returning * into v_listing;

  return v_listing;
end;
$$;

revoke all    on function public.publish_listing(uuid) from public;
revoke all    on function public.publish_listing(uuid) from anon;
grant execute on function public.publish_listing(uuid) to authenticated;
