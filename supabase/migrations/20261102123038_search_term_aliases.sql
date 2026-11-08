-- Search synonyms, backend (roadmap 7.5a, search Phase 3c). Builds on 7.2's
-- text functions (20261102095218_hebrew_search_text_functions.sql,
-- 20261102095915_hebrew_search_text_hardening.sql), 7.3's search document
-- and search_listings (20261102101334, 20261102101440, 20261102102513) and
-- the attribute taxonomy (20261026085742_listing_attribute_taxonomy.sql).
--
-- WHY: a listing's search document already carries its attribute term
-- labels and slugs, but a buyer types "trainers", "tee" or "קפוצ'ון" and an
-- untagged listing only matches its own words. This adds a curated alias
-- table per attribute term and expands the search QUERY (not the document):
-- a query word that matches a term alias is replaced by
--   (the 7.2 sub-query of those words) OR (each alias of that term),
-- so "trainers" also finds "Sneakers" and "sneakers" also finds an untagged
-- "Vintage trainers".
--
-- Design (approved plan 7.5a):
--   - public.fynd_search_query (7.2) is UNCHANGED (search_text.sql pins it).
--     search_listings switches to the new STABLE wrapper
--     public.fynd_search_query_expanded, which returns a superset of the 7.2
--     query and exactly the 7.2 query when no alias matches.
--   - One alias key maps to exactly one term across all kinds (primary key),
--     at most 3 words, at most 16 alias rows per term.
--   - Matching is token by token (no phrase operator: document positions of
--     label words aren't adjacent). The longest alias wins ("dress shoes"
--     beats "dress"); a recognised alias span counts as one of the 8 query
--     units, keyed by term, so "hoodie קפוצ'ון" uses one unit.
--   - Hebrew: a query word uses all its 7.2 variants, but an alias word only
--     its suffix forms (variants that are a prefix of the alias), so the
--     alias שחור never brings in חור.
--   - Brand aliases are NOT used for text expansion (Roy's decision D4).
--     fynd_search_spans can return brand spans for 7.5b's recognition RPC;
--     the expansion calls it with p_include_brands = false.
--   - Retired terms keep their aliases: listings carrying them stay findable.
--
-- Seed: every term's own normalized label and slug (underscores -> spaces),
-- then the approved list (scratchpad 7.5-synonyms.md with Roy's rulings).
-- Deviation from the approved list: "off white" (Cream) is omitted because it
-- normalizes to the brand alias "Off-White"; text search for "off white"
-- still finds the brand through the document.
--
-- Access (§2.4, same as the taxonomy tables): RLS on, authenticated SELECT
-- only, no anon access, no client writes. Every new function has
-- search_path = '', EXECUTE revoked from public and anon and granted to
-- authenticated: search_listings is SECURITY INVOKER and runs as the caller,
-- so every function it calls must be executable by authenticated.
--
-- Non-ASCII characters in regexes are written as \uXXXX escapes; Hebrew
-- appears literally only inside the seed's alias string values.

-- ============================================================
-- 1. listing_attribute_term_aliases
-- ============================================================
create table public.listing_attribute_term_aliases (
  -- fynd_text_normalize(alias); one key -> one term, across all kinds.
  alias_key text primary key,
  term_id uuid not null,
  -- Carried only so the composite foreign key guarantees the kind.
  term_kind text not null,
  alias text not null,
  created_at timestamptz not null default now(),
  constraint listing_attribute_term_aliases_term_fkey
    foreign key (term_id, term_kind)
    references public.listing_attribute_terms (id, kind)
    on delete cascade,
  constraint listing_attribute_term_aliases_alias_length check (char_length(alias) between 1 and 60),
  constraint listing_attribute_term_aliases_key_matches check (
    alias_key <> '' and alias_key = public.fynd_text_normalize(alias)
  ),
  constraint listing_attribute_term_aliases_max_words check (
    cardinality(string_to_array(alias_key, ' ')) <= 3
  )
);

create index listing_attribute_term_aliases_term_id_idx
  on public.listing_attribute_term_aliases (term_id);

comment on table public.listing_attribute_term_aliases is
  'Search synonyms per attribute term (roadmap 7.5). alias_key = fynd_text_normalize(alias), unique across all kinds; <= 3 words; <= 16 rows per term. Changed only by migrations.';

-- pg_default_acl grants broad privileges on new relations; the blanket
-- revoke makes the single SELECT grant meaningful.
alter table public.listing_attribute_term_aliases enable row level security;
revoke all on public.listing_attribute_term_aliases from public, anon, authenticated;
grant select on public.listing_attribute_term_aliases to authenticated;

create policy "Attribute term aliases are readable by signed-in users"
  on public.listing_attribute_term_aliases for select to authenticated using (true);

-- ============================================================
-- 2. Seed
-- ============================================================
-- (a) Every term's own label and slug. A slug equal to its label after
-- normalization ("t_shirt" / "T-shirt") is the same key: do nothing.
insert into public.listing_attribute_term_aliases (alias_key, term_id, term_kind, alias)
select public.fynd_text_normalize(t.label), t.id, t.kind, t.label
  from public.listing_attribute_terms t
on conflict (alias_key) do nothing;

insert into public.listing_attribute_term_aliases (alias_key, term_id, term_kind, alias)
select public.fynd_text_normalize(replace(t.slug, '_', ' ')), t.id, t.kind, replace(t.slug, '_', ' ')
  from public.listing_attribute_terms t
on conflict (alias_key) do nothing;

-- (b) The approved list, terms looked up by (kind, slug). No ON CONFLICT: a
-- cross-term duplicate must fail the migration. The guard below checks that
-- no row was lost to a missing (kind, slug).
insert into public.listing_attribute_term_aliases (alias_key, term_id, term_kind, alias)
select public.fynd_text_normalize(v.alias), t.id, t.kind, v.alias
  from (values
    -- ---- Item types ----
    ('item_type', 't_shirt', 'tee'),
    ('item_type', 't_shirt', 'tshirt'),
    ('item_type', 't_shirt', 'טישירט'),
    ('item_type', 't_shirt', 'טי שירט'),
    ('item_type', 't_shirt', 'חולצת טי'),
    ('item_type', 'shirt', 'button up'),
    ('item_type', 'shirt', 'button down'),
    ('item_type', 'shirt', 'חולצה'),
    ('item_type', 'shirt', 'חולצת'),
    ('item_type', 'shirt', 'חולצה מכופתרת'),
    ('item_type', 'polo', 'polo shirt'),
    ('item_type', 'polo', 'פולו'),
    ('item_type', 'polo', 'חולצת פולו'),
    ('item_type', 'blouse', 'בלוזה'),
    ('item_type', 'tank_top', 'tank'),
    ('item_type', 'tank_top', 'singlet'),
    ('item_type', 'tank_top', 'cami'),
    ('item_type', 'tank_top', 'camisole'),
    ('item_type', 'tank_top', 'גופייה'),
    ('item_type', 'tank_top', 'גופיה'),
    ('item_type', 'sweater', 'jumper'),
    ('item_type', 'sweater', 'pullover'),
    ('item_type', 'sweater', 'knit'),
    ('item_type', 'sweater', 'knitwear'),
    ('item_type', 'sweater', 'סוודר'),
    ('item_type', 'sweater', 'סריג'),
    ('item_type', 'cardigan', 'קרדיגן'),
    ('item_type', 'hoodie', 'hoody'),
    ('item_type', 'hoodie', 'hooded sweatshirt'),
    ('item_type', 'hoodie', 'קפוצ''ון'),
    ('item_type', 'hoodie', 'הודי'),
    ('item_type', 'sweatshirt', 'crewneck'),
    ('item_type', 'sweatshirt', 'crew neck'),
    ('item_type', 'sweatshirt', 'סווטשירט'),
    ('item_type', 'sweatshirt', 'סווטשרט'),
    ('item_type', 'jacket', 'bomber'),
    ('item_type', 'jacket', 'puffer'),
    ('item_type', 'jacket', 'windbreaker'),
    ('item_type', 'jacket', 'ג''קט'),
    ('item_type', 'coat', 'overcoat'),
    ('item_type', 'coat', 'parka'),
    ('item_type', 'coat', 'trench'),
    ('item_type', 'coat', 'trench coat'),
    ('item_type', 'coat', 'מעיל'),
    ('item_type', 'coat', 'פרקה'),
    ('item_type', 'blazer', 'suit jacket'),
    ('item_type', 'blazer', 'sport coat'),
    ('item_type', 'blazer', 'בלייזר'),
    ('item_type', 'blazer', 'ז''קט'),
    ('item_type', 'vest', 'gilet'),
    ('item_type', 'vest', 'body warmer'),
    ('item_type', 'vest', 'וסט'),
    ('item_type', 'vest', 'אפודה'),
    ('item_type', 'jeans', 'jean'),
    ('item_type', 'jeans', 'ג''ינס'),
    ('item_type', 'jeans', 'מכנסי ג''ינס'),
    ('item_type', 'trousers', 'pants'),
    ('item_type', 'trousers', 'slacks'),
    ('item_type', 'trousers', 'chinos'),
    ('item_type', 'trousers', 'chino'),
    ('item_type', 'trousers', 'מכנסיים'),
    ('item_type', 'trousers', 'מכנס'),
    ('item_type', 'joggers', 'sweatpants'),
    ('item_type', 'joggers', 'track pants'),
    ('item_type', 'joggers', 'jogging pants'),
    ('item_type', 'joggers', 'טרנינג'),
    ('item_type', 'joggers', 'מכנסי טרנינג'),
    ('item_type', 'shorts', 'bermuda'),
    ('item_type', 'shorts', 'שורטים'),
    ('item_type', 'shorts', 'שורטס'),
    ('item_type', 'shorts', 'מכנסיים קצרים'),
    ('item_type', 'shorts', 'ברמודה'),
    ('item_type', 'skirt', 'חצאית'),
    ('item_type', 'skirt', 'חצאיות'),
    ('item_type', 'leggings', 'tights'),
    ('item_type', 'leggings', 'טייץ'),
    ('item_type', 'leggings', 'טייטס'),
    ('item_type', 'dress', 'gown'),
    ('item_type', 'dress', 'שמלה'),
    ('item_type', 'dress', 'שמלת'),
    ('item_type', 'jumpsuit', 'romper'),
    ('item_type', 'jumpsuit', 'playsuit'),
    ('item_type', 'jumpsuit', 'overalls'),
    ('item_type', 'jumpsuit', 'dungarees'),
    ('item_type', 'jumpsuit', 'אוברול'),
    ('item_type', 'sneakers', 'trainers'),
    ('item_type', 'sneakers', 'kicks'),
    ('item_type', 'sneakers', 'tennis shoes'),
    ('item_type', 'sneakers', 'running shoes'),
    ('item_type', 'sneakers', 'סניקרס'),
    ('item_type', 'sneakers', 'נעלי ספורט'),
    ('item_type', 'sneakers', 'נעלי ריצה'),
    ('item_type', 'boots', 'boot'),
    ('item_type', 'boots', 'מגפיים'),
    ('item_type', 'boots', 'מגף'),
    ('item_type', 'boots', 'מגפונים'),
    ('item_type', 'sandals', 'slides'),
    ('item_type', 'sandals', 'flip flops'),
    ('item_type', 'sandals', 'סנדלים'),
    ('item_type', 'sandals', 'סנדלי'),
    ('item_type', 'sandals', 'כפכפים'),
    ('item_type', 'sandals', 'כפכפי'),
    ('item_type', 'heels', 'high heels'),
    ('item_type', 'heels', 'pumps'),
    ('item_type', 'heels', 'stilettos'),
    ('item_type', 'heels', 'עקבים'),
    ('item_type', 'heels', 'נעלי עקב'),
    ('item_type', 'flats', 'ballet flats'),
    ('item_type', 'flats', 'ballerinas'),
    ('item_type', 'flats', 'בלרינות'),
    ('item_type', 'flats', 'נעלי בובה'),
    ('item_type', 'loafers', 'moccasins'),
    ('item_type', 'loafers', 'מוקסינים'),
    ('item_type', 'loafers', 'לואפרס'),
    ('item_type', 'dress_shoes', 'oxfords'),
    ('item_type', 'dress_shoes', 'brogues'),
    ('item_type', 'dress_shoes', 'derbies'),
    ('item_type', 'dress_shoes', 'נעלי ערב'),
    ('item_type', 'dress_shoes', 'נעליים אלגנטיות'),
    ('item_type', 'bag', 'handbag'),
    ('item_type', 'bag', 'purse'),
    ('item_type', 'bag', 'tote'),
    ('item_type', 'bag', 'shoulder bag'),
    ('item_type', 'bag', 'crossbody'),
    ('item_type', 'bag', 'backpack'),
    ('item_type', 'bag', 'תיק'),
    ('item_type', 'bag', 'תיק צד'),
    ('item_type', 'bag', 'תיק גב'),
    ('item_type', 'hat', 'cap'),
    ('item_type', 'hat', 'beanie'),
    ('item_type', 'hat', 'bucket hat'),
    ('item_type', 'hat', 'כובע'),
    ('item_type', 'hat', 'כובע גרב'),
    ('item_type', 'scarf', 'shawl'),
    ('item_type', 'scarf', 'צעיף'),
    ('item_type', 'belt', 'חגורה'),
    -- ---- Colors ("off white" omitted: it is the brand alias Off-White) ----
    ('color', 'black', 'שחור'),
    ('color', 'white', 'לבן'),
    ('color', 'grey', 'gray'),
    ('color', 'grey', 'אפור'),
    ('color', 'cream', 'ivory'),
    ('color', 'cream', 'קרם'),
    ('color', 'cream', 'שמנת'),
    ('color', 'beige', 'tan'),
    ('color', 'beige', 'camel'),
    ('color', 'beige', 'בז'''),
    ('color', 'beige', 'ניוד'),
    ('color', 'brown', 'chocolate'),
    ('color', 'brown', 'חום'),
    ('color', 'navy', 'navy blue'),
    ('color', 'navy', 'נייבי'),
    ('color', 'navy', 'כחול כהה'),
    ('color', 'blue', 'כחול'),
    ('color', 'light_blue', 'sky blue'),
    ('color', 'light_blue', 'baby blue'),
    ('color', 'light_blue', 'תכלת'),
    ('color', 'green', 'ירוק'),
    ('color', 'khaki', 'olive'),
    ('color', 'khaki', 'חאקי'),
    ('color', 'khaki', 'זית'),
    ('color', 'red', 'אדום'),
    ('color', 'burgundy', 'maroon'),
    ('color', 'burgundy', 'wine'),
    ('color', 'burgundy', 'בורדו'),
    ('color', 'pink', 'ורוד'),
    ('color', 'purple', 'violet'),
    ('color', 'purple', 'lilac'),
    ('color', 'purple', 'סגול'),
    ('color', 'yellow', 'mustard'),
    ('color', 'yellow', 'צהוב'),
    ('color', 'orange', 'כתום'),
    ('color', 'multicolor', 'multicolour'),
    ('color', 'multicolor', 'multi color'),
    ('color', 'multicolor', 'rainbow'),
    ('color', 'multicolor', 'צבעוני'),
    ('color', 'multicolor', 'צבעונית'),
    -- ---- Materials (עור excluded: ambiguous) ----
    ('material', 'cotton', 'כותנה'),
    ('material', 'denim', 'דנים'),
    ('material', 'wool', 'merino'),
    ('material', 'wool', 'cashmere'),
    ('material', 'wool', 'צמר'),
    ('material', 'leather', 'suede'),
    ('material', 'faux_leather', 'vegan leather'),
    ('material', 'faux_leather', 'pu leather'),
    ('material', 'faux_leather', 'leatherette'),
    ('material', 'faux_leather', 'דמוי עור'),
    ('material', 'linen', 'פשתן'),
    ('material', 'silk', 'satin'),
    ('material', 'silk', 'משי'),
    ('material', 'synthetic', 'polyester'),
    ('material', 'synthetic', 'nylon'),
    ('material', 'synthetic', 'פוליאסטר'),
    ('material', 'synthetic', 'ניילון'),
    -- ---- Patterns (חלק, נקודות, הדפס, print excluded: ambiguous) ----
    ('pattern', 'solid', 'plain'),
    ('pattern', 'striped', 'stripes'),
    ('pattern', 'striped', 'stripe'),
    ('pattern', 'striped', 'פסים'),
    ('pattern', 'striped', 'מפוספס'),
    ('pattern', 'checked', 'check'),
    ('pattern', 'checked', 'plaid'),
    ('pattern', 'checked', 'tartan'),
    ('pattern', 'checked', 'gingham'),
    ('pattern', 'checked', 'משבצות'),
    ('pattern', 'checked', 'משובץ'),
    ('pattern', 'logo', 'לוגו'),
    ('pattern', 'floral', 'flower'),
    ('pattern', 'floral', 'flowers'),
    ('pattern', 'floral', 'פרחוני'),
    ('pattern', 'floral', 'פרחים'),
    ('pattern', 'animal_print', 'leopard'),
    ('pattern', 'animal_print', 'zebra'),
    ('pattern', 'animal_print', 'snake print'),
    ('pattern', 'animal_print', 'מנומר'),
    ('pattern', 'polka_dot', 'dots'),
    ('pattern', 'polka_dot', 'dotted'),
    ('pattern', 'polka_dot', 'polka'),
    ('pattern', 'polka_dot', 'מנוקד'),
    ('pattern', 'camo', 'camouflage'),
    ('pattern', 'camo', 'הסוואה'),
    ('pattern', 'camo', 'קמופלאז'''),
    -- ---- Styles ----
    ('style', 'sportswear', 'athleisure'),
    ('style', 'sportswear', 'ספורטיבי'),
    ('style', 'boho', 'bohemian'),
    ('style', 'boho', 'בוהו'),
    ('style', 'minimal', 'minimalist'),
    ('style', 'vintage', 'וינטג'''),
    -- ---- Fits ----
    ('fit', 'slim', 'skinny'),
    ('fit', 'slim', 'סלים'),
    ('fit', 'oversized', 'אוברסייז')
  ) as v(kind, slug, alias)
  join public.listing_attribute_terms t on t.kind = v.kind and t.slug = v.slug;

do $guard$
declare
  v_terms integer;
  v_rows integer;
begin
  select count(*) into v_terms from public.listing_attribute_terms;
  select count(*) into v_rows from public.listing_attribute_term_aliases;

  -- 80 terms -> 82 label/slug keys (vest and checked have a distinct slug
  -- key) + 229 approved aliases.
  if v_terms <> 80 or v_rows <> 311 then
    raise exception 'Alias seed mismatch: % terms, % alias rows (expected 80 / 311)', v_terms, v_rows;
  end if;

  if exists (
    select 1 from public.listing_attribute_terms t
     where not exists (select 1 from public.listing_attribute_term_aliases a
                        where a.term_id = t.id and a.alias_key = public.fynd_text_normalize(t.label))
        or not exists (select 1 from public.listing_attribute_term_aliases a
                        where a.term_id = t.id
                          and a.alias_key = public.fynd_text_normalize(replace(t.slug, '_', ' ')))
  ) then
    raise exception 'A term is missing its own label or slug alias row';
  end if;

  if exists (
    select 1 from public.listing_attribute_term_aliases a
     group by a.term_id having count(*) > 16
  ) then
    raise exception 'A term has more than 16 alias rows';
  end if;

  if exists (
    select 1 from public.listing_attribute_term_aliases a
      join public.brand_aliases b on public.fynd_text_normalize(b.alias) = a.alias_key
  ) then
    raise exception 'A term alias equals a brand alias';
  end if;
end
$guard$;

-- ============================================================
-- 3. fynd_match_forms
-- ============================================================
-- The forms one NORMALIZED token is matched by. Two tokens match when their
-- forms overlap.
--   Hebrew query token : every 7.2 variant (prefix forms + stems).
--   Hebrew alias token : only variants v the token starts with (suffix
--                        forms), so the alias שחור never yields חור.
--   other token        : the token plus its english lexemes ("trainers" ->
--                        {trainer, trainers}); stopwords keep the token.
create function public.fynd_match_forms(p_token text, p_is_query boolean)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_token is null or p_token = '' then '{}'::text[]
    when p_token ~ '^[\u05D0-\u05EA]+$' then
      case
        when p_is_query then public.fynd_token_variants(p_token)
        else array(select v.form
                     from unnest(public.fynd_token_variants(p_token)) with ordinality as v(form, o)
                    where left(p_token, length(v.form)) = v.form
                    order by v.o)
      end
    else array(select distinct x.form
                 from unnest(array[p_token]
                        || tsvector_to_array(to_tsvector('pg_catalog.english'::regconfig, p_token))) as x(form)
                order by x.form)
  end;
$$;

comment on function public.fynd_match_forms(text, boolean) is
  'Match forms of one normalized token (roadmap 7.5): Hebrew query = all variants, Hebrew alias = suffix forms only, other = token + english lexemes.';

revoke all on function public.fynd_match_forms(text, boolean) from public, anon;
grant execute on function public.fynd_match_forms(text, boolean) to authenticated;

-- ============================================================
-- 4. fynd_member_token_query
-- ============================================================
-- One alias token -> tsquery. Hebrew: OR of its suffix forms (simple).
-- Other: english || simple (one when identical); an English stopword is
-- KEPT via simple, so the alias "t shirt" requires 't' & 'shirt' (the
-- document indexes 't' through its simple variants).
create function public.fynd_member_token_query(p_token text)
returns tsquery
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_form text;
  v_part tsquery;
  v_sub tsquery;
  v_english tsquery;
  v_simple tsquery;
begin
  if p_token is null or p_token = '' then
    return null;
  end if;

  if p_token ~ '^[\u05D0-\u05EA]+$' then
    foreach v_form in array public.fynd_match_forms(p_token, false) loop
      v_part := plainto_tsquery('pg_catalog.simple'::regconfig, v_form);
      continue when numnode(v_part) = 0;
      v_sub := case when v_sub is null then v_part else v_sub || v_part end;
    end loop;
    return v_sub;
  end if;

  v_simple := plainto_tsquery('pg_catalog.simple'::regconfig, p_token);
  if numnode(v_simple) = 0 then
    return null;
  end if;
  if length(to_tsvector('pg_catalog.english'::regconfig, p_token)) = 0 then
    return v_simple;
  end if;
  v_english := plainto_tsquery('pg_catalog.english'::regconfig, p_token);
  return case when v_english = v_simple then v_english else v_english || v_simple end;
end;
$$;

comment on function public.fynd_member_token_query(text) is
  'One normalized alias token -> tsquery (roadmap 7.5): Hebrew suffix forms OR-ed; english || simple otherwise, stopwords kept via simple.';

revoke all on function public.fynd_member_token_query(text) from public, anon;
grant execute on function public.fynd_member_token_query(text) to authenticated;

-- ============================================================
-- 5. fynd_search_tokens
-- ============================================================
-- 7.2's input preparation, shared: cut to 200 characters (dropping a word the
-- cut lands inside), normalize, split. Not deduped (spans need positions).
create function public.fynd_search_tokens(p_query text)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    array(
      select t.tok
        from unnest(string_to_array(public.fynd_text_normalize(
               case
                 when length(p_query) > 200
                   then regexp_replace(left(p_query, 201), '[^[:space:]]*$', '')
                 else p_query
               end), ' ')) with ordinality as t(tok, i)
       where t.tok <> ''
       order by t.i),
    '{}'::text[]);
