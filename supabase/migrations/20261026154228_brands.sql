-- Brand catalog (AI listing metadata plan, Phase 1b): the controlled list of
-- known brands, their aliases, and the normalization that makes an exact
-- alias match decide which brand free text means.
--
--   * brands: canonical brand rows. Retire with `retired_at` (existing
--     listings keep a retired brand; it just can't be newly chosen).
--   * brand_aliases: one row per accepted spelling, including each brand's
--     own name. `alias_key` is the PRIMARY KEY, so one normalized alias can
--     resolve to exactly one brand; a colliding insert fails (23505) instead
--     of silently picking a winner.
--   * normalize_brand_key(): the single normalization for names, aliases and
--     typed text. CHECK constraints tie every stored key back to it, so a
--     row can never disagree with the function.
--
-- Same access rules as the attribute vocabulary: RLS on, authenticated
-- SELECT only, no anon, no client writes. New brands are added only by a
-- reviewed migration. The listing columns, resolution and search_brands()
-- live in the next migration.

-- ============================================================
-- normalize_brand_key
-- ============================================================
-- 1. lowercase, then Unicode NFKD and drop combining marks (Stüssy -> stussy,
--    Hermès -> hermes)
-- 2. `&` becomes ` and `
-- 3. delete apostrophes, periods and the Hebrew geresh/gershayim
--    (Levi's -> levis, J.Crew -> jcrew, ג'ורדן -> גורדן)
-- 4. fold Hebrew final letters (ך ם ן ף ץ)
-- 5. any other run of characters that are not a-z, 0-9 or Hebrew letters
--    becomes one space; trim.
create function public.normalize_brand_key(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      translate(
        regexp_replace(
          replace(
            regexp_replace(normalize(lower(coalesce(p_text, '')), nfkd), '[\u0300-\u036f]', '', 'g'),
            '&', ' and '
          ),
          '[\u05f3\u05f4''’`.]', '', 'g'
        ),
        'ךםןףץ', 'כמנפצ'
      ),
      '[^a-z0-9\u05d0-\u05ea]+', ' ', 'g'
    )
  );
$$;

-- Pure function over its argument; harmless to expose (it is also what a
-- client would compute itself).
revoke all on function public.normalize_brand_key(text) from public, anon;
grant execute on function public.normalize_brand_key(text) to authenticated;

-- ============================================================
-- brands
-- ============================================================
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key text not null,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  constraint brands_name_length check (char_length(name) between 1 and 60 and name = btrim(name)),
  constraint brands_key_matches_name check (key <> '' and key = public.normalize_brand_key(name)),
  constraint brands_key_key unique (key)
);

create table public.brand_aliases (
  alias_key text primary key,
  brand_id uuid not null references public.brands (id) on delete cascade,
  alias text not null,
  created_at timestamptz not null default now(),
  constraint brand_aliases_alias_length check (char_length(alias) between 1 and 60),
  constraint brand_aliases_key_matches_alias check (
    alias_key <> '' and alias_key = public.normalize_brand_key(alias)
  )
);

create index brand_aliases_brand_id_idx on public.brand_aliases (brand_id);

-- ============================================================
-- Access rules (same as the attribute vocabulary)
-- ============================================================
alter table public.brands enable row level security;
alter table public.brand_aliases enable row level security;

revoke all on public.brands from public, anon, authenticated;
revoke all on public.brand_aliases from public, anon, authenticated;

grant select on public.brands to authenticated;
grant select on public.brand_aliases to authenticated;

create policy "Brands are readable by signed-in users"
  on public.brands for select to authenticated using (true);
create policy "Brand aliases are readable by signed-in users"
  on public.brand_aliases for select to authenticated using (true);

