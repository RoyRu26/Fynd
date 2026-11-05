import { describe, expect, it } from 'vitest';

import {
  associateConversationHeaderUrls,
  associateInboxAvatarUrls,
  associateInboxCoverUrls,
  deriveNextInboxCursor,
  filterInboxConversations,
  formatConversationRoleCaption,
  formatInboxTimestamp,
  formatLastMessagePreview,
  getInboxEmptyCopy,
  getInboxRole,
  normalizeConversationHeader,
  normalizeInboxRow,
  resolveOtherPartyName,
  selectRecentPartners,
  type ConversationDetailRpcRow,
  type InboxConversation,
  type InboxConversationRpcRow,
  type InboxConversationWithCover,
  type NormalizedConversationHeader,
  type NormalizedInboxRow,
} from '@/features/inbox/inbox';

function rpcRow(overrides: Partial<InboxConversationRpcRow> = {}): InboxConversationRpcRow {
  return {
    conversation_id: 'conversation-1',
    listing_id: 'listing-1',
    listing_title: 'Vintage denim jacket',
    listing_status: 'active',
    cover_storage_path: 'seller-1/listing-1/cover.jpg',
    other_participant_id: 'other-1',
    other_username: 'roy',
    other_display_name: 'Roy',
    other_avatar_path: 'other-1/avatar.jpg',
    last_message_at: '2026-01-02T10:00:00+00:00',
    last_message_body: 'Is this still available?',
    last_message_sender_id: 'other-1',
    unread_count: 2,
    seller_id: 'seller-1',
    ...overrides,
  };
}

describe('normalizeInboxRow', () => {
  it('maps every field from snake_case to camelCase', () => {
    expect(normalizeInboxRow(rpcRow())).toEqual({
      conversationId: 'conversation-1',
      listingId: 'listing-1',
      listingTitle: 'Vintage denim jacket',
      listingStatus: 'active',
      coverStoragePath: 'seller-1/listing-1/cover.jpg',
      otherParticipantId: 'other-1',
      otherUsername: 'roy',
      otherDisplayName: 'Roy',
      otherAvatarPath: 'other-1/avatar.jpg',
      lastMessageAt: '2026-01-02T10:00:00+00:00',
      lastMessageBody: 'Is this still available?',
      lastMessageSenderId: 'other-1',
      unreadCount: 2,
      isUnread: true,
      sellerId: 'seller-1',
    });
  });

  it('derives isUnread as false when unread_count is zero', () => {
    const normalized = normalizeInboxRow(rpcRow({ unread_count: 0 }));
    expect(normalized.unreadCount).toBe(0);
    expect(normalized.isUnread).toBe(false);
  });

  // The whole reason this function exists: the generated RPC row type
  // claims these are non-null, because the migration's left joins against
  // listings and the cover subquery are genuinely nullable at runtime — a
  // hard-deleted listing, or one that never had a photo.
  it('passes a genuinely null listing_title through as null, not a crash or a coerced value', () => {
    const row = rpcRow({ listing_title: null as unknown as string });
    expect(normalizeInboxRow(row).listingTitle).toBeNull();
  });

  it('passes a genuinely null listing_status through as null', () => {
    const row = rpcRow({
      listing_status: null as unknown as InboxConversationRpcRow['listing_status'],
    });
    expect(normalizeInboxRow(row).listingStatus).toBeNull();
  });

  it('passes a genuinely null cover_storage_path through as null', () => {
    const row = rpcRow({ cover_storage_path: null as unknown as string });
    expect(normalizeInboxRow(row).coverStoragePath).toBeNull();
  });

  // Same nullability lie as feed/pagination.ts's seller_* fields, here for
  // the other participant's profile.
  it('passes genuinely null other_username/other_display_name/other_avatar_path through as null', () => {
    const row = rpcRow({
      other_username: null as unknown as string,
      other_display_name: null as unknown as string,
      other_avatar_path: null as unknown as string,
    });
    const normalized = normalizeInboxRow(row);
    expect(normalized.otherUsername).toBeNull();
    expect(normalized.otherDisplayName).toBeNull();
    expect(normalized.otherAvatarPath).toBeNull();
  });

  it('passes a null last_message_body/last_message_sender_id through as null (an empty thread)', () => {
    const row = rpcRow({
      last_message_body: null as unknown as string,
      last_message_sender_id: null as unknown as string,
      unread_count: 0,
    });
    const normalized = normalizeInboxRow(row);
    expect(normalized.lastMessageBody).toBeNull();
    expect(normalized.lastMessageSenderId).toBeNull();
  });
});

