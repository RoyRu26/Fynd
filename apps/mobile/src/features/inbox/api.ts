import { createListingImageUrls } from '@/features/listings/api';
import { supabase } from '@/lib/supabase';
import {
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
 *   * The other participant's avatar has no resolvable URL at all yet —
 *     `avatar_path` has no Storage bucket behind it in this phase (see the
 *     same note on seller/[id].tsx and listing/[id].tsx). The screen renders
 *     it as initials only.
 */

/**
 * One inbox page: the `inbox_conversations` RPC, then exactly one batched
 * signed-URL request covering every non-null listing cover in the page.
 * Never N+1 — a page of 20 conversations costs at most 2 network round
 * trips, not 21.
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

  const storagePaths = rows
    .map((row) => row.coverStoragePath)
    .filter((path): path is string => path !== null);
  const urlsByPath = await createListingImageUrls(storagePaths);
  return associateInboxCoverUrls(rows, urlsByPath);
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
 * The thread header for the stub `[id].tsx` screen: who, about what, and
 * what state that listing is in.
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
  return row ? normalizeConversationHeader(row) : null;
}