-- ============================================================
-- Seed: the approved v1 catalog (120 brands, 246 alias rows)
-- ============================================================
-- Deterministic ids b0000000-0000-4000-8000-<n>. Keys are written out
-- literally; brands_key_matches_name / brand_aliases_key_matches_alias fail
-- the migration if any of them disagrees with normalize_brand_key().
insert into public.brands (id, name, key) values
  -- A. Mainstream & high street
  ('b0000000-0000-4000-8000-000000000001', 'Zara', 'zara'),
  ('b0000000-0000-4000-8000-000000000002', 'H&M', 'h and m'),
  ('b0000000-0000-4000-8000-000000000003', 'Mango', 'mango'),
  ('b0000000-0000-4000-8000-000000000004', 'Bershka', 'bershka'),
  ('b0000000-0000-4000-8000-000000000005', 'Pull&Bear', 'pull and bear'),
  ('b0000000-0000-4000-8000-000000000006', 'Stradivarius', 'stradivarius'),
  ('b0000000-0000-4000-8000-000000000007', 'Massimo Dutti', 'massimo dutti'),
  ('b0000000-0000-4000-8000-000000000008', 'Uniqlo', 'uniqlo'),
  ('b0000000-0000-4000-8000-000000000009', 'Gap', 'gap'),
  ('b0000000-0000-4000-8000-000000000010', 'Shein', 'shein'),
  ('b0000000-0000-4000-8000-000000000011', 'ASOS', 'asos'),
  ('b0000000-0000-4000-8000-000000000012', 'Next', 'next'),
  ('b0000000-0000-4000-8000-000000000013', 'Marks & Spencer', 'marks and spencer'),
  ('b0000000-0000-4000-8000-000000000014', 'Urban Outfitters', 'urban outfitters'),
  ('b0000000-0000-4000-8000-000000000015', 'Abercrombie & Fitch', 'abercrombie and fitch'),
  ('b0000000-0000-4000-8000-000000000016', 'American Eagle', 'american eagle'),
  -- B. Denim, workwear & heritage
  ('b0000000-0000-4000-8000-000000000017', 'Levi''s', 'levis'),
  ('b0000000-0000-4000-8000-000000000018', 'Wrangler', 'wrangler'),
  ('b0000000-0000-4000-8000-000000000019', 'Lee', 'lee'),
  ('b0000000-0000-4000-8000-000000000020', 'Diesel', 'diesel'),
  ('b0000000-0000-4000-8000-000000000021', 'G-Star Raw', 'g star raw'),
  ('b0000000-0000-4000-8000-000000000022', 'Pepe Jeans', 'pepe jeans'),
  ('b0000000-0000-4000-8000-000000000023', 'Guess', 'guess'),
  ('b0000000-0000-4000-8000-000000000024', 'Carhartt', 'carhartt'),
  ('b0000000-0000-4000-8000-000000000025', 'Carhartt WIP', 'carhartt wip'),
  ('b0000000-0000-4000-8000-000000000026', 'Dickies', 'dickies'),
  ('b0000000-0000-4000-8000-000000000027', 'Calvin Klein', 'calvin klein'),
  ('b0000000-0000-4000-8000-000000000028', 'Tommy Hilfiger', 'tommy hilfiger'),
  ('b0000000-0000-4000-8000-000000000029', 'Ralph Lauren', 'ralph lauren'),
  ('b0000000-0000-4000-8000-000000000030', 'U.S. Polo Assn.', 'us polo assn'),
  ('b0000000-0000-4000-8000-000000000031', 'Lacoste', 'lacoste'),
  ('b0000000-0000-4000-8000-000000000032', 'Fred Perry', 'fred perry'),
  -- C. Sportswear & outdoor
  ('b0000000-0000-4000-8000-000000000033', 'Nike', 'nike'),
  ('b0000000-0000-4000-8000-000000000034', 'Adidas', 'adidas'),
  ('b0000000-0000-4000-8000-000000000035', 'Puma', 'puma'),
  ('b0000000-0000-4000-8000-000000000036', 'Reebok', 'reebok'),
  ('b0000000-0000-4000-8000-000000000037', 'New Balance', 'new balance'),
  ('b0000000-0000-4000-8000-000000000038', 'Asics', 'asics'),
  ('b0000000-0000-4000-8000-000000000039', 'Under Armour', 'under armour'),
  ('b0000000-0000-4000-8000-000000000040', 'Fila', 'fila'),
  ('b0000000-0000-4000-8000-000000000041', 'Champion', 'champion'),
  ('b0000000-0000-4000-8000-000000000042', 'Lululemon', 'lululemon'),
  ('b0000000-0000-4000-8000-000000000043', 'The North Face', 'the north face'),
  ('b0000000-0000-4000-8000-000000000044', 'Columbia', 'columbia'),
  ('b0000000-0000-4000-8000-000000000045', 'Patagonia', 'patagonia'),
  ('b0000000-0000-4000-8000-000000000046', 'Arc''teryx', 'arcteryx'),
  ('b0000000-0000-4000-8000-000000000047', 'Salomon', 'salomon'),
  ('b0000000-0000-4000-8000-000000000048', 'Hoka', 'hoka'),
  ('b0000000-0000-4000-8000-000000000049', 'On Running', 'on running'),
  ('b0000000-0000-4000-8000-000000000050', 'Timberland', 'timberland'),
  ('b0000000-0000-4000-8000-000000000051', 'Jordan', 'jordan'),
  ('b0000000-0000-4000-8000-000000000052', 'Yeezy', 'yeezy'),
  ('b0000000-0000-4000-8000-000000000053', 'Fjällräven', 'fjallraven'),
  -- D. Footwear
  ('b0000000-0000-4000-8000-000000000054', 'Converse', 'converse'),
  ('b0000000-0000-4000-8000-000000000055', 'Vans', 'vans'),
  ('b0000000-0000-4000-8000-000000000056', 'Dr. Martens', 'dr martens'),
  ('b0000000-0000-4000-8000-000000000057', 'Birkenstock', 'birkenstock'),
  ('b0000000-0000-4000-8000-000000000058', 'Crocs', 'crocs'),
  ('b0000000-0000-4000-8000-000000000059', 'UGG', 'ugg'),
  ('b0000000-0000-4000-8000-000000000060', 'Clarks', 'clarks'),
  ('b0000000-0000-4000-8000-000000000061', 'Steve Madden', 'steve madden'),
  ('b0000000-0000-4000-8000-000000000062', 'Skechers', 'skechers'),
  ('b0000000-0000-4000-8000-000000000063', 'Camper', 'camper'),
  ('b0000000-0000-4000-8000-000000000064', 'Golden Goose', 'golden goose'),
  -- E. Streetwear
  ('b0000000-0000-4000-8000-000000000065', 'Supreme', 'supreme'),
  ('b0000000-0000-4000-8000-000000000066', 'Stüssy', 'stussy'),
  ('b0000000-0000-4000-8000-000000000067', 'Palace', 'palace'),
  ('b0000000-0000-4000-8000-000000000068', 'Off-White', 'off white'),
  ('b0000000-0000-4000-8000-000000000069', 'A Bathing Ape', 'a bathing ape'),
  ('b0000000-0000-4000-8000-000000000070', 'Kith', 'kith'),
  ('b0000000-0000-4000-8000-000000000071', 'Aimé Leon Dore', 'aime leon dore'),
  ('b0000000-0000-4000-8000-000000000072', 'Fear of God', 'fear of god'),
  -- F. Contemporary & designer-adjacent
  ('b0000000-0000-4000-8000-000000000073', 'COS', 'cos'),
  ('b0000000-0000-4000-8000-000000000074', '& Other Stories', 'and other stories'),
  ('b0000000-0000-4000-8000-000000000075', 'Arket', 'arket'),
  ('b0000000-0000-4000-8000-000000000076', 'Sandro', 'sandro'),
  ('b0000000-0000-4000-8000-000000000077', 'Maje', 'maje'),
  ('b0000000-0000-4000-8000-000000000078', 'Zadig & Voltaire', 'zadig and voltaire'),
  ('b0000000-0000-4000-8000-000000000079', 'AllSaints', 'allsaints'),
  ('b0000000-0000-4000-8000-000000000080', 'Brandy Melville', 'brandy melville'),
  ('b0000000-0000-4000-8000-000000000081', 'American Vintage', 'american vintage'),
  ('b0000000-0000-4000-8000-000000000082', 'J.Crew', 'jcrew'),
  ('b0000000-0000-4000-8000-000000000083', 'Ganni', 'ganni'),
  ('b0000000-0000-4000-8000-000000000084', 'Acne Studios', 'acne studios'),
  ('b0000000-0000-4000-8000-000000000085', 'Isabel Marant', 'isabel marant'),
  ('b0000000-0000-4000-8000-000000000086', 'Jacquemus', 'jacquemus'),
  ('b0000000-0000-4000-8000-000000000087', 'Ami Paris', 'ami paris'),
  -- G. Designer & luxury
  ('b0000000-0000-4000-8000-000000000088', 'Gucci', 'gucci'),
  ('b0000000-0000-4000-8000-000000000089', 'Prada', 'prada'),
  ('b0000000-0000-4000-8000-000000000090', 'Louis Vuitton', 'louis vuitton'),
  ('b0000000-0000-4000-8000-000000000091', 'Chanel', 'chanel'),
  ('b0000000-0000-4000-8000-000000000092', 'Dior', 'dior'),
  ('b0000000-0000-4000-8000-000000000093', 'Hermès', 'hermes'),
  ('b0000000-0000-4000-8000-000000000094', 'Saint Laurent', 'saint laurent'),
  ('b0000000-0000-4000-8000-000000000095', 'Balenciaga', 'balenciaga'),
  ('b0000000-0000-4000-8000-000000000096', 'Burberry', 'burberry'),
  ('b0000000-0000-4000-8000-000000000097', 'Versace', 'versace'),
  ('b0000000-0000-4000-8000-000000000098', 'Fendi', 'fendi'),
  ('b0000000-0000-4000-8000-000000000099', 'Givenchy', 'givenchy'),
  ('b0000000-0000-4000-8000-000000000100', 'Valentino', 'valentino'),
  ('b0000000-0000-4000-8000-000000000101', 'Bottega Veneta', 'bottega veneta'),
  ('b0000000-0000-4000-8000-000000000102', 'Celine', 'celine'),
  ('b0000000-0000-4000-8000-000000000103', 'Loewe', 'loewe'),
  ('b0000000-0000-4000-8000-000000000104', 'Miu Miu', 'miu miu'),
  ('b0000000-0000-4000-8000-000000000105', 'Moncler', 'moncler'),
  ('b0000000-0000-4000-8000-000000000106', 'Stone Island', 'stone island'),
  ('b0000000-0000-4000-8000-000000000107', 'Alexander McQueen', 'alexander mcqueen'),
  ('b0000000-0000-4000-8000-000000000108', 'Maison Margiela', 'maison margiela'),
  ('b0000000-0000-4000-8000-000000000109', 'Hugo Boss', 'hugo boss'),
  ('b0000000-0000-4000-8000-000000000110', 'Coach', 'coach'),
  ('b0000000-0000-4000-8000-000000000111', 'Michael Kors', 'michael kors'),
  ('b0000000-0000-4000-8000-000000000112', 'Kate Spade', 'kate spade'),
  ('b0000000-0000-4000-8000-000000000113', 'Longchamp', 'longchamp'),
  -- H. Israeli
  ('b0000000-0000-4000-8000-000000000114', 'Castro', 'castro'),
  ('b0000000-0000-4000-8000-000000000115', 'Fox', 'fox'),
  ('b0000000-0000-4000-8000-000000000116', 'Renuar', 'renuar'),
  ('b0000000-0000-4000-8000-000000000117', 'Golf & Co', 'golf and co'),
  ('b0000000-0000-4000-8000-000000000118', 'Honigman', 'honigman'),
  ('b0000000-0000-4000-8000-000000000119', 'Dodo Bar Or', 'dodo bar or'),
  ('b0000000-0000-4000-8000-000000000120', 'Adika', 'adika');

