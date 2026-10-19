import { supabase } from '@/lib/supabase';
import type { Enums } from '@/types/database';

/**
 * Client for ROADMAP 4.2's Edge Function (supabase/functions/suggest-listing/).
 *
 * Shape only -- wiring this into the sell flow UI is 4.3's job. This file
 * is a thin, direct passthrough: the Edge Function does every real check
 * (ownership, draft status, rate limiting, Anthropic call, output
 * validation) server-side. Nothing here duplicates that logic, and nothing
 * here ever sees `ANTHROPIC_API_KEY` -- it is read only inside the Edge
 * Function via `Deno.env.get` and never appears in any response body.
 */

export type ListingSuggestion = {
  title: string;
  description: string;
  condition: Enums<'listing_condition'>;
  categoryId: string | null;
  priceMinAmount: number;
  priceMaxAmount: number;
};

// Hand-duplicated from supabase/functions/suggest-listing/index.ts's own
// SuggestionBody/FailureReason/SuggestListingResponse types -- there is no
// mechanism in this repo for sharing types across the Deno/mobile boundary,
// so these two definitions have no single source of truth. If either side
// changes (a new FailureReason, a renamed field), update both by hand; a
// mismatch here would only surface at runtime, not at typecheck time, since
// `data` above is typed by the generic parameter, not inferred from the
// function's actual return.
export type SuggestListingResult =
  | { ok: true; suggestion: ListingSuggestion }
  | {
      ok: false;
      reason: 'not_found' | 'no_photos' | 'rate_limited' | 'ai_unavailable' | 'invalid_request';
      message: string;
      retryAfterSeconds?: number;
    };

/**
 * Requests AI-suggested listing fields from the draft's uploaded photos.
 *
 * A thrown/transport-level `error` (network failure, function not
 * deployed, etc.) is mapped to the same `ai_unavailable` shape the
 * function itself returns for its own expected AI failures, so callers
 * handle exactly one failure contract rather than two.
 */
export async function suggestListingFromPhotos(listingId: string): Promise<SuggestListingResult> {
  const { data, error } = await supabase.functions.invoke<SuggestListingResult>('suggest-listing', {
    body: { listingId },
  });
  if (error || !data) {
    return { ok: false, reason: 'ai_unavailable', message: "Couldn't get suggestions right now." };
  }
  return data;
}
