-- ROADMAP 6.1b "Settings: account deletion", continued from
-- 20261021065243_account_deletion_sentinel_and_reassignment.sql (read that
-- file's header first -- it explains the sentinel account, the
-- BEFORE DELETE reassignment trigger, and the two structural FK collisions
-- it fixes; this migration builds on top of all three without repeating
-- that reasoning).
--
-- `request_account_deletion` is the ONE RPC a departing user's own JWT
-- calls, from `supabase/functions/delete-account/index.ts` (the Edge
-- Function, built alongside this migration). It does every reversible,
-- "still the caller's own row, still their own JWT" part of account
-- deletion:
--
--   * hard-deletes the caller's own DRAFT listings (no other-party stake in
--     an unpublished draft -- nobody else has ever seen it)
--   * sets the caller's ACTIVE/RESERVED listings to `status = 'removed'`,
--     hiding them from the feed/search immediately
--   * leaves SOLD listings completely untouched -- permanent history,
--     exactly like `remove_listing` already refuses to touch a sold listing
--
-- It does NOT delete `auth.users` -- that requires the Admin API (service
-- role key), which only the Edge Function holds, never this RPC and never
-- the mobile client. This RPC's whole job is to make the account SAFE and
-- CORRECT to delete a moment later; the actual `auth.users` deletion (and,
-- with it, the `BEFORE DELETE` reassignment trigger firing) happens in a
-- separate Admin API call the Edge Function makes afterward.
--
-- Also, deliberately, NOT a row lock / `for update` anywhere here, unlike
-- `mark_listing_sold`'s or `remove_listing`'s single-row-then-branch shape:
-- every statement below is a bulk DELETE/UPDATE scoped by `seller_id =
-- (select auth.uid())`, already atomic as a single statement, and a second
-- concurrent call (or a retried call after a failure) simply matches zero
-- rows the second time around -- which is also exactly what makes this
-- function idempotent, a REQUIRED property: the Edge Function's own
-- retry-safety depends on being able to call this RPC again if a later step
-- (the Admin API delete) fails, without this RPC erroring or double-acting
-- on an already-cleaned-up account.
--
-- `seller_id` on the now-`removed` active/reserved listings is left as the
-- caller's own id here, on purpose -- NOT reassigned to the sentinel. That
-- reassignment happens exactly once, later, inside
-- `reassign_departing_user_rows`'s `BEFORE DELETE` trigger, at the moment
-- `auth.users` is actually deleted. Doing it here too would just be the same
-- write performed twice for no benefit.

create or replace function public.request_account_deletion()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  -- 28000 (invalid_authorization_specification), not this codebase's usual
  -- 42501 for "no caller identity" -- the task this RPC implements calls
  -- for that exact SQLSTATE, and it reads correctly here too: this function
  -- has no caller-supplied target to authorize against (unlike, say,
  -- `remove_listing`'s "not your listing"), so "there is no authorization
  -- context at all" is the more precise of the two.
  if v_caller is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- Draft listings: hard DELETE. `listing_images` cascades away with the
  -- listing row (20260829142345), leaving the Storage objects those rows
  -- pointed at as orphans -- the Edge Function is responsible for cleaning
  -- those up using the caller's own still-valid JWT, and it MUST do so
  -- BEFORE calling this RPC (see delete-account/index.ts's own header for
  -- the exact ordering and why).
  delete from public.listings
   where seller_id = v_caller
     and status = 'draft';

  -- Active/reserved listings: reuse the exact terminal state
  -- `remove_listing` (20261013165513) already produces, rather than
  -- inventing a second "removed because the account was deleted" status
  -- every feed/search/profile query would then need to separately filter
  -- for. This hides the listing from browsing immediately.
  update public.listings
     set status = 'removed'
   where seller_id = v_caller
     and status in ('active', 'reserved');

  -- Sold listings: completely untouched. Sold is permanent history
  -- (remove_listing's own "sold is NOT removable through this path"
  -- principle) -- a user deleting their account must not retroactively
  -- erase or hide a completed, historical sale from the record, which is
  -- exactly the "listings they ever sold" harm this whole 6.1b pass exists
  -- to prevent in the first place.
end;
$$;

-- Combined `from public, anon` on one line (mirrors
-- `public.is_blocked_with`'s own precedent, 20261020065007) rather than two
-- separate REVOKE statements -- both forms appear elsewhere in this
-- codebase; either revokes the same thing.
revoke all    on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;
