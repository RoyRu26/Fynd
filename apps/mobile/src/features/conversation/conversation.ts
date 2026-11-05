import type { ConversationMessage } from '@/features/conversation/optimistic';
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

// ============================================================
// Day separators + message grouping (SCREENS.md Task 8)
// ============================================================
// Hand-rolled day-boundary math, not Intl.DateTimeFormat — same reasoning
// as features/listings/price.ts's formatMoney and features/inbox/inbox.ts's
// formatInboxTimestamp: Hermes delegates Intl to the platform (Apple
// Foundation on iOS, android.icu on Android), while tests run on Node's own
// ICU, so a test can only ever assert one of three real implementations. A
// hand-rolled formatter is identical everywhere.

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** A stable per-calendar-day grouping key (local time) — for comparison only, never shown. */
function localDayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * A day separator's label — "Today", "Yesterday", or a bare date. Compares
 * LOCAL CALENDAR DAYS, not a 24h-elapsed window, same reasoning
 * `formatInboxTimestamp` documents: a message from 11:58pm yesterday must
 * read "Yesterday" even though under two minutes have elapsed. Clamped at 0
 * so a clock-skewed future timestamp reads as "Today" rather than a
 * nonsensical negative day count, and a malformed `createdAt` returns `''`
 * rather than "NaN" or throwing — the same "garbage never badges"
 * philosophy `isJustDropped` documents.
 */
export function formatDaySeparatorLabel(createdAt: string, now: number = Date.now()): string {
  const date = new Date(createdAt);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) {
    return '';
  }
  const dayIndex = Math.max(0, Math.floor((startOfLocalDay(now) - startOfLocalDay(timestamp)) / DAY_MS));
  if (dayIndex === 0) return 'Today';
  if (dayIndex === 1) return 'Yesterday';
  return `${MONTH_LABELS[date.getMonth()]} ${date.getDate()}`;
}

export type ChatListItem =
  | { kind: 'message'; message: ConversationMessage; showTime: boolean }
  | { kind: 'separator'; id: string; label: string };

/**
 * Interleaves day separators into `messages` (already newest-first — exactly
 * what `useMessageHistory` returns, and what an `inverted` FlatList wants)
 * and marks each message with whether it is the newest in its own
 * consecutive-same-sender, same-day run — the one bubble in a burst that
 * gets a timestamp under it.
 *
 * Walking newest-to-oldest, a separator is inserted the moment a message's
 * calendar day differs from the one just seen. In this newest-first array,
 * that means the separator lands immediately BEFORE (in array order) the
 * first message of an OLDER day — and since the FlatList rendering this is
 * `inverted`, "before" in array order is "above" on screen, so each
 * separator correctly sits above its own day's message group.
 *
 * `showTime` is true exactly when this message is the newest of a run: the
 * very first message overall, or whenever the PREVIOUS array entry (one
 * step NEWER, since the array is newest-first) is a different sender or a
 * different day. A day boundary always ends a group even for the same
 * sender — the separator between them already carries the date.
 */
export function buildChatListItems(
  messages: ConversationMessage[],
  now: number = Date.now(),
): ChatListItem[] {
  const items: ChatListItem[] = [];
  let lastDayKey: string | null = null;

  messages.forEach((message, index) => {
    const dayKey = localDayKey(message.createdAt);
    if (dayKey !== lastDayKey) {
      items.push({
        kind: 'separator',
        id: `day:${dayKey}`,
        label: formatDaySeparatorLabel(message.createdAt, now),
      });
      lastDayKey = dayKey;
    }

    const newer = index > 0 ? messages[index - 1] : undefined;
    const showTime =
      newer === undefined || newer.senderId !== message.senderId || localDayKey(newer.createdAt) !== dayKey;
    items.push({ kind: 'message', message, showTime });
  });

  return items;
}