function conversationDetailRpcRow(
  overrides: Partial<ConversationDetailRpcRow> = {},
): ConversationDetailRpcRow {
  return {
    conversation_id: 'conversation-1',
    listing_id: 'listing-1',
    listing_title: 'Vintage denim jacket',
    listing_status: 'active',
    cover_storage_path: 'seller-1/listing-1/cover.jpg',
    other_participant_id: 'other-1',
    other_username: 'roy',
    other_display_name: 'Roy',
    other_avatar_path: 'other-1/avatar.jpg',
    can_review: false,
    listing_price_amount: 2400,
    listing_currency: 'ILS',
    listing_size: 'alpha_m',
    seller_id: 'seller-1',
    ...overrides,
  };
}

describe('normalizeConversationHeader', () => {
  it('maps every field from snake_case to camelCase', () => {
    expect(normalizeConversationHeader(conversationDetailRpcRow())).toEqual({
      conversationId: 'conversation-1',
      listingId: 'listing-1',
      listingTitle: 'Vintage denim jacket',
      listingStatus: 'active',
      coverStoragePath: 'seller-1/listing-1/cover.jpg',
      otherParticipantId: 'other-1',
      otherUsername: 'roy',
      otherDisplayName: 'Roy',
      otherAvatarPath: 'other-1/avatar.jpg',
      canReview: false,
      listingPriceAmount: 2400,
      listingCurrency: 'ILS',
      listingSize: 'alpha_m',
      sellerId: 'seller-1',
    });
  });

  // ROADMAP 5.4: canReview is never null by construction -- the migration's
  // own `coalesce(..., false)` guarantees it, so normalizeConversationHeader
  // does no correction of its own here, unlike the nullable fields above.
  it('passes canReview through as-is -- true when the RPC says the sale is reviewable', () => {
    const row = conversationDetailRpcRow({ can_review: true });
    expect(normalizeConversationHeader(row).canReview).toBe(true);
  });

  // Same nullability lie as normalizeInboxRow corrects for
  // inbox_conversations: conversation_detail's generated return type claims
  // these are non-null, but the migration's left joins against listings
  // and the cover subquery are genuinely nullable at runtime — a
  // hard-deleted listing, or one that never had a photo.
  it('passes a genuinely null listing_title through as null, not a crash or a coerced value', () => {
    const row = conversationDetailRpcRow({ listing_title: null as unknown as string });
    expect(normalizeConversationHeader(row).listingTitle).toBeNull();
  });

  it('passes a genuinely null listing_status through as null', () => {
    const row = conversationDetailRpcRow({
      listing_status: null as unknown as ConversationDetailRpcRow['listing_status'],
    });
    expect(normalizeConversationHeader(row).listingStatus).toBeNull();
  });

  it('passes a genuinely null cover_storage_path through as null', () => {
    const row = conversationDetailRpcRow({ cover_storage_path: null as unknown as string });
    expect(normalizeConversationHeader(row).coverStoragePath).toBeNull();
  });

  // SCREENS.md Task 6: listing_price_amount/listing_currency go through the
  // identical left-joined-with-listings nullability as listing_title/
  // listing_status/cover_storage_path just above — a hard-deleted listing
  // leaves all of them null together.
  it('passes genuinely null listing_price_amount/listing_currency through as null', () => {
    const row = conversationDetailRpcRow({
      listing_price_amount: null as unknown as number,
      listing_currency: null as unknown as string,
    });
    const normalizedHeader = normalizeConversationHeader(row);
    expect(normalizedHeader.listingPriceAmount).toBeNull();
    expect(normalizedHeader.listingCurrency).toBeNull();
  });

  // Same left-joined-with-listings nullability as the price/currency pair.
  it('passes a genuinely null listing_size through as null', () => {
    const row = conversationDetailRpcRow({ listing_size: null as unknown as 'alpha_m' });
    expect(normalizeConversationHeader(row).listingSize).toBeNull();
  });

  // seller_id is never null by construction -- a plain NOT NULL column
  // already on `conversations` itself, not part of the left-joined group.
  it('passes seller_id through as-is', () => {
    const row = conversationDetailRpcRow({ seller_id: 'a-different-seller' });
    expect(normalizeConversationHeader(row).sellerId).toBe('a-different-seller');
  });

  // Same nullability lie as feed/pagination.ts's seller_* fields, here for
  // the other participant's profile.
  it('passes genuinely null other_username/other_display_name/other_avatar_path through as null', () => {
    const row = conversationDetailRpcRow({
      other_username: null as unknown as string,
      other_display_name: null as unknown as string,
      other_avatar_path: null as unknown as string,
    });
    const normalized = normalizeConversationHeader(row);
    expect(normalized.otherUsername).toBeNull();
    expect(normalized.otherDisplayName).toBeNull();
    expect(normalized.otherAvatarPath).toBeNull();
  });
});

