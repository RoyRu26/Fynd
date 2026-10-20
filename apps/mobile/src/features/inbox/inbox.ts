import type { Database } from '@/types/database';

/**
 * Pure inbox-page logic: RPC-row normalization, cover-URL association, and
 * cursor derivation.
 *
 * No react-native import of any kind — not even transitively through
 * `@/lib/supabase`, which pulls in `@react-native-async-storage/async-storage`
 * and, through it, react-native's own Flow-syntax source that the test
 * runner's transform cannot parse (verified empirically; see
 * feed/pagination.ts for the same split for the same reason). Keeping this
 * logic here — separate from api.ts, which does import `@/lib/supabase` — is
 * what makes it directly unit-testable.
 */

export type InboxCursor = { lastMessageAt: string; id: string } | null;

/** The generated inbox_conversations RPC row shape, aliased for readability. */
export type InboxConversationRpcRow =
  Database['public']['Functions']['inbox_conversations']['Returns'][number];

/**
 * One inbox row, resolved and ready to render: camelCase, with the listing
 * cover's signed URL already attached (or `null` when there is none to
 * resolve — unlike the feed, a conversation's listing cover is legitimately
 * optional, see `associateInboxCoverUrls`).
 */
export type InboxConversation = {
  conversationId: string;
  listingId: string;
  listingTitle: string | null;
  listingStatus: Database['public']['Enums']['listing_status'] | null;
  coverStoragePath: string | null;
  coverUrl: string | null;
  otherParticipantId: string;
  otherUsername: string | null;
  otherDisplayName: string | null;
  otherAvatarPath: string | null;
  otherAvatarUrl: string | null;
  lastMessageAt: string;
  lastMessageBody: string | null;
  lastMessageSenderId: string | null;
  unreadCount: number;
  isUnread: boolean;
};

export type NormalizedInboxRow = Omit<InboxConversation, 'coverUrl' | 'otherAvatarUrl'>;

/** The intermediate shape after cover-url resolution but before avatar-url resolution. */
export type InboxConversationWithCover = Omit<InboxConversation, 'otherAvatarUrl'>;

/**
 * Row -> domain normalization.
 *
 * `inbox_conversations`'s generated return type claims `listing_title`,
 * `listing_status`, `cover_storage_path`, `other_username`,
 * `other_display_name`, and `other_avatar_path` are all non-null, because
 * PostgreSQL's `RETURNS TABLE` cannot express per-column nullability — but
 * every one of them is genuinely nullable at runtime:
 *
 *   * `listing_title`, `listing_status`, and `cover_storage_path` come from
 *     a `left join public.listings l` (and a further `left join lateral`
 *     for the cover) that the migration's own comment explains is
 *     deliberate: a hard-deleted listing must still let the conversation
 *     render, with nulls rather than vanishing. So all three are corrected
 *     here into properly nullable domain fields.
 *   * `other_username`, `other_display_name`, and `other_avatar_path` come
 *     from `public.profiles`, which is nullable for the same reason
 *     feed/pagination.ts corrects `seller_username` et al. — a user who
 *     hasn't finished onboarding.
 *   * `last_message_body` and `last_message_sender_id` are claimed non-null
 *     too, but `conversations.last_message_body`/`last_message_sender_id`
 *     carry no NOT NULL constraint — an empty thread the viewer themselves
 *     opened (no message sent yet) genuinely has both as null. Corrected
 *     here as well, for the same reason as the other five.
 *
 * Never hand-edit database.ts to "fix" this — it is regenerated from the
 * live schema and a hand edit is silently lost on the next
 * `pnpm run gen:types`.
 *
 * `conversation_id`, `listing_id`, `other_participant_id`, `last_message_at`
 * and `unread_count` stay non-null: `conversation_id`/`listing_id` come from
 * `conversations`' own NOT NULL columns, `other_participant_id` from an
 * inner `join public.profiles other` (never left), `last_message_at` is
 * NOT NULL with a default, and `unread_count` is a `count(*)`, which is
 * never null.
 */
export function normalizeInboxRow(row: InboxConversationRpcRow): NormalizedInboxRow {
  const unreadCount = row.unread_count;
  return {
    conversationId: row.conversation_id,
    listingId: row.listing_id,
    listingTitle: row.listing_title,
    listingStatus: row.listing_status,
    coverStoragePath: row.cover_storage_path,
    otherParticipantId: row.other_participant_id,
    otherUsername: row.other_username,
    otherDisplayName: row.other_display_name,
    otherAvatarPath: row.other_avatar_path,
    lastMessageAt: row.last_message_at,
    lastMessageBody: row.last_message_body,
    lastMessageSenderId: row.last_message_sender_id,
    unreadCount,
    isUnread: unreadCount > 0,
  };
}

/**
 * Attaches each row's signed cover URL, keyed by storage path.
 *
 * Unlike `associateCoverUrls` in feed/pagination.ts, this must NOT throw on
 * a missing or unresolved cover: a conversation's listing can legitimately
 * have no storage path at all (deleted listing, or one that never had a
 * photo), and even when a path exists, a transient signing failure must not
 * take down the whole inbox page the way a broken feed card would. A row
 * with `coverUrl: null` still renders — `ListingImage` already handles an
 * undefined/missing uri by showing its skeleton fill.
 */
