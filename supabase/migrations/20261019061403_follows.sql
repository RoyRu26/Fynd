-- Follows -- the durable, directed "A follows B" relationship.
--
-- DESIGN.md §14.3 ("Instagram-shaped structure: identity header (avatar,
-- display name, handle, counts, follow button)") and ROADMAP 3.1. §16 item 5
-- tracked `follows` as the one remaining schema gap blocking that pattern;
-- this closes it.
--
-- READ POLICY IS PUBLIC, not owner-scoped -- deliberately the opposite shape
-- from `favorites`' "Users read own favorites". Milestone 3.3 (follower /
-- following LIST screens, not built in this slice) needs to show a stranger
-- the list of who follows THEM, which is structurally impossible under an
-- owner-scoped read: the viewer is neither the follower nor the followed
-- party for most rows in someone else's list. A follow edge is also not
-- sensitive the way a favorite arguably is (what you've saved to buy) --
-- it's closer to `profiles`, which is already "Profiles are publicly
-- readable" (`using (true)`) for the same reason: public social identity.
-- This policy, and the SELECT grant below, mirror that profiles precedent
-- exactly rather than inventing a third shape.
--
-- Write (insert/delete) stays owner-scoped to `follower_id = auth.uid()`,
-- same shape as `favorites`: you control your own follow/unfollow action,
-- nobody else's.
create table public.follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  followed_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- The composite PK is the unique (follower, followed) pair -- no separate
  -- surrogate id, mirroring `favorites`' (user_id, listing_id). A
  -- double-tap race resolves to 23505 rather than two rows.
  primary key (follower_id, followed_id),
  -- `<>`, not `is distinct from`. Both columns are NOT NULL (unlike
  -- `categories.parent_id`, which is nullable and needed `is distinct from`
  -- to tolerate a null root), so there is no NULL-silently-passes trap here
  -- -- `<>` is both sufficient and correct, mirroring
  -- `conversations_distinct_participants check (buyer_id <> seller_id)`
  -- (20260929090000_chat_conversations_and_messages.sql).
  constraint follows_not_self check (follower_id <> followed_id)
);

-- The PK already indexes (follower_id, followed_id) for "does A follow B" /
-- "list everyone A follows" -- the following-side lookup. This covers the
-- other direction -- "who follows B" / "how many followers does B have" --
-- mirroring `favorites_listing_id_idx`'s exact precedent: an index for the
-- other direction's count, no trigger-maintained counter column.
create index follows_followed_id_idx on public.follows (followed_id);

alter table public.follows enable row level security;

-- Public read, mirroring "Profiles are publicly readable" -- see the header
-- note above for why this, and not favorites' owner-scoped read, is the
-- correct shape here.
create policy "Follows are publicly readable"
on public.follows for select
using (true);

create policy "Users follow as themselves"
on public.follows for insert to authenticated
with check (follower_id = (select auth.uid()));

create policy "Users unfollow their own follows"
on public.follows for delete to authenticated
using (follower_id = (select auth.uid()));

-- pg_default_acl grants arwdDxtm to anon and authenticated on every new
-- relation in this schema, so the blanket revoke is what makes the grants
-- below load-bearing rather than decorative.
revoke all on public.follows from anon, authenticated;

-- SELECT stays table-level for both roles, exactly like
-- `grant select on public.profiles to anon, authenticated;`
-- (20261014112232_profile_bio_and_avatars.sql) -- RLS ("Follows are publicly
-- readable", `using (true)`) does the actual scoping, which for a public
-- read policy is "no scoping at all". Copied verbatim rather than
-- reinventing a different role list for the same "publicly readable" shape.
grant select on public.follows to anon, authenticated;

-- Column allowlist: created_at is absent, so it is server-controlled and a
-- client cannot forge when a follow started, mirroring favorites' own
-- insert grant. No UPDATE grant at all -- a follow is created or deleted,
-- never edited.
grant insert (follower_id, followed_id) on public.follows to authenticated;
grant delete on public.follows to authenticated;
