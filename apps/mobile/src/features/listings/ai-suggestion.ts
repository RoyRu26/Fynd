import { z } from 'zod';

import { Constants, type Enums } from '@/types/database';

/**
 * The AI suggestion shape (AI listing metadata plan, Phase 2), as returned by
 * the suggest-listing Edge Function and as stored in
 * `listing_ai_analyses.suggestion`.
 *
 * Pure (no react-native, no `@/lib/supabase`). Everything is parsed with Zod
 * before the app uses it: the Edge Function already validated the model's
 * output, but this side still treats both the function response and a
 * stored row as untrusted input — an unknown `version`, a malformed field or
 * an out-of-range confidence means "no suggestion", never a crash.
 *
 * The server's types (supabase/functions/suggest-listing/parse.ts, index.ts)
 * can't be imported across the Deno/app boundary; `version` is what keeps
 * the two in step.
 */
export const AI_SUGGESTION_VERSION = 1;

const confidence = z.number().min(0).max(1);
// Any 8-4-4-4-12 hex id; z.uuid() would also insist on RFC version bits.
const uuid = z.guid();
const scoredTerm = z.object({ termId: uuid, slug: z.string().min(1).max(60), confidence });

export const aiSuggestionSchema = z.object({
  version: z.literal(AI_SUGGESTION_VERSION),
  title: z.string().min(1).max(120).nullable(),
  description: z.string().max(5000).nullable(),
  categoryId: uuid.nullable(),
  price: z
    .object({ minAmount: z.number().int().min(0), maxAmount: z.number().int().min(1) })
    .refine((range) => range.maxAmount >= range.minAmount)
    .nullable(),
  condition: z.object({ value: z.enum(Constants.public.Enums.listing_condition), confidence }).nullable(),
  itemType: scoredTerm.nullable(),
  colors: z.array(scoredTerm).max(10),
  styles: z.array(scoredTerm).max(10),
  materials: z.array(scoredTerm.extend({ evidence: z.enum(['label', 'visual']) })).max(10),
  pattern: scoredTerm.nullable(),
  fit: scoredTerm.nullable(),
  brand: z
    .object({
      brandId: uuid.nullable(),
      // Code points, like the server (an emoji is one character, not two).
      name: z.string().min(1).refine((name) => [...name].length <= 60),
      confidence,
      evidence: z.enum(['label', 'printed_text', 'logo', 'style_inference', 'none']),
    })
    .nullable(),
  keywords: z.array(z.string().min(2).max(24)).max(10),
});

export type AiSuggestion = z.infer<typeof aiSuggestionSchema>;
export type AiBrandEvidence = NonNullable<AiSuggestion['brand']>['evidence'];
export type ListingCondition = Enums<'listing_condition'>;

/** A validated suggestion, or null for anything malformed or from an unknown version. */
export function parseAiSuggestion(value: unknown): AiSuggestion | null {
  const result = aiSuggestionSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** The first `count` image paths, in order, as one comparable string. Empty when there are no photos. */
export function photoSetSignature(storagePaths: readonly string[], count = 4): string {
  return storagePaths.slice(0, count).join('\n');
}

/**
 * Whether the editor should start an automatic analysis now. Only a CHANGE
 * of the analyzed photo set during this session counts: `baseline` is the set
 * seen when the editor opened (so reopening a draft never analyzes by
 * itself), `lastRequested` is the set most recently sent (so the same set is
 * never re-sent), and nothing runs while uploads are in flight or with no
 * photos. The caller adds the settle delay.
 */
export function shouldAutoAnalyze(input: {
  baseline: string | null;
  signature: string | null;
  lastRequested: string | null;
  photosInFlight: number;
  ready: boolean;
}): boolean {
  const { baseline, signature, lastRequested, photosInFlight, ready } = input;
  if (!ready || baseline === null || signature === null || signature === '') return false;
  if (photosInFlight > 0) return false;
  return signature !== baseline && signature !== lastRequested;
}
