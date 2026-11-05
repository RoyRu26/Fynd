-- AI listing metadata plan, Phase 1a (migration 2 of 2): structured
-- attributes on listings. This migration makes manual entry work on its
-- own; the AI analysis tables (and `listings.ai_analysis_id`, whose foreign
-- key needs them) arrive in Phase 2. Brands arrive in Phase 1b, behind the
-- brand-list approval gate.
--
-- Data model:
--   * listings.keywords: freeform search terms, at most 10, normalized.
--   * listing_attribute_values: one row per controlled-vocabulary value on
--     a listing (item type, colors, styles, materials, pattern, fit).
--
-- The database is authoritative on correctness:
--   * The composite foreign key (term_id, kind) means a value can never be
--     filed under the wrong kind.
--   * A BEFORE trigger rejects a value that doesn't apply to the listing's
--     current category: item type via listing_item_type_categories, every
--     other kind via listing_attribute_kind_categories.
--   * An AFTER trigger enforces each kind's max_values.
--   * When a listing's category changes, an AFTER UPDATE trigger removes
--     only the values that are invalid under the NEW category and keeps the
--     rest (Phase 0 decision 12). Removing rather than rejecting keeps the
--     existing draft save path working: the category is saved first, then
--     the attributes in a second request.
--
-- Clients never write listing_attribute_values or listings.keywords
-- directly. The only write path is set_listing_attributes(), for the owner
-- of a draft, active or reserved listing.

