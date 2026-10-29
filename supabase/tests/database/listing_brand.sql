-- pgTAP tests for listing brands (AI listing metadata plan, Phase 1b):
-- listings.brand_id / brand_text, brand resolution inside
-- set_listing_attributes, retired brands, constraints and read visibility.
-- The catalog itself and search_brands() are covered in brands.sql.
--
-- Same conventions as the other suites: 4-arg throws_ok(sql, sqlstate,
-- null, description), SQLSTATE only, never message text.
--
-- Run with: pnpm exec supabase test db --local
create extension if not exists pgtap with schema extensions;

begin;

select plan(66);

-- ============================================================
-- Fixtures
-- ============================================================
--   L1 draft,  Women › Tops, A
--   L2 active, Women › Tops, A (starts with the Adidas brand)
--   L3 sold,   Women › Tops, A
--   L4 draft,  Women › Tops, B (starts with brand_text 'B Label')

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('f8000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-brand-a@test.dev', 'x', now(), now()),
  ('f8000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pgtap-brand-b@test.dev', 'x', now(), now());

insert into public.listings
  (id, seller_id, title, description, price_amount, condition, size, category_id, status)
values
  ('f8aa0000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-00000000000a',
   'Brand draft', '', null, null, null, 'c0000001-0000-4000-8000-000000000001', 'draft'),
  ('f8aa0000-0000-0000-0000-000000000002', 'f8000000-0000-0000-0000-00000000000a',
   'Brand active', '', 5000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'active'),
  ('f8aa0000-0000-0000-0000-000000000003', 'f8000000-0000-0000-0000-00000000000a',
   'Brand sold', '', 5000, 'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001', 'sold'),
  ('f8aa0000-0000-0000-0000-000000000004', 'f8000000-0000-0000-0000-00000000000b',
   'Brand B draft', '', null, null, null, 'c0000001-0000-4000-8000-000000000001', 'draft');

-- Privileged setup (brand columns have no client write grant).
update public.listings
   set brand_id = (select id from public.brands where key = 'adidas')
 where id = 'f8aa0000-0000-0000-0000-000000000002';
update public.listings
   set brand_text = 'B Label'
 where id = 'f8aa0000-0000-0000-0000-000000000004';

set local role authenticated;
set local request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ============================================================
-- 1. A known brand
-- ============================================================

select lives_ok(
  $$select public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}',
      (select id from public.brands where key = 'nike'), null)$$,
  'the owner can set a known brand on their draft'
);

select ok(
  (select brand_id = (select id from public.brands where key = 'nike') and brand_text is null
     from public.listings where id = 'f8aa0000-0000-0000-0000-000000000001'),
  'the listing stores brand_id and no brand_text'
);

select is(
  (select resolved_brand_id from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}',
      (select id from public.brands where key = 'adidas'), null)),
  (select id from public.brands where key = 'adidas'),
  'the RPC returns the brand it stored'
);

-- ============================================================
-- 2. Free text: kept as text unless it exactly matches an alias
-- ============================================================

select is(
  (select resolved_brand_text from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, 'Some Tiny Label')),
  'Some Tiny Label',
  'an unknown brand is kept as the seller''s text'
);

select ok(
  (select brand_id is null and brand_text = 'Some Tiny Label'
     from public.listings where id = 'f8aa0000-0000-0000-0000-000000000001'),
  'the listing stores brand_text and no brand_id'
);

select is(
  (select resolved_brand_text from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, '  Tiny    Label  ')),
  'Tiny Label',
  'brand text is trimmed and its whitespace collapsed'
);

select is(
  (select resolved_brand_text from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, E'Tiny\tLabel')),
  'Tiny Label',
  'a tab between words becomes a space, not nothing'
);

select is(
  (select resolved_brand_text from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, E'Ti\x01ny')),
  'Tiny',
  'control characters inside brand text are dropped'
);

select is(
  (select resolved_brand_text from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, 'Nikee')),
  'Nikee',
  'a near miss ("Nikee") is NOT fuzzy-matched to Nike'
);

select is(
  (select resolved_brand_text from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, 'Polo')),
  'Polo',
  'the generic word "Polo" stays text (it is no brand''s alias)'
);

-- Exact normalized alias -> brand id, text cleared.
select is(
  (select resolved_brand_id from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, 'nike')),
  (select id from public.brands where key = 'nike'),
  'typed "nike" resolves to the Nike brand'
);

