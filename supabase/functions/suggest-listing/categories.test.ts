import { assertEquals } from 'jsr:@std/assert@1';

import { buildCategoryPaths, resolveCategoryPath, type CategoryRow } from './categories.ts';

const ROWS: CategoryRow[] = [
  { id: 'top-women', name: 'Women', parent_id: null },
  { id: 'top-men', name: 'Men', parent_id: null },
  { id: 'leaf-women-tops', name: 'Tops', parent_id: 'top-women' },
  { id: 'leaf-women-dresses', name: 'Dresses', parent_id: 'top-women' },
  { id: 'leaf-men-tops', name: 'Tops', parent_id: 'top-men' },
];

Deno.test('buildCategoryPaths excludes top-level (parent_id null) rows', () => {
  const paths = buildCategoryPaths(ROWS);
  assertEquals(paths.length, 3);
  assertEquals(paths.some((p) => p.categoryId === 'top-women'), false);
  assertEquals(paths.some((p) => p.categoryId === 'top-men'), false);
});

Deno.test('buildCategoryPaths joins "Group > Leaf" using the parent name', () => {
  const paths = buildCategoryPaths(ROWS);
  assertEquals(
    paths.find((p) => p.categoryId === 'leaf-women-tops')?.path,
    'Women > Tops',
  );
  assertEquals(
    paths.find((p) => p.categoryId === 'leaf-women-dresses')?.path,
    'Women > Dresses',
  );
});

Deno.test('buildCategoryPaths disambiguates same-named leaves under different parents', () => {
  const paths = buildCategoryPaths(ROWS);
  assertEquals(
    paths.find((p) => p.categoryId === 'leaf-men-tops')?.path,
    'Men > Tops',
  );
  // Two distinct leaves both named "Tops" produce two distinct path strings.
  const topsPaths = paths.filter((p) => p.path.endsWith('> Tops'));
  assertEquals(topsPaths.length, 2);
});

Deno.test('buildCategoryPaths skips a row whose parent_id does not resolve to any row', () => {
  const rowsWithOrphan: CategoryRow[] = [
    ...ROWS,
    { id: 'orphan', name: 'Orphan leaf', parent_id: 'does-not-exist' },
  ];
  const paths = buildCategoryPaths(rowsWithOrphan);
  assertEquals(paths.some((p) => p.categoryId === 'orphan'), false);
});

Deno.test('buildCategoryPaths returns an empty list for no rows', () => {
  assertEquals(buildCategoryPaths([]), []);
});

Deno.test('resolveCategoryPath returns the matching categoryId for an exact path match', () => {
  const paths = buildCategoryPaths(ROWS);
  assertEquals(resolveCategoryPath('Women > Tops', paths), 'leaf-women-tops');
  assertEquals(resolveCategoryPath('Men > Tops', paths), 'leaf-men-tops');
});

Deno.test('resolveCategoryPath returns null (never fabricates) for an unknown path', () => {
  const paths = buildCategoryPaths(ROWS);
  assertEquals(resolveCategoryPath('Kids & Baby > Shoes', paths), null);
  assertEquals(resolveCategoryPath('', paths), null);
});

Deno.test('resolveCategoryPath is case-sensitive and exact -- no partial or fuzzy match', () => {
  const paths = buildCategoryPaths(ROWS);
  assertEquals(resolveCategoryPath('women > tops', paths), null);
  assertEquals(resolveCategoryPath('Women >  Tops', paths), null);
});
