-- Reviews -- ROADMAP 5.4 "Reviews": "After 5.3, buyer and seller can each
-- leave one rating + comment. Average rating and count on seller
-- profiles." The last item of Milestone 5 "Trust & safety", and the
-- consumer of the durable `sold_to_user_id` column 20261020073200
-- deliberately built for exactly this.
--
-- ============================================================
-- THE central design decision, flagged (not decided) by 20261020073200's
-- own header: is review eligibility BLIND to block state, or does it check
-- `private.has_block_between`/`public.is_blocked_with`?
-- ============================================================
-- Resolved here: BLIND. `submit_review` below does NOT check
-- `private.has_block_between` or `public.is_blocked_with` at all --
-- symmetric with how 20261020073200 treats `sold_to_user_id` itself (a
-- completed sale is settled fact regardless of any later block), NOT with
-- how messaging (`messages`' INSERT policy) or following
-- (`follows`' amended INSERT policy, 20261020065007) are gated.
--
-- The two sides of this, weighed explicitly rather than picked by default:
--
--   * The case FOR gating on block state (the one 20261020073200's header
--     flagged as a real cost): a seller could complete a sale, immediately
--     block the buyer, and keep the sale on record while unilaterally
--     shutting off that buyer's ability to leave a review -- an asymmetry
--     with no cost to the seller and no trace tying the block's timing to
--     the review window. If a reviewer cared primarily about "can one
--     party silence the other's feedback," this would be the deciding
--     factor, and the fix would be either checking the block live (this
--     migration's rejected alternative) or snapshotting non-blocked status
--     at sale time (rejected for the same reason `sold_to_user_id` itself
--     isn't re-validated against the block table on every read -- it would
--     require a new column and a new trigger for a concern this schema has
--     no other precedent for).
--
--   * The case AGAINST gating (the one that wins): a review is not a
--     communication channel. It never reaches the other party as a
--     message, requires no engagement from them to exist, and carries no
--     delivery event a block could meaningfully intercept -- unlike a
--     `messages` INSERT, which the blocked party would otherwise RECEIVE.
--     `messages`/`follows` are gated because blocking is specifically
--     about stopping one person from reaching or being reachable by
--     another; a review reaches a reputation surface (`seller_review_
--     summary`, a profile's average/count), not a person. Blocking the
--     reviewer does not and should not un-happen the sale, and a seller
--     who disagrees with what gets posted about them has no more recourse
--     here than any public-review system gives a business owner --
--     reputation content answerable to moderation, not unilaterally
--     silenceable by the subject. The actual harassment-content risk a
--     block might otherwise exist to prevent (an abusive comment, not an
--     unwanted contact) is already covered independently by 5.1's
--     report-a-user pipeline (`public.reports`, `reported_user_id`) --
--     exactly the channel this codebase already uses for "I was mistreated
--     by this person," not blocking. Gating review eligibility on block
--     state would therefore buy nothing this schema doesn't already have a
--     dedicated answer for, while costing the ability to ever leave a
--     review at all whenever either party blocks the other post-sale --
--     the overwhelmingly more common reason to block someone you just
--     transacted with.
--
-- Whoever revisits this should disagree with this reasoning explicitly (and
-- add the check deliberately) rather than discover the gap by accident --
-- which is exactly why this header is as long as 5.1/5.2/5.3's own central-
-- decision headers.
--
-- ============================================================
-- `on delete cascade` on all three FKs -- a DEPARTURE from `reports`' `on
-- delete set null`, not an oversight of that precedent
-- ============================================================
-- 20261020050442_reports.sql made `listing_id`/`reported_user_id` SET NULL
-- specifically because a report is moderation EVIDENCE that must survive
-- the deletion of the thing it was filed against ("this listing was
-- reported 5 times before it was removed"). A review about "nobody," "from
-- nobody," or "about no listing" isn't meaningful in the same way: all
-- three identity columns here (`listing_id`, `reviewer_id`, `reviewee_id`)
-- are NOT NULL by design, not nullable-with-a-CHECK like `sold_to_user_id`
-- is. There is no analogous "this seller was reviewed 5 times before their
-- account vanished" evidentiary need this schema is being asked to serve --
-- a review's entire value is as a readable, attributable, two-sided
-- account of one transaction, which a dangling null-reviewer or
-- null-reviewee row could never again provide (there would be nothing left
-- to render: no name, no avatar, half the sentence missing). CASCADE is the
-- only choice that keeps every surviving row meaningful; SET NULL here
-- would just accumulate increasingly meaningless rows forever, and NULLing
-- a NOT NULL column isn't even available as a fallback since the schema is
-- deliberately NOT NULL on all three for exactly this reason.
--
-- ============================================================
-- Why `reviewee_id` is a stored column at all, even though it is derivable
-- from `listings` (`seller_id`/`sold_to_user_id`) on every read
-- ============================================================
-- This is bounded, single-writer denormalization, not the kind of
-- client-trusted duplication CLAUDE.md's "treat all client input as
-- untrusted" rule warns against: `reviewee_id` is never accepted as a
-- parameter from the client at all (`submit_review`'s signature below has
-- no such argument) -- the ONLY place that ever writes it is
-- `submit_review` itself, which derives it from a `for update`-locked
-- `listings` row it just read in the same transaction, the instant before
-- the INSERT. There is exactly one writer and zero path for it to diverge
-- from the listing it was computed from, so "derived vs. stored" here is
-- purely a read-performance/query-shape choice (indexing and filtering
-- `seller_review_summary` directly by `reviewee_id`, rather than joining
-- back through `listings` on every lookup of "all reviews about user X" --
-- the listing a review names could itself later be hard-deleted in some
-- future feature, at which point a derived reviewee would have nothing left
-- to derive FROM, while the stored column keeps working), never a
-- trust boundary being loosened.
--
-- ============================================================
-- Public SELECT -- the OPPOSITE of `reports`/`blocks`' owner-scoped-or-none
-- shape, deliberately the SAME shape as `follows`' public read
-- ============================================================
-- `reports` has no SELECT policy at all, and `blocks` is owner-scoped to
-- the blocker only -- both because the content is adversarial/moderation-
-- shaped and confirming it exists is itself a retaliation or privacy risk
-- (see those migrations' own headers). A review is the opposite: it is
-- reputation content a STRANGER legitimately needs to see before
-- transacting with this seller -- the entire point of `seller_review_
-- summary` existing on a public profile is that anyone, including a
-- not-yet-signed-in-feeling browsing user, can see it. This is the same
-- shape `follows` already established ("Follows are publicly readable,"
-- 20261019061403) for the identical reason: a directed social/reputation
-- fact a stranger needs, not an adversarial one a target needs shielded
-- from them.
--
-- ============================================================
-- Insert-only, immutable -- no UPDATE or DELETE policy/grant at all
-- ============================================================
-- "Sold is terminal, permanent history" is already this schema's running
-- theme (`remove_listing` never accepts 'sold'; `mark_listing_sold`'s own
-- header calls sold a state "nothing reaches" once entered). A review about
-- a permanent, unchangeable sale is itself permanent history for the same
-- reason -- letting either party edit or retract their review after the
-- fact would let a seller or buyer quietly rewrite the public record of a
-- settled transaction, undermining exactly the "stranger can trust this
-- before transacting" property the public-SELECT decision above exists to
-- serve. There is no edit/delete UI anywhere in this feature, and no grant
-- that would let one be added without a further schema change.
--
-- ============================================================
-- Why `(listing_id, reviewer_id)` alone is a sufficient, complete natural
-- key for "one review per direction per sale"
-- ============================================================
-- Confirmed against the REAL current bodies of `mark_listing_sold` and
-- `remove_listing` (20261013165513_listing_status_transitions.sql,
-- widened by 20261020073200) before relying on this, not assumed: `sold` is
-- terminal ("sold -> *" is listed as terminal in that migration's own
-- transition table, and `remove_listing`'s own header says so verbatim --
-- "remove_listing never accepts 'sold' -- sold is permanent history").
-- Nothing anywhere in this schema moves a listing OUT of `sold`, and
-- `mark_listing_sold` only ever runs once per listing (it requires
-- `status in ('active', 'reserved')` as its source state, which a sold
-- listing can never be again). A listing is therefore sold AT MOST ONCE,
-- with AT MOST ONE recorded buyer, permanently -- so for any given
-- `listing_id`, there is at most one valid reviewer in the seller->buyer
-- direction and at most one in the buyer->seller direction, and a single
-- reviewer can only ever occupy one of those two roles on one listing (the
-- `reviewer_id <> reviewee_id`/ownership checks below rule out the
-- degenerate case). `(listing_id, reviewer_id)` is therefore already
-- exactly as fine-grained as `(listing_id, reviewer_id, reviewee_id)` would
-- be, with one fewer column in the index.
--
-- ============================================================
-- `seller_review_summary` is SECURITY INVOKER, not DEFINER
-- ============================================================
-- Every DEFINER RPC elsewhere in this schema (`mark_listing_sold`,
-- `conversation_detail`, `is_blocked_with`, ...) is DEFINER because it
-- needs to cross a privilege boundary RLS would otherwise block (reading a
-- sold listing the buyer can't directly SELECT, reading `private.*` from an
-- INVOKER context, etc.). `reviews` has NO such boundary to cross: it is
-- fully public-read (see above), so an INVOKER function run as `anon` or
-- `authenticated` sees exactly the same rows a DEFINER one would. This is
-- the identical reasoning `feed_listings`/`search_listings` already
-- established for staying INVOKER despite reading `public.listings`
-- (itself filtered by a permissive-enough RLS policy for the feed's own
-- purposes) -- "no privilege boundary needs crossing" is the actual test,
-- not "is this a SELECT-only function."
create table public.reviews (
  id          bigint generated always as identity primary key,
  listing_id  uuid not null references public.listings (id) on delete cascade,
  reviewer_id uuid not null references auth.users (id)   on delete cascade,
  reviewee_id uuid not null references auth.users (id)   on delete cascade,
  rating      smallint not null,
  comment     text,
  created_at  timestamptz not null default now(),

  constraint reviews_rating_range check (rating between 1 and 5),
  -- `<>`, not `is distinct from`: both columns are NOT NULL, so there is no
  -- NULL-silently-skips trap here -- mirrors `blocks_not_self`'s identical
  -- reasoning for the identical shape (two NOT NULL uuid columns).
  constraint reviews_reviewer_not_reviewee check (reviewer_id <> reviewee_id),
  constraint reviews_comment_length check (comment is null or char_length(comment) <= 1000)
);

-- The natural key: at most one review per reviewer per listing. See the
-- header note above for why this is complete on its own, without
-- `reviewee_id` needing to participate.
create unique index reviews_unique_listing_reviewer
  on public.reviews (listing_id, reviewer_id);

-- Backs `seller_review_summary`'s `where reviewee_id = p_seller_id` and a
-- future reviews-list screen's "newest first" ordering in one shot.
create index reviews_reviewee_id_idx
  on public.reviews (reviewee_id, created_at desc, id desc);

alter table public.reviews enable row level security;

-- Public read -- see the header note above for why this is the OPPOSITE
-- shape from `reports`/`blocks` and the SAME shape as `follows`. No `to`
-- clause: applies to PUBLIC (anon and authenticated both), same as
-- `follows`' "Follows are publicly readable" policy.
create policy "Reviews are publicly readable"
on public.reviews for select
using (true);

-- No INSERT/UPDATE/DELETE policy at all -- `submit_review` below is the
-- SOLE writer and runs as its DEFINER owner, bypassing RLS for the write
-- entirely, exactly like `get_or_create_listing_conversation` is the sole
-- writer of `conversations`. A client holds no direct write grant on this
-- table whatsoever (see the revokes below) -- RLS policies are moot for a
-- role with no underlying table privilege to begin with, but the revokes
-- are what is actually load-bearing, not the absent policies.

-- pg_default_acl grants arwdDxtm to anon and authenticated on every new
-- relation in this schema, so the blanket revoke is what makes the grant
-- below load-bearing rather than decorative.
revoke all on public.reviews from anon, authenticated;
-- The table-level revoke above does NOT touch the identity column's backing
-- sequence -- same gap `reports_id_seq`'s own revoke closes, for the
-- identical reason: Postgres does not require sequence privilege to INSERT
-- into an identity column, so left alone this would let anon/authenticated
-- read `last_value` directly and infer total review volume with no
-- row-level access at all. Harmless here compared to `reports` (this table
-- IS meant to be countable, via `seller_review_summary`), but revoked
-- anyway for the same "don't leave an unintentional side channel open"
-- discipline, and because the sequence's own counter is not a number this
-- feature's UI should ever expose directly (only the per-seller count is).
revoke all on public.reviews_id_seq from anon, authenticated;

grant select on public.reviews to anon, authenticated;

-- ============================================================
-- submit_review
-- ============================================================
-- One review per direction per completed sale. Mirrors `mark_listing_sold`
-- and `listing_conversation_buyers`'s shared hardening pattern: SECURITY
-- DEFINER, `set search_path = ''`, every name fully qualified, the caller's
-- identity taken only from `(select auth.uid())` (never a parameter), a
-- `for update` row lock on `listings` so a concurrent `remove_listing` (or
-- another `submit_review` call) can't race this one, not-found -> P0002,
-- wrong-state/invalid-input -> P0001, not-your-sale -> 42501.
create or replace function public.submit_review(
  p_listing_id uuid,
  p_rating     smallint,
  p_comment    text default null
)
returns public.reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_viewer   uuid := (select auth.uid());
  v_listing  public.listings;
  v_reviewee uuid;
  v_review   public.reviews;
begin
  if v_viewer is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Treat all client input as untrusted (CLAUDE.md): `p_rating` is
  -- revalidated here even though the table's own `reviews_rating_range`
  -- CHECK would catch an out-of-range value too -- the CHECK is the real,
  -- unconditional backstop (it holds even for a future privileged writer
  -- that bypasses this RPC entirely), this is the belt to that suspenders,
  -- giving a clean P0001 rather than a bare 23514 constraint-violation
  -- surfacing from deeper inside the function.
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5' using errcode = 'P0001';
  end if;

  select * into v_listing from public.listings where id = p_listing_id for update;
  if not found then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;

  -- The eligibility gate: a completed sale with a recorded buyer. A sold
  -- listing with `sold_to_user_id is null` (sold outside the app, per
  -- 20261020073200's own header on why that column stays nullable) has no
  -- second party to review or be reviewed by, so it is rejected here
  -- exactly like every other wrong-state case in this schema, P0001.
  if v_listing.status <> 'sold' or v_listing.sold_to_user_id is null then
    raise exception 'This listing has no completed sale to review' using errcode = 'P0001';
  end if;

  -- `v_reviewee` is derived here, from the locked `listings` row, and
  -- NEVER accepted as a client parameter -- see the header note above on
  -- why this makes the stored `reviewee_id` column safe denormalization
  -- rather than trusted client input.
  if v_viewer = v_listing.seller_id then
    v_reviewee := v_listing.sold_to_user_id;
  elsif v_viewer = v_listing.sold_to_user_id then
    v_reviewee := v_listing.seller_id;
  else
    raise exception 'You were not part of this sale' using errcode = '42501';
  end if;

  -- No `private.has_block_between` / `public.is_blocked_with` check here --
  -- deliberate, not a gap. See this migration's header for the full
  -- reasoning: review eligibility is BLIND to block state, symmetric with
  -- how `mark_listing_sold` already treats `sold_to_user_id` itself.

  -- A duplicate (listing_id, reviewer_id) raises 23505 from the unique
  -- index above -- no pre-check needed, the same "let the constraint be
  -- the single source of truth for the race-safe case" discipline
  -- `conversations_listing_buyer_key` already established.
  insert into public.reviews (listing_id, reviewer_id, reviewee_id, rating, comment)
  values (p_listing_id, v_viewer, v_reviewee, p_rating,
          nullif(btrim(coalesce(p_comment, '')), ''))
  returning * into v_review;

  return v_review;
end;
$$;

-- All three grantees revoked separately, same discipline every RPC in this
-- codebase follows (pg_default_acl grants EXECUTE to PUBLIC on every new
-- function independently of the table-level ACL defaults, and `revoke ...
-- from public` alone does not reach a role's own direct grant).
revoke all    on function public.submit_review(uuid, smallint, text) from public;
revoke all    on function public.submit_review(uuid, smallint, text) from anon;
grant execute on function public.submit_review(uuid, smallint, text) to authenticated;

-- ============================================================
-- seller_review_summary
-- ============================================================
-- Query-time computation, not a trigger-maintained denormalized counter
-- column -- this schema has no precedent for the latter anywhere
-- (`feed_listings`/`search_listings` are INVOKER RPCs computing their own
-- result sets live; `follows`' follower/following counts are plain
-- `count:'exact', head:true` queries from the client, not a stored
-- counter). A reviews table is small and infrequently written compared to
-- the read volume any one seller's profile gets, so a live `avg`/`count`
-- over `reviews_reviewee_id_idx` costs nothing a counter column would
-- meaningfully save, while a counter would add exactly the kind of
-- trigger-maintenance surface (increment/decrement correctness, backfill
-- for the three already-landed rows if this were ever added later) this
-- schema has consistently avoided elsewhere.
--
-- SECURITY INVOKER -- see the header note above for why, in full.
create or replace function public.seller_review_summary(p_seller_id uuid)
returns table (average_rating numeric, review_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(avg(rating), 0)::numeric(3,2), count(*)::integer
    from public.reviews
   where reviewee_id = p_seller_id;
$$;

revoke all    on function public.seller_review_summary(uuid) from public;
-- Granted to anon too, unlike `submit_review` -- reading a seller's rating
-- summary is exactly as public as reading their listing grid or follower
-- count, both of which already carry no authentication requirement at the
-- RLS/grant layer (`listings`' own SELECT policy and `follows`' public read
-- are both reachable by `anon`).
grant execute on function public.seller_review_summary(uuid) to anon, authenticated;