-- Every brand's own name first-class as an alias, then its extra spellings
-- (English and Hebrew). A collision between two brands raises 23505 here.
insert into public.brand_aliases (alias_key, brand_id, alias) values
  -- A. Mainstream & high street
  ('zara', 'b0000000-0000-4000-8000-000000000001', 'Zara'),
  ('זארה', 'b0000000-0000-4000-8000-000000000001', 'זארה'),
  ('h and m', 'b0000000-0000-4000-8000-000000000002', 'H&M'),
  ('hm', 'b0000000-0000-4000-8000-000000000002', 'HM'),
  ('hennes and mauritz', 'b0000000-0000-4000-8000-000000000002', 'Hennes & Mauritz'),
  ('אייצ אנד אמ', 'b0000000-0000-4000-8000-000000000002', 'אייץ אנד אם'),
  ('mango', 'b0000000-0000-4000-8000-000000000003', 'Mango'),
  ('מנגו', 'b0000000-0000-4000-8000-000000000003', 'מנגו'),
  ('bershka', 'b0000000-0000-4000-8000-000000000004', 'Bershka'),
  ('ברשקה', 'b0000000-0000-4000-8000-000000000004', 'ברשקה'),
  ('pull and bear', 'b0000000-0000-4000-8000-000000000005', 'Pull&Bear'),
  ('pullandbear', 'b0000000-0000-4000-8000-000000000005', 'PullAndBear'),
  ('פול אנד בר', 'b0000000-0000-4000-8000-000000000005', 'פול אנד בר'),
  ('stradivarius', 'b0000000-0000-4000-8000-000000000006', 'Stradivarius'),
  ('סטרדיבריוס', 'b0000000-0000-4000-8000-000000000006', 'סטרדיבריוס'),
  ('massimo dutti', 'b0000000-0000-4000-8000-000000000007', 'Massimo Dutti'),
  ('מסימו דוטי', 'b0000000-0000-4000-8000-000000000007', 'מסימו דוטי'),
  ('uniqlo', 'b0000000-0000-4000-8000-000000000008', 'Uniqlo'),
  ('יוניקלו', 'b0000000-0000-4000-8000-000000000008', 'יוניקלו'),
  ('gap', 'b0000000-0000-4000-8000-000000000009', 'Gap'),
  ('גאפ', 'b0000000-0000-4000-8000-000000000009', 'גאפ'),
  ('shein', 'b0000000-0000-4000-8000-000000000010', 'Shein'),
  ('שיינ', 'b0000000-0000-4000-8000-000000000010', 'שיין'),
  ('asos', 'b0000000-0000-4000-8000-000000000011', 'ASOS'),
  ('asos design', 'b0000000-0000-4000-8000-000000000011', 'ASOS Design'),
  ('אסוס', 'b0000000-0000-4000-8000-000000000011', 'אסוס'),
  ('next', 'b0000000-0000-4000-8000-000000000012', 'Next'),
  ('נקסט', 'b0000000-0000-4000-8000-000000000012', 'נקסט'),
  ('marks and spencer', 'b0000000-0000-4000-8000-000000000013', 'Marks & Spencer'),
  ('m and s', 'b0000000-0000-4000-8000-000000000013', 'M&S'),
  ('מרקס אנד ספנסר', 'b0000000-0000-4000-8000-000000000013', 'מרקס אנד ספנסר'),
  ('urban outfitters', 'b0000000-0000-4000-8000-000000000014', 'Urban Outfitters'),
  ('abercrombie and fitch', 'b0000000-0000-4000-8000-000000000015', 'Abercrombie & Fitch'),
  ('abercrombie', 'b0000000-0000-4000-8000-000000000015', 'Abercrombie'),
  ('a and f', 'b0000000-0000-4000-8000-000000000015', 'A&F'),
  ('american eagle', 'b0000000-0000-4000-8000-000000000016', 'American Eagle'),
  ('american eagle outfitters', 'b0000000-0000-4000-8000-000000000016', 'American Eagle Outfitters'),
  ('aeo', 'b0000000-0000-4000-8000-000000000016', 'AEO'),
  ('אמריקנ איגל', 'b0000000-0000-4000-8000-000000000016', 'אמריקן איגל'),
  -- B. Denim, workwear & heritage
  ('levis', 'b0000000-0000-4000-8000-000000000017', 'Levi''s'),
  ('levi strauss', 'b0000000-0000-4000-8000-000000000017', 'Levi Strauss'),
  ('levi strauss and co', 'b0000000-0000-4000-8000-000000000017', 'Levi Strauss & Co'),
  ('wrangler', 'b0000000-0000-4000-8000-000000000018', 'Wrangler'),
  ('רנגלר', 'b0000000-0000-4000-8000-000000000018', 'רנגלר'),
  ('lee', 'b0000000-0000-4000-8000-000000000019', 'Lee'),
  ('diesel', 'b0000000-0000-4000-8000-000000000020', 'Diesel'),
  ('דיזל', 'b0000000-0000-4000-8000-000000000020', 'דיזל'),
  ('g star raw', 'b0000000-0000-4000-8000-000000000021', 'G-Star Raw'),
  ('g star', 'b0000000-0000-4000-8000-000000000021', 'G-Star'),
  ('gstar', 'b0000000-0000-4000-8000-000000000021', 'GStar'),
  ('גי סטאר', 'b0000000-0000-4000-8000-000000000021', 'ג''י סטאר'),
  ('pepe jeans', 'b0000000-0000-4000-8000-000000000022', 'Pepe Jeans'),
  ('pepe jeans london', 'b0000000-0000-4000-8000-000000000022', 'Pepe Jeans London'),
  ('פפה גינס', 'b0000000-0000-4000-8000-000000000022', 'פפה ג''ינס'),
  ('guess', 'b0000000-0000-4000-8000-000000000023', 'Guess'),
  ('guess jeans', 'b0000000-0000-4000-8000-000000000023', 'Guess Jeans'),
  ('carhartt', 'b0000000-0000-4000-8000-000000000024', 'Carhartt'),
  ('קארהארט', 'b0000000-0000-4000-8000-000000000024', 'קארהארט'),
  ('carhartt wip', 'b0000000-0000-4000-8000-000000000025', 'Carhartt WIP'),
  ('carhartt work in progress', 'b0000000-0000-4000-8000-000000000025', 'Carhartt Work In Progress'),
  ('dickies', 'b0000000-0000-4000-8000-000000000026', 'Dickies'),
  ('calvin klein', 'b0000000-0000-4000-8000-000000000027', 'Calvin Klein'),
  ('calvin klein jeans', 'b0000000-0000-4000-8000-000000000027', 'Calvin Klein Jeans'),
  ('קלווינ קליינ', 'b0000000-0000-4000-8000-000000000027', 'קלווין קליין'),
  ('tommy hilfiger', 'b0000000-0000-4000-8000-000000000028', 'Tommy Hilfiger'),
  ('hilfiger', 'b0000000-0000-4000-8000-000000000028', 'Hilfiger'),
  ('טומי הילפיגר', 'b0000000-0000-4000-8000-000000000028', 'טומי הילפיגר'),
  ('ralph lauren', 'b0000000-0000-4000-8000-000000000029', 'Ralph Lauren'),
  ('polo ralph lauren', 'b0000000-0000-4000-8000-000000000029', 'Polo Ralph Lauren'),
  ('polo by ralph lauren', 'b0000000-0000-4000-8000-000000000029', 'Polo by Ralph Lauren'),
  ('ראלפ לורנ', 'b0000000-0000-4000-8000-000000000029', 'ראלף לורן'),
  ('us polo assn', 'b0000000-0000-4000-8000-000000000030', 'U.S. Polo Assn.'),
  ('lacoste', 'b0000000-0000-4000-8000-000000000031', 'Lacoste'),
  ('לקוסט', 'b0000000-0000-4000-8000-000000000031', 'לקוסט'),
  ('fred perry', 'b0000000-0000-4000-8000-000000000032', 'Fred Perry'),
  -- C. Sportswear & outdoor
  ('nike', 'b0000000-0000-4000-8000-000000000033', 'Nike'),
  ('נייקי', 'b0000000-0000-4000-8000-000000000033', 'נייקי'),
  ('adidas', 'b0000000-0000-4000-8000-000000000034', 'Adidas'),
  ('adidas originals', 'b0000000-0000-4000-8000-000000000034', 'Adidas Originals'),
  ('אדידס', 'b0000000-0000-4000-8000-000000000034', 'אדידס'),
  ('puma', 'b0000000-0000-4000-8000-000000000035', 'Puma'),
  ('פומה', 'b0000000-0000-4000-8000-000000000035', 'פומה'),
  ('reebok', 'b0000000-0000-4000-8000-000000000036', 'Reebok'),
  ('ריבוק', 'b0000000-0000-4000-8000-000000000036', 'ריבוק'),
  ('new balance', 'b0000000-0000-4000-8000-000000000037', 'New Balance'),
  ('newbalance', 'b0000000-0000-4000-8000-000000000037', 'NewBalance'),
  ('ניו באלאנס', 'b0000000-0000-4000-8000-000000000037', 'ניו באלאנס'),
  ('asics', 'b0000000-0000-4000-8000-000000000038', 'Asics'),
  ('asics tiger', 'b0000000-0000-4000-8000-000000000038', 'ASICS Tiger'),
  ('אסיקס', 'b0000000-0000-4000-8000-000000000038', 'אסיקס'),
  ('under armour', 'b0000000-0000-4000-8000-000000000039', 'Under Armour'),
  ('underarmour', 'b0000000-0000-4000-8000-000000000039', 'UnderArmour'),
  ('אנדר ארמור', 'b0000000-0000-4000-8000-000000000039', 'אנדר ארמור'),
  ('fila', 'b0000000-0000-4000-8000-000000000040', 'Fila'),
  ('פילה', 'b0000000-0000-4000-8000-000000000040', 'פילה'),
  ('champion', 'b0000000-0000-4000-8000-000000000041', 'Champion'),
  ('lululemon', 'b0000000-0000-4000-8000-000000000042', 'Lululemon'),
  ('lulu lemon', 'b0000000-0000-4000-8000-000000000042', 'Lulu Lemon'),
  ('לולולמונ', 'b0000000-0000-4000-8000-000000000042', 'לולולמון'),
  ('the north face', 'b0000000-0000-4000-8000-000000000043', 'The North Face'),
  ('north face', 'b0000000-0000-4000-8000-000000000043', 'North Face'),
  ('tnf', 'b0000000-0000-4000-8000-000000000043', 'TNF'),
  ('נורת פייס', 'b0000000-0000-4000-8000-000000000043', 'נורת'' פייס'),
  ('columbia', 'b0000000-0000-4000-8000-000000000044', 'Columbia'),
  ('columbia sportswear', 'b0000000-0000-4000-8000-000000000044', 'Columbia Sportswear'),
  ('patagonia', 'b0000000-0000-4000-8000-000000000045', 'Patagonia'),
  ('arcteryx', 'b0000000-0000-4000-8000-000000000046', 'Arc''teryx'),
  ('salomon', 'b0000000-0000-4000-8000-000000000047', 'Salomon'),
  ('סלומונ', 'b0000000-0000-4000-8000-000000000047', 'סלומון'),
  ('hoka', 'b0000000-0000-4000-8000-000000000048', 'Hoka'),
  ('hoka one one', 'b0000000-0000-4000-8000-000000000048', 'Hoka One One'),
  ('הוקה', 'b0000000-0000-4000-8000-000000000048', 'הוקה'),
  ('on running', 'b0000000-0000-4000-8000-000000000049', 'On Running'),
  ('timberland', 'b0000000-0000-4000-8000-000000000050', 'Timberland'),
  ('טימברלנד', 'b0000000-0000-4000-8000-000000000050', 'טימברלנד'),
  ('jordan', 'b0000000-0000-4000-8000-000000000051', 'Jordan'),
  ('air jordan', 'b0000000-0000-4000-8000-000000000051', 'Air Jordan'),
  ('jordan brand', 'b0000000-0000-4000-8000-000000000051', 'Jordan Brand'),
  ('גורדנ', 'b0000000-0000-4000-8000-000000000051', 'ג''ורדן'),
  ('yeezy', 'b0000000-0000-4000-8000-000000000052', 'Yeezy'),
  ('fjallraven', 'b0000000-0000-4000-8000-000000000053', 'Fjällräven'),
  -- D. Footwear
  ('converse', 'b0000000-0000-4000-8000-000000000054', 'Converse'),
  ('קונברס', 'b0000000-0000-4000-8000-000000000054', 'קונברס'),
  ('vans', 'b0000000-0000-4000-8000-000000000055', 'Vans'),
  ('ואנס', 'b0000000-0000-4000-8000-000000000055', 'ואנס'),
  ('dr martens', 'b0000000-0000-4000-8000-000000000056', 'Dr. Martens'),
  ('doc martens', 'b0000000-0000-4000-8000-000000000056', 'Doc Martens'),
  ('דר מרטנס', 'b0000000-0000-4000-8000-000000000056', 'דר מרטנס'),
  ('birkenstock', 'b0000000-0000-4000-8000-000000000057', 'Birkenstock'),
  ('בירקנשטוק', 'b0000000-0000-4000-8000-000000000057', 'בירקנשטוק'),
  ('crocs', 'b0000000-0000-4000-8000-000000000058', 'Crocs'),
  ('קרוקס', 'b0000000-0000-4000-8000-000000000058', 'קרוקס'),
  ('ugg', 'b0000000-0000-4000-8000-000000000059', 'UGG'),
  ('ugg australia', 'b0000000-0000-4000-8000-000000000059', 'UGG Australia'),
  ('אוג', 'b0000000-0000-4000-8000-000000000059', 'אוג'),
  ('clarks', 'b0000000-0000-4000-8000-000000000060', 'Clarks'),
  ('קלארקס', 'b0000000-0000-4000-8000-000000000060', 'קלארקס'),
  ('steve madden', 'b0000000-0000-4000-8000-000000000061', 'Steve Madden'),
  ('סטיב מדנ', 'b0000000-0000-4000-8000-000000000061', 'סטיב מדן'),
  ('skechers', 'b0000000-0000-4000-8000-000000000062', 'Skechers'),
  ('סקצרס', 'b0000000-0000-4000-8000-000000000062', 'סקצ''רס'),
  ('camper', 'b0000000-0000-4000-8000-000000000063', 'Camper'),
  ('קמפר', 'b0000000-0000-4000-8000-000000000063', 'קמפר'),
  ('golden goose', 'b0000000-0000-4000-8000-000000000064', 'Golden Goose'),
  -- E. Streetwear
  ('supreme', 'b0000000-0000-4000-8000-000000000065', 'Supreme'),
  ('stussy', 'b0000000-0000-4000-8000-000000000066', 'Stüssy'),
  ('palace', 'b0000000-0000-4000-8000-000000000067', 'Palace'),
  ('off white', 'b0000000-0000-4000-8000-000000000068', 'Off-White'),
  ('offwhite', 'b0000000-0000-4000-8000-000000000068', 'Offwhite'),
  ('a bathing ape', 'b0000000-0000-4000-8000-000000000069', 'A Bathing Ape'),
  ('bape', 'b0000000-0000-4000-8000-000000000069', 'BAPE'),
  ('bathing ape', 'b0000000-0000-4000-8000-000000000069', 'Bathing Ape'),
  ('kith', 'b0000000-0000-4000-8000-000000000070', 'Kith'),
  ('aime leon dore', 'b0000000-0000-4000-8000-000000000071', 'Aimé Leon Dore'),
  ('ald', 'b0000000-0000-4000-8000-000000000071', 'ALD'),
  ('fear of god', 'b0000000-0000-4000-8000-000000000072', 'Fear of God'),
  -- F. Contemporary & designer-adjacent
  ('cos', 'b0000000-0000-4000-8000-000000000073', 'COS'),
  ('and other stories', 'b0000000-0000-4000-8000-000000000074', '& Other Stories'),
  ('other stories', 'b0000000-0000-4000-8000-000000000074', 'Other Stories'),
  ('arket', 'b0000000-0000-4000-8000-000000000075', 'Arket'),
  ('sandro', 'b0000000-0000-4000-8000-000000000076', 'Sandro'),
  ('sandro paris', 'b0000000-0000-4000-8000-000000000076', 'Sandro Paris'),
  ('סנדרו', 'b0000000-0000-4000-8000-000000000076', 'סנדרו'),
  ('maje', 'b0000000-0000-4000-8000-000000000077', 'Maje'),
  ('zadig and voltaire', 'b0000000-0000-4000-8000-000000000078', 'Zadig & Voltaire'),
  ('zadig', 'b0000000-0000-4000-8000-000000000078', 'Zadig'),
  ('allsaints', 'b0000000-0000-4000-8000-000000000079', 'AllSaints'),
  ('all saints', 'b0000000-0000-4000-8000-000000000079', 'All Saints'),
  ('brandy melville', 'b0000000-0000-4000-8000-000000000080', 'Brandy Melville'),
  ('ברנדי מלוויל', 'b0000000-0000-4000-8000-000000000080', 'ברנדי מלוויל'),
  ('american vintage', 'b0000000-0000-4000-8000-000000000081', 'American Vintage'),
  ('jcrew', 'b0000000-0000-4000-8000-000000000082', 'J.Crew'),
  ('ganni', 'b0000000-0000-4000-8000-000000000083', 'Ganni'),
  ('acne studios', 'b0000000-0000-4000-8000-000000000084', 'Acne Studios'),
  ('acne', 'b0000000-0000-4000-8000-000000000084', 'Acne'),
  ('isabel marant', 'b0000000-0000-4000-8000-000000000085', 'Isabel Marant'),
  ('jacquemus', 'b0000000-0000-4000-8000-000000000086', 'Jacquemus'),
  ('ami paris', 'b0000000-0000-4000-8000-000000000087', 'Ami Paris'),
  ('ami', 'b0000000-0000-4000-8000-000000000087', 'AMI'),
  -- G. Designer & luxury
  ('gucci', 'b0000000-0000-4000-8000-000000000088', 'Gucci'),
  ('גוצי', 'b0000000-0000-4000-8000-000000000088', 'גוצ''י'),
  ('prada', 'b0000000-0000-4000-8000-000000000089', 'Prada'),
  ('פראדה', 'b0000000-0000-4000-8000-000000000089', 'פראדה'),
  ('louis vuitton', 'b0000000-0000-4000-8000-000000000090', 'Louis Vuitton'),
  ('lv', 'b0000000-0000-4000-8000-000000000090', 'LV'),
  ('לואי ויטונ', 'b0000000-0000-4000-8000-000000000090', 'לואי ויטון'),
  ('chanel', 'b0000000-0000-4000-8000-000000000091', 'Chanel'),
  ('שאנל', 'b0000000-0000-4000-8000-000000000091', 'שאנל'),
  ('dior', 'b0000000-0000-4000-8000-000000000092', 'Dior'),
  ('christian dior', 'b0000000-0000-4000-8000-000000000092', 'Christian Dior'),
  ('hermes', 'b0000000-0000-4000-8000-000000000093', 'Hermès'),
  ('הרמס', 'b0000000-0000-4000-8000-000000000093', 'הרמס'),
  ('saint laurent', 'b0000000-0000-4000-8000-000000000094', 'Saint Laurent'),
  ('ysl', 'b0000000-0000-4000-8000-000000000094', 'YSL'),
  ('yves saint laurent', 'b0000000-0000-4000-8000-000000000094', 'Yves Saint Laurent'),
  ('סנ לורנ', 'b0000000-0000-4000-8000-000000000094', 'סן לורן'),
  ('balenciaga', 'b0000000-0000-4000-8000-000000000095', 'Balenciaga'),
  ('בלנסיאגה', 'b0000000-0000-4000-8000-000000000095', 'בלנסיאגה'),
  ('burberry', 'b0000000-0000-4000-8000-000000000096', 'Burberry'),
  ('ברברי', 'b0000000-0000-4000-8000-000000000096', 'ברברי'),
  ('versace', 'b0000000-0000-4000-8000-000000000097', 'Versace'),
  ('ורסצה', 'b0000000-0000-4000-8000-000000000097', 'ורסצ''ה'),
  ('fendi', 'b0000000-0000-4000-8000-000000000098', 'Fendi'),
  ('פנדי', 'b0000000-0000-4000-8000-000000000098', 'פנדי'),
  ('givenchy', 'b0000000-0000-4000-8000-000000000099', 'Givenchy'),
  ('גיבנשי', 'b0000000-0000-4000-8000-000000000099', 'ג''יבנשי'),
  ('valentino', 'b0000000-0000-4000-8000-000000000100', 'Valentino'),
  ('ולנטינו', 'b0000000-0000-4000-8000-000000000100', 'ולנטינו'),
  ('bottega veneta', 'b0000000-0000-4000-8000-000000000101', 'Bottega Veneta'),
  ('בוטגה ונטה', 'b0000000-0000-4000-8000-000000000101', 'בוטגה ונטה'),
  ('celine', 'b0000000-0000-4000-8000-000000000102', 'Celine'),
  ('סלינ', 'b0000000-0000-4000-8000-000000000102', 'סלין'),
  ('loewe', 'b0000000-0000-4000-8000-000000000103', 'Loewe'),
  ('miu miu', 'b0000000-0000-4000-8000-000000000104', 'Miu Miu'),
  ('moncler', 'b0000000-0000-4000-8000-000000000105', 'Moncler'),
  ('מונקלר', 'b0000000-0000-4000-8000-000000000105', 'מונקלר'),
  ('stone island', 'b0000000-0000-4000-8000-000000000106', 'Stone Island'),
  ('alexander mcqueen', 'b0000000-0000-4000-8000-000000000107', 'Alexander McQueen'),
  ('mcqueen', 'b0000000-0000-4000-8000-000000000107', 'McQueen'),
  ('maison margiela', 'b0000000-0000-4000-8000-000000000108', 'Maison Margiela'),
  ('margiela', 'b0000000-0000-4000-8000-000000000108', 'Margiela'),
  ('hugo boss', 'b0000000-0000-4000-8000-000000000109', 'Hugo Boss'),
  ('boss', 'b0000000-0000-4000-8000-000000000109', 'Boss'),
  ('הוגו בוס', 'b0000000-0000-4000-8000-000000000109', 'הוגו בוס'),
  ('coach', 'b0000000-0000-4000-8000-000000000110', 'Coach'),
  ('michael kors', 'b0000000-0000-4000-8000-000000000111', 'Michael Kors'),
  ('michael michael kors', 'b0000000-0000-4000-8000-000000000111', 'MICHAEL Michael Kors'),
  ('מייקל קורס', 'b0000000-0000-4000-8000-000000000111', 'מייקל קורס'),
  ('kate spade', 'b0000000-0000-4000-8000-000000000112', 'Kate Spade'),
  ('kate spade new york', 'b0000000-0000-4000-8000-000000000112', 'Kate Spade New York'),
  ('longchamp', 'b0000000-0000-4000-8000-000000000113', 'Longchamp'),
  -- H. Israeli
  ('castro', 'b0000000-0000-4000-8000-000000000114', 'Castro'),
  ('קסטרו', 'b0000000-0000-4000-8000-000000000114', 'קסטרו'),
  ('fox', 'b0000000-0000-4000-8000-000000000115', 'Fox'),
  ('פוקס', 'b0000000-0000-4000-8000-000000000115', 'פוקס'),
  ('renuar', 'b0000000-0000-4000-8000-000000000116', 'Renuar'),
  ('רנואר', 'b0000000-0000-4000-8000-000000000116', 'רנואר'),
  ('golf and co', 'b0000000-0000-4000-8000-000000000117', 'Golf & Co'),
  ('golf', 'b0000000-0000-4000-8000-000000000117', 'Golf'),
  ('גולפ', 'b0000000-0000-4000-8000-000000000117', 'גולף'),
  ('honigman', 'b0000000-0000-4000-8000-000000000118', 'Honigman'),
  ('הוניגמנ', 'b0000000-0000-4000-8000-000000000118', 'הוניגמן'),
  ('dodo bar or', 'b0000000-0000-4000-8000-000000000119', 'Dodo Bar Or'),
  ('דודו בר אור', 'b0000000-0000-4000-8000-000000000119', 'דודו בר אור'),
  ('adika', 'b0000000-0000-4000-8000-000000000120', 'Adika'),
  ('אדיקה', 'b0000000-0000-4000-8000-000000000120', 'אדיקה');

do $guard$
declare
  v_brands integer;
  v_aliases integer;
begin
  select count(*) into v_brands from public.brands;
  select count(*) into v_aliases from public.brand_aliases;
  if v_brands <> 120 or v_aliases <> 246 then
    raise exception 'Brand seed mismatch: % brands, % alias rows (expected 120 / 246)', v_brands, v_aliases;
  end if;
  if exists (
    select 1 from public.brands b
     where not exists (
       select 1 from public.brand_aliases a where a.brand_id = b.id and a.alias_key = b.key
     )
  ) then
    raise exception 'A brand is missing its own-name alias row';
  end if;
end
$guard$;