function normalized(overrides: Partial<NormalizedInboxRow> = {}): NormalizedInboxRow {
  return {
    conversationId: 'conversation-1',
    listingId: 'listing-1',
    listingTitle: 'Vintage denim jacket',
    listingStatus: 'active',
    coverStoragePath: 'seller-1/listing-1/cover.jpg',
    otherParticipantId: 'other-1',
    otherUsername: 'roy',
    otherDisplayName: 'Roy',
    otherAvatarPath: 'other-1/avatar.jpg',
    lastMessageAt: '2026-01-02T10:00:00+00:00',
    lastMessageBody: 'Is this still available?',
    lastMessageSenderId: 'other-1',
    unreadCount: 2,
    isUnread: true,
    sellerId: 'seller-1',
    ...overrides,
  };
}

function withCover(overrides: Partial<InboxConversationWithCover> = {}): InboxConversationWithCover {
  return { ...normalized(), coverUrl: 'https://signed/cover.jpg', ...overrides };
}

function conversation(overrides: Partial<InboxConversation> = {}): InboxConversation {
  return { ...withCover(), otherAvatarUrl: 'https://signed/avatar.jpg', ...overrides };
}

describe('associateInboxCoverUrls', () => {
  it('attaches each url by storage path, not by array position', () => {
    const rows = [
      normalized({ conversationId: 'a', coverStoragePath: 'path/a.jpg' }),
      normalized({ conversationId: 'b', coverStoragePath: 'path/b.jpg' }),
    ];
    const urlsByPath = {
      'path/b.jpg': 'https://signed/b',
      'path/a.jpg': 'https://signed/a',
    };

    const result = associateInboxCoverUrls(rows, urlsByPath);

    expect(result.find((r) => r.conversationId === 'a')?.coverUrl).toBe('https://signed/a');
    expect(result.find((r) => r.conversationId === 'b')?.coverUrl).toBe('https://signed/b');
  });

  it('does not throw when a row has no cover storage path at all — resolves coverUrl to null', () => {
    const rows = [normalized({ conversationId: 'a', coverStoragePath: null })];
    expect(() => associateInboxCoverUrls(rows, {})).not.toThrow();
    expect(associateInboxCoverUrls(rows, {})[0].coverUrl).toBeNull();
  });

  it('does not throw when a cover storage path fails to resolve a signed url — resolves coverUrl to null', () => {
    const rows = [normalized({ conversationId: 'a', coverStoragePath: 'path/a.jpg' })];
    expect(() => associateInboxCoverUrls(rows, {})).not.toThrow();
    expect(associateInboxCoverUrls(rows, {})[0].coverUrl).toBeNull();
  });

  it('returns an empty array for an empty page without error', () => {
    expect(associateInboxCoverUrls([], {})).toEqual([]);
  });
});

describe('associateInboxAvatarUrls', () => {
  it('attaches each url by storage path, not by array position', () => {
    const rows = [
      withCover({ conversationId: 'a', otherAvatarPath: 'avatar/a.jpg' }),
      withCover({ conversationId: 'b', otherAvatarPath: 'avatar/b.jpg' }),
    ];
    const urlsByPath = {
      'avatar/b.jpg': 'https://signed/b',
      'avatar/a.jpg': 'https://signed/a',
    };

    const result = associateInboxAvatarUrls(rows, urlsByPath);

    expect(result.find((r) => r.conversationId === 'a')?.otherAvatarUrl).toBe('https://signed/a');
    expect(result.find((r) => r.conversationId === 'b')?.otherAvatarUrl).toBe('https://signed/b');
  });

  it('does not throw when a row has no avatar path at all — resolves otherAvatarUrl to null', () => {
    const rows = [withCover({ conversationId: 'a', otherAvatarPath: null })];
    expect(() => associateInboxAvatarUrls(rows, {})).not.toThrow();
    expect(associateInboxAvatarUrls(rows, {})[0].otherAvatarUrl).toBeNull();
  });

  it('does not throw when an avatar path fails to resolve a signed url — resolves otherAvatarUrl to null', () => {
    const rows = [withCover({ conversationId: 'a', otherAvatarPath: 'avatar/a.jpg' })];
    expect(() => associateInboxAvatarUrls(rows, {})).not.toThrow();
    expect(associateInboxAvatarUrls(rows, {})[0].otherAvatarUrl).toBeNull();
  });

  it('returns an empty array for an empty page without error', () => {
    expect(associateInboxAvatarUrls([], {})).toEqual([]);
  });
});

