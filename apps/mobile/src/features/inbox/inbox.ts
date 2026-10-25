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
  /**
   * The conversation's seller id (SCREENS.md Task 6's Buying/Selling
   * filter) — compare against the viewer's own id (`getInboxRole`) rather
   * than trusting a precomputed role flag. Always one of the two
   * participants; never null, the same NOT NULL guarantee
   * `inbox_conversations`'s own migration documents for `conversation_id`
   * et al.
   */
  sellerId: string;
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
    sellerId: row.seller_id,
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
  coverUrl: string | null;
  otherParticipantId: string;
  otherUsername: string | null;
  otherDisplayName: string | null;
  otherAvatarPath: string | null;
  otherAvatarUrl: string | null;
  canReview: boolean;
  /**
   * SCREENS.md Task 6's pinned listing strip. Nullable for the same reason
   * `listingTitle`/`listingStatus`/`coverStoragePath` are: all four come
   * from the same `left join public.listings l`
   * (20261025091545_conversation_detail_listing_price.sql), so a
   * hard-deleted listing leaves all four null together.
   */
  listingPriceAmount: number | null;
  listingCurrency: string | null;
  /** SCREENS.md Task 8's pinned strip "price . size" line — same left-join nullability as the price/currency pair above. */
  listingSize: Database['public']['Enums']['listing_size'] | null;
  /**
   * SCREENS.md Task 8's header caption ("Buying from you" / "Selling to
   * you") — compare the viewer's own id against this, never a precomputed
   * role flag, same "the client already knows its own id and can compare"
   * shape `inbox_conversations`'s own `seller_id` already established.
   * Never null: a plain NOT NULL column already on `conversations` itself.
   */
  sellerId: string;
};

export type NormalizedConversationHeader = Omit<ConversationHeader, 'otherAvatarUrl' | 'coverUrl'>;

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
    listingPriceAmount: row.listing_price_amount,
    listingCurrency: row.listing_currency,
    listingSize: row.listing_size,
    sellerId: row.seller_id,
  };
}

/**
 * Attaches the thread header's two resolved signed URLs — the other
 * participant's avatar and the listing's cover (the pinned strip's
 * thumbnail) — in one step, since `fetchConversationDetail` always resolves
 * both together. Same null-tolerant contract as `associateInboxAvatarUrls`/
 * `associateInboxCoverUrls`: neither path resolving is a genuine resting
 * state (a profile with no avatar, a hard-deleted listing), never an error.
 */
