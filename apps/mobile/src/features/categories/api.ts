import type { CategoryRow } from '@/features/categories/categories';
import { supabase } from '@/lib/supabase';

/**
 * Database access for the category taxonomy (ROADMAP 2.1).
 *
 * `categories` has no client write path at all -- see
 * supabase/migrations/20261018100200_categories.sql -- so this file is
 * read-only by construction, not by convention. Ordered by `position` (the
 * taxonomy's own curated order) then `name` as a tie-break for siblings
 * that happen to share a position, though the seed never does.
 */
export async function fetchCategories(): Promise<CategoryRow[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, parent_id, position')
    .order('position')
    .order('name');
  if (error) throw error;
  return data;
}
