-- Search over attributes, part 1: the search document (roadmap 7.3, spec
-- §10.3 / §10.6 step 2). Builds on 7.2's text functions
-- (20261102095218_hebrew_search_text_functions.sql and
-- 20261102095915_hebrew_search_text_hardening.sql).
--
-- WHY: listings.search_tsv was a GENERATED column over title + description,
-- English config only. Search now has to find a listing by its brand (incl.
-- Hebrew aliases such as Nike's), its category, its attribute labels (item
-- type, color, style, material, pattern, fit) and its keywords, and Hebrew
-- text has to match through 7.2's variant expansion. A generated column can
-- only read its own row, so search_tsv becomes a plain column kept current by
-- triggers.
--
-- The document (§10.3):
--   weight A  title; brand_text; brand name + all its aliases; category leaf
--             name + its group name; item-type label + slug
--   weight B  color / style / material / pattern / fit labels + slugs;
--             keywords
--   weight C  description
-- Slugs have underscores turned into spaces ("wide_leg" -> "wide leg").
--
-- Deviations from the spec text (approved):
--   1. Every part, not just title/description, is indexed with english AND
--      simple-variant lexemes via public.fynd_text_tsvector, so "sneaker"
--      finds item type "Sneakers" and Hebrew aliases get prefix variants.
--   2. The trigger functions are SECURITY DEFINER in schema private: they
--      must read brands/terms/categories and write listings.search_tsv,
--      which clients cannot write, and an INVOKER trigger would need USAGE on
--      private for every caller (or the helpers exposed via /rpc). They only
--      ever write the derived search_tsv column.
--   3. listings_set_updated_at is recreated as BEFORE UPDATE OF <every
--      listings column except search_tsv>, so derived-only refreshes (an
--      attribute, brand alias, term or category change) never bump
--      updated_at, which My Listings orders by. A pgTAP drift guard checks
--      the column list equals all columns minus search_tsv: a column added
--      later must be added to this trigger too.
--
-- Refresh triggers:
--   listings                 BEFORE INSERT / UPDATE OF title, description,
--                            category_id, brand_id, brand_text, keywords (row)
--   listing_attribute_values AFTER INSERT / UPDATE / DELETE (statement,
--                            transition tables)
--   brands                   AFTER UPDATE, name changed
--   brand_aliases            AFTER INSERT / UPDATE / DELETE
--   listing_attribute_terms  AFTER UPDATE, label or slug changed
--   categories               AFTER UPDATE, name or parent_id changed
-- Retiring a brand or term does not change any document.
--
-- Rebuild after a PostgreSQL major or ICU upgrade (the text functions are
-- IMMUTABLE but depend on ICU / Unicode / snowball data):
--   select private.refresh_listing_search_tsv(array(select id from public.listings));
--
-- The backfill at the end only rewrites the derived search_tsv; no row is
-- added or removed.

-- ============================================================
-- 1. search_tsv becomes a plain column
-- ============================================================
-- DROP EXPRESSION keeps the stored values (no table rewrite) and the GIN
-- index listings_search_tsv_idx stays valid; the backfill below replaces the
-- values. Default + NOT NULL are set after the backfill (default '' keeps the
-- column optional in the generated Insert type).
alter table public.listings alter column search_tsv drop expression;

-- ============================================================
-- 2. fynd_text_tsvector: english lexemes + simple Hebrew/word variants
-- ============================================================
create function public.fynd_text_tsvector(p_text text)
returns tsvector
language sql
immutable
parallel safe
set search_path = ''
as $$
  select to_tsvector('pg_catalog.english'::regconfig, public.fynd_text_normalize(p_text))
      || to_tsvector('pg_catalog.simple'::regconfig,  public.fynd_variants_text(p_text));
$$;

comment on function public.fynd_text_tsvector(text) is
  'Search document text -> tsvector (spec §10.3): english lexemes of the normalized text plus simple lexemes of its variants.';

revoke all on function public.fynd_text_tsvector(text) from public, anon;
grant execute on function public.fynd_text_tsvector(text) to authenticated;

