// Resolves the model's brand text against the approved catalog, exactly the
// way set_listing_attributes resolves typed text: normalize with the
// database's own normalize_brand_key(), then an EXACT alias lookup among
// active brands. No fuzzy matching. Unknown brands stay text. Reads go
// through the caller-scoped client (brands / brand_aliases are
// authenticated-SELECT). Not unit-tested: it is two network reads.

export type ResolvedBrand = { brandId: string; name: string };

type AliasRow = { brand_id: string; brands: { name: string; retired_at: string | null } | null };

/** Minimal shape of the subset of the supabase-js client this file uses. */
export type BrandsReadClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
};

/** The catalog brand the text names, or null (unknown, retired, or the lookup failed). */
export async function resolveBrandText(client: BrandsReadClient, text: string): Promise<ResolvedBrand | null> {
  const { data: key, error: keyError } = await client.rpc('normalize_brand_key', { p_text: text });
  if (keyError || typeof key !== 'string' || key === '') return null;

  const { data, error } = await client
    .from('brand_aliases')
    .select('brand_id, brands(name, retired_at)')
    .eq('alias_key', key)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as AliasRow;
  if (!row.brands || row.brands.retired_at !== null) return null;
  return { brandId: row.brand_id, name: row.brands.name };
}
