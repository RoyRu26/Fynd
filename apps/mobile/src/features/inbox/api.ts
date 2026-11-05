import { createListingImageUrls } from '@/features/listings/api';
import { createAvatarUrls } from '@/features/profile/api';
import { supabase } from '@/lib/supabase';
import {
  associateConversationHeaderUrls,
  associateInboxAvatarUrls,
  associateInboxCoverUrls,
  normalizeConversationHeader,
  normalizeInboxRow,
  type ConversationHeader,
  type InboxCursor,
  type InboxConversation,
} from '@/features/inbox/inbox';

export type {
  ConversationHeader,
  InboxCursor,
  InboxConversation,
} from '@/features/inbox/inbox';

/**
 * Database access for the Inbox.
 *
 * The privilege model this layer respects, enforced server-side:
 *
 *   * `inbox_conversations`, `conversation_detail`, and
 *     `mark_conversation_read` are all `SECURITY DEFINER` — see the read
 *     RPCs' own migration comment for why a `feed_listings`-style INVOKER
 *     function cannot work here (a sold/removed listing's thread must still
 *     render for the buyer, even though RLS would now hide that listing row
 *     from them).
 *   * Listing covers come back as a `storage_path`, never a public URL —
 *     same private-bucket signing requirement as the feed and seller
 *     profile. Unlike those, a conversation's cover is allowed to be
 *     missing (see `associateInboxCoverUrls`), since the underlying listing
 *     can legitimately have been deleted.
 *   * The other participant's avatar resolves through the same private
 *     `avatars` bucket as every other screen (seller profile, listing
 *     detail, feed) — a batched signed-URL request alongside the listing
 *     cover's, never a second avatar-specific round trip per row.
 */

/**
 * One inbox page: the `inbox_conversations` RPC, then exactly one batched
 * signed-URL request per bucket covering every non-null listing cover and
 * every non-null avatar path in the page. Never N+1 — a page of 20
 * conversations costs at most 3 network round trips, not 21.
 */
export async function fetchInboxPage(params: {
  limit: number;
  cursor: InboxCursor;
}): Promise<InboxConversation[]> {
  const { limit, cursor } = params;

  const { data, error } = await supabase.rpc('inbox_conversations', {
    p_limit: limit,
    p_cursor_last_message_at: cursor?.lastMessageAt,
    p_cursor_id: cursor?.id,
  });
  if (error) throw error;

  const rows = data.map(normalizeInboxRow);
  if (rows.length === 0) {
    return [];
  }

  const coverPaths = rows
    .map((row) => row.coverStoragePath)
    .filter((path): path is string => path !== null);
  // Deduped: many rows can share the same other participant (and therefore
  // the same avatar path), so signing the same path twice would be wasted
  // work, not a correctness issue.
  const avatarPaths = Array.from(
    new Set(rows.map((row) => row.otherAvatarPath).filter((path): path is string => path !== null)),
  );

  const [coverUrlsByPath, avatarUrlsByPath] = await Promise.all([
    createListingImageUrls(coverPaths),
    createAvatarUrls(avatarPaths),
  ]);

  const withCovers = associateInboxCoverUrls(rows, coverUrlsByPath);
  return associateInboxAvatarUrls(withCovers, avatarUrlsByPath);
}

/**
 * Marks a conversation read up to `upTo` (defaulting server-side to now,
 * clamped so a client can never mark the future as read). The sole writer
 * of the per-side read timestamps — no client holds an UPDATE grant on
 * `conversations` at all.
 */
export async function markConversationRead(params: {
  conversationId: string;
  upTo?: string;
}): Promise<void> {
  const { conversationId, upTo } = params;
  const { error } = await supabase.rpc('mark_conversation_read', {
    p_conversation_id: conversationId,
    p_up_to: upTo,
  });
  if (error) throw error;
}

/**
 * The thread header for `[id].tsx`: who, about what, what state that
 * listing is in, and — for the pinned listing strip (SCREENS.md Task 6) —
 * its cover photo and price.
 *
 * `conversation_detail` never actually returns zero rows for "no such
 * conversation" or "not yours" — for both cases it `raise exception ...
 * using errcode = 'P0002'` before `return query` ever runs (see its
 * migration comment: the two are deliberately indistinguishable, raised
 * from one combined branch rather than two). So in practice this function
 * either resolves to exactly one row or the call throws, which the caller
 * sees as `error` above and `mapInboxError` turns into a message.
 *
 * The `null` return below is a defensive fallback only, kept in case a
 * future version of the RPC starts returning an empty result set instead
 * of throwing — it is not exercised by the current RPC contract and should
 * not be read as the real not-found UX.
 */
export async function fetchConversationDetail(
  conversationId: string,
): Promise<ConversationHeader | null> {
  const { data, error } = await supabase.rpc('conversation_detail', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  const row = data[0];
  if (!row) {
    return null;
  }

  const normalized = normalizeConversationHeader(row);
  const [avatarUrlsByPath, coverUrlsByPath] = await Promise.all([
    createAvatarUrls(normalized.otherAvatarPath ? [normalized.otherAvatarPath] : []),
    createListingImageUrls(normalized.coverStoragePath ? [normalized.coverStoragePath] : []),
  ]);
  return associateConversationHeaderUrls(normalized, avatarUrlsByPath, coverUrlsByPath);
}

/**
 * Resumes the caller's existing conversation about this listing, or starts
 * one — race-safe server-side via `conversations_listing_buyer_key` (see the
 * RPC's own migration comment: unique-index arbitration, resume-first then
 * gate-on-active, `on conflict do nothing` plus a re-select on a lost race).
 * Tapping "Message seller" twice, or twice from two devices, can never
 * create two threads.
 *
 * Returns a bare conversation id, not a row — same reasoning as
 * `markConversationRead`'s RPC returning `void`: the only thing the caller
 * does with the result is navigate.
 */
export async function startOrResumeConversation(listingId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_or_create_listing_conversation', {
    p_listing_id: listingId,
  });
  if (error) throw error;
  return data;
}
