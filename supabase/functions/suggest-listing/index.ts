// ROADMAP 4.2 "Suggest-from-photos Edge Function", upgraded in the AI
// listing metadata plan, Phase 2.
//
// Invoked by the mobile client as:
//   supabase.functions.invoke('suggest-listing', { body: { listingId } })
// The listing id is the ONLY input. Which images are analyzed (the listing's
// first 4, cover first), the seller text and the category hint are all read
// server-side from the caller's own draft — never accepted from the client —
// so no arbitrary storage path, URL or other user's photo can be analyzed.
//
// Security model — read this before changing anything below:
//
//   * The Supabase client is built from the CALLER'S OWN `Authorization`
//     header and the anon key. The service role key is never read or used:
//     every read (listing, images, taxonomy, brands, cached analyses,
//     Storage objects) goes through Postgres RLS / Storage RLS as the user,
//     and every write goes through SECURITY DEFINER RPCs that re-check
//     ownership themselves (record_ai_suggestion_attempt,
//     record_listing_ai_analysis).
//   * `listings` SELECT RLS also exposes other sellers' ACTIVE listings, so
//     the explicit `seller_id === auth user` AND `status === 'draft'` check
//     below is what actually closes that gap. Every "not your draft" case
//     (missing, someone else's, not a draft, no JWT) collapses into one
//     identical `not_found` response, so the endpoint can't be used to learn
//     whether a listing id exists.
//   * ANTHROPIC_API_KEY is read only here via Deno.env.get, and never appears
//     in any response or record.
//   * Model output is untrusted — see parse.ts. Only validated, normalized
//     output is stored or returned.
//
// Flow: gate -> photos -> runtime taxonomy -> manifest + cache key -> cache
// hit? return it (no model call, no quota) -> quota (per user AND per
// listing) -> download photos -> model (25 s deadline, one retry on
// overload) -> partial parse -> brand resolution -> record -> respond.
// Failures after the quota is charged are recorded as failed/invalid
// analyses for debugging and evaluation.
//
// Response contract: HTTP 200 for every EXPECTED failure (never a raw
// 500/stack trace); a non-200 is reserved for truly unexpected errors.
//
// File layout: this file is orchestration only. taxonomy.ts, manifest.ts,
// anthropic.ts, parse.ts, photos.ts, brands.ts and categories.ts each own
// one concern; the pure ones have Deno tests (`*.test.ts`).

import { createClient } from 'npm:@supabase/supabase-js@2.112.4';

import {
  buildPrompt,
  buildSuggestionTool,
  callSuggestionModel,
  ModelCallError,
  SUGGESTION_MODEL,
} from './anthropic.ts';
import { resolveBrandText, type BrandsReadClient } from './brands.ts';
import {
  analysisInputHash,
  buildManifest,
  metadataSchemaVersion,
  normalizeSellerText,
  PROMPT_VERSION,
} from './manifest.ts';
import { isValidStoredSuggestion, parseSuggestion, type ParsedSuggestion } from './parse.ts';
import { downloadPhotoAsBase64, fetchListingPhotos, type PhotosReadClient } from './photos.ts';
import { fetchTaxonomy, type Taxonomy, type TaxonomyReadClient } from './taxonomy.ts';

const LISTING_IMAGES_BUCKET = 'listing-images';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** What is returned and stored: the parsed suggestion with the brand resolved against the catalog. */
type StoredSuggestion = Omit<ParsedSuggestion, 'brand'> & {
  brand: {
    /** The catalog brand when the text exactly matches an active alias, else null (keep as text). */
    brandId: string | null;
    name: string;
    confidence: number;
    evidence: NonNullable<ParsedSuggestion['brand']>['evidence'];
  } | null;
};

type FailureReason = 'not_found' | 'no_photos' | 'rate_limited' | 'ai_unavailable' | 'invalid_request';