$$;

comment on function public.fynd_search_tokens(text) is
  'Search box text -> normalized tokens after 7.2''s 200-character cut (roadmap 7.5). Not deduped.';

revoke all on function public.fynd_search_tokens(text) from public, anon;
grant execute on function public.fynd_search_tokens(text) to authenticated;

-- ============================================================
-- 6. fynd_search_spans
-- ============================================================
-- Every alias that matches tokens [first_token, first_token + token_count - 1]
-- of the first 24 tokens, token by token. Term aliases always; active brand
-- aliases only when p_include_brands (7.5b recognition). exact = the tokens
-- spell the alias key literally.
create function public.fynd_search_spans(p_tokens text[], p_include_brands boolean)
returns table (
  first_token integer,
  token_count integer,
  kind text,
  term_id uuid,
  brand_id uuid,
  alias text,
  exact boolean
)
language sql
stable
parallel safe
security invoker
set search_path = ''
as $$
  with qt as materialized (
    select t.tok, t.i::int as i, public.fynd_match_forms(t.tok, true) as forms
      from unnest(coalesce(p_tokens, '{}'::text[])) with ordinality as t(tok, i)
     where t.i <= 24
  ),
  cand as materialized (
    select c.kind, c.term_id, c.brand_id, c.alias, c.key,
           string_to_array(c.key, ' ') as toks,
           cardinality(string_to_array(c.key, ' ')) as k,
           public.fynd_match_forms(split_part(c.key, ' ', 1), false) as first_forms
      from (
        select a.term_kind as kind, a.term_id, null::uuid as brand_id, a.alias, a.alias_key as key
          from public.listing_attribute_term_aliases a
        union all
        select 'brand', null::uuid, b.id, ba.alias, public.fynd_text_normalize(ba.alias)
          from public.brand_aliases ba
          join public.brands b on b.id = ba.brand_id
         where p_include_brands
           and b.retired_at is null
      ) c
     where c.key <> ''
  )
  select q1.i, c.k, c.kind, c.term_id, c.brand_id, c.alias,
         array_to_string((select array_agg(q.tok order by q.i) from qt q
                           where q.i between q1.i and q1.i + c.k - 1), ' ') = c.key
    from qt q1
    join cand c on c.first_forms && q1.forms
   where q1.i + c.k - 1 <= (select max(q.i) from qt q)
     and not exists (
       select 1
         from unnest(c.toks) with ordinality as x(tok, j)
        where x.j > 1
          and not exists (
            select 1 from qt q2
             where q2.i = q1.i + x.j::int - 1
               and q2.forms && public.fynd_match_forms(x.tok, false)));