select ok(
  (select brand_id = (select id from public.brands where key = 'nike') and brand_text is null
     from public.listings where id = 'f8aa0000-0000-0000-0000-000000000001'),
  'a resolved brand is stored as brand_id with brand_text cleared'
);

select is(
  (select resolved_brand_id from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, '  NIKE  ')),
  (select id from public.brands where key = 'nike'),
  'case and edge whitespace do not matter'
);

select is(
  (select resolved_brand_id from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, 'נייקי')),
  (select id from public.brands where key = 'nike'),
  'the Hebrew spelling resolves to Nike'
);

select is(
  (select resolved_brand_id from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, 'Polo Ralph Lauren')),
  (select id from public.brands where key = 'ralph lauren'),
  '"Polo Ralph Lauren" resolves to Ralph Lauren'
);

select is(
  (select resolved_brand_id from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, 'U.S. Polo Assn')),
  (select id from public.brands where key = 'us polo assn'),
  '"U.S. Polo Assn" resolves to U.S. Polo Assn., not Ralph Lauren'
);

select is(
  (select resolved_brand_id from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, 'Carhartt Work In Progress')),
  (select id from public.brands where key = 'carhartt wip'),
  '"Carhartt Work In Progress" resolves to Carhartt WIP'
);

select is(
  (select resolved_brand_id from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, 'Carhartt')),
  (select id from public.brands where key = 'carhartt'),
  '"Carhartt" resolves to regular Carhartt, not Carhartt WIP'
);

-- ============================================================
-- 3. Never both, and bad input
-- ============================================================

select throws_ok(
  $$select public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}',
      (select id from public.brands where key = 'nike'), 'Nike')$$,
  '22023', null,
  'a brand id and brand text together are refused'
);

select throws_ok(
  $$select public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}',
      '00000000-0000-4000-8000-00000000dead', null)$$,
  '22023', null,
  'an unknown brand id is refused'
);

select throws_ok(
  $$select public.set_listing_attributes('f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, '???')$$,
  '22023', null,
  'brand text with no letters or digits is refused'
);

select is(
  (select resolved_brand_text from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, '無印良品')),
  '無印良品',
  'a brand in a script the key does not cover (Japanese) is kept as text, not refused'
);

select is(
  (select resolved_brand_text from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, 'Москва 7')),
  'Москва 7',
  'a Cyrillic brand with a digit is kept as text'
);

select ok(
  (select brand_id is null and brand_text = 'Москва 7' from public.listings where id = 'f8aa0000-0000-0000-0000-000000000001'),
  'and stored as brand_text with no brand_id'
);

select is(
  (select resolved_brand_id from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, 'J. Crew')),
  (select id from public.brands where key = 'jcrew'),
  'typed "J. Crew" resolves to the J.Crew brand'
);

select is(
  (select resolved_brand_id from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, E'\u05E0\u05B4\u05D9\u05D9\u05E7\u05B4\u05D9')),
  (select id from public.brands where key = 'nike'),
  'typed pointed Hebrew (נִייקִי) resolves to Nike'
);

-- Invisible formatting characters are stripped, so a disguised brand still
-- resolves to the real one and none can be stored.
select is(
  (select resolved_brand_id from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, E'Ni\u200bke')),
  (select id from public.brands where key = 'nike'),
  'a zero-width space inside "Nike" does not stop it resolving to Nike'
);

select is(
  (select resolved_brand_id from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, E'\u202eNike')),
  (select id from public.brands where key = 'nike'),
  'a right-to-left override in front of "Nike" is stripped'
);

select is(
  (select resolved_brand_id from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, E'\ufeffNike')),
  (select id from public.brands where key = 'nike'),
  'a byte-order mark in front of "Nike" is stripped'
);

select is(
  (select resolved_brand_text from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, E'Tiny\u200bLabel')),
  'TinyLabel',
  'invisible characters are removed from stored text, not turned into spaces'
);

select throws_ok(
  $$select public.set_listing_attributes('f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, repeat('a', 61))$$,
  '22023', null,
  'brand text over 60 characters is refused'
);

select throws_ok(
  $$select public.set_listing_attributes('f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, repeat('a', 401))$$,
  '22023', null,
  'brand text over 400 bytes is refused before normalization'
);

select is(
  (select resolved_brand_id from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}',
      (select id from public.brands where key = 'puma'), '   ')),
  (select id from public.brands where key = 'puma'),
  'blank brand text beside a brand id counts as no text'
);

