import { supabase } from '@/lib/supabase';

/**
 * Records one impression via `record_listing_impression`.
 *
 * Never writes `listing_events` directly — the client holds no INSERT
 * privilege on that table at all. Never sends a user id: the RPC derives
 * the caller from `auth.uid()` internally, so this wrapper cannot even be
 * called in a way that asserts whose impression it is. Never sends a
 * timestamp: `created_at` is server-controlled.
 *
 * Deduplication is the RPC's job (a partial unique index made a no-op by
 * `ON CONFLICT DO NOTHING`), so a repeated call for the same
 * (listing, session) is a harmless, cheap no-op rather than an error this
 * wrapper needs to handle. Client-side dedupe (impressions.ts) exists only
 * to avoid making that redundant call in the first place — it is an
 * optimization, not the source of truth.
 *
 * Throws on failure rather than swallowing anything: the caller (Phase 3's
 * impression tracker) is what decides a failed send stays retryable, and it
 * needs the rejection to do that.
 */
export async function recordListingImpression(params: {
  listingId: string;
  sessionId: string;
  feedPosition: number;
}): Promise<void> {
  const { error } = await supabase.rpc('record_listing_impression', {
    p_listing_id: params.listingId,
    p_session_id: params.sessionId,
    p_feed_position: params.feedPosition,
  });
  if (error) throw error;
}
