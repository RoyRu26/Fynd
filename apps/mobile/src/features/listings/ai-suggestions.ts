import { aiSuggestionSchema, parseAiSuggestion, type AiSuggestion } from '@/features/listings/ai-suggestion';
import { supabase } from '@/lib/supabase';

/**
 * Client for the suggest-listing Edge Function and for the persisted
 * analyses it records (AI listing metadata plan, Phase 2).
 *
 * The Edge Function does every real check server-side (ownership, draft
 * status, which images, quota, the model call, output validation); it takes
 * only the listing id. Nothing here ever sees `ANTHROPIC_API_KEY`.
 *
 * Both the function's response and a stored analysis are parsed with Zod
 * (ai-suggestion.ts) before use: a malformed or unknown-version suggestion
 * is treated as "no suggestion", never trusted.
 */

export type AnalysisFailureReason = 'not_found' | 'no_photos' | 'rate_limited' | 'ai_unavailable' | 'invalid_request';

export type ListingAnalysis = {
  analysisId: string | null;
  /** The photos this analysis looked at, in order — so it is shown only for that photo set. */
  imagePaths: string[];
  suggestion: AiSuggestion;
};

export type SuggestListingResult =
  | ({ ok: true; cached: boolean } & ListingAnalysis)
  | { ok: false; reason: AnalysisFailureReason; message: string };

const UNAVAILABLE_MESSAGE = "Couldn't analyze your photos right now. You can fill in the details yourself.";
const FAILURE_REASONS: readonly AnalysisFailureReason[] = [
  'not_found',
  'no_photos',
  'rate_limited',
  'ai_unavailable',
  'invalid_request',
];

/**
 * Asks the server to analyze the draft's photos (or return the cached
 * analysis for identical inputs). Never throws: a transport failure, a
 * missing function or a malformed response all become one `ai_unavailable`
 * result, so manual listing always continues.
 */
export async function suggestListingFromPhotos(listingId: string): Promise<SuggestListingResult> {
  const { data, error } = await supabase.functions.invoke<unknown>('suggest-listing', { body: { listingId } });
  if (error || typeof data !== 'object' || data === null) {
    return { ok: false, reason: 'ai_unavailable', message: UNAVAILABLE_MESSAGE };
  }
  const body = data as Record<string, unknown>;

  if (body.ok === true) {
    const suggestion = parseAiSuggestion(body.suggestion);
    const imagePaths = stringArray(body.imagePaths);
    if (!suggestion || !imagePaths) {
      logBadShape(body.suggestion);
      return { ok: false, reason: 'ai_unavailable', message: UNAVAILABLE_MESSAGE };
    }
    return {
      ok: true,
      cached: body.cached === true,
      analysisId: typeof body.analysisId === 'string' ? body.analysisId : null,
      imagePaths,
      suggestion,
    };
  }

  const reason = FAILURE_REASONS.includes(body.reason as AnalysisFailureReason)
    ? (body.reason as AnalysisFailureReason)
    : 'ai_unavailable';
  const message = typeof body.message === 'string' && body.message.length <= 200 ? body.message : UNAVAILABLE_MESSAGE;
  return { ok: false, reason, message };
}

/**
 * The draft's most recent succeeded analysis, so suggestions survive closing
 * and reopening the editor without another model call. RLS returns only the
 * caller's own rows. Null when there is none (or it no longer parses).
 */
export async function fetchLatestListingAnalysis(listingId: string): Promise<ListingAnalysis | null> {
  const { data, error } = await supabase
    .from('listing_ai_analyses')
    .select('id, suggestion, image_paths')
    .eq('listing_id', listingId)
    .eq('status', 'succeeded')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const suggestion = parseAiSuggestion(data.suggestion);
  if (!suggestion) {
    logBadShape(data.suggestion);
    return null;
  }
  return { analysisId: data.id, imagePaths: data.image_paths, suggestion };
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;
}

/** A suggestion the app can't read is dropped whole; in development, say why. */
function logBadShape(value: unknown) {
  if (__DEV__) {
    const result = aiSuggestionSchema.safeParse(value);
    console.warn('[ai-suggestions] ignoring a suggestion with an unexpected shape', result.error?.issues);
  }
}
