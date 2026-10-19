// ROADMAP 4.2 "Suggest-from-photos Edge Function".
//
// Invoked by the mobile client as:
//   supabase.functions.invoke('suggest-listing', { body: { listingId } })
// (the client wiring is 4.3's job -- this function is built to expect
// exactly that request shape regardless).
//
// Security model -- read this before changing anything below:
//
//   * This function builds its Supabase client from the CALLER'S OWN
//     `Authorization` header (their JWT) and the public anon key. The
//     `SUPABASE_SERVICE_ROLE_KEY` is never read, referenced, or used
//     anywhere in this function -- every read (the listing row,
//     listing_images, categories, Storage objects) goes through this
//     user-scoped client, so Postgres RLS and the existing Storage RLS
//     (supabase/migrations/20260914160000_listing_draft_scoped_rls_and_storage.sql)
//     do the ownership enforcement.
//   * `listings`' own SELECT RLS is broader than "owner only" -- it also
//     lets anyone read anyone else's ACTIVE listing. That means a crafted
//     listingId naming someone else's active listing still resolves as a
//     readable row. The explicit `seller_id === auth.uid()` AND
//     `status === 'draft'` check below is what actually closes that gap --
//     "the query returned a row" is not sufficient on its own.
//   * The ANTHROPIC_API_KEY secret is read only via `Deno.env.get` inside
//     this server-side function. It is never included in any response
//     body and never reaches the mobile client.
//   * Model output is untrusted too -- see parse.ts.
//
// Response contract: HTTP 200 for every EXPECTED failure (never a raw
// 500/stack trace); a non-200 is reserved for truly unexpected errors
// (caught once, at the very bottom, and logged server-side only).
// `not_found` deliberately collapses three distinct cases -- the listing
// doesn't exist, isn't the caller's, or isn't a draft -- into one identical
// reason+message. Distinguishing them would let a response reveal whether
// a given id names someone else's listing at all, which is exactly the
// enumeration surface this function must not open.
//
// File layout: this file is the HTTP entry point and orchestration only.
// categories.ts, photos.ts, anthropic.ts and parse.ts each own one
// concern. parse.ts and categories.ts's pure helpers have Deno test specs
// co-located (`*.test.ts`) -- index.ts/anthropic.ts/photos.ts do not,
// because they are not unit-testable without a mocking layer this repo
// doesn't have; they are verified manually instead (see the migration/
// deploy notes recorded alongside this change).

import { createClient } from 'npm:@supabase/supabase-js@2.112.4';

import { callSuggestionModel } from './anthropic.ts';
import { fetchCategoryPaths, type CategoriesReadClient, type CategoryPath } from './categories.ts';
import { downloadPhotoAsBase64, fetchListingPhotoPaths, type PhotosReadClient } from './photos.ts';
import { parseAndValidateSuggestion } from './parse.ts';

const LISTING_IMAGES_BUCKET = 'listing-images';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type SuggestionBody = {
  title: string;
  description: string;
  condition: string;
  categoryId: string | null;
  priceMinAmount: number;
  priceMaxAmount: number;
};

type FailureReason = 'not_found' | 'no_photos' | 'rate_limited' | 'ai_unavailable' | 'invalid_request';

type SuggestListingResponse =
  | { ok: true; suggestion: SuggestionBody }
  | { ok: false; reason: FailureReason; message: string; retryAfterSeconds?: number };

