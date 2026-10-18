import { describe, expect, it } from 'vitest';

import {
  findCategorySelection,
  formatCategoryBreadcrumb,
  groupCategoriesByParent,
  normalizeCategoryRow,
  type Category,
} from '@/features/categories/categories';

function category(overrides: Partial<Category> = {}): Category {
  return {
    id: 'cat-women',
    name: 'Women',
    parentId: null,
    position: 0,
    ...overrides,
  };
}

const WOMEN = category({ id: 'cat-women', name: 'Women', parentId: null, position: 0 });
const MEN = category({ id: 'cat-men', name: 'Men', parentId: null, position: 1 });
const WOMEN_TOPS = category({ id: 'cat-women-tops', name: 'Tops', parentId: 'cat-women', position: 0 });
const WOMEN_SHOES = category({ id: 'cat-women-shoes', name: 'Shoes', parentId: 'cat-women', position: 1 });
const MEN_TOPS = category({ id: 'cat-men-tops', name: 'Tops', parentId: 'cat-men', position: 0 });

describe('normalizeCategoryRow', () => {
  it('maps snake_case columns to camelCase fields', () => {
    expect(normalizeCategoryRow({ id: 'c1', name: 'Women', parent_id: null, position: 0 })).toEqual({
      id: 'c1',
      name: 'Women',
      parentId: null,
      position: 0,
    });
  });

  it('preserves a non-null parent_id', () => {
    expect(
      normalizeCategoryRow({ id: 'c2', name: 'Tops', parent_id: 'c1', position: 3 }),
    ).toEqual({ id: 'c2', name: 'Tops', parentId: 'c1', position: 3 });
  });
});

describe('groupCategoriesByParent', () => {
  it('groups leaves under their correct top-level parent, in position order', () => {
    const groups = groupCategoriesByParent([MEN, WOMEN, MEN_TOPS, WOMEN_SHOES, WOMEN_TOPS]);

    expect(groups.map((g) => g.name)).toEqual(['Women', 'Men']);
    expect(groups[0]).toEqual({
      id: 'cat-women',
      name: 'Women',
      subcategories: [WOMEN_TOPS, WOMEN_SHOES],
    });
    expect(groups[1]).toEqual({
      id: 'cat-men',
      name: 'Men',
      subcategories: [MEN_TOPS],
    });
  });

  it('sorts both groups and their leaves by position, not insertion order', () => {
    const groups = groupCategoriesByParent([WOMEN_SHOES, MEN_TOPS, WOMEN_TOPS, MEN, WOMEN]);
    expect(groups.map((g) => g.name)).toEqual(['Women', 'Men']);
    expect(groups[0].subcategories.map((c) => c.name)).toEqual(['Tops', 'Shoes']);
  });

  it('returns an empty list for empty input', () => {
    expect(groupCategoriesByParent([])).toEqual([]);
  });

  // The throw-on-unknown-parent invariant: a leaf whose parent_id does not
  // resolve to ANY row in the list at all.
  it('throws when a leaf references a parent_id that does not exist in the list', () => {
    const dangling = category({ id: 'cat-dangling', name: 'Ghost', parentId: 'does-not-exist' });
    expect(() => groupCategoriesByParent([WOMEN, dangling])).toThrow(/does not resolve/);
  });

  // The same invariant, but the referenced id DOES exist -- just not as a
  // top-level row. A real taxonomy bug (three levels deep) must not be
  // silently flattened.
  it('throws when a leaf points at another leaf instead of a top-level category', () => {
    const grandchild = category({ id: 'cat-grandchild', name: 'Heels', parentId: 'cat-women-shoes' });
    expect(() => groupCategoriesByParent([WOMEN, WOMEN_SHOES, grandchild])).toThrow(
      /does not resolve/,
    );
  });

  // The orphaned/malformed invariant: a row with neither a parent_id nor
  // any children of its own is neither a usable group nor a usable leaf.
  it('throws when a top-level row has no children at all', () => {
    const emptyGroup = category({ id: 'cat-empty', name: 'Empty', parentId: null, position: 2 });
    expect(() => groupCategoriesByParent([WOMEN, WOMEN_TOPS, emptyGroup])).toThrow(
      /neither a valid group nor a valid leaf/,
    );
  });
});

describe('formatCategoryBreadcrumb', () => {
  it('joins the group and leaf names with the separator', () => {
    const group = { id: 'cat-women', name: 'Women', subcategories: [WOMEN_SHOES] };
    expect(formatCategoryBreadcrumb(group, WOMEN_SHOES)).toBe('Women › Shoes');
  });

  it('uses U+203A as the separator character', () => {
    const group = { id: 'cat-men', name: 'Men', subcategories: [MEN_TOPS] };
    const breadcrumb = formatCategoryBreadcrumb(group, MEN_TOPS);
    expect(breadcrumb).toContain('›');
  });
});

describe('findCategorySelection', () => {
  const groups = groupCategoriesByParent([WOMEN, MEN, WOMEN_TOPS, WOMEN_SHOES, MEN_TOPS]);

  it('resolves an id to its group and leaf', () => {
    expect(findCategorySelection(groups, 'cat-women-shoes')).toEqual({
      group: groups[0],
      leaf: WOMEN_SHOES,
    });
  });

  it('returns null for a null id', () => {
    expect(findCategorySelection(groups, null)).toBeNull();
  });

  it('returns null for an id that matches no leaf, rather than throwing', () => {
    expect(findCategorySelection(groups, 'unknown-id')).toBeNull();
  });

  it('returns null for a top-level group id, which is never a valid selection', () => {
    expect(findCategorySelection(groups, 'cat-women')).toBeNull();
  });
});
