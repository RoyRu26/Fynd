import { BRAND_SEARCH_LIMIT, toBrandSuggestions, type BrandSuggestion } from '@/features/brands/brands';
import { supabase } from '@/lib/supabase';

/**
 * Database access for brands. `brands` and `brand_aliases` are authenticated-
 * SELECT only with no client writes, and users can't create brands: the picker
 * only ever *finds* catalog brands (this RPC) or hands free text to
 * `set_listing_attributes`, which resolves an exact alias match itself.
 */
export async function searchBrands(query: string, limit: number = BRAND_SEARCH_LIMIT): Promise<BrandSuggestion[]> {
  const { data, error } = await supabase.rpc('search_brands', { p_query: query, p_limit: limit });
  if (error) throw error;
  return toBrandSuggestions(data);
}