describe('associateConversationHeaderUrls', () => {
  function header(overrides: Partial<NormalizedConversationHeader> = {}): NormalizedConversationHeader {
    return {
      conversationId: 'conversation-1',
      listingId: 'listing-1',
      listingTitle: 'Vintage denim jacket',
      listingStatus: 'active',
      coverStoragePath: 'seller-1/listing-1/cover.jpg',
      otherParticipantId: 'other-1',
      otherUsername: 'roy',
      otherDisplayName: 'Roy',
      otherAvatarPath: 'other-1/avatar.jpg',
      canReview: false,
      listingPriceAmount: 2400,
      listingCurrency: 'ILS',
      listingSize: 'alpha_m',
      sellerId: 'seller-1',
      ...overrides,
    };
  }

  it('resolves otherAvatarUrl and coverUrl when both paths have a matching signed url', () => {
    const result = associateConversationHeaderUrls(
      header(),
      { 'other-1/avatar.jpg': 'https://signed/avatar.jpg' },
      { 'seller-1/listing-1/cover.jpg': 'https://signed/cover.jpg' },
    );
    expect(result).toEqual({
      ...header(),
      otherAvatarUrl: 'https://signed/avatar.jpg',
      coverUrl: 'https://signed/cover.jpg',
    });
  });

  it('does not throw when otherAvatarPath is null — resolves otherAvatarUrl to null', () => {
    const h = header({ otherAvatarPath: null });
    expect(() => associateConversationHeaderUrls(h, {}, {})).not.toThrow();
    expect(associateConversationHeaderUrls(h, {}, {}).otherAvatarUrl).toBeNull();
  });

  it('does not throw when the avatar path fails to resolve a signed url — resolves otherAvatarUrl to null', () => {
    const h = header({ otherAvatarPath: 'other-1/avatar.jpg' });
    expect(() => associateConversationHeaderUrls(h, {}, {})).not.toThrow();
    expect(associateConversationHeaderUrls(h, {}, {}).otherAvatarUrl).toBeNull();
  });

  it('does not throw when coverStoragePath is null — resolves coverUrl to null', () => {
    const h = header({ coverStoragePath: null });
    expect(() => associateConversationHeaderUrls(h, {}, {})).not.toThrow();
    expect(associateConversationHeaderUrls(h, {}, {}).coverUrl).toBeNull();
  });

  it('does not throw when the cover path fails to resolve a signed url — resolves coverUrl to null', () => {
    const h = header({ coverStoragePath: 'seller-1/listing-1/cover.jpg' });
    expect(() => associateConversationHeaderUrls(h, {}, {})).not.toThrow();
    expect(associateConversationHeaderUrls(h, {}, {}).coverUrl).toBeNull();
  });

  it('resolves each url independently — an avatar failure does not blank out a resolved cover', () => {
    const result = associateConversationHeaderUrls(
      header(),
      {},
      { 'seller-1/listing-1/cover.jpg': 'https://signed/cover.jpg' },
    );
    expect(result.otherAvatarUrl).toBeNull();
    expect(result.coverUrl).toBe('https://signed/cover.jpg');
  });
});

describe('resolveOtherPartyName', () => {
  it('prefers display name', () => {
    const c = conversation({ otherDisplayName: 'Roy', otherUsername: 'roy123' });
    expect(resolveOtherPartyName(c)).toBe('Roy');
  });

  it('falls back to username when display name is null', () => {
    const c = conversation({ otherDisplayName: null, otherUsername: 'roy123' });
    expect(resolveOtherPartyName(c)).toBe('roy123');
  });

  it('falls back to a generic placeholder when both are null', () => {
    const c = conversation({ otherDisplayName: null, otherUsername: null });
    expect(resolveOtherPartyName(c)).toBe('Fynd user');
  });
});