-- ============================================================
-- Keyword validity
-- ============================================================
-- Each keyword: already normalized (lowercase, trimmed, single spaces),
-- 2-24 characters, made of Latin letters, digits and Hebrew letters,
-- optionally joined by spaces or hyphens. No duplicates. Other scripts are
-- out of scope for v1. set_listing_attributes normalizes input before it
-- reaches this check, so the check is the backstop, not the UX.
create function public.listing_keywords_valid(p_keywords text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    (select coalesce(bool_and(
              k = lower(k)
              and char_length(k) between 2 and 24
              and k ~ '^[a-z0-9א-ת]([a-z0-9א-ת -]*[a-z0-9א-ת])?$'
              and position('  ' in k) = 0
            ), true)
       from unnest(p_keywords) as k)
    and cardinality(p_keywords) = (select count(distinct k) from unnest(p_keywords) as k);
$$;

-- Executable by authenticated because the CHECK below is re-evaluated on
-- every UPDATE of a listings row, including the plain draft UPDATE that
-- clients make directly.
revoke all on function public.listing_keywords_valid(text[]) from public, anon;
grant execute on function public.listing_keywords_valid(text[]) to authenticated;

alter table public.listings add column keywords text[] not null default '{}';

alter table public.listings
  add constraint listings_keywords_count check (cardinality(keywords) <= 10);
alter table public.listings
  add constraint listings_keywords_valid check (public.listing_keywords_valid(keywords));

-- Deliberately no column grant on `keywords`: unlike title/price/etc., it is
-- written only through set_listing_attributes, so its normalization and
-- validation live in one place. The existing table-level SELECT grant
-- already covers reading it.

-- ============================================================
-- listing_attribute_values
-- ============================================================
create table public.listing_attribute_values (
  listing_id uuid not null references public.listings (id) on delete cascade,
  term_id uuid not null,
  kind text not null,
  -- Order within the kind, 0-based. For colors, position 0 is the primary
  -- color.
  position smallint not null,
  created_at timestamptz not null default now(),
  primary key (listing_id, term_id),
  constraint listing_attribute_values_position_nonnegative check (position >= 0),
  constraint listing_attribute_values_kind_position_unique unique (listing_id, kind, position),
  constraint listing_attribute_values_term_fkey
    foreign key (term_id, kind)
    references public.listing_attribute_terms (id, kind)
    on delete restrict
);

-- For future search filters: "listings that have term X".
create index listing_attribute_values_term_listing_idx
  on public.listing_attribute_values (term_id, listing_id);

-- ============================================================
-- Applicability, shared by every check below
-- ============================================================
-- True when a value of `p_kind`/`p_term_id` may sit on a listing in
-- `p_category_id`. A listing with no category yet (an early draft) accepts
-- any value: there is nothing to validate against, and the category-change
-- trigger prunes it the moment a category is chosen.
create function public.listing_attribute_value_applies(
  p_kind text,
  p_term_id uuid,
  p_category_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_category_id is null then true
    when p_kind = 'item_type' then exists (
      select 1 from public.listing_item_type_categories c
       where c.term_id = p_term_id
         and c.category_id = p_category_id
    )
    else exists (
      select 1 from public.listing_attribute_kind_categories c
       where c.kind = p_kind
         and c.category_id = p_category_id
    )
  end;
$$;

revoke all on function public.listing_attribute_value_applies(text, uuid, uuid) from public, anon;
grant execute on function public.listing_attribute_value_applies(text, uuid, uuid) to authenticated;

-- ============================================================
-- Value triggers
-- ============================================================
create function public.listing_attribute_values_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_category_id uuid;
begin
  select l.category_id into v_category_id
    from public.listings l
   where l.id = new.listing_id;

  if not public.listing_attribute_value_applies(new.kind, new.term_id, v_category_id) then
    if new.kind = 'item_type' then
      raise exception 'That item type doesn''t fit this listing''s category'
        using errcode = '23514';
    end if;
    raise exception 'That % doesn''t apply to this listing''s category', replace(new.kind, '_', ' ')
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create function public.listing_attribute_values_enforce_max()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.listing_attribute_values v
       where v.listing_id = new.listing_id
         and v.kind = new.kind)
     > (select k.max_values from public.listing_attribute_kinds k where k.kind = new.kind) then
    raise exception 'Too many % values for one listing', replace(new.kind, '_', ' ')
      using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke all on function public.listing_attribute_values_validate() from public, anon, authenticated;
revoke all on function public.listing_attribute_values_enforce_max() from public, anon, authenticated;

create trigger listing_attribute_values_validate
before insert or update on public.listing_attribute_values
for each row execute function public.listing_attribute_values_validate();

-- AFTER, so the count includes the row being written. Not deferred:
-- set_listing_attributes deletes a listing's values before re-inserting
-- them, so the count never passes the limit even briefly.
create trigger listing_attribute_values_enforce_max
after insert or update on public.listing_attribute_values
for each row execute function public.listing_attribute_values_enforce_max();

-- ============================================================
-- Category change: prune values that no longer apply
-- ============================================================
-- SECURITY DEFINER because the category can change through the plain draft
-- UPDATE that clients make directly, and clients have no DELETE privilege
-- on listing_attribute_values. It only ever touches rows belonging to the
-- listing being updated, which the caller was already allowed to update.
create function public.listings_prune_attribute_values_on_category_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.category_id is null then
    return null;
  end if;

  delete from public.listing_attribute_values v
   where v.listing_id = new.id
     and not public.listing_attribute_value_applies(v.kind, v.term_id, new.category_id);

  return null;
end;
$$;

revoke all on function public.listings_prune_attribute_values_on_category_change() from public, anon, authenticated;

create trigger listings_prune_attribute_values_on_category_change
after update of category_id on public.listings
for each row
when (old.category_id is distinct from new.category_id)
execute function public.listings_prune_attribute_values_on_category_change();

-- ============================================================
-- Access
-- ============================================================
-- Readable by authenticated whenever the parent listing is readable to the
-- caller: the EXISTS runs under the caller's own RLS on listings, so a
-- draft's attributes stay as private as the draft itself. No anon access,
-- and no client write path at all.
alter table public.listing_attribute_values enable row level security;

revoke all on public.listing_attribute_values from public, anon, authenticated;
grant select on public.listing_attribute_values to authenticated;

create policy "Attribute values are readable alongside their listing"
  on public.listing_attribute_values
  for select
  to authenticated
  using (
    exists (
      select 1 from public.listings l
       where l.id = listing_attribute_values.listing_id
    )
  );

-- ============================================================
-- set_listing_attributes
-- ============================================================
-- Replaces a listing's whole attribute set and keyword list in one call.
-- `p_term_ids` order is meaningful: within each kind, the first id becomes
-- position 0 (so the first color is the primary color).
--
-- Who: the listing's owner. Which listings: draft, active or reserved
-- (sold and removed are terminal, matching update_listing_details).
--
-- Checked here, with friendly errors (22023), before anything is written:
-- duplicates, unknown ids, retired terms (allowed only if this listing
-- already has them, so editing an old listing never forces dropping a
-- retired value), and max_values per kind. Category applicability and the
-- keyword format are enforced by the table trigger and CHECK constraints
-- respectively (23514), which also protect every future writer.
create function public.set_listing_attributes(
  p_listing_id uuid,
  p_term_ids uuid[],
  p_keywords text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_seller_id uuid;
  v_status public.listing_status;
  v_term_ids uuid[] := coalesce(p_term_ids, '{}');
  v_keywords text[];
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select l.seller_id, l.status
    into v_seller_id, v_status
    from public.listings l
   where l.id = p_listing_id
   for update;

  if not found then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;

  if v_seller_id <> v_user_id then
    raise exception 'Only the seller can edit this listing' using errcode = '42501';
  end if;

  if v_status not in ('draft', 'active', 'reserved') then
    raise exception 'This listing can no longer be edited' using errcode = 'P0001';
  end if;

  -- Sanity cap far above any legitimate request (the per-kind maxima sum to
  -- 11), so an oversized array is refused before any lookups run.
  if cardinality(v_term_ids) > 50 then
    raise exception 'Too many attribute values' using errcode = '22023';
  end if;

  if exists (select 1 from unnest(v_term_ids) as x where x is null) then
    raise exception 'Attribute values cannot be empty' using errcode = '22023';
  end if;

  if cardinality(v_term_ids) <> (select count(distinct x) from unnest(v_term_ids) as x) then
    raise exception 'The same attribute value was given twice' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(v_term_ids) as x
     where not exists (select 1 from public.listing_attribute_terms t where t.id = x)
  ) then
    raise exception 'Unknown attribute value' using errcode = '22023';
  end if;

  if exists (
    select 1
      from unnest(v_term_ids) as x
      join public.listing_attribute_terms t on t.id = x
     where t.retired_at is not null
       and not exists (
         select 1 from public.listing_attribute_values v
          where v.listing_id = p_listing_id
            and v.term_id = x
       )
  ) then
    raise exception 'That attribute value is no longer available' using errcode = '22023';
  end if;

  if exists (
    select 1
      from unnest(v_term_ids) as x
      join public.listing_attribute_terms t on t.id = x
      join public.listing_attribute_kinds k on k.kind = t.kind
     group by k.kind, k.max_values
    having count(*) > k.max_values
  ) then
    raise exception 'Too many values for one attribute' using errcode = '22023';
  end if;

  -- Keywords: trim, lowercase, collapse inner whitespace, drop empties, and
  -- dedupe keeping each keyword's first position. The listings CHECK
  -- constraints then validate the result.
  select coalesce(array_agg(d.keyword order by d.first_ordinal), '{}')
    into v_keywords
    from (
      select n.keyword, min(n.ordinal) as first_ordinal
        from (
          select lower(regexp_replace(btrim(u.raw), '\s+', ' ', 'g')) as keyword, u.ordinal
            from unnest(coalesce(p_keywords, '{}')) with ordinality as u(raw, ordinal)
        ) n
       where n.keyword <> ''
       group by n.keyword
    ) d;

  delete from public.listing_attribute_values v where v.listing_id = p_listing_id;

  insert into public.listing_attribute_values (listing_id, term_id, kind, position)
  select p_listing_id,
         t.id,
         t.kind,
         (row_number() over (partition by t.kind order by u.ordinal) - 1)::smallint
    from unnest(v_term_ids) with ordinality as u(term_id, ordinal)
    join public.listing_attribute_terms t on t.id = u.term_id;

  update public.listings l
     set keywords = v_keywords
   where l.id = p_listing_id
     and l.keywords is distinct from v_keywords;
end;
$$;

revoke all on function public.set_listing_attributes(uuid, uuid[], text[]) from public, anon;
grant execute on function public.set_listing_attributes(uuid, uuid[], text[]) to authenticated;