type SuggestListingResponse =
  | {
      ok: true;
      analysisId: string | null;
      cached: boolean;
      /** The analyzed photos, so the client can tell which photo set a suggestion describes. */
      imagePaths: string[];
      suggestion: StoredSuggestion;
    }
  | { ok: false; reason: FailureReason; message: string; retryAfterSeconds?: number };

function jsonResponse(body: SuggestListingResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/** Every expected failure is HTTP 200 — see the header note. */
function fail(reason: FailureReason, message: string, retryAfterSeconds?: number): Response {
  return jsonResponse(
    retryAfterSeconds === undefined ? { ok: false, reason, message } : { ok: false, reason, message, retryAfterSeconds },
  );
}

const UNAVAILABLE = "Couldn't analyze your photos right now. You can fill in the details yourself.";
/** A generic fixed cooldown, never derived from exact timestamps. */
const RATE_LIMIT_RETRY_AFTER_SECONDS = 3600;

/**
 * The taxonomy is the same for every caller (authenticated-SELECT reference
 * data, changed only by migrations), so one read per warm worker per minute
 * is enough — this keeps the work done before the quota check small even if
 * a client calls in a tight loop. A taxonomy change still reaches the model
 * within a minute, and the manifest hash keeps the cache correct meanwhile.
 */
const TAXONOMY_TTL_MS = 60_000;
let taxonomyCache: { taxonomy: Taxonomy; fetchedAt: number } | null = null;

async function getTaxonomy(client: TaxonomyReadClient): Promise<Taxonomy> {
  if (taxonomyCache && Date.now() - taxonomyCache.fetchedAt < TAXONOMY_TTL_MS) return taxonomyCache.taxonomy;
  const taxonomy = await fetchTaxonomy(client);
  taxonomyCache = { taxonomy, fetchedAt: Date.now() };
  return taxonomy;
}

type AttemptResult = { allowed: boolean; remaining: number; limited_by: 'user' | 'listing' | null };

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

type AnalysisRecord = {
  status: 'succeeded' | 'failed' | 'invalid';
  failureReason: string | null;
  validationIssues: string[];
  suggestion: StoredSuggestion | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
};

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
    typeof parsedBody === 'object' && parsedBody !== null ? (parsedBody as Record<string, unknown>).listingId : undefined;
  if (typeof listingId !== 'string' || !UUID_RE.test(listingId)) {
    return fail('invalid_request', 'listingId must be a UUID string.');
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return fail('not_found', 'Listing not found.');
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY are not set in the function environment');
  }

  // The user's own JWT, forwarded as-is. NEVER the service role key.
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
  // Ownership + draft gate, before anything else.
  // ------------------------------------------------------------
  const { data: listing, error: listingError } = await userClient
    .from('listings')
    .select('id, seller_id, status, title, description, category_id')
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
  // The images to analyze: this listing's first 4, cover first.
  // ------------------------------------------------------------
  let photos: { imageId: string; storagePath: string; position: number }[];
  try {
    photos = await fetchListingPhotos(userClient as unknown as PhotosReadClient, listingId);
  } catch (error) {
    console.error('[suggest-listing] photo lookup failed');
    return fail('ai_unavailable', UNAVAILABLE);
  }
  if (photos.length === 0) {
    return fail('no_photos', 'Add at least one photo to get suggestions.');
  }

  // ------------------------------------------------------------
  // Runtime taxonomy -> manifest -> cache identity
  // ------------------------------------------------------------
  let taxonomy;
  try {
    taxonomy = await getTaxonomy(userClient as unknown as TaxonomyReadClient);
  } catch (error) {
    console.error('[suggest-listing] taxonomy fetch failed', error instanceof Error ? error.message : 'unknown');
    return fail('ai_unavailable', UNAVAILABLE);
  }
  if (taxonomy.categoryPaths.length === 0) {
    console.error('[suggest-listing] no category leaves available');
    return fail('ai_unavailable', UNAVAILABLE);
  }

  // A hint is only meaningful if it is a real leaf; anything else is ignored.
  const categoryHintId =
    listing.category_id && taxonomy.categoryPaths.some((entry) => entry.categoryId === listing.category_id)
      ? (listing.category_id as string)
      : null;
  const sellerTitle = normalizeSellerText(listing.title as string | null);
  const sellerDescription = normalizeSellerText(listing.description as string | null);

  const manifest = buildManifest(taxonomy, categoryHintId);
  const schemaVersion = await metadataSchemaVersion(manifest);
  const inputHash = await analysisInputHash({
    model: SUGGESTION_MODEL,
    promptVersion: PROMPT_VERSION,
    metadataSchemaVersion: schemaVersion,
    images: photos,
    title: sellerTitle,
    description: sellerDescription,
    categoryHintId,
  });
  const imagePaths = photos.map((photo) => photo.storagePath);

  // ------------------------------------------------------------
  // Cache: an identical succeeded analysis is returned as-is — no model
  // call, and checked BEFORE the quota so it costs nothing.
  // ------------------------------------------------------------
  const { data: cached, error: cacheError } = await userClient
    .from('listing_ai_analyses')
    .select('id, suggestion')
    .eq('listing_id', listingId)
    .eq('analysis_input_hash', inputHash)
    .eq('status', 'succeeded')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cacheError) {
    // Not fatal: fall through to a fresh analysis.
    console.error('[suggest-listing] cache lookup failed', cacheError);
  } else if (cached && isValidStoredSuggestion(cached.suggestion, manifest)) {
    // Only a row that still has exactly this function's output shape, with
    // every id present in the current manifest, is served. Anything else
    // (e.g. a row someone wrote through the RPC directly) is a cache miss.
    return jsonResponse({
      ok: true,
      analysisId: cached.id as string,
      cached: true,
      imagePaths,
      suggestion: cached.suggestion as StoredSuggestion,
    });
  }

  // Checked before the quota, so a misconfigured deployment never charges it.
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('[suggest-listing] ANTHROPIC_API_KEY is not set');
    return fail('ai_unavailable', UNAVAILABLE);
  }

  // ------------------------------------------------------------
  // Quota: 20 per user and 3 per listing per rolling 24h, server-side.
  // ------------------------------------------------------------
  const { data: attemptData, error: attemptError } = await (userClient as unknown as RpcClient).rpc(
    'record_ai_suggestion_attempt',
    { p_listing_id: listingId },
  );
  if (attemptError) {
    console.error('[suggest-listing] rate limit RPC failed', attemptError);
    return fail('ai_unavailable', UNAVAILABLE);
  }
  const attempt = (Array.isArray(attemptData) ? attemptData[0] : attemptData) as AttemptResult | undefined;
  if (!attempt?.allowed) {
    return fail(
      'rate_limited',
      attempt?.limited_by === 'listing'
        ? 'This draft has been analyzed several times today. You can still fill in the details yourself.'
        : "You've reached today's AI suggestion limit. You can still fill in the details yourself.",
      RATE_LIMIT_RETRY_AFTER_SECONDS,
    );
  }

  const record = (analysis: AnalysisRecord) =>
    recordAnalysis(userClient as unknown as RpcClient, {
      listingId,
      schemaVersion,
      inputHash,
      imagePaths,
      analysis,
    });

  // ------------------------------------------------------------
  // Photos -> model
  // ------------------------------------------------------------
  let photosBase64: string[];
  try {
    photosBase64 = await Promise.all(
      imagePaths.map((path) =>
        downloadPhotoAsBase64(userClient as unknown as PhotosReadClient, LISTING_IMAGES_BUCKET, path),
      ),
    );
  } catch (error) {
    console.error('[suggest-listing] photo download failed');
    await record(failure('failed', 'photos_unavailable'));
    return fail('ai_unavailable', UNAVAILABLE);
  }

  const categoryHintPath = categoryHintId
    ? (manifest.categories.find((entry) => entry.id === categoryHintId)?.path ?? null)
    : null;
  const tool = buildSuggestionTool(manifest);
  const prompt = buildPrompt({ title: sellerTitle, description: sellerDescription, categoryPath: categoryHintPath });

  const started = Date.now();
  let modelResult;
  try {
    modelResult = await callSuggestionModel(apiKey, photosBase64, tool, prompt);
  } catch (error) {
    const reason = error instanceof ModelCallError ? error.reason : 'provider_error';
    // Reason code only: provider error messages can echo request details.
    console.error('[suggest-listing] model call failed', reason);
    await record({ ...failure('failed', reason), latencyMs: Date.now() - started });
    return fail('ai_unavailable', UNAVAILABLE);
  }
  const latencyMs = Date.now() - started;

  // ------------------------------------------------------------
  // Partial parse: invalid fields are dropped, valid ones kept.
  // ------------------------------------------------------------
  const parsed = parseSuggestion(modelResult.input, { manifest, taxonomy, categoryHintId });
  const usage = { inputTokens: modelResult.usage.inputTokens, outputTokens: modelResult.usage.outputTokens };
  if (parsed.usableFieldCount === 0) {
    console.error('[suggest-listing] model output had no usable fields', parsed.issues.join(','));
    await record({
      ...failure('invalid', 'no_valid_fields'),
      validationIssues: parsed.issues,
      ...usage,
      latencyMs,
    });
    return fail('ai_unavailable', UNAVAILABLE);
  }

  const resolvedBrand = parsed.suggestion.brand
    ? await resolveBrandText(userClient as unknown as BrandsReadClient, parsed.suggestion.brand.text)
    : null;
  const suggestion: StoredSuggestion = {
    ...parsed.suggestion,
    brand: parsed.suggestion.brand
      ? {
          brandId: resolvedBrand?.brandId ?? null,
          // A catalog brand is shown by its canonical name.
          name: resolvedBrand?.name ?? parsed.suggestion.brand.text,
          confidence: parsed.suggestion.brand.confidence,
          evidence: parsed.suggestion.brand.evidence,
        }
      : null,
  };

  const analysisId = await record({
    status: 'succeeded',
    failureReason: null,
    validationIssues: parsed.issues,
    suggestion,
    ...usage,
    latencyMs,
  });

  return jsonResponse({ ok: true, analysisId, cached: false, imagePaths, suggestion });
}