export function associateConversationHeaderUrls(
  header: NormalizedConversationHeader,
  avatarUrlsByPath: Record<string, string>,
  coverUrlsByPath: Record<string, string>,
): ConversationHeader {
  return {
    ...header,
    otherAvatarUrl: header.otherAvatarPath ? avatarUrlsByPath[header.otherAvatarPath] ?? null : null,
    coverUrl: header.coverStoragePath ? coverUrlsByPath[header.coverStoragePath] ?? null : null,
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

// ============================================================
// Buying / Selling (SCREENS.md Task 6)
// ============================================================
// "Offers" is deliberately not a fourth filter here: there is no offers
// table or RPC at all yet (see sell/index.tsx's own "buzz" omission for the
// identical gap), so a count badge for it would have no real data behind
// it. Hidden rather than faked, same rule the task states for a section
// with no data.

export type InboxRole = 'buying' | 'selling';
export type InboxRoleFilter = 'all' | InboxRole;

/** `viewerId` compared against `sellerId` is the whole rule — see the `seller_id` field's own doc comment on why that beats a precomputed flag. */
export function getInboxRole(conversation: { sellerId: string }, viewerId: string): InboxRole {
  return conversation.sellerId === viewerId ? 'selling' : 'buying';
}

/**
 * SCREENS.md Task 8's chat header caption ("Buying from you" / "Selling to
 * you") — describes the OTHER participant's role, from the viewer's own
 * point of view. Takes the viewer's OWN role (from `getInboxRole`) rather
 * than recomputing anything: if the viewer is selling, the other
 * participant is the one buying FROM them; if the viewer is buying, the
 * other participant is the one selling TO them — the two are always
 * opposite sides of the same conversation.
 */
export function formatConversationRoleCaption(viewerRole: InboxRole): string {
  return viewerRole === 'selling' ? 'Buying from you' : 'Selling to you';
}

export function filterInboxConversations<T extends { sellerId: string }>(
  conversations: T[],
  filter: InboxRoleFilter,
  viewerId: string,
): T[] {
  if (filter === 'all') {
    return conversations;
  }
  return conversations.filter((conversation) => getInboxRole(conversation, viewerId) === filter);
}

/**
 * Copy for the filtered-to-nothing state, mirroring
 * `features/listings/status.ts`'s `getMyListingsEmptyCopy` shape: the
 * message differs depending on whether the inbox is genuinely empty versus
 * just empty for the selected filter.
 */
export function getInboxEmptyCopy(filter: InboxRoleFilter, totalCount: number): { title: string; body?: string } {
  if (totalCount === 0) {
    return {
      title: 'No messages yet.',
      body: "When you contact a seller, or someone messages you about a listing, it'll show up here.",
    };
  }
  switch (filter) {
    case 'buying':
      return { title: 'No conversations about things you’re buying.' };
    case 'selling':
      return { title: 'No conversations about things you’re selling.' };
    case 'all':
      // Unreachable in practice: 'all' never filters anything out, so a
      // nonzero totalCount always means a nonzero visible count too.
      return { title: 'Nothing here yet.' };
  }
}

// ============================================================
// Stories row (SCREENS.md Task 6)
// ============================================================

export type InboxPartner = {
  otherParticipantId: string;
  name: string;
  avatarUrl: string | null;
  /** True when ANY conversation with this partner is unread — not just the one that first surfaced them. */
  hasUnread: boolean;
  /** The partner's most recently active conversation — where tapping their ring opens. */
  conversationId: string;
  lastMessageAt: string;
};

/**
 * The seller's recent conversation partners, deduplicated and capped to
 * `limit` — the Stories row (StoryRing per partner, `active` = has unread).
 *
 * `conversations` is assumed already ordered newest-first (matching
 * `inbox_conversations`'s own ordering), so the first row seen for a given
 * partner is their most recent conversation, and that is the one a tap opens
 * even if the partner has more than one thread. The `limit` caps DISTINCT
 * partners, not rows scanned: a partner already captured keeps absorbing
 * `hasUnread` from their other conversations even after the cap is reached,
 * so an unread thread further down the list is never silently dropped from
 * the ring's own active state.
 */
export function selectRecentPartners(conversations: InboxConversation[], limit: number): InboxPartner[] {
  const order: string[] = [];
  const byId = new Map<string, InboxPartner>();

  for (const conversation of conversations) {
    const id = conversation.otherParticipantId;
    const existing = byId.get(id);
    if (existing) {
      if (conversation.isUnread) {
        existing.hasUnread = true;
      }
      continue;
    }
    if (order.length >= limit) {
      continue;
    }
    order.push(id);
    byId.set(id, {
      otherParticipantId: id,
      name: resolveOtherPartyName(conversation),
      avatarUrl: conversation.otherAvatarUrl,
      hasUnread: conversation.isUnread,
      conversationId: conversation.conversationId,
      lastMessageAt: conversation.lastMessageAt,
    });
  }

  return order.map((id) => {
    const partner = byId.get(id);
    if (!partner) {
      throw new Error(`selectRecentPartners: missing partner for id ${id}`);
    }
    return partner;
  });
}

// ============================================================
// Row timestamp
// ============================================================
// Hand-rolled, deliberately not Intl.DateTimeFormat — same reasoning as
// features/listings/price.ts's formatMoney: Hermes delegates Intl to Apple
// Foundation on iOS and android.icu on Android, while tests run on Node's
// full ICU, so a test can only ever assert one of three real
// implementations. A hand-rolled formatter is identical everywhere.

const INBOX_WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const INBOX_MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * A row's calendar-aware timestamp: a clock time today, "Yesterday", a
 * weekday name within the last week, otherwise a short date — matching the
 * handoff's own 14:11 / Yesterday / Sun / Mon progression.
 *
 * Compares LOCAL CALENDAR DAYS, not a 24h-elapsed window: a message from
 * 11:58pm yesterday must read "Yesterday" even though under two minutes have
 * elapsed, and a message from this morning must show its clock time even
 * after 20+ hours have passed. `formatReviewAge`'s elapsed-ms approach is
 * wrong for this reason and is not reused here.
 *
 * `now` is an explicit, defaulted parameter, same convention as
 * `isJustDropped`/`formatReviewAge`, so this stays a pure function of its
 * inputs for testing. A malformed `lastMessageAt` returns `''` rather than
 * rendering "NaN:NaN" or throwing — the row simply shows no time, same
 * "garbage never badges" philosophy `isJustDropped` documents.
 */
export function formatInboxTimestamp(lastMessageAt: string, now: number = Date.now()): string {
  const date = new Date(lastMessageAt);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) {
    return '';
  }

  // Clamped at 0: a clock-skewed future timestamp renders as "today" rather
  // than a nonsensical negative day count, the same clamping reasoning
  // isJustDropped documents for its own now-vs-createdAt subtraction.
  const dayIndex = Math.max(0, Math.floor((startOfLocalDay(now) - startOfLocalDay(timestamp)) / DAY_MS));

  if (dayIndex === 0) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  if (dayIndex === 1) {
    return 'Yesterday';
  }
  if (dayIndex < 7) {
    return INBOX_WEEKDAY_LABELS[date.getDay()];
  }
  return `${INBOX_MONTH_LABELS[date.getMonth()]} ${date.getDate()}`;
}