select ok(
  (select resolved_brand_id is null and resolved_brand_text is null
     from public.set_listing_attributes('f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, '   ')),
  'no id and blank text clears the brand'
);

select ok(
  (select brand_id is null and brand_text is null from public.listings where id = 'f8aa0000-0000-0000-0000-000000000001'),
  'the cleared brand is cleared on the listing'
);

-- ============================================================
-- 4. The brand travels with the rest of the attribute set
-- ============================================================

select lives_ok(
  $$select public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001',
      array['a1000001-0000-4000-8000-000000000008', 'a1000002-0000-4000-8000-000000000003']::uuid[],
      array['crewneck'],
      (select id from public.brands where key = 'champion'), null)$$,
  'attributes, keywords and a brand can be saved in one call'
);

select ok(
  (select l.brand_id = (select id from public.brands where key = 'champion')
      and l.keywords = array['crewneck']
      and (select count(*) from public.listing_attribute_values v where v.listing_id = l.id) = 2
     from public.listings l where l.id = 'f8aa0000-0000-0000-0000-000000000001'),
  'all three were stored together'
);

select lives_ok(
  $$select public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001',
      array['a1000001-0000-4000-8000-000000000008']::uuid[], array['crewneck'])$$,
  'the old 3-argument call shape still works'
);

select ok(
  (select brand_id is null and brand_text is null from public.listings where id = 'f8aa0000-0000-0000-0000-000000000001'),
  'omitting the brand arguments clears the brand, like omitting keywords clears keywords'
);

select lives_ok(
  $$select public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}',
      (select id from public.brands where key = 'nike'), null)$$,
  'setup: the draft gets Nike again'
);

select lives_ok(
  $$update public.listings set category_id = 'c0000004-0000-4000-8000-000000000001'
     where id = 'f8aa0000-0000-0000-0000-000000000001'$$,
  'the seller moves the draft to Home › Furniture'
);

select ok(
  (select brand_id = (select id from public.brands where key = 'nike')
     from public.listings where id = 'f8aa0000-0000-0000-0000-000000000001'),
  'a category change does not touch the brand (brand applies to every category)'
);

select lives_ok(
  $$select public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000002', '{}', '{}',
      (select id from public.brands where key = 'zara'), null)$$,
  'an ACTIVE listing''s brand can be edited'
);

select lives_ok(
  $$select public.update_listing_details(
      'f8aa0000-0000-0000-0000-000000000002', 'Brand active renamed', '', 5000,
      'good', 'alpha_m', 'c0000001-0000-4000-8000-000000000001')$$,
  'update_listing_details works on a branded active listing'
);

select ok(
  (select brand_id = (select id from public.brands where key = 'zara')
     from public.listings where id = 'f8aa0000-0000-0000-0000-000000000002'),
  'and leaves its brand untouched'
);

-- ============================================================
-- 5. Who and which listings
-- ============================================================

select throws_ok(
  $$select public.set_listing_attributes('f8aa0000-0000-0000-0000-000000000003', '{}', '{}',
      (select id from public.brands where key = 'nike'), null)$$,
  'P0001', null,
  'a sold listing''s brand can no longer be edited'
);

select throws_ok(
  $$select public.set_listing_attributes('f8aa0000-0000-0000-0000-000000000004', '{}', '{}',
      (select id from public.brands where key = 'nike'), null)$$,
  '42501', null,
  'A cannot set a brand on B''s listing'
);

-- ============================================================
-- 6. No direct client writes
-- ============================================================

select throws_ok(
  $$update public.listings set brand_text = 'Hacked' where id = 'f8aa0000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'a client cannot write listings.brand_text directly'
);

select throws_ok(
  $$update public.listings set brand_id = (select id from public.brands where key = 'nike')
     where id = 'f8aa0000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'a client cannot write listings.brand_id directly'
);

select lives_ok(
  $$update public.listings set title = 'Brand draft renamed' where id = 'f8aa0000-0000-0000-0000-000000000001'$$,
  'a plain draft UPDATE of allowed columns still works'
);

-- ============================================================
-- 7. Retired brands
-- ============================================================