$$;

comment on function public.fynd_search_spans(text[], boolean) is
  'Alias spans over the first 24 normalized query tokens (roadmap 7.5): term aliases, plus active brand aliases when p_include_brands.';

revoke all on function public.fynd_search_spans(text[], boolean) from public, anon;
grant execute on function public.fynd_search_spans(text[], boolean) to authenticated;

-- ============================================================
-- 7. fynd_search_query_expanded
-- ============================================================
-- Left to right over the tokens, at most 8 units:
--   - an alias span starting here (longest, then exact, then kind / term
--     position): unit key 'term:<id>'; sub-query = the 7.2 query of the
--     covered words OR each alias of that term (first 16 by key; an alias is
--     the AND of its fynd_member_token_query tokens);
--   - otherwise the 7.2 rules for the single word (fynd_search_query of the
--     token itself: stopwords and lone Hebrew letters skipped); unit key =
--     the word.
-- Units already used, or empty, are skipped. Units are ANDed. NULL = no text
-- filter. With no span, the result equals fynd_search_query(p_query).
create function public.fynd_search_query_expanded(p_query text)
returns tsquery
language plpgsql
stable
parallel safe
security invoker
set search_path = ''
as $$
declare
  c_max_units constant int := 8;
  c_max_members constant int := 16;
  v_tokens text[];
  v_n int;
  v_span_count int[];
  v_span_term uuid[];
  r record;
  i int := 1;
  v_k int;
  v_key text;
  v_used_keys text[] := '{}';
  v_used int := 0;
  v_alias_key text;
  v_tok text;
  v_part tsquery;
  v_member tsquery;
  v_members text[];
  v_sub tsquery;
  v_result tsquery;
