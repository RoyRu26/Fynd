import { useQuery } from '@tanstack/react-query';

import { fetchCategories } from '@/features/categories/api';
import { normalizeCategoryRow, type Category } from '@/features/categories/categories';

export const categoryKeys = {
  all: ['categories'] as const,
};

/**
 * The full category taxonomy, normalized to camelCase domain rows.
 * Grouping into top-level/leaf pairs (`groupCategoriesByParent`) is left to
 * callers -- the sell-flow picker and listing-detail breadcrumb want the
 * same flat list shaped slightly differently (a drill-down list vs. a
 * single id -> group+leaf lookup), so neither shape is privileged here.
 *
 * `staleTime: 24h` -- the first long-lived reference-data cache in this
 * app. Every other query here is per-user or per-listing state that
 * changes during a session (a draft being edited, a feed page, messages);
 * this is shared, server-seeded taxonomy content that -- per
 * supabase/migrations/20261018100200_categories.sql's header -- has no
 * client write path at all and is expected to change on the order of
 * product decisions, not sessions. Refetching it on every mount/focus would
 * be pure waste: a brand-new category added mid-session reaching the picker
 * within a day is an acceptable trade for that.
 */
export function useCategories() {
  return useQuery({
    queryKey: categoryKeys.all,
    queryFn: async (): Promise<Category[]> => (await fetchCategories()).map(normalizeCategoryRow),
    staleTime: 24 * 60 * 60 * 1000,
  });
}
