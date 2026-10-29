// Fixed value lists shared by the manifest, the tool schema and the parser.

/**
 * Mirrors the database's `listing_condition` enum and
 * apps/mobile/src/features/listings/condition.ts exactly. A manual literal
 * list (this Deno runtime can't import the app's generated types), so if the
 * enum ever grows a value, update both. Part of the manifest, so a change
 * also changes metadata_schema_version.
 */
export const LISTING_CONDITIONS = ['new', 'like_new', 'very_good', 'good', 'fair'] as const;
export type ListingCondition = (typeof LISTING_CONDITIONS)[number];

/** How the model knows the brand. Only label / printed_text may ever pre-fill. */
export const BRAND_EVIDENCE = ['label', 'printed_text', 'logo', 'style_inference', 'none'] as const;
export type BrandEvidence = (typeof BRAND_EVIDENCE)[number];

/** How the model knows a material. Only a readable label may ever pre-fill. */
export const MATERIAL_EVIDENCE = ['label', 'visual'] as const;
export type MaterialEvidence = (typeof MATERIAL_EVIDENCE)[number];
