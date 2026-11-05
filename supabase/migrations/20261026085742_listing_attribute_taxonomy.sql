-- AI listing metadata plan, Phase 1a (migration 1 of 2): the controlled
-- vocabularies for structured listing attributes, plus where each one
-- applies.
--
-- Why lookup tables rather than enums: unlike listing_condition and
-- listing_size, a marketplace's product taxonomy keeps changing. Values get
-- added, renamed, retired and eventually translated. A Postgres enum value
-- can't be removed and can't carry a label, so every vocabulary here is rows:
--   * add    = insert a row
--   * rename = update `label` (or `slug`; listings hold the term's `id`, so
--              existing listings are unaffected)
--   * retire = set `retired_at`. A retired term is hidden from pickers and
--              from the AI, but listings that already carry it keep it.
-- Localized labels can be added later as a separate table keyed on
-- (term_id, locale) without reworking anything here.
--
-- Nothing in this migration touches the approved category tree
-- (20261018100200_categories.sql). Item type is a separate concept, tied to
-- categories through an explicit compatibility table.
--
-- Access, v1 (identical on all four tables): authenticated can SELECT, anon
-- has no access at all, and no client role can INSERT, UPDATE or DELETE.
-- Vocabulary changes only ever arrive through reviewed migrations.

-- ============================================================
-- Shared leaf guard
-- ============================================================
-- A row in either applicability table must point at a LEAF category (a row
-- with a parent). The categories migration documents that leaf-only rule as
-- review-enforced for listings; for these two tables it is enforced here,
-- because a group id would silently make an attribute apply to nothing.
create function public.listing_taxonomy_require_leaf_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.categories c
     where c.id = new.category_id
       and c.parent_id is not null
  ) then
    raise exception 'Category % is not a leaf category', new.category_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.listing_taxonomy_require_leaf_category() from public, anon, authenticated;

-- ============================================================
-- listing_attribute_kinds
-- ============================================================
-- One row per attribute kind. This list changes only alongside code: the
-- Sell UI renders a section per kind.
create table public.listing_attribute_kinds (
  kind text primary key,
  label text not null,
  -- The cardinality rule lives here as data, so listing_attribute_values'
  -- own trigger and set_listing_attributes read the same number.
  max_values smallint not null,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint listing_attribute_kinds_kind_format check (kind ~ '^[a-z]+(_[a-z]+)*$'),
  constraint listing_attribute_kinds_label_length check (char_length(btrim(label)) between 1 and 40),
  constraint listing_attribute_kinds_max_values_range check (max_values between 1 and 10)
);