-- ============================================================
-- 3. The document builder and the refresh helper (private)
-- ============================================================
create function private.listing_search_document(
  p_listing_id  uuid,
  p_title       text,
  p_description text,
  p_category_id uuid,
  p_brand_id    uuid,
  p_brand_text  text,
  p_keywords    text[]
)
returns tsvector
language sql
stable
set search_path = ''
as $$
  select
       setweight(public.fynd_text_tsvector(p_title), 'A')
    || setweight(public.fynd_text_tsvector(concat_ws(' ',
         p_brand_text,
         (select concat_ws(' ', b.name, string_agg(a.alias, ' ' order by a.alias_key))
            from public.brands b
            left join public.brand_aliases a on a.brand_id = b.id
           where b.id = p_brand_id
           group by b.id, b.name),
         (select concat_ws(' ', leaf.name, grp.name)
            from public.categories leaf
            left join public.categories grp on grp.id = leaf.parent_id
           where leaf.id = p_category_id),
         (select string_agg(t.label || ' ' || replace(t.slug, '_', ' '), ' ' order by v.position)
            from public.listing_attribute_values v
            join public.listing_attribute_terms t on t.id = v.term_id
           where v.listing_id = p_listing_id
             and v.kind = 'item_type'))), 'A')
    || setweight(public.fynd_text_tsvector(concat_ws(' ',
         (select string_agg(t.label || ' ' || replace(t.slug, '_', ' '), ' ' order by v.kind, v.position)
            from public.listing_attribute_values v
            join public.listing_attribute_terms t on t.id = v.term_id
           where v.listing_id = p_listing_id
             and v.kind <> 'item_type'),
         array_to_string(p_keywords, ' '))), 'B')
    || setweight(public.fynd_text_tsvector(p_description), 'C');
$$;

revoke all on function private.listing_search_document(uuid, text, text, uuid, uuid, text, text[]) from public;

create function private.refresh_listing_search_tsv(p_listing_ids uuid[])
returns void
language sql
volatile
set search_path = ''
as $$
  update public.listings l
     set search_tsv = private.listing_search_document(
           l.id, l.title, l.description, l.category_id, l.brand_id, l.brand_text, l.keywords)
   where l.id = any(p_listing_ids);
$$;

revoke all on function private.refresh_listing_search_tsv(uuid[]) from public;

-- ============================================================
-- 4. updated_at ignores search_tsv-only updates
-- ============================================================
-- Column list = every listings column except search_tsv (read from the live
-- table when this was written). See deviation 3 in the header.
drop trigger listings_set_updated_at on public.listings;
create trigger listings_set_updated_at
  before update of
    id, seller_id, title, description, price_amount, currency, condition,
    status, created_at, updated_at, size, category_id, sold_to_user_id,
    keywords, brand_id, brand_text
  on public.listings
  for each row execute function public.set_updated_at();

-- ============================================================
-- 5. listings: recompute on insert and on a change to a document column
-- ============================================================
create function private.listings_set_search_tsv()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.search_tsv := private.listing_search_document(
    new.id, new.title, new.description, new.category_id,
    new.brand_id, new.brand_text, new.keywords);
  return new;
end;
$$;

revoke all on function private.listings_set_search_tsv() from public;

create trigger listings_set_search_tsv
  before insert or update of title, description, category_id, brand_id, brand_text, keywords
  on public.listings
  for each row execute function private.listings_set_search_tsv();

-- ============================================================
-- 6. listing_attribute_values: refresh the affected listings
-- ============================================================
-- Statement-level with transition tables: set_listing_attributes does one
-- DELETE and one INSERT, so each refreshes the listing once. Transition
-- tables allow only one event per trigger, hence three triggers.
create function private.listing_attribute_values_refresh_search()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct n.listing_id) into v_ids from new_rows n;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct o.listing_id) into v_ids from old_rows o;
  else
    select array_agg(distinct x.listing_id) into v_ids
      from (select o.listing_id from old_rows o
            union
            select n.listing_id from new_rows n) x;
  end if;

  if v_ids is not null then
    perform private.refresh_listing_search_tsv(v_ids);
  end if;
  return null;
end;
$$;

revoke all on function private.listing_attribute_values_refresh_search() from public;

create trigger listing_attribute_values_refresh_search_ins
  after insert on public.listing_attribute_values
  referencing new table as new_rows
  for each statement execute function private.listing_attribute_values_refresh_search();