function failure(status: 'failed' | 'invalid', reason: string): AnalysisRecord {
  return {
    status,
    failureReason: reason,
    validationIssues: [],
    suggestion: null,
    inputTokens: null,
    outputTokens: null,
    latencyMs: null,
  };
}

/** Records an analysis through the SECURITY DEFINER RPC. Never fatal: returns null if it fails. */
async function recordAnalysis(
  client: RpcClient,
  args: { listingId: string; schemaVersion: string; inputHash: string; imagePaths: string[]; analysis: AnalysisRecord },
): Promise<string | null> {
  const { data, error } = await client.rpc('record_listing_ai_analysis', {
    p_listing_id: args.listingId,
    p_status: args.analysis.status,
    p_failure_reason: args.analysis.failureReason,
    p_validation_issues: args.analysis.validationIssues,
    p_model: SUGGESTION_MODEL,
    p_prompt_version: PROMPT_VERSION,
    p_metadata_schema_version: args.schemaVersion,
    p_analysis_input_hash: args.inputHash,
    p_image_paths: args.imagePaths,
    p_suggestion: args.analysis.suggestion,
    p_input_tokens: args.analysis.inputTokens,
    p_output_tokens: args.analysis.outputTokens,
    p_latency_ms: args.analysis.latencyMs,
  });
  if (error) {
    console.error('[suggest-listing] could not record analysis', error);
    return null;
  }
  return typeof data === 'string' ? data : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  try {
    return await handleRequest(req);
  } catch (error) {
    // Truly unexpected — never a raw stack trace in the body.
    console.error('[suggest-listing] unexpected error', error);
    return new Response(JSON.stringify({ ok: false, reason: 'ai_unavailable', message: 'Unexpected server error.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
});
