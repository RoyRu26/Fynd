-- ROADMAP 6.4 "Security audit" -- a Critical/High finding against the
-- account-deletion work in 20261021065243/20261021065411.
--
-- ============================================================
-- THE BUG: reviews.reviewer_id/reviewee_id reference auth.users DIRECTLY,
-- bypassing the reassignment trigger entirely
-- ============================================================
-- `reassign_departing_user_rows` (20261021065243) is a `before delete on
-- public.profiles` trigger: it reassigns `listings.seller_id`,
-- `conversations.buyer_id`/`seller_id`, and `messages.sender_id` to the
-- sentinel BEFORE Postgres's own CASCADE from `auth.users` to `profiles`
-- completes -- which works because every one of those four columns
-- references `public.profiles(id)`, so their own CASCADE is a SEPARATE
-- step that only fires from `profiles`' own deletion, strictly AFTER that
-- same row's `before delete` trigger has already finished reassigning them.
--
-- `reviews.reviewer_id`/`reviewee_id` were defined differently: `references
-- auth.users (id) on delete cascade` -- a cascade hanging directly off
-- `auth.users`, a SIBLING of the `auth.users` -> `profiles` cascade, not a
-- descendant of it. Verified live, empirically, before writing this fix
-- (not assumed from reading the FK alone): built a real sold listing with
-- a real review between two fixture users, deleted the seller's
-- `auth.users` row inside a rolled-back transaction, and confirmed the
-- review -- untouched by the existing trigger, which never references
-- `reviews` at all today -- is gone (count 1 -> 0). Relying on Postgres's
-- firing order between two INDEPENDENT constraint triggers on the SAME
-- table (`auth.users`) to coincidentally save it, by extending the
-- `profiles`-level trigger alone, would depend on undocumented internal
-- trigger-ordering behavior (RI constraint trigger firing order, which
-- happens to track creation order today but is not something to build a
-- data-safety guarantee on top of).
--
-- Concrete harm this allowed: User A leaves a legitimate review about User
-- B. B later deletes their own, completely unrelated account. A's review
-- -- content A alone owns, about a sale that already completed -- is
-- silently destroyed by an action A never took. This is exactly the harm
-- class 20261021065243's own header names as unacceptable ("someone else's
-- data being destroyed by this user's own deletion request"), just reached
-- through a FK this schema's review never re-examined against that
-- principle once self-service deletion became reachable.
--
-- ============================================================
-- THE FIX: retarget both FKs through `profiles`, the same way every other
-- user-reference column in this schema already does
-- ============================================================
-- Semantically identical -- `profiles.id` is a 1:1 mirror of `auth.users.id`
-- (profiles.id itself references auth.users(id) on delete cascade, and
-- `handle_new_user` creates exactly one profiles row per signup), so no
-- reviewer_id/reviewee_id value that was ever valid against auth.users(id)
-- stops being valid against profiles(id). What changes is which CASCADE
-- governs the deletion path: routing through `profiles` means this table's
-- cascade now only fires from `profiles`' OWN deletion -- strictly after
-- that row's `before delete` trigger has already run, the same
-- already-proven-reliable sequencing every other reassigned column uses,
-- not a cross-table firing-order assumption.

alter table public.reviews drop constraint reviews_reviewer_id_fkey;
alter table public.reviews drop constraint reviews_reviewee_id_fkey;

alter table public.reviews
  add constraint reviews_reviewer_id_fkey
    foreign key (reviewer_id) references public.profiles (id) on delete cascade;

alter table public.reviews
  add constraint reviews_reviewee_id_fkey
    foreign key (reviewee_id) references public.profiles (id) on delete cascade;

-- ============================================================
-- Same two structural collisions 20261021065243 already found and fixed
-- for `conversations`, re-derived here for `reviews` -- caught by applying
-- that migration's own reasoning to this table, not discovered fresh
-- ============================================================
--
-- (1) `reviews_reviewer_not_reviewee check (reviewer_id <> reviewee_id)`.
-- A single listing has at most two reviews (seller-about-buyer,
-- buyer-about-seller). If BOTH the seller and the recorded buyer of that
-- one listing independently delete their accounts -- two ordinary,
-- unrelated self-service actions, arbitrarily far apart in time -- the
-- reassignment below sets `reviewer_id` to the sentinel on each of those
-- two rows in turn; the second one to run now reads `reviewer_id =
-- reviewee_id = sentinel` on ITS OWN row, which this CHECK forbids,
-- aborting that user's entire account deletion. Relaxed the same way
-- `conversations_distinct_participants` was: a real reviewer can still
-- never equal a real reviewee (the sentinel is not authenticatable, so it
-- can never reach `submit_review` as itself), only this one specific,
-- legitimate post-reassignment state is admitted.
alter table public.reviews drop constraint reviews_reviewer_not_reviewee;

alter table public.reviews
  add constraint reviews_reviewer_not_reviewee
    check (
      reviewer_id <> reviewee_id
      or reviewer_id = '00000000-0000-0000-0000-000000000001'
    );

-- (2) `reviews_unique_listing_reviewer unique (listing_id, reviewer_id)`.
-- Same listing, same scenario as (1): the seller's review of the buyer and
-- the buyer's review of the seller share one `listing_id`. Once both
-- parties have independently deleted their accounts, both rows'
-- `reviewer_id` becomes the sentinel -- the second reassignment collides
-- with the first on this exact unique index (23505), aborting whichever
-- deletion runs second. Made partial, excluding the sentinel, mirroring
-- `conversations_listing_buyer_key`'s identical fix: the invariant ("one
-- review per real reviewer per listing") still holds for every real
-- reviewer; only the sentinel -- never itself a real caller of
-- `submit_review` -- is exempted. `submit_review` never performs an `on
-- conflict` against this index (it relies on the bare unique violation,
-- 23505, as its documented duplicate-review signal), so no RPC body needs
-- a matching update the way `get_or_create_listing_conversation` did.
drop index public.reviews_unique_listing_reviewer;

create unique index reviews_unique_listing_reviewer
  on public.reviews (listing_id, reviewer_id)
  where reviewer_id <> '00000000-0000-0000-0000-000000000001';

-- ============================================================
-- Extend the reassignment trigger itself
-- ============================================================
-- Safe to add here now that both FKs above cascade through `profiles`:
-- this UPDATE runs (as part of this same `before delete on profiles`
-- trigger) strictly before `profiles`' own CASCADE to `reviews` is
-- evaluated, so by the time that CASCADE runs, nothing in these two
-- columns still references the departing id.
create or replace function public.reassign_departing_user_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sentinel constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  if old.id = v_sentinel then
    return old;
  end if;

  update public.listings
     set seller_id = v_sentinel
   where seller_id = old.id;

  update public.conversations
     set buyer_id = v_sentinel
   where buyer_id = old.id;

  update public.conversations
     set seller_id = v_sentinel
   where seller_id = old.id;

  update public.messages
     set sender_id = v_sentinel
   where sender_id = old.id;

  update public.reviews
     set reviewer_id = v_sentinel
   where reviewer_id = old.id;

  update public.reviews
     set reviewee_id = v_sentinel
   where reviewee_id = old.id;

  return old;
end;
$$;