create trigger listing_attribute_values_refresh_search_del
  after delete on public.listing_attribute_values
  referencing old table as old_rows
  for each statement execute function private.listing_attribute_values_refresh_search();

create trigger listing_attribute_values_refresh_search_upd
  after update on public.listing_attribute_values
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.listing_attribute_values_refresh_search();

-- ============================================================
-- 7. Lookup tables: refresh listings whose document text changed
-- ============================================================

-- brands: a rename changes the brand name in every listing with that brand.
create function private.brands_refresh_search()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select array_agg(l.id) into v_ids
    from public.listings l
   where l.brand_id in (
     select n.id
       from new_rows n
       join old_rows o on o.id = n.id
      where n.name is distinct from o.name
   );

  if v_ids is not null then
    perform private.refresh_listing_search_tsv(v_ids);
  end if;
  return null;
end;
$$;

revoke all on function private.brands_refresh_search() from public;

create trigger brands_refresh_search
  after update on public.brands
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.brands_refresh_search();

-- brand_aliases: any added, removed or changed alias (old and new brand).
create function private.brand_aliases_refresh_search()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand_ids uuid[];
  v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct n.brand_id) into v_brand_ids from new_rows n;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct o.brand_id) into v_brand_ids from old_rows o;
  else
    select array_agg(distinct x.brand_id) into v_brand_ids
      from (select o.brand_id from old_rows o
            union
            select n.brand_id from new_rows n) x;
  end if;

  if v_brand_ids is null then
    return null;
  end if;

  select array_agg(l.id) into v_ids
    from public.listings l
   where l.brand_id = any(v_brand_ids);

  if v_ids is not null then
    perform private.refresh_listing_search_tsv(v_ids);
  end if;
  return null;
end;
$$;

revoke all on function private.brand_aliases_refresh_search() from public;

create trigger brand_aliases_refresh_search_ins
  after insert on public.brand_aliases
  referencing new table as new_rows
  for each statement execute function private.brand_aliases_refresh_search();

create trigger brand_aliases_refresh_search_del
  after delete on public.brand_aliases
  referencing old table as old_rows
  for each statement execute function private.brand_aliases_refresh_search();

create trigger brand_aliases_refresh_search_upd
  after update on public.brand_aliases
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.brand_aliases_refresh_search();

-- listing_attribute_terms: a label or slug change.
create function private.listing_attribute_terms_refresh_search()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select array_agg(distinct v.listing_id) into v_ids
    from public.listing_attribute_values v
   where v.term_id in (
     select n.id
       from new_rows n
       join old_rows o on o.id = n.id
      where n.label is distinct from o.label
         or n.slug is distinct from o.slug
   );

  if v_ids is not null then
    perform private.refresh_listing_search_tsv(v_ids);
  end if;
  return null;
end;
$$;

revoke all on function private.listing_attribute_terms_refresh_search() from public;

create trigger listing_attribute_terms_refresh_search
  after update on public.listing_attribute_terms
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.listing_attribute_terms_refresh_search();

-- categories: a name or parent change affects listings in that category and,
-- for a group, listings in its children.
create function private.categories_refresh_search()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed uuid[];
  v_ids uuid[];
begin
  select array_agg(n.id) into v_changed
    from new_rows n
    join old_rows o on o.id = n.id
   where n.name is distinct from o.name
      or n.parent_id is distinct from o.parent_id;

  if v_changed is null then
    return null;
  end if;

  select array_agg(l.id) into v_ids
    from public.listings l
   where l.category_id = any(v_changed)
      or l.category_id in (
        select c.id from public.categories c where c.parent_id = any(v_changed)
      );

  if v_ids is not null then
    perform private.refresh_listing_search_tsv(v_ids);
  end if;
  return null;
end;
$$;

revoke all on function private.categories_refresh_search() from public;

create trigger categories_refresh_search
  after update on public.categories
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.categories_refresh_search();

-- ============================================================
-- 8. Backfill, then default + NOT NULL
-- ============================================================
-- Rewrites only the derived search_tsv of existing listings (updated_at is
-- untouched thanks to section 4).
select private.refresh_listing_search_tsv(array(select l.id from public.listings l));

alter table public.listings alter column search_tsv set default ''::tsvector;
alter table public.listings alter column search_tsv set not null;
