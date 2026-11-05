// Shared fixtures for the Deno tests in this folder (not a test file itself).

import { buildTaxonomy, type Taxonomy } from './taxonomy.ts';

export const TOPS = 'cat-women-tops';
export const SHOES = 'cat-women-shoes';
export const FURNITURE = 'cat-home-furniture';

export function fixtureTaxonomy(): Taxonomy {
  return buildTaxonomy({
    categories: [
      { id: 'grp-women', name: 'Women', parent_id: null },
      { id: 'grp-home', name: 'Home', parent_id: null },
      { id: TOPS, name: 'Tops', parent_id: 'grp-women' },
      { id: SHOES, name: 'Shoes', parent_id: 'grp-women' },
      { id: FURNITURE, name: 'Furniture', parent_id: 'grp-home' },
    ],
    kinds: [
      { kind: 'item_type', max_values: 1 },
      { kind: 'color', max_values: 3 },
      { kind: 'style', max_values: 3 },
      { kind: 'material', max_values: 2 },
      { kind: 'pattern', max_values: 1 },
      { kind: 'fit', max_values: 1 },
    ],
    terms: [
      { id: 't-hoodie', kind: 'item_type', slug: 'hoodie', retired_at: null },
      { id: 't-sneakers', kind: 'item_type', slug: 'sneakers', retired_at: null },
      { id: 'c-black', kind: 'color', slug: 'black', retired_at: null },
      { id: 'c-grey', kind: 'color', slug: 'grey', retired_at: null },
      { id: 'c-white', kind: 'color', slug: 'white', retired_at: null },
      { id: 'c-red', kind: 'color', slug: 'red', retired_at: null },
      { id: 'c-teal', kind: 'color', slug: 'teal', retired_at: '2026-01-01T00:00:00Z' },
      { id: 's-street', kind: 'style', slug: 'streetwear', retired_at: null },
      { id: 'm-cotton', kind: 'material', slug: 'cotton', retired_at: null },
      { id: 'm-leather', kind: 'material', slug: 'leather', retired_at: null },
      { id: 'p-solid', kind: 'pattern', slug: 'solid', retired_at: null },
      { id: 'f-regular', kind: 'fit', slug: 'regular', retired_at: null },
    ],
    kindCategories: [
      ...['color', 'style', 'material', 'pattern'].flatMap((kind) => [
        { kind, category_id: TOPS },
        { kind, category_id: SHOES },
      ]),
      { kind: 'fit', category_id: TOPS },
    ],
    itemTypeCategories: [
      { term_id: 't-hoodie', category_id: TOPS },
      { term_id: 't-sneakers', category_id: SHOES },
    ],
  });
}