function jsonResponse(body: SuggestListingResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/** Every expected failure is HTTP 200 -- see the header note above. */
function fail(reason: FailureReason, message: string, retryAfterSeconds?: number): Response {
  return jsonResponse(
    retryAfterSeconds === undefined
      ? { ok: false, reason, message }
      : { ok: false, reason, message, retryAfterSeconds },
  );
}

/** A generic fixed cooldown, never derived from exact timestamps. */
const RATE_LIMIT_RETRY_AFTER_SECONDS = 3600;

type RecordAttemptResult = { allowed: boolean; remaining: number };

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return fail('invalid_request', 'Expected a POST request.');
  }

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return fail('invalid_request', 'Request body must be JSON.');
  }

  const listingId =
    typeof parsedBody === 'object' && parsedBody !== null
      ? (parsedBody as Record<string, unknown>).listingId
      : undefined;

  if (typeof listingId !== 'string' || !UUID_RE.test(listingId)) {
    return fail('invalid_request', 'listingId must be a UUID string.');
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    // No JWT at all -- cannot be anyone's draft. Collapsed into the same
    // not_found reason as every other "not this caller's draft" case.
    return fail('not_found', 'Listing not found.');
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    // Platform-provided, should always be set -- genuinely unexpected.
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY are not set in the function environment');
  }

  // The user's own JWT, forwarded as-is. NEVER the service role key -- see
  // the header note. `persistSession: false` because this client is
  // request-scoped and thrown away at the end of this invocation.
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData?.user) {
    return fail('not_found', 'Listing not found.');
  }
  const userId = authData.user.id;

  // ------------------------------------------------------------
  // Ownership + draft-status gate -- BEFORE anything else, including the
  // rate-limit RPC and definitely before any Anthropic call.
  // ------------------------------------------------------------
  const { data: listing, error: listingError } = await userClient
    .from('listings')
    .select('id, seller_id, status')
    .eq('id', listingId)
    .maybeSingle();

  if (listingError) {
    console.error('[suggest-listing] listing lookup failed', listingError);
    return fail('not_found', 'Listing not found.');
  }
  if (!listing || listing.seller_id !== userId || listing.status !== 'draft') {
    return fail('not_found', 'Listing not found.');
  }

  // ------------------------------------------------------------
  // Rate limit -- counted and enforced server-side via the SECURITY
  // DEFINER RPC (supabase/migrations/20261019113250_ai_suggestion_calls.sql),
  // never by a raw client write to the ledger table.
  // ------------------------------------------------------------
  const { data: rateLimitData, error: rateLimitError } = await userClient.rpc(
    'record_ai_suggestion_attempt',
    { p_listing_id: listingId },
  );
  if (rateLimitError) {
    // The RPC re-checks ownership/draft-status itself (42501 on failure).
    // Our own check above already passed, so reaching this branch means
    // something unexpected happened, not a legitimate denial.
    console.error('[suggest-listing] rate limit RPC failed', rateLimitError);
    return fail('ai_unavailable', "Couldn't get suggestions right now.");
  }
  const rateLimitResult = (Array.isArray(rateLimitData) ? rateLimitData[0] : rateLimitData) as
    | RecordAttemptResult
    | undefined;
  if (!rateLimitResult?.allowed) {
    return fail(
      'rate_limited',
      "You've reached today's AI suggestion limit. Try again later.",
      RATE_LIMIT_RETRY_AFTER_SECONDS,
    );
  }

  // ------------------------------------------------------------
  // Photos
  // ------------------------------------------------------------
  const photoPaths = await fetchListingPhotoPaths(userClient as unknown as PhotosReadClient, listingId);
  if (photoPaths.length === 0) {
    return fail('no_photos', 'Add at least one photo before requesting suggestions.');
  }

  let photosBase64: string[];
  try {
    photosBase64 = await Promise.all(
      photoPaths.map((path) =>
        downloadPhotoAsBase64(userClient as unknown as PhotosReadClient, LISTING_IMAGES_BUCKET, path),
      ),
    );
  } catch (error) {
    console.error('[suggest-listing] photo download failed', error);
    return fail('ai_unavailable', "Couldn't get suggestions right now.");
  }

  // ------------------------------------------------------------
  // Live category taxonomy (never hardcoded -- see categories.ts)
  // ------------------------------------------------------------
  let categoryPaths: CategoryPath[];
  try {
    categoryPaths = await fetchCategoryPaths(userClient as unknown as CategoriesReadClient);
  } catch (error) {
    console.error('[suggest-listing] category fetch failed', error);
    return fail('ai_unavailable', "Couldn't get suggestions right now.");
  }
  if (categoryPaths.length === 0) {
    console.error('[suggest-listing] no category leaves available to build the tool enum');
    return fail('ai_unavailable', "Couldn't get suggestions right now.");
  }

  // ------------------------------------------------------------
  // Anthropic call
  // ------------------------------------------------------------
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('[suggest-listing] ANTHROPIC_API_KEY is not set');
    return fail('ai_unavailable', "Couldn't get suggestions right now.");
  }

  let rawToolInput: unknown;
  try {
    rawToolInput = await callSuggestionModel(apiKey, photosBase64, categoryPaths);
  } catch (error) {
    console.error('[suggest-listing] Anthropic call failed', error);
    return fail('ai_unavailable', "Couldn't get suggestions right now.");
  }

  // ------------------------------------------------------------
  // Validate model output (untrusted, same as client input)
  // ------------------------------------------------------------
  try {
    const suggestion = parseAndValidateSuggestion(rawToolInput, categoryPaths);
    return jsonResponse({ ok: true, suggestion });
  } catch (error) {
    console.error('[suggest-listing] model output failed validation', error);
    return fail('ai_unavailable', "Couldn't get suggestions right now.");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  try {
    return await handleRequest(req);
  } catch (error) {
    // Truly unexpected -- never a raw stack trace in the body, logged
    // server-side only (visible via `supabase functions logs`).
    console.error('[suggest-listing] unexpected error', error);
    return new Response(JSON.stringify({ ok: false, reason: 'ai_unavailable', message: 'Unexpected server error.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
});