begin
  v_tokens := public.fynd_search_tokens(p_query);
  v_n := cardinality(v_tokens);
  if v_n = 0 then
    return null;
  end if;

  v_span_count := array_fill(0, array[v_n]);
  v_span_term := array_fill(null::uuid, array[v_n]);

  for r in
    select distinct on (s.first_token) s.first_token, s.token_count, s.term_id
      from public.fynd_search_spans(v_tokens, false) s
      join public.listing_attribute_terms t on t.id = s.term_id
      join public.listing_attribute_kinds k on k.kind = t.kind
     order by s.first_token, s.token_count desc, s.exact desc, k.position, t.position, s.alias
  loop
    v_span_count[r.first_token] := r.token_count;
    v_span_term[r.first_token] := r.term_id;
  end loop;

  while i <= v_n and v_used < c_max_units loop
    v_k := v_span_count[i];

    if v_k > 0 then
      v_key := 'term:' || v_span_term[i]::text;
      v_sub := null;
      if not v_key = any(v_used_keys) then
        v_sub := public.fynd_search_query(array_to_string(v_tokens[i:i + v_k - 1], ' '));
        v_members := '{}';
        for v_alias_key in
          select a.alias_key
            from public.listing_attribute_term_aliases a
           where a.term_id = v_span_term[i]
           order by a.alias_key
           limit c_max_members
        loop
          v_member := null;
          foreach v_tok in array string_to_array(v_alias_key, ' ') loop
            v_part := public.fynd_member_token_query(v_tok);
            continue when v_part is null or numnode(v_part) = 0;
            v_member := case when v_member is null then v_part else v_member && v_part end;
          end loop;
          continue when v_member is null or v_member::text = any(v_members);
          v_members := v_members || v_member::text;
          v_sub := case when v_sub is null then v_member else v_sub || v_member end;
        end loop;
      end if;
      i := i + v_k;
    else
      v_key := v_tokens[i];
      v_sub := null;
      if not v_key = any(v_used_keys) then
        v_sub := public.fynd_search_query(v_key);
      end if;
      i := i + 1;
    end if;

    continue when v_sub is null or numnode(v_sub) = 0;
    v_used_keys := v_used_keys || v_key;
    v_result := case when v_result is null then v_sub else v_result && v_sub end;
    v_used := v_used + 1;
  end loop;

  return v_result;