describe('formatLastMessagePreview', () => {
  it('shows a greeting placeholder for a thread with no messages yet', () => {
    const c = conversation({ lastMessageBody: null, lastMessageSenderId: null });
    expect(formatLastMessagePreview(c, 'viewer-1')).toBe('Say hello 👋');
  });

  it("prefixes the viewer's own message with 'You: '", () => {
    const c = conversation({ lastMessageBody: 'Sounds good!', lastMessageSenderId: 'viewer-1' });
    expect(formatLastMessagePreview(c, 'viewer-1')).toBe('You: Sounds good!');
  });

  it("does not prefix the other participant's message", () => {
    const c = conversation({ lastMessageBody: 'Is this still available?', lastMessageSenderId: 'other-1' });
    expect(formatLastMessagePreview(c, 'viewer-1')).toBe('Is this still available?');
  });
});

describe('deriveNextInboxCursor', () => {
  const page = [
    { lastMessageAt: '2026-01-03T00:00:00+00:00', conversationId: 'c' },
    { lastMessageAt: '2026-01-02T00:00:00+00:00', conversationId: 'b' },
    { lastMessageAt: '2026-01-01T00:00:00+00:00', conversationId: 'a' },
  ];

  it('derives the cursor from the LAST row of a full page', () => {
    expect(deriveNextInboxCursor(page, 3)).toEqual({
      lastMessageAt: '2026-01-01T00:00:00+00:00',
      id: 'a',
    });
  });

  it('returns null for a page shorter than the requested size — the inbox is exhausted', () => {
    expect(deriveNextInboxCursor(page, 10)).toBeNull();
  });

  it('returns null for a genuinely empty page', () => {
    expect(deriveNextInboxCursor([], 10)).toBeNull();
  });

  it('still derives a cursor at the exact boundary (page length equals page size)', () => {
    expect(deriveNextInboxCursor(page, 3)).not.toBeNull();
  });
});

describe('getInboxRole', () => {
  it('is selling when the viewer is the seller', () => {
    expect(getInboxRole({ sellerId: 'viewer-1' }, 'viewer-1')).toBe('selling');
  });

  it('is buying when the viewer is not the seller', () => {
    expect(getInboxRole({ sellerId: 'seller-1' }, 'viewer-1')).toBe('buying');
  });
});

describe('formatConversationRoleCaption', () => {
  it('describes the OTHER participant as buying when the viewer is selling', () => {
    expect(formatConversationRoleCaption('selling')).toBe('Buying from you');
  });

  it('describes the OTHER participant as selling when the viewer is buying', () => {
    expect(formatConversationRoleCaption('buying')).toBe('Selling to you');
  });
});

describe('filterInboxConversations', () => {
  const rows = [
    conversation({ conversationId: 'selling-1', sellerId: 'viewer-1' }),
    conversation({ conversationId: 'buying-1', sellerId: 'other-1' }),
    conversation({ conversationId: 'buying-2', sellerId: 'other-2' }),
  ];

  it("'all' returns every conversation unfiltered", () => {
    expect(filterInboxConversations(rows, 'all', 'viewer-1')).toEqual(rows);
  });

  it("'selling' keeps only conversations where the viewer is the seller", () => {
    const result = filterInboxConversations(rows, 'selling', 'viewer-1');
    expect(result.map((r) => r.conversationId)).toEqual(['selling-1']);
  });

  it("'buying' keeps only conversations where the viewer is not the seller", () => {
    const result = filterInboxConversations(rows, 'buying', 'viewer-1');
    expect(result.map((r) => r.conversationId)).toEqual(['buying-1', 'buying-2']);
  });
});

describe('getInboxEmptyCopy', () => {
  it('uses the genuinely-empty copy when the inbox has nothing at all, regardless of filter', () => {
    expect(getInboxEmptyCopy('buying', 0).title).toBe('No messages yet.');
    expect(getInboxEmptyCopy('all', 0).title).toBe('No messages yet.');
  });

  it('uses filter-specific copy when the inbox has conversations but none match', () => {
    expect(getInboxEmptyCopy('buying', 5).title).not.toBe('No messages yet.');
    expect(getInboxEmptyCopy('selling', 5).title).not.toBe('No messages yet.');
    expect(getInboxEmptyCopy('buying', 5).title).not.toBe(getInboxEmptyCopy('selling', 5).title);
  });
});