export function associateInboxCoverUrls(
  rows: NormalizedInboxRow[],
  urlsByPath: Record<string, string>,
): InboxConversationWithCover[] {
  return rows.map((row) => ({
    ...row,
    coverUrl: row.coverStoragePath ? urlsByPath[row.coverStoragePath] ?? null : null,
  }));
}

/**
 * Attaches each row's resolved avatar URL, keyed by storage path. Same
 * null-tolerant contract as `associateInboxCoverUrls`: a missing path or an
 * unresolved signing never throws, since an avatar is a legitimate
 * permanent null state (onboarding never sets one).
 */
export function associateInboxAvatarUrls(
  rows: InboxConversationWithCover[],
  urlsByPath: Record<string, string>,
): InboxConversation[] {
  return rows.map((row) => ({
    ...row,
    otherAvatarUrl: row.otherAvatarPath ? urlsByPath[row.otherAvatarPath] ?? null : null,
  }));
}

/**
 * The other participant's display name, falling back through the same
 * chain as every other seller/profile rendering in this app: display name,
 * then username, then a generic placeholder for a profile that hasn't
 * finished onboarding.
 *
 * Typed structurally (just the two fields it needs) rather than against
 * `InboxConversation` specifically, so the `[id].tsx` stub's
 * `ConversationHeader` — a differently-shaped row with the same two
 * nullable name fields — can reuse it instead of duplicating the fallback
 * chain.
 */
export function resolveOtherPartyName(conversation: {
  otherDisplayName: string | null;
  otherUsername: string | null;
}): string {
  return conversation.otherDisplayName ?? conversation.otherUsername ?? 'Fynd user';
}

/**
 * The inbox row's subtitle line: a placeholder for a thread with no
 * messages yet, otherwise the last message body, prefixed with "You: " when
 * the viewer sent it themselves.
 */
export function formatLastMessagePreview(
  conversation: InboxConversation,
  viewerId: string,
): string {
  if (conversation.lastMessageBody === null) {
    return 'Say hello 👋';
  }
  const prefix = conversation.lastMessageSenderId === viewerId ? 'You: ' : '';
  return `${prefix}${conversation.lastMessageBody}`;
}

/** The generated conversation_detail RPC row shape, aliased for readability. */
export type ConversationDetailRpcRow =
  Database['public']['Functions']['conversation_detail']['Returns'][number];

/**
 * The thread header, normalized the same way as an inbox row and for the
 * same reason: `conversation_detail`'s generated return type claims
 * `listing_title`, `listing_status`, `cover_storage_path`,
 * `other_username`, `other_display_name`, and `other_avatar_path` are all
 * non-null, but every one of them goes through the identical `left join`s
 * as `inbox_conversations` (see that function's row type and
 * `normalizeInboxRow`'s doc comment) — a hard-deleted listing, or a
 * not-yet-onboarded profile, both land here as genuine nulls at runtime.
 *
 * `canReview` (ROADMAP 5.4) is the one column that is genuinely never
 * null, by construction — `20261020113820_conversation_detail_can_review.sql`
 * wraps its whole expression in `coalesce(..., false)` server-side
 * specifically so a hard-deleted listing's `left join` nulls resolve to a
 * clean `false` rather than leaking a nullable boolean into this type.
 */
export type ConversationHeader = {
  conversationId: string;
  listingId: string;
  listingTitle: string | null;
  listingStatus: Database['public']['Enums']['listing_status'] | null;
  coverStoragePath: string | null;
  otherParticipantId: string;
  otherUsername: string | null;
  otherDisplayName: string | null;
  otherAvatarPath: string | null;
  otherAvatarUrl: string | null;
  canReview: boolean;
};

export type NormalizedConversationHeader = Omit<ConversationHeader, 'otherAvatarUrl'>;

export function normalizeConversationHeader(row: ConversationDetailRpcRow): NormalizedConversationHeader {
  return {
    conversationId: row.conversation_id,
    listingId: row.listing_id,
    listingTitle: row.listing_title,
    listingStatus: row.listing_status,
    coverStoragePath: row.cover_storage_path,
    otherParticipantId: row.other_participant_id,
    otherUsername: row.other_username,
    otherDisplayName: row.other_display_name,
    otherAvatarPath: row.other_avatar_path,
    canReview: row.can_review,
  };
}

/**
 * Attaches the resolved avatar URL for the thread header's single avatar
 * path. Same null-tolerant contract as `associateInboxAvatarUrls`.
 */
export function associateConversationHeaderAvatarUrl(
  header: NormalizedConversationHeader,
  urlsByPath: Record<string, string>,
): ConversationHeader {
  return {
    ...header,
    otherAvatarUrl: header.otherAvatarPath ? urlsByPath[header.otherAvatarPath] ?? null : null,
  };
}

/**
 * The next page's cursor, or `null` when there is no next page.
 *
 * Derived from the LAST row of the page just fetched — `lastMessageAt` and
 * `conversationId`, matching `inbox_conversations`'s `(last_message_at,
 * id) DESC` ordering exactly. A page shorter than what was requested is the
 * signal that the inbox is exhausted: asking again would return zero rows,
 * so pagination stops here instead of spending a request to find that out.
 */
export function deriveNextInboxCursor(
  page: Pick<InboxConversation, 'lastMessageAt' | 'conversationId'>[],
  pageSize: number,
): InboxCursor {
  if (page.length < pageSize) {
    return null;
  }
  const last = page[page.length - 1];
  return { lastMessageAt: last.lastMessageAt, id: last.conversationId };
}
