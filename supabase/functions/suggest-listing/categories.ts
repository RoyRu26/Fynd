// Builds the live `category_path` enum from the real `categories` table,
// and resolves a model-chosen path back to a real category id.
//
// `buildCategoryPaths` and `resolveCategoryPath` are pure (no Deno-specific
// or network imports) and unit-tested in categories.test.ts. Only
// `fetchCategoryPaths` touches the network, through the caller-scoped
// client passed in from index.ts -- never a service-role client.

export type CategoryRow = {
  id: string;
  name: string;
  parent_id: string | null;
};

export type CategoryPath = {
  /** Exact "Group > Leaf" string, one per real leaf category row. */
  path: string;
  categoryId: string;
};

/** Minimal shape of the subset of the supabase-js client this file uses. */
export type CategoriesReadClient = {
  from: (table: string) => {
    select: (columns: string) => Promise<{ data: CategoryRow[] | null; error: { message: string } | null }>;
  };
};

/**
 * Builds one entry per LEAF category -- a row with a non-null `parent_id`.
 * Top-level rows (parent_id null) are never leaves themselves (see
 * supabase/migrations/20261018100200_categories.sql's header: a listing's
 * category_id always points at a leaf, never a bare top-level row), so
 * they are excluded here and only contribute their name as a prefix.
 */
export function buildCategoryPaths(rows: CategoryRow[]): CategoryPath[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const paths: CategoryPath[] = [];

  for (const row of rows) {
    if (row.parent_id === null) {
      continue;
    }
    const parent = byId.get(row.parent_id);
    if (!parent) {
      // Defensive only -- the FK makes this unreachable with real data.
      continue;
    }
    paths.push({ path: `${parent.name} > ${row.name}`, categoryId: row.id });
  }

  return paths;
}

/**
 * Resolves a model-returned `category_path` back to a real category id.
 * Returns `null` (never fabricates an id) when the path does not match any
 * real leaf -- e.g. if the model ignored the enum constraint it was given.
 */
export function resolveCategoryPath(path: string, categoryPaths: CategoryPath[]): string | null {
  const match = categoryPaths.find((entry) => entry.path === path);
  return match ? match.categoryId : null;
}

/**
 * Fetches every category row through the caller-scoped client. `categories`
 * has a public SELECT policy (20261018100200_categories.sql), so this
 * succeeds for any authenticated caller -- RLS applies as a matter of
 * course, it just never denies here.
 */
export async function fetchCategoryPaths(client: CategoriesReadClient): Promise<CategoryPath[]> {
  const { data, error } = await client.from('categories').select('id, name, parent_id');
  if (error) {
    throw new Error(`Failed to fetch categories: ${error.message}`);
  }
  return buildCategoryPaths(data ?? []);
}
