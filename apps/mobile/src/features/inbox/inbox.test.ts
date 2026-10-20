import { describe, expect, it } from 'vitest';

import {
  associateConversationHeaderAvatarUrl,
  associateInboxAvatarUrls,
  associateInboxCoverUrls,
  deriveNextInboxCursor,
  formatLastMessagePreview,
  normalizeConversationHeader,
  normalizeInboxRow,
  resolveOtherPartyName,
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

describe('associateConversationHeaderAvatarUrl', () => {
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
      ...overrides,
    };
  }

  it('resolves otherAvatarUrl when the path has a matching signed url', () => {
    const result = associateConversationHeaderAvatarUrl(header(), {
      'other-1/avatar.jpg': 'https://signed/avatar.jpg',
    });
    expect(result).toEqual({ ...header(), otherAvatarUrl: 'https://signed/avatar.jpg' });
  });

  it('does not throw when otherAvatarPath is null — resolves otherAvatarUrl to null', () => {
    const h = header({ otherAvatarPath: null });
    expect(() => associateConversationHeaderAvatarUrl(h, {})).not.toThrow();
    expect(associateConversationHeaderAvatarUrl(h, {}).otherAvatarUrl).toBeNull();
  });

  it('does not throw when the path fails to resolve a signed url — resolves otherAvatarUrl to null', () => {
    const h = header({ otherAvatarPath: 'other-1/avatar.jpg' });
    expect(() => associateConversationHeaderAvatarUrl(h, {})).not.toThrow();
    expect(associateConversationHeaderAvatarUrl(h, {}).otherAvatarUrl).toBeNull();
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