reset role;
update public.brands set retired_at = now() where key in ('adidas', 'nike');
update public.listings set brand_id = (select id from public.brands where key = 'adidas')
 where id = 'f8aa0000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select throws_ok(
  $$select public.set_listing_attributes('f8aa0000-0000-0000-0000-000000000001', '{}', '{}',
      (select id from public.brands where key = 'adidas'), null)$$,
  '22023', null,
  'a retired brand cannot be newly chosen'
);

select lives_ok(
  $$select public.set_listing_attributes('f8aa0000-0000-0000-0000-000000000002', '{}', array['kept'],
      (select id from public.brands where key = 'adidas'), null)$$,
  'a listing that already has the retired brand can keep it while being edited'
);

select is(
  (select resolved_brand_text from public.set_listing_attributes(
      'f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, 'nike')),
  'nike',
  'typed text is not resolved to a retired brand; it stays as text'
);

-- ============================================================
-- 8. Constraints behind the RPC (privileged writes)
-- ============================================================

reset role;

select throws_ok(
  $$update public.listings
       set brand_id = (select id from public.brands where key = 'zara'), brand_text = 'Zara'
     where id = 'f8aa0000-0000-0000-0000-000000000001'$$,
  '23514', null,
  'the table refuses a listing with both a brand id and brand text'
);

select throws_ok(
  $$update public.listings set brand_text = '' where id = 'f8aa0000-0000-0000-0000-000000000001'$$,
  '23514', null,
  'the table refuses empty brand text'
);

select throws_ok(
  $$update public.listings set brand_text = ' padded' where id = 'f8aa0000-0000-0000-0000-000000000001'$$,
  '23514', null,
  'the table refuses brand text with edge whitespace'
);

select throws_ok(
  $$update public.listings set brand_text = repeat('a', 61) where id = 'f8aa0000-0000-0000-0000-000000000001'$$,
  '23514', null,
  'the table refuses brand text over 60 characters'
);

select throws_ok(
  $$update public.listings set brand_text = E'two\nlines' where id = 'f8aa0000-0000-0000-0000-000000000001'$$,
  '23514', null,
  'the table refuses brand text with control characters'
);

select throws_ok(
  $$update public.listings set brand_text = E'Ni\u200bke' where id = 'f8aa0000-0000-0000-0000-000000000001'$$,
  '23514', null,
  'the table refuses brand text with invisible formatting characters'
);

select throws_ok(
  $$update public.listings set brand_id = '00000000-0000-4000-8000-00000000dead', brand_text = null
     where id = 'f8aa0000-0000-0000-0000-000000000001'$$,
  '23503', null,
  'the table refuses a brand id that is not in the catalog'
);

select throws_ok(
  $$delete from public.brands where key = 'adidas'$$,
  '23503', null,
  'a brand still used by a listing cannot be deleted'
);

-- ============================================================
-- 9. Read visibility follows the listing
-- ============================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"f8000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select is(
  (select brand_id from public.listings where id = 'f8aa0000-0000-0000-0000-000000000002'),
  (select id from public.brands where key = 'adidas'),
  'another signed-in user can read the brand of an active listing'
);

select is_empty(
  $$select brand_id, brand_text from public.listings where id = 'f8aa0000-0000-0000-0000-000000000001'$$,
  'another user cannot read the brand of someone else''s draft'
);

select is(
  (select brand_text from public.listings where id = 'f8aa0000-0000-0000-0000-000000000004'),
  'B Label',
  'B reads their own draft''s brand text (and A''s failed call did not change it)'
);

-- anon can't read the brand tables, so capture the id while privileged.
do $$ begin
  perform set_config('t.adidas', (select id::text from public.brands where key = 'adidas'), true);
end $$;

-- anon: documented, accepted behavior. listings is publicly readable for
-- active rows (title and description too), so the brand is as visible as
-- they are. The brand TABLES themselves stay closed to anon (brands.sql).
set local role anon;

select is(
  (select brand_id from public.listings where id = 'f8aa0000-0000-0000-0000-000000000002'),
  current_setting('t.adidas')::uuid,
  'anon can read an active listing''s brand, exactly like its title (accepted)'
);

select throws_ok(
  $$select public.set_listing_attributes('f8aa0000-0000-0000-0000-000000000001', '{}', '{}', null, 'x')$$,
  '42501', null,
  'anon cannot execute set_listing_attributes'
);

select * from finish();

rollback;
