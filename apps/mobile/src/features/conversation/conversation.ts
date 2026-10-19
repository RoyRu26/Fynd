import type { Database } from '@/types/database';

/**
 * Pure conversation-thread logic: RPC-row normalization, message-body
 * validation, and the client nonce used for idempotent sends.
 *
 * No react-native import of any kind — not even transitively through
 * `@/lib/supabase` — for the same reason `features/inbox/inbox.ts` and
 * `features/feed/pagination.ts` are split this way: it is what makes this
 * module directly unit-testable.
 */

export type MessageCursor = { createdAt: string; id: string } | null;

/**
 * The raw `messages` table row, as returned by a direct `.insert().select()`
 * (api.ts's `sendMessage`, including its `23505`-retry refetch).
 */
export type MessageRow = Database['public']['Tables']['messages']['Row'];

/**
 * The generated `conversation_messages` RPC row shape (api.ts's
 * `fetchMessagePage`), aliased for readability. Structurally identical to
 * `MessageRow` — same six columns, same types — because the RPC's `returns
 * table` clause mirrors the base table exactly rather than projecting
 * through any `left join`. `normalizeMessageRow` below accepts either.
 */
export type MessageRpcRow =
  Database['public']['Functions']['conversation_messages']['Returns'][number];

/**
 * A message that has landed in the database — either fetched through
 * history, or arrived via `useSendMessage`'s own success, or delivered by
 * the Realtime subscription.
 */
export type ConfirmedMessage = {
  kind: 'confirmed';
  id: string;
  clientNonce: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
};

/**
 * Row -> domain normalization.
 *
 * Unlike `normalizeInboxRow`, this needs no nullability correction:
 * `messages`' generated `Row` type has no nullable column at all (every one
 * of `id`, `conversation_id`, `sender_id`, `body`, `client_nonce`,
 * `created_at` carries a `not null` constraint — see the table's own
 * migration), and `conversation_messages`'s generated `Returns` shape
 * mirrors that directly rather than going through a `left join` the way the
 * inbox RPCs do. Verified against the live generated type, not assumed.
 */
export function normalizeMessageRow(row: MessageRow): ConfirmedMessage {
  return {
    kind: 'confirmed',
    id: row.id,
    clientNonce: row.client_nonce,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

/**
 * The next page's cursor, or `null` when there is no next page.
 *
 * Same "a short page means exhausted" rule as `deriveNextInboxCursor` /
 * `deriveNextCursor`: a page shorter than what was requested is the signal
 * that history is exhausted, so pagination stops here rather than spending
 * a request to find that out. Derived from the LAST row of the page just
 * fetched, matching `conversation_messages`'s `(created_at, id) DESC`
 * ordering exactly.
 */
export function deriveNextMessageCursor(
  page: Pick<ConfirmedMessage, 'createdAt' | 'id'>[],
  pageSize: number,
): MessageCursor {
  if (page.length < pageSize) {
    return null;
  }
  const last = page[page.length - 1];
  return { createdAt: last.createdAt, id: last.id };
}

// ============================================================
// client_nonce
// ============================================================
// `messages_client_nonce_shape` requires `char_length between 8 and 64` (see
// 20260929090000_chat_conversations_and_messages.sql). Both branches below
// satisfy that comfortably: `crypto.randomUUID()` is a fixed 36 characters,
// and the fallback's `<~9-char base36 timestamp>-<10-char random>` is ~20.

const NONCE_RANDOM_LENGTH = 10;

/**
 * A per-send idempotency token, scoped to this sender (see the column's own
 * migration comment for the full "why text, not uuid" reasoning). Mirrors
 * `createImageId` (listings/paths.ts) and `createOpaqueToken`
 * (feed/impressions.ts) exactly: uniqueness is all that's required, not
 * unguessability, and `expo-crypto` is deliberately not a dependency, so
 * `crypto.randomUUID()` is used where the runtime provides it and otherwise
 * falls back to time plus randomness.
 */
export function createMessageNonce(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  const time = Date.now().toString(36);
  const random = Math.random()
    .toString(36)
    .slice(2, 2 + NONCE_RANDOM_LENGTH)
    .padEnd(NONCE_RANDOM_LENGTH, '0');
  return `${time}-${random}`;
}

/**
 * Whether `body` may be sent. Mirrors the two server-side CHECK constraints
 * client-side, so a doomed send never reaches the network:
 * `messages_body_present` (`btrim(body) <> ''`) and `messages_body_length`
 * (`char_length(body) between 1 and 2000`). The server remains the
 * authority — this is a UX shortcut, not the enforcement.
 */
export function isValidMessageBody(body: string): boolean {
  return body.trim().length > 0 && body.length <= 2000;
}
