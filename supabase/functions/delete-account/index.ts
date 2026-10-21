// ROADMAP 6.1b "Settings: account deletion" -- the SECOND Edge Function
// this repo has ever had, and the FIRST to legitimately need
// `SUPABASE_SERVICE_ROLE_KEY`.
//
// Invoked by the mobile client as:
//   supabase.functions.invoke('delete-account', { body: {} })
// (empty body -- it always acts on the CALLER'S OWN id, resolved from their
// JWT; there is no client-supplied target anywhere in this function).
//
// Read suggest-listing/index.ts first -- this function follows its exact
// CORS/response/auth shape (every expected failure is HTTP 200 with
// `{ ok: false, reason, message }`; only a truly unexpected error is a raw
// 500). The one deliberate departure is the service role key, explained
// next.
//
// ============================================================
// Why this function -- alone, among every Edge Function in this repo --
// needs SUPABASE_SERVICE_ROLE_KEY
// ============================================================
// Deleting a row from `auth.users` is only possible through the Admin API
// (`adminClient.auth.admin.deleteUser`), which requires the service role
// key -- there is no RLS-scoped, user-JWT path to it, by design (a regular
// user must never be able to delete an arbitrary `auth.users` row,
// including arguably their own, through an ordinary authenticated
// request). `suggest-listing` never reads this secret at all (see its own
// header); this function is the first that has a genuine reason to.
//
// The key is read exactly ONCE (`Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`,
// step 6 below), used for exactly ONE call (`adminClient.auth.admin.
// deleteUser`, step 7), and is NEVER included in any response body or log
// line -- every `console.error` call below logs an error object or a plain
// string, never the key itself or the client that holds it. The mobile
// client never sees it: it stays entirely server-side inside this
// function's own process, exactly like `ANTHROPIC_API_KEY` already does for
// `suggest-listing` (CLAUDE.md: "never expose server secrets to the mobile
// app"). Every OTHER read in this function (steps 3-5) deliberately goes
// through `userClient` -- the caller's own JWT -- so RLS and Storage policy
// do the ownership enforcement right up until the one step that genuinely
// cannot be done any other way.
//
// ============================================================
// Why this exact order of operations
// ============================================================
// Storage cleanup (step 3-5) must happen BEFORE the `auth.users` row is
// deleted (step 7), because it needs the caller's own still-valid,
// RLS-scoped JWT -- `userClient.auth.getUser()` and every Storage policy
// this function relies on (`listing-images`'/`avatars`' own DELETE
// policies, 20260914160000/20261014112232) authorize against a live
// session for an account that still exists. Once `auth.users` is gone,
// that JWT's underlying session is gone with it, so this must run first or
// not at all.
//
// request_account_deletion() (step 4) must run BEFORE the Storage object
// removal (step 5), because it is what actually deletes the caller's draft
// listings -- the storage objects this function cleans up are about to
// become (or, for drafts, already have become) orphans of THAT delete, and
// the whole point of step 3's enumeration is to capture them first. It must
// also run BEFORE the `auth.users` deletion (step 7): if it fails, this
// function aborts WITHOUT deleting the auth user, so the account is left
// fully intact and the caller can simply retry -- never a half-deleted
// account from this step's own failure.
//
// request_account_deletion() is idempotent (see its own migration header),
// which is what makes this function safe to retry wholesale: if step 7 (the
// Admin API call) fails, the account is left partially anonymized (drafts
// gone, active/reserved listings removed) but NOT deleted -- a safe,
// resumable state, not data loss, since calling this function again simply
// re-runs an RPC that is a no-op for the parts already done and finishes
// the job.

import { createClient } from 'npm:@supabase/supabase-js@2.112.4';

const LISTING_IMAGES_BUCKET = 'listing-images';
const AVATARS_BUCKET = 'avatars';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type FailureReason = 'unauthorized' | 'invalid_request' | 'deletion_failed';

type DeleteAccountResponse = { ok: true } | { ok: false; reason: FailureReason; message: string };