-- ============================================================
-- listing_attribute_terms
-- ============================================================
create table public.listing_attribute_terms (
  id uuid primary key default gen_random_uuid(),
  kind text not null references public.listing_attribute_kinds (kind) on delete restrict,
  -- Canonical machine value: what the AI picks from and what search uses.
  -- Lowercase snake_case only, so synonyms can't sneak in as near-duplicate
  -- slugs.
  slug text not null,
  label text not null,
  position smallint not null default 0,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  constraint listing_attribute_terms_slug_format check (slug ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  constraint listing_attribute_terms_label_length check (char_length(btrim(label)) between 1 and 60),
  constraint listing_attribute_terms_kind_slug_unique unique (kind, slug),
  -- Target of the composite foreign keys below and in
  -- listing_attribute_values: those tables carry (term_id, kind) together,
  -- so the database itself refuses a term filed under the wrong kind.
  constraint listing_attribute_terms_id_kind_unique unique (id, kind)
);

create index listing_attribute_terms_kind_position_idx
  on public.listing_attribute_terms (kind, position);

-- ============================================================
-- listing_attribute_kind_categories
-- ============================================================
-- Which category leaves each NON-item-type kind applies to (Phase 0
-- decision 5: leaf-level, not group-level). Item type is excluded because it
-- has its own finer-grained compatibility table below; it would be
-- redundant, and confusing, to have two places say where item type
-- applies.
create table public.listing_attribute_kind_categories (
  kind text not null references public.listing_attribute_kinds (kind) on delete restrict,
  category_id uuid not null references public.categories (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (kind, category_id),
  constraint listing_attribute_kind_categories_not_item_type check (kind <> 'item_type')
);

create index listing_attribute_kind_categories_category_id_idx
  on public.listing_attribute_kind_categories (category_id);

create trigger listing_attribute_kind_categories_require_leaf
before insert or update on public.listing_attribute_kind_categories
for each row execute function public.listing_taxonomy_require_leaf_category();

-- ============================================================
-- listing_item_type_categories
-- ============================================================
-- Item type ↔ category compatibility (Phase 0 sign-off). Kind-level
-- applicability alone would allow combinations like Shoes + hoodie; this
-- table says, per item type, exactly which leaves it is valid under.
-- `term_kind` exists only so the composite foreign key can guarantee the
-- term really is an item type.
create table public.listing_item_type_categories (
  term_id uuid not null,
  term_kind text not null default 'item_type',
  category_id uuid not null references public.categories (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (term_id, category_id),
  constraint listing_item_type_categories_kind_is_item_type check (term_kind = 'item_type'),
  constraint listing_item_type_categories_term_fkey
    foreign key (term_id, term_kind)
    references public.listing_attribute_terms (id, kind)
    on delete restrict
);

create index listing_item_type_categories_category_id_idx
  on public.listing_item_type_categories (category_id);

create trigger listing_item_type_categories_require_leaf
before insert or update on public.listing_item_type_categories
for each row execute function public.listing_taxonomy_require_leaf_category();

-- ============================================================
-- Access (identical on all four tables)
-- ============================================================
-- pg_default_acl grants broad privileges to anon and authenticated on every
-- new relation, so the blanket revoke is what makes the single SELECT grant
-- meaningful.
alter table public.listing_attribute_kinds enable row level security;
alter table public.listing_attribute_terms enable row level security;
alter table public.listing_attribute_kind_categories enable row level security;
alter table public.listing_item_type_categories enable row level security;

revoke all on public.listing_attribute_kinds from public, anon, authenticated;
revoke all on public.listing_attribute_terms from public, anon, authenticated;
revoke all on public.listing_attribute_kind_categories from public, anon, authenticated;
revoke all on public.listing_item_type_categories from public, anon, authenticated;

grant select on public.listing_attribute_kinds to authenticated;
grant select on public.listing_attribute_terms to authenticated;
grant select on public.listing_attribute_kind_categories to authenticated;
grant select on public.listing_item_type_categories to authenticated;

create policy "Attribute kinds are readable by signed-in users"
  on public.listing_attribute_kinds for select to authenticated using (true);
create policy "Attribute terms are readable by signed-in users"
  on public.listing_attribute_terms for select to authenticated using (true);
create policy "Attribute applicability is readable by signed-in users"
  on public.listing_attribute_kind_categories for select to authenticated using (true);
create policy "Item type compatibility is readable by signed-in users"
  on public.listing_item_type_categories for select to authenticated using (true);

-- ============================================================
-- SEED DATA (Phase 0 approved). Do not change the values or mappings below
-- without a new sign-off.
-- ============================================================
-- Term ids are fixed literals, the same reproducibility convention as the
-- categories seed: a100000K-0000-4000-8000-0000000000NN, where K identifies
-- the kind (1 item_type, 2 color, 3 style, 4 material, 5 pattern, 6 fit)
-- and NN is the term's 1-based position within its kind.

insert into public.listing_attribute_kinds (kind, label, max_values, position) values
  ('item_type', 'Item type', 1, 0),
  ('color',     'Color',     3, 1),
  ('style',     'Style',     3, 2),
  ('material',  'Material',  2, 3),
  ('pattern',   'Pattern',   1, 4),
  ('fit',       'Fit',       1, 5);

insert into public.listing_attribute_terms (id, kind, slug, label, position) values
  -- ---- Item types (32) ----
  ('a1000001-0000-4000-8000-000000000001', 'item_type', 't_shirt',     'T-shirt',       0),
  ('a1000001-0000-4000-8000-000000000002', 'item_type', 'shirt',       'Shirt',         1),
  ('a1000001-0000-4000-8000-000000000003', 'item_type', 'polo',        'Polo',          2),
  ('a1000001-0000-4000-8000-000000000004', 'item_type', 'blouse',      'Blouse',        3),
  ('a1000001-0000-4000-8000-000000000005', 'item_type', 'tank_top',    'Tank top',      4),
  ('a1000001-0000-4000-8000-000000000006', 'item_type', 'sweater',     'Sweater',       5),
  ('a1000001-0000-4000-8000-000000000007', 'item_type', 'cardigan',    'Cardigan',      6),
  ('a1000001-0000-4000-8000-000000000008', 'item_type', 'hoodie',      'Hoodie',        7),
  ('a1000001-0000-4000-8000-000000000009', 'item_type', 'sweatshirt',  'Sweatshirt',    8),
  ('a1000001-0000-4000-8000-000000000010', 'item_type', 'jacket',      'Jacket',        9),
  ('a1000001-0000-4000-8000-000000000011', 'item_type', 'coat',        'Coat',         10),
  ('a1000001-0000-4000-8000-000000000012', 'item_type', 'blazer',      'Blazer',       11),
  ('a1000001-0000-4000-8000-000000000013', 'item_type', 'vest',        'Vest / gilet', 12),
  ('a1000001-0000-4000-8000-000000000014', 'item_type', 'jeans',       'Jeans',        13),
  ('a1000001-0000-4000-8000-000000000015', 'item_type', 'trousers',    'Trousers',     14),
  ('a1000001-0000-4000-8000-000000000016', 'item_type', 'joggers',     'Joggers',      15),
  ('a1000001-0000-4000-8000-000000000017', 'item_type', 'shorts',      'Shorts',       16),
  ('a1000001-0000-4000-8000-000000000018', 'item_type', 'skirt',       'Skirt',        17),
  ('a1000001-0000-4000-8000-000000000019', 'item_type', 'leggings',    'Leggings',     18),
  ('a1000001-0000-4000-8000-000000000020', 'item_type', 'dress',       'Dress',        19),
  ('a1000001-0000-4000-8000-000000000021', 'item_type', 'jumpsuit',    'Jumpsuit',     20),
  ('a1000001-0000-4000-8000-000000000022', 'item_type', 'sneakers',    'Sneakers',     21),
  ('a1000001-0000-4000-8000-000000000023', 'item_type', 'boots',       'Boots',        22),
  ('a1000001-0000-4000-8000-000000000024', 'item_type', 'sandals',     'Sandals',      23),
  ('a1000001-0000-4000-8000-000000000025', 'item_type', 'heels',       'Heels',        24),
  ('a1000001-0000-4000-8000-000000000026', 'item_type', 'flats',       'Flats',        25),
  ('a1000001-0000-4000-8000-000000000027', 'item_type', 'loafers',     'Loafers',      26),
  ('a1000001-0000-4000-8000-000000000028', 'item_type', 'dress_shoes', 'Dress shoes',  27),
  ('a1000001-0000-4000-8000-000000000029', 'item_type', 'bag',         'Bag',          28),
  ('a1000001-0000-4000-8000-000000000030', 'item_type', 'hat',         'Hat',          29),
  ('a1000001-0000-4000-8000-000000000031', 'item_type', 'scarf',       'Scarf',        30),
  ('a1000001-0000-4000-8000-000000000032', 'item_type', 'belt',        'Belt',         31),

  -- ---- Colors (18) ----
  ('a1000002-0000-4000-8000-000000000001', 'color', 'black',      'Black',       0),
  ('a1000002-0000-4000-8000-000000000002', 'color', 'white',      'White',       1),
  ('a1000002-0000-4000-8000-000000000003', 'color', 'grey',       'Grey',        2),
  ('a1000002-0000-4000-8000-000000000004', 'color', 'cream',      'Cream',       3),
  ('a1000002-0000-4000-8000-000000000005', 'color', 'beige',      'Beige',       4),
  ('a1000002-0000-4000-8000-000000000006', 'color', 'brown',      'Brown',       5),
  ('a1000002-0000-4000-8000-000000000007', 'color', 'navy',       'Navy',        6),
  ('a1000002-0000-4000-8000-000000000008', 'color', 'blue',       'Blue',        7),
  ('a1000002-0000-4000-8000-000000000009', 'color', 'light_blue', 'Light blue',  8),
  ('a1000002-0000-4000-8000-000000000010', 'color', 'green',      'Green',       9),
  ('a1000002-0000-4000-8000-000000000011', 'color', 'khaki',      'Khaki',      10),
  ('a1000002-0000-4000-8000-000000000012', 'color', 'red',        'Red',        11),
  ('a1000002-0000-4000-8000-000000000013', 'color', 'burgundy',   'Burgundy',   12),
  ('a1000002-0000-4000-8000-000000000014', 'color', 'pink',       'Pink',       13),
  ('a1000002-0000-4000-8000-000000000015', 'color', 'purple',     'Purple',     14),
  ('a1000002-0000-4000-8000-000000000016', 'color', 'yellow',     'Yellow',     15),
  ('a1000002-0000-4000-8000-000000000017', 'color', 'orange',     'Orange',     16),
  ('a1000002-0000-4000-8000-000000000018', 'color', 'multicolor', 'Multicolor', 17),

  -- ---- Styles (9; `casual` dropped at Phase 0) ----
  ('a1000003-0000-4000-8000-000000000001', 'style', 'streetwear', 'Streetwear', 0),
  ('a1000003-0000-4000-8000-000000000002', 'style', 'vintage',    'Vintage',    1),
  ('a1000003-0000-4000-8000-000000000003', 'style', 'y2k',        'Y2K',        2),
  ('a1000003-0000-4000-8000-000000000004', 'style', 'minimal',    'Minimal',    3),
  ('a1000003-0000-4000-8000-000000000005', 'style', 'workwear',   'Workwear',   4),
  ('a1000003-0000-4000-8000-000000000006', 'style', 'sportswear', 'Sportswear', 5),
  ('a1000003-0000-4000-8000-000000000007', 'style', 'formal',     'Formal',     6),
  ('a1000003-0000-4000-8000-000000000008', 'style', 'preppy',     'Preppy',     7),
  ('a1000003-0000-4000-8000-000000000009', 'style', 'boho',       'Boho',       8),

  -- ---- Materials (8) ----
  ('a1000004-0000-4000-8000-000000000001', 'material', 'cotton',       'Cotton',       0),
  ('a1000004-0000-4000-8000-000000000002', 'material', 'denim',        'Denim',        1),
  ('a1000004-0000-4000-8000-000000000003', 'material', 'wool',         'Wool',         2),
  ('a1000004-0000-4000-8000-000000000004', 'material', 'leather',      'Leather',      3),
  ('a1000004-0000-4000-8000-000000000005', 'material', 'faux_leather', 'Faux leather', 4),
  ('a1000004-0000-4000-8000-000000000006', 'material', 'linen',        'Linen',        5),
  ('a1000004-0000-4000-8000-000000000007', 'material', 'silk',         'Silk',         6),
  ('a1000004-0000-4000-8000-000000000008', 'material', 'synthetic',    'Synthetic',    7),

  -- ---- Patterns (9) ----
  ('a1000005-0000-4000-8000-000000000001', 'pattern', 'solid',        'Solid',           0),
  ('a1000005-0000-4000-8000-000000000002', 'pattern', 'striped',      'Striped',         1),
  ('a1000005-0000-4000-8000-000000000003', 'pattern', 'checked',      'Checked / plaid', 2),
  ('a1000005-0000-4000-8000-000000000004', 'pattern', 'graphic',      'Graphic',         3),
  ('a1000005-0000-4000-8000-000000000005', 'pattern', 'logo',         'Logo',            4),
  ('a1000005-0000-4000-8000-000000000006', 'pattern', 'floral',       'Floral',          5),
  ('a1000005-0000-4000-8000-000000000007', 'pattern', 'animal_print', 'Animal print',    6),
  ('a1000005-0000-4000-8000-000000000008', 'pattern', 'polka_dot',    'Polka dot',       7),
  ('a1000005-0000-4000-8000-000000000009', 'pattern', 'camo',         'Camo',            8),

  -- ---- Fits (4) ----
  ('a1000006-0000-4000-8000-000000000001', 'fit', 'slim',      'Slim',      0),
  ('a1000006-0000-4000-8000-000000000002', 'fit', 'regular',   'Regular',   1),
  ('a1000006-0000-4000-8000-000000000003', 'fit', 'relaxed',   'Relaxed',   2),
  ('a1000006-0000-4000-8000-000000000004', 'fit', 'oversized', 'Oversized', 3);

-- ---- Kind applicability (Phase 0 decision 5, leaf-level) ----
-- color/material/pattern/style: all 17 fashion leaves (every Women and Men
-- leaf, plus Kids › Clothing, Shoes and Accessories).
-- fit: clothing leaves only (no shoes, bags or accessories).
with fashion_leaves(category_id) as (values
  ('c0000001-0000-4000-8000-000000000001'::uuid), -- Women › Tops
  ('c0000001-0000-4000-8000-000000000002'),       -- Women › Dresses
  ('c0000001-0000-4000-8000-000000000003'),       -- Women › Bottoms
  ('c0000001-0000-4000-8000-000000000004'),       -- Women › Outerwear
  ('c0000001-0000-4000-8000-000000000005'),       -- Women › Shoes
  ('c0000001-0000-4000-8000-000000000006'),       -- Women › Bags
  ('c0000001-0000-4000-8000-000000000007'),       -- Women › Accessories
  ('c0000001-0000-4000-8000-000000000008'),       -- Women › Activewear
  ('c0000002-0000-4000-8000-000000000001'),       -- Men › Tops
  ('c0000002-0000-4000-8000-000000000002'),       -- Men › Bottoms
  ('c0000002-0000-4000-8000-000000000003'),       -- Men › Outerwear
  ('c0000002-0000-4000-8000-000000000004'),       -- Men › Shoes
  ('c0000002-0000-4000-8000-000000000005'),       -- Men › Accessories
  ('c0000002-0000-4000-8000-000000000006'),       -- Men › Activewear
  ('c0000003-0000-4000-8000-000000000001'),       -- Kids & Baby › Clothing
  ('c0000003-0000-4000-8000-000000000002'),       -- Kids & Baby › Shoes
  ('c0000003-0000-4000-8000-000000000005')        -- Kids & Baby › Accessories
)
insert into public.listing_attribute_kind_categories (kind, category_id)
select k.kind, f.category_id
  from fashion_leaves f
 cross join (values ('color'), ('material'), ('pattern'), ('style')) as k(kind);

insert into public.listing_attribute_kind_categories (kind, category_id) values
  ('fit', 'c0000001-0000-4000-8000-000000000001'), -- Women › Tops
  ('fit', 'c0000001-0000-4000-8000-000000000002'), -- Women › Dresses
  ('fit', 'c0000001-0000-4000-8000-000000000003'), -- Women › Bottoms
  ('fit', 'c0000001-0000-4000-8000-000000000004'), -- Women › Outerwear
  ('fit', 'c0000001-0000-4000-8000-000000000008'), -- Women › Activewear
  ('fit', 'c0000002-0000-4000-8000-000000000001'), -- Men › Tops
  ('fit', 'c0000002-0000-4000-8000-000000000002'), -- Men › Bottoms
  ('fit', 'c0000002-0000-4000-8000-000000000003'), -- Men › Outerwear
  ('fit', 'c0000002-0000-4000-8000-000000000006'), -- Men › Activewear
  ('fit', 'c0000003-0000-4000-8000-000000000001'); -- Kids & Baby › Clothing

-- ---- Item type ↔ category compatibility (Phase 0 approved) ----
-- Written category-first for review. Slugs are joined to their term ids,
-- and the count check right after the insert fails the whole migration if a
-- typo silently dropped a row from the join.
with mapping(category_id, slug) as (values
  -- Women › Tops (9)
  ('c0000001-0000-4000-8000-000000000001'::uuid, 't_shirt'),
  ('c0000001-0000-4000-8000-000000000001', 'shirt'),
  ('c0000001-0000-4000-8000-000000000001', 'polo'),
  ('c0000001-0000-4000-8000-000000000001', 'blouse'),
  ('c0000001-0000-4000-8000-000000000001', 'tank_top'),
  ('c0000001-0000-4000-8000-000000000001', 'sweater'),
  ('c0000001-0000-4000-8000-000000000001', 'cardigan'),
  ('c0000001-0000-4000-8000-000000000001', 'hoodie'),
  ('c0000001-0000-4000-8000-000000000001', 'sweatshirt'),
  -- Women › Dresses (2)
  ('c0000001-0000-4000-8000-000000000002', 'dress'),
  ('c0000001-0000-4000-8000-000000000002', 'jumpsuit'),
  -- Women › Bottoms (6)
  ('c0000001-0000-4000-8000-000000000003', 'jeans'),
  ('c0000001-0000-4000-8000-000000000003', 'trousers'),
  ('c0000001-0000-4000-8000-000000000003', 'joggers'),
  ('c0000001-0000-4000-8000-000000000003', 'shorts'),
  ('c0000001-0000-4000-8000-000000000003', 'skirt'),
  ('c0000001-0000-4000-8000-000000000003', 'leggings'),
  -- Women › Outerwear (4)
  ('c0000001-0000-4000-8000-000000000004', 'jacket'),
  ('c0000001-0000-4000-8000-000000000004', 'coat'),
  ('c0000001-0000-4000-8000-000000000004', 'blazer'),
  ('c0000001-0000-4000-8000-000000000004', 'vest'),
  -- Women › Shoes (7)
  ('c0000001-0000-4000-8000-000000000005', 'sneakers'),
  ('c0000001-0000-4000-8000-000000000005', 'boots'),
  ('c0000001-0000-4000-8000-000000000005', 'sandals'),
  ('c0000001-0000-4000-8000-000000000005', 'heels'),
  ('c0000001-0000-4000-8000-000000000005', 'flats'),
  ('c0000001-0000-4000-8000-000000000005', 'loafers'),
  ('c0000001-0000-4000-8000-000000000005', 'dress_shoes'),
  -- Women › Bags (1)
  ('c0000001-0000-4000-8000-000000000006', 'bag'),
  -- Women › Accessories (3)
  ('c0000001-0000-4000-8000-000000000007', 'hat'),
  ('c0000001-0000-4000-8000-000000000007', 'scarf'),
  ('c0000001-0000-4000-8000-000000000007', 'belt'),
  -- Women › Activewear (9)
  ('c0000001-0000-4000-8000-000000000008', 't_shirt'),
  ('c0000001-0000-4000-8000-000000000008', 'tank_top'),
  ('c0000001-0000-4000-8000-000000000008', 'hoodie'),
  ('c0000001-0000-4000-8000-000000000008', 'sweatshirt'),
  ('c0000001-0000-4000-8000-000000000008', 'jacket'),
  ('c0000001-0000-4000-8000-000000000008', 'shorts'),
  ('c0000001-0000-4000-8000-000000000008', 'leggings'),
  ('c0000001-0000-4000-8000-000000000008', 'trousers'),
  ('c0000001-0000-4000-8000-000000000008', 'joggers'),
  -- Men › Tops (8)
  ('c0000002-0000-4000-8000-000000000001', 't_shirt'),
  ('c0000002-0000-4000-8000-000000000001', 'shirt'),
  ('c0000002-0000-4000-8000-000000000001', 'polo'),
  ('c0000002-0000-4000-8000-000000000001', 'tank_top'),
  ('c0000002-0000-4000-8000-000000000001', 'sweater'),
  ('c0000002-0000-4000-8000-000000000001', 'cardigan'),
  ('c0000002-0000-4000-8000-000000000001', 'hoodie'),
  ('c0000002-0000-4000-8000-000000000001', 'sweatshirt'),
  -- Men › Bottoms (4)
  ('c0000002-0000-4000-8000-000000000002', 'jeans'),
  ('c0000002-0000-4000-8000-000000000002', 'trousers'),
  ('c0000002-0000-4000-8000-000000000002', 'joggers'),
  ('c0000002-0000-4000-8000-000000000002', 'shorts'),
  -- Men › Outerwear (4)
  ('c0000002-0000-4000-8000-000000000003', 'jacket'),
  ('c0000002-0000-4000-8000-000000000003', 'coat'),
  ('c0000002-0000-4000-8000-000000000003', 'blazer'),
  ('c0000002-0000-4000-8000-000000000003', 'vest'),
  -- Men › Shoes (5; no `flats` for men, per Phase 0)
  ('c0000002-0000-4000-8000-000000000004', 'sneakers'),
  ('c0000002-0000-4000-8000-000000000004', 'boots'),
  ('c0000002-0000-4000-8000-000000000004', 'sandals'),
  ('c0000002-0000-4000-8000-000000000004', 'loafers'),
  ('c0000002-0000-4000-8000-000000000004', 'dress_shoes'),
  -- Men › Accessories (4; bags live here, since Men has no Bags leaf)
  ('c0000002-0000-4000-8000-000000000005', 'bag'),
  ('c0000002-0000-4000-8000-000000000005', 'hat'),
  ('c0000002-0000-4000-8000-000000000005', 'scarf'),
  ('c0000002-0000-4000-8000-000000000005', 'belt'),
  -- Men › Activewear (9)
  ('c0000002-0000-4000-8000-000000000006', 't_shirt'),
  ('c0000002-0000-4000-8000-000000000006', 'tank_top'),
  ('c0000002-0000-4000-8000-000000000006', 'hoodie'),
  ('c0000002-0000-4000-8000-000000000006', 'sweatshirt'),
  ('c0000002-0000-4000-8000-000000000006', 'jacket'),
  ('c0000002-0000-4000-8000-000000000006', 'shorts'),
  ('c0000002-0000-4000-8000-000000000006', 'trousers'),
  ('c0000002-0000-4000-8000-000000000006', 'joggers'),
  ('c0000002-0000-4000-8000-000000000006', 'leggings'),
  -- Kids & Baby › Clothing (20)
  ('c0000003-0000-4000-8000-000000000001', 't_shirt'),
  ('c0000003-0000-4000-8000-000000000001', 'shirt'),
  ('c0000003-0000-4000-8000-000000000001', 'polo'),
  ('c0000003-0000-4000-8000-000000000001', 'blouse'),
  ('c0000003-0000-4000-8000-000000000001', 'tank_top'),
  ('c0000003-0000-4000-8000-000000000001', 'sweater'),
  ('c0000003-0000-4000-8000-000000000001', 'cardigan'),
  ('c0000003-0000-4000-8000-000000000001', 'hoodie'),
  ('c0000003-0000-4000-8000-000000000001', 'sweatshirt'),
  ('c0000003-0000-4000-8000-000000000001', 'jacket'),
  ('c0000003-0000-4000-8000-000000000001', 'coat'),
  ('c0000003-0000-4000-8000-000000000001', 'vest'),
  ('c0000003-0000-4000-8000-000000000001', 'jeans'),
  ('c0000003-0000-4000-8000-000000000001', 'trousers'),
  ('c0000003-0000-4000-8000-000000000001', 'joggers'),
  ('c0000003-0000-4000-8000-000000000001', 'shorts'),
  ('c0000003-0000-4000-8000-000000000001', 'skirt'),
  ('c0000003-0000-4000-8000-000000000001', 'leggings'),
  ('c0000003-0000-4000-8000-000000000001', 'dress'),
  ('c0000003-0000-4000-8000-000000000001', 'jumpsuit'),
  -- Kids & Baby › Shoes (4)
  ('c0000003-0000-4000-8000-000000000002', 'sneakers'),
  ('c0000003-0000-4000-8000-000000000002', 'boots'),
  ('c0000003-0000-4000-8000-000000000002', 'sandals'),
  ('c0000003-0000-4000-8000-000000000002', 'flats'),
  -- Kids & Baby › Accessories (4)
  ('c0000003-0000-4000-8000-000000000005', 'bag'),
  ('c0000003-0000-4000-8000-000000000005', 'hat'),
  ('c0000003-0000-4000-8000-000000000005', 'scarf'),
  ('c0000003-0000-4000-8000-000000000005', 'belt')
  -- No item types for: Kids & Baby › Toys and Baby gear; every Home,
  -- Electronics and Other leaf (including Other › Sports & outdoors, per
  -- Phase 0).
)
insert into public.listing_item_type_categories (term_id, category_id)
select t.id, m.category_id
  from mapping m
  join public.listing_attribute_terms t
    on t.kind = 'item_type' and t.slug = m.slug;

-- Guard: fail loudly on a seed typo rather than silently mapping less than
-- what was approved.
do $$
declare
  v_terms int;
  v_kind_rows int;
  v_compat_rows int;
  v_unmapped int;
begin
  select count(*) into v_terms from public.listing_attribute_terms;
  select count(*) into v_kind_rows from public.listing_attribute_kind_categories;
  select count(*) into v_compat_rows from public.listing_item_type_categories;
  select count(*) into v_unmapped
    from public.listing_attribute_terms t
   where t.kind = 'item_type'
     and not exists (select 1 from public.listing_item_type_categories c where c.term_id = t.id);

  if v_terms <> 80 then
    raise exception 'Expected 80 attribute terms, found %', v_terms;
  end if;
  if v_kind_rows <> 78 then
    raise exception 'Expected 78 kind applicability rows (4 kinds x 17 leaves + 10 fit leaves), found %', v_kind_rows;
  end if;
  if v_compat_rows <> 103 then
    raise exception 'Expected 103 item type compatibility rows, found %', v_compat_rows;
  end if;
  if v_unmapped <> 0 then
    raise exception '% item type(s) have no compatible category', v_unmapped;
  end if;
end;
$$;