end;
$$;

comment on function public.fynd_search_query_expanded(text) is
  'fynd_search_query plus term-alias expansion (roadmap 7.5); used by search_listings. Equals fynd_search_query when no alias matches. NULL = no text filter.';

revoke all on function public.fynd_search_query_expanded(text) from public, anon;
grant execute on function public.fynd_search_query_expanded(text) to authenticated;

-- ============================================================
-- 8. search_listings: the expanded query
-- ============================================================
-- Same 18-argument signature and body as
-- 20261102102513_search_attributes_review_fixes.sql; the only change is
-- v_tsquery := public.fynd_search_query_expanded(p_query) (still after the
-- validation checks). Grants re-asserted.
create or replace function public.search_listings(
  p_query             text default null,
  p_category_id       uuid default null,
  p_condition         public.listing_condition default null,
  p_size              public.listing_size default null,
  p_price_min         bigint default null,
  p_price_max         bigint default null,
  p_sort              public.search_sort default 'newest',
  p_cursor_created_at timestamptz default null,
  p_cursor_price      bigint default null,
  p_cursor_id         uuid default null,
  p_limit             integer default 20,
  p_brand_ids         uuid[] default null,
  p_item_type_ids     uuid[] default null,
  p_color_ids         uuid[] default null,
  p_style_ids         uuid[] default null,
  p_material_ids      uuid[] default null,
  p_pattern_ids       uuid[] default null,
  p_fit_ids           uuid[] default null
)
returns table (
  listing_id          uuid,
  title               text,
  price_amount        bigint,
  currency            text,
  condition           public.listing_condition,
  size                public.listing_size,
  category_id         uuid,
  created_at          timestamptz,
  cover_storage_path  text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_sort   public.search_sort := coalesce(p_sort, 'newest');
  v_tsquery tsquery;
  v_brand_ids     uuid[] := nullif(p_brand_ids, '{}');
  v_item_type_ids uuid[] := nullif(p_item_type_ids, '{}');
  v_color_ids     uuid[] := nullif(p_color_ids, '{}');
  v_style_ids     uuid[] := nullif(p_style_ids, '{}');
  v_material_ids  uuid[] := nullif(p_material_ids, '{}');
  v_pattern_ids   uuid[] := nullif(p_pattern_ids, '{}');
  v_fit_ids       uuid[] := nullif(p_fit_ids, '{}');
begin
  if exists (
    select 1
      from (values (v_brand_ids), (v_item_type_ids), (v_color_ids), (v_style_ids),
                   (v_material_ids), (v_pattern_ids), (v_fit_ids)) as f(ids)
     where f.ids is not null
       and (array_ndims(f.ids) > 1
            or cardinality(f.ids) > 20
            or exists (select 1 from unnest(f.ids) as x(id) where x.id is null))
  ) then
    raise exception 'Too many or invalid filter values' using errcode = '22023';
  end if;

  if p_price_min is not null and p_price_max is not null and p_price_min > p_price_max then
    raise exception 'price_min cannot be greater than price_max' using errcode = 'P0001';
  end if;

  v_tsquery := public.fynd_search_query_expanded(p_query);

  if v_sort = 'price' then
    if (p_cursor_price is null) <> (p_cursor_id is null) then
      raise exception 'A price-sort cursor needs both price and id, or neither' using errcode = 'P0001';
    end if;
    if p_cursor_created_at is not null then
      raise exception 'A created_at cursor cannot be used with sort = price' using errcode = 'P0001';
    end if;

    return query
    select
      l.id, l.title, l.price_amount, l.currency, l.condition, l.size,
      l.category_id, l.created_at, cover.storage_path
    from public.listings l
    join public.categories cat on cat.id = l.category_id
    cross join lateral (
      select li.storage_path
        from public.listing_images li
       where li.listing_id = l.id
       order by li."position"
       limit 1
    ) cover
    where l.status = 'active'
      and (v_tsquery is null or l.search_tsv @@ v_tsquery)
      and (p_category_id is null or cat.id = p_category_id or cat.parent_id = p_category_id)
      and (p_condition is null or l.condition = p_condition)
      and (p_size is null or l.size = p_size)
      and (p_price_min is null or l.price_amount >= p_price_min)
      and (p_price_max is null or l.price_amount <= p_price_max)
      and (v_brand_ids is null or l.brand_id = any(v_brand_ids))
      and (v_item_type_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'item_type' and v.term_id = any(v_item_type_ids)))
      and (v_color_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'color' and v.term_id = any(v_color_ids)))
      and (v_style_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'style' and v.term_id = any(v_style_ids)))
      and (v_material_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'material' and v.term_id = any(v_material_ids)))
      and (v_pattern_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'pattern' and v.term_id = any(v_pattern_ids)))
      and (v_fit_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'fit' and v.term_id = any(v_fit_ids)))
      -- ROADMAP 5.2: same suppression as feed_listings, in either
      -- direction. Search deliberately keeps including the viewer's OWN
      -- listings (20261018104807's own header -- this is a catalog lookup
      -- utility, not a discovery feed), and blocks are irreflexive
      -- (blocks_not_self), so this can never suppress a viewer's own row.
      and not public.is_blocked_with(l.seller_id)
      and (p_cursor_price is null or (l.price_amount, l.id) > (p_cursor_price, p_cursor_id))
    order by l.price_amount asc, l.id asc
    limit v_limit;

  else
    if (p_cursor_created_at is null) <> (p_cursor_id is null) then
      raise exception 'A newest-sort cursor needs both created_at and id, or neither' using errcode = 'P0001';
    end if;
    if p_cursor_price is not null then
      raise exception 'A price cursor cannot be used with sort = newest' using errcode = 'P0001';
    end if;

    return query
    select
      l.id, l.title, l.price_amount, l.currency, l.condition, l.size,
      l.category_id, l.created_at, cover.storage_path
    from public.listings l
    join public.categories cat on cat.id = l.category_id
    cross join lateral (
      select li.storage_path
        from public.listing_images li
       where li.listing_id = l.id
       order by li."position"
       limit 1
    ) cover
    where l.status = 'active'
      and (v_tsquery is null or l.search_tsv @@ v_tsquery)
      and (p_category_id is null or cat.id = p_category_id or cat.parent_id = p_category_id)
      and (p_condition is null or l.condition = p_condition)
      and (p_size is null or l.size = p_size)
      and (p_price_min is null or l.price_amount >= p_price_min)
      and (p_price_max is null or l.price_amount <= p_price_max)
      and (v_brand_ids is null or l.brand_id = any(v_brand_ids))
      and (v_item_type_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'item_type' and v.term_id = any(v_item_type_ids)))
      and (v_color_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'color' and v.term_id = any(v_color_ids)))
      and (v_style_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'style' and v.term_id = any(v_style_ids)))
      and (v_material_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'material' and v.term_id = any(v_material_ids)))
      and (v_pattern_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'pattern' and v.term_id = any(v_pattern_ids)))
      and (v_fit_ids is null or exists (
            select 1 from public.listing_attribute_values v
             where v.listing_id = l.id and v.kind = 'fit' and v.term_id = any(v_fit_ids)))
      and not public.is_blocked_with(l.seller_id)
      and (p_cursor_created_at is null or (l.created_at, l.id) < (p_cursor_created_at, p_cursor_id))
    order by l.created_at desc, l.id desc
    limit v_limit;
  end if;
end;
$$;

revoke all on function public.search_listings(
  text, uuid, public.listing_condition, public.listing_size, bigint, bigint,
  public.search_sort, timestamptz, bigint, uuid, integer,
  uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[]
) from public, anon;
grant execute on function public.search_listings(
  text, uuid, public.listing_condition, public.listing_size, bigint, bigint,
  public.search_sort, timestamptz, bigint, uuid, integer,
  uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[]
) to authenticated;