function jsonResponse(body: DeleteAccountResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/** Every expected failure is HTTP 200 -- see the header note above. */
function fail(reason: FailureReason, message: string): Response {
  return jsonResponse({ ok: false, reason, message });
}

type StorageListClient = {
  storage: {
    from: (bucket: string) => {
      list: (
        path: string,
      ) => Promise<{ data: { name: string }[] | null; error: { message: string } | null }>;
      remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
    };
  };
};

/**
 * Lists every object directly under `{bucket}/{prefix}/`, returning their
 * full storage paths. Best-effort at the CALLER: a listing failure here is
 * caught by the caller and treated as "nothing found to clean up", never as
 * a reason to abort the whole deletion -- the same "don't block a deletion
 * on failing to enumerate its own photos" principle
 * `features/listings/api.ts`'s `deleteDraft` established, though the
 * mechanism differs: that function reads exact paths from
 * `listing_images.storage_path`, this one lists the bucket prefix directly
 * (unpaginated -- `.list()` defaults to 100 items, a real limit this
 * function does not handle, acceptable for a best-effort cleanup step).
 */
async function listObjectPaths(client: StorageListClient, bucket: string, prefix: string): Promise<string[]> {
  const { data, error } = await client.storage.from(bucket).list(prefix);
  if (error) {
    throw new Error(`Failed to list ${bucket}/${prefix}: ${error.message}`);
  }
  return (data ?? []).map((object) => `${prefix}/${object.name}`);
}

async function handleRequest(req: Request): Promise<Response> {
  // ------------------------------------------------------------
  // 1. Reject non-POST.
  // ------------------------------------------------------------
  if (req.method !== 'POST') {
    return fail('invalid_request', 'Expected a POST request.');
  }

  // ------------------------------------------------------------
  // 2. Resolve the caller from their own JWT. Never a client-supplied id.
  // ------------------------------------------------------------
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return fail('unauthorized', 'Authentication required.');
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    // Platform-provided, should always be set -- genuinely unexpected.
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY are not set in the function environment');
  }

  // The user's own JWT, forwarded as-is. `persistSession: false` because
  // this client is request-scoped and thrown away at the end of this
  // invocation -- same shape as suggest-listing's own userClient.
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData?.user) {
    return fail('unauthorized', 'Authentication required.');
  }
  const userId = authData.user.id;

  // ------------------------------------------------------------
  // 3. Storage cleanup targets, collected with the CALLER's own JWT, BEFORE
  // request_account_deletion() runs and BEFORE auth.users is deleted --
  // see the header note above for why this ordering is load-bearing.
  // ------------------------------------------------------------
  const storageTargets: { bucket: string; paths: string[] }[] = [];

  // Avatars: path convention `{user_id}/{image_id}.jpg`
  // (20261014112232_profile_bio_and_avatars.sql) -- one flat prefix, no
  // listing to look up first.
  try {
    const avatarPaths = await listObjectPaths(userClient, AVATARS_BUCKET, userId);
    if (avatarPaths.length > 0) {
      storageTargets.push({ bucket: AVATARS_BUCKET, paths: avatarPaths });
    }
  } catch (error) {
    console.error('[delete-account] could not list avatar objects', error);
  }

  // Draft listings' photos: path convention `{seller_id}/{listing_id}/{image}.jpg`
  // (20260914160000_listing_draft_scoped_rls_and_storage.sql). Only DRAFT
  // listings -- request_account_deletion() hard-deletes exactly those, so
  // these are the only listing-images objects about to become orphans of
  // THIS call. Active/reserved listings are merely set to `removed` by that
  // RPC, keeping their photos exactly as they were.
  try {
    const { data: draftListings, error: draftError } = await userClient
      .from('listings')
      .select('id')
      .eq('seller_id', userId)
      .eq('status', 'draft');
    if (draftError) {
      throw new Error(`Failed to list draft listings: ${draftError.message}`);
    }
    for (const draft of draftListings ?? []) {
      try {
        const paths = await listObjectPaths(userClient, LISTING_IMAGES_BUCKET, `${userId}/${draft.id}`);
        if (paths.length > 0) {
          storageTargets.push({ bucket: LISTING_IMAGES_BUCKET, paths });
        }
      } catch (error) {
        console.error(`[delete-account] could not list photos for draft ${draft.id}`, error);
      }
    }
  } catch (error) {
    console.error('[delete-account] could not enumerate draft listings for storage cleanup', error);
  }

  // ------------------------------------------------------------
  // 4. request_account_deletion() -- the real, server-controlled deletion
  // logic (draft hard-delete, active/reserved -> removed, sold untouched).
  // On failure: abort WITHOUT touching auth.users, so the account stays
  // fully intact and retry-safe.
  // ------------------------------------------------------------
  const { error: rpcError } = await userClient.rpc('request_account_deletion');
  if (rpcError) {
    console.error('[delete-account] request_account_deletion failed', rpcError);
    return fail('deletion_failed', "Couldn't delete your account right now. Please try again.");
  }

  // ------------------------------------------------------------
  // 5. Remove the Storage objects collected in step 3. Best-effort: a
  // failure here is logged, never thrown -- the database side of the
  // deletion already succeeded, which is the part that matters, and an
  // orphaned object is invisible to the app and remains removable later
  // through the same Storage DELETE policies' orphan branches (see
  // features/listings/api.ts's `removeStorageObjects` for the identical
  // convention this mirrors).
  // ------------------------------------------------------------
  for (const target of storageTargets) {
    const { error: removeError } = await userClient.storage.from(target.bucket).remove(target.paths);
    if (removeError) {
      console.error(`[delete-account] best-effort storage cleanup failed for ${target.bucket}`, removeError);
    }
  }

  // ------------------------------------------------------------
  // 6. The service role key -- read once, used once, for exactly the one
  // call that genuinely needs it. See the header note above.
  // ------------------------------------------------------------
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) {
    // Platform-provided, should always be set -- genuinely unexpected. The
    // account is already anonymized (step 4 succeeded) but not deleted,
    // which is the same safe, retry-able state a deleteUser failure below
    // would leave it in.
    console.error('[delete-account] SUPABASE_SERVICE_ROLE_KEY is not set');
    return fail('deletion_failed', "Couldn't delete your account right now. Please try again.");
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ------------------------------------------------------------
  // 7. The actual auth.users deletion. This is what fires the BEFORE DELETE
  // reassignment trigger (reassign_departing_user_rows,
  // 20261021065243_account_deletion_sentinel_and_reassignment.sql) and,
  // immediately after, Postgres's own CASCADE machinery.
  // ------------------------------------------------------------
  const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteUserError) {
    // The account is partially anonymized at this point (drafts gone,
    // active/reserved listings removed) but not deleted -- safe to retry
    // (request_account_deletion is idempotent), not data loss.
    console.error('[delete-account] admin deleteUser failed', deleteUserError);
    return fail('deletion_failed', "Couldn't delete your account right now. Please try again.");
  }

  // ------------------------------------------------------------
  // 8. Success.
  // ------------------------------------------------------------
  return jsonResponse({ ok: true });
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
    console.error('[delete-account] unexpected error', error);
    return new Response(
      JSON.stringify({ ok: false, reason: 'deletion_failed', message: 'Unexpected server error.' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
    );
  }
});
