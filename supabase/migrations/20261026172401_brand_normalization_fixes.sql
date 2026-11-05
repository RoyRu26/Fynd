-- Brand normalization fixes (follow-up to Phase 1b). Three known gaps:
--
-- 1. Unicode ordering. normalize_brand_key() lowercased BEFORE the Unicode
--    compatibility decomposition (NFKD). Compatibility letters whose
--    decomposition is uppercase then slipped past the lowercasing and were
--    later replaced by a space: double-struck "ℕike" normalized to "ike" and
--    "ℍoka" to "oka". NFKD now runs first, then lowercasing, then the removal
--    of the combining marks it produced, so such forms normalize like the
--    plain letters ("nike", "hoka"). Ordinary Latin and Hebrew names are
--    unaffected.
-- 2. Hebrew niqqud. Vowel points and cantillation marks (U+0591-U+05C7 except
--    the maqaf U+05BE, which is a hyphen and still becomes a space) were
--    turned into spaces, so a pointed spelling never matched its plain
--    alias ("נִייקִי" gave "נ ייק י"). They are now removed, so a pointed
--    spelling normalizes to the same key as the unpointed one. Hebrew
--    presentation forms (e.g. U+FB2A) decompose under NFKD first and then
--    lose their points the same way. Final-letter folding and geresh /
--    gershayim removal are unchanged.
-- 3. A missing alias: "J. Crew" (with a space) did not resolve to J.Crew,
--    because "J.Crew" normalizes to "jcrew" and "J. Crew" to "j crew".
--    Added as an approved spelling variant of J.Crew.
--
-- Safety: before this migration was written, every existing brands.key and
-- brand_aliases.alias_key was recomputed under the corrected function: none
-- changed, and no collision arises (including with the new alias), so no
-- existing row is rewritten. Replacing a function does not re-check the CHECK
-- constraints that call it, so the guard at the end re-verifies every row
-- explicitly.

create or replace function public.normalize_brand_key(p_text text)
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
            -- NFKD, THEN lowercase (so letters that decompose to uppercase are
            -- lowercased), THEN drop combining marks: Latin accents and
            -- Hebrew niqqud / cantillation (everything U+0591-U+05C7 except
            -- the maqaf U+05BE).
            regexp_replace(
              lower(normalize(coalesce(p_text, ''), nfkd)),
              '[̀-֑ͯ-ֽֿ-ׇ]', '', 'g'
            ),
            '&', ' and '
          ),
          '[׳״''’`.]', '', 'g'
        ),
        'ךםןףץ', 'כמנפצ'
      ),
      '[^a-z0-9א-ת]+', ' ', 'g'
    )
  );
$$;

-- "J. Crew" -> J.Crew. The alias key is written out literally; the
-- brand_aliases_key_matches_alias CHECK fails this migration if it is not
-- what normalize_brand_key() produces. A collision with another brand's alias
-- would raise 23505 (alias_key is the primary key).
insert into public.brand_aliases (alias_key, brand_id, alias)
select 'j crew', b.id, 'J. Crew'
  from public.brands b
 where b.key = 'jcrew';

do $guard$
declare
  v_brands integer;
  v_aliases integer;
begin
  if exists (select 1 from public.brands b where b.key <> public.normalize_brand_key(b.name)) then
    raise exception 'A brand key no longer matches normalize_brand_key(name)';
  end if;
  if exists (select 1 from public.brand_aliases a where a.alias_key <> public.normalize_brand_key(a.alias)) then
    raise exception 'An alias key no longer matches normalize_brand_key(alias)';
  end if;

  select count(*) into v_brands from public.brands;
  select count(*) into v_aliases from public.brand_aliases;
  if v_brands <> 120 or v_aliases <> 247 then
    raise exception 'Brand catalog mismatch: % brands, % alias rows (expected 120 / 247)', v_brands, v_aliases;
  end if;
end
$guard$;
