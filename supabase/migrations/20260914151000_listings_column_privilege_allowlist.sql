-- Writable-column privilege allowlist for listings and listing_images.
--
-- Audited on the running local DB before this migration: pg_class.relacl
-- showed anon and authenticated both holding full table-level privileges
-- (arwdDxtm -- insert/select/update/delete/truncate/references/trigger) on
-- both tables, and pg_attribute.attacl was NULL on every column -- i.e.
-- zero true column-level grants exist. A column-level REVOKE alone would
-- therefore be a no-op: PostgreSQL checks table-level and column-level
-- privileges independently and a statement succeeds if EITHER is
-- satisfied, so a standing table-level grant is not diminished by a
-- column-level revoke. The blanket REVOKE ALL below is what makes the
-- column grants that follow load-bearing.

-- ============================================================
-- listings
-- ============================================================

revoke all on public.listings from anon, authenticated;

-- SELECT stays table-level for both roles; RLS ("active OR own") does the
-- actual scoping, same as before this migration.
grant select on public.listings to anon, authenticated;

-- DELETE stays table-level for authenticated only; RLS already restricts
-- it to (auth.uid() = seller_id and status = 'draft') via the delete-safety
-- migration.
grant delete on public.listings to authenticated;

-- Column-level INSERT allowlist. status/currency/created_at/updated_at are
-- deliberately excluded: status is server-controlled (a future publish
-- RPC), currency relies on its 'EUR' default for this slice, and both
-- timestamps are owned by their defaults / the set_updated_at trigger.
-- seller_id IS included here (needed so RLS's WITH CHECK auth.uid() =
-- seller_id can be satisfied on insert) but is deliberately NOT in the
-- UPDATE allowlist below -- that asymmetry is what makes ownership
-- transfer impossible at the privilege layer, not merely via RLS.
grant insert (seller_id, title, description, price_amount, condition)
  on public.listings to authenticated;

-- Column-level UPDATE allowlist. Same exclusions as INSERT, plus seller_id
-- and id are never updatable under any circumstance.
grant update (title, description, price_amount, condition)
  on public.listings to authenticated;

-- Direct client UPDATE is now restricted to owned DRAFTS, not merely owned
-- rows -- closing the gap where a seller could edit title/price/condition
-- on an already-active listing through the ordinary REST path.
alter policy "Users can update own listings" on public.listings
  using (auth.uid() = seller_id and status = 'draft')
  with check (auth.uid() = seller_id and status = 'draft');

-- ============================================================
-- listing_images -- privilege reduction only.
--
-- Draft-scoping this table's RLS, Storage policies, and the attach/reorder
-- RPCs are explicitly out of scope for this phase and land later. This
-- migration only tightens what the client can do today.
-- ============================================================

revoke all on public.listing_images from anon, authenticated;

-- SELECT: unchanged behavior. The existing "follows listing visibility"
-- policy still applies.
grant select on public.listing_images to anon, authenticated;

-- DELETE: unchanged behavior for this phase. The existing delete policy is
-- owner-scoped but NOT YET draft-scoped -- that is a known, deliberate,
-- temporary gap. Until the later phase adds draft-scoping here, a seller
-- can still delete an image row from an already-active listing via the
-- ordinary REST path. Flagged, not fixed in this migration.
grant delete on public.listing_images to authenticated;

-- No INSERT grant, no UPDATE grant: attaching and reordering become
-- RPC-only once those RPCs exist (a later phase). Until then the client
-- has no way to insert or update listing_images rows at all. Stricter than
-- the eventual steady state, but acceptable: no UI depends on direct
-- insert/update yet.

-- The INSERT and UPDATE policies below are now genuinely dead code: with
-- no table-level INSERT/UPDATE privilege granted above, PostgREST's
-- privilege check fails before RLS is ever consulted, so these policies
-- can never be evaluated again. Dropped rather than left standing as
-- misleading dead code that implies RLS is still the active gate.
drop policy "Users can add images to own listings" on public.listing_images;
drop policy "Users can update images on own listings" on public.listing_images;