describe('selectRecentPartners', () => {
  it('dedupes by otherParticipantId, keeping the first (most recent) occurrence', () => {
    const rows = [
      conversation({ conversationId: 'c2', otherParticipantId: 'p1', lastMessageAt: '2026-01-02T00:00:00Z' }),
      conversation({ conversationId: 'c1', otherParticipantId: 'p1', lastMessageAt: '2026-01-01T00:00:00Z' }),
    ];
    const result = selectRecentPartners(rows, 10);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ otherParticipantId: 'p1', conversationId: 'c2' });
  });

  it('caps at the given limit, in input order', () => {
    const rows = [
      conversation({ otherParticipantId: 'p1' }),
      conversation({ otherParticipantId: 'p2' }),
      conversation({ otherParticipantId: 'p3' }),
    ];
    expect(selectRecentPartners(rows, 2).map((p) => p.otherParticipantId)).toEqual(['p1', 'p2']);
  });

  it('OR-accumulates hasUnread across a partner\'s other conversations, even past the limit', () => {
    const rows = [
      conversation({ otherParticipantId: 'p1', isUnread: false }),
      conversation({ otherParticipantId: 'p2', isUnread: false }),
      conversation({ otherParticipantId: 'p3', isUnread: false }),
      // A later, unread conversation with p1 -- already captured, so it must
      // still flip hasUnread even though the limit below is 1.
      conversation({ otherParticipantId: 'p1', isUnread: true }),
    ];
    const result = selectRecentPartners(rows, 1);
    expect(result).toHaveLength(1);
    expect(result[0].hasUnread).toBe(true);
  });

  it('never flips hasUnread true for a read conversation', () => {
    const rows = [conversation({ otherParticipantId: 'p1', isUnread: false })];
    expect(selectRecentPartners(rows, 10)[0].hasUnread).toBe(false);
  });

  it('resolves name the same way resolveOtherPartyName does', () => {
    const rows = [conversation({ otherParticipantId: 'p1', otherDisplayName: null, otherUsername: 'roy123' })];
    expect(selectRecentPartners(rows, 10)[0].name).toBe('roy123');
  });

  it('returns an empty array for no conversations', () => {
    expect(selectRecentPartners([], 10)).toEqual([]);
  });
});

describe('formatInboxTimestamp', () => {
  // A Tuesday, for the within-week/outside-week boundary below.
  const now = new Date('2026-01-13T15:00:00').getTime();

  it('shows a clock time for a message from earlier today', () => {
    expect(formatInboxTimestamp('2026-01-13T09:05:00', now)).toBe('09:05');
  });

  it('shows a clock time for a message from a few minutes ago, zero-padded', () => {
    expect(formatInboxTimestamp('2026-01-13T14:59:00', now)).toBe('14:59');
  });

  it('shows "Yesterday" for a message from the previous calendar day, even if nearly 24h ago', () => {
    // 11:58pm the day before "now" -- barely over an hour elapsed, but a
    // different calendar day, so this must say Yesterday, not a clock time.
    expect(formatInboxTimestamp('2026-01-12T23:58:00', now)).toBe('Yesterday');
  });

  it('shows "Yesterday" even for a message from just after midnight yesterday', () => {
    expect(formatInboxTimestamp('2026-01-12T00:05:00', now)).toBe('Yesterday');
  });

  it('shows a weekday name within the last week (but not yesterday or today)', () => {
    // 2026-01-13 is a Tuesday; 2026-01-11 is the Sunday three days earlier.
    expect(formatInboxTimestamp('2026-01-11T10:00:00', now)).toBe('Sun');
  });

  it('shows a month/day date for anything a week or older', () => {
    expect(formatInboxTimestamp('2026-01-01T10:00:00', now)).toBe('Jan 1');
  });

  it('clamps a clock-skewed future timestamp to a clock time instead of a negative day count', () => {
    expect(formatInboxTimestamp('2026-01-14T10:00:00', now)).toBe('10:00');
  });

  it('returns an empty string for an unparseable timestamp rather than "NaN:NaN" or throwing', () => {
    expect(formatInboxTimestamp('not-a-date', now)).toBe('');
  });
});
