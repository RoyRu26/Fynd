import { describe, expect, it } from 'vitest';

import { clearUnreadInPages, type InboxPages } from '@/features/inbox/inbox-cache';
import type { InboxConversation } from '@/features/inbox/inbox';

function conversation(id: string, unreadCount = 2): InboxConversation {
  return {
    conversationId: id,
    listingId: `listing-${id}`,
    listingTitle: `Listing ${id}`,
    listingStatus: 'active',
    coverStoragePath: `seller-1/${id}/cover.jpg`,
    coverUrl: `https://signed/${id}`,
    otherParticipantId: 'other-1',
    otherUsername: 'roy',
    otherDisplayName: 'Roy',
    otherAvatarPath: null,
    lastMessageAt: '2026-01-02T10:00:00+00:00',
    lastMessageBody: 'Hey!',
    lastMessageSenderId: 'other-1',
    unreadCount,
    isUnread: unreadCount > 0,
  };
}

function pages(...pageContents: InboxConversation[][]): InboxPages<number> {
  return {
    pages: pageContents,
    pageParams: pageContents.map((_, index) => index),
  };
}

describe('clearUnreadInPages', () => {
  it('clears the targeted conversation and leaves others untouched', () => {
    const data = pages([conversation('a'), conversation('b')]);
    const next = clearUnreadInPages(data, 'a');

    const a = next.pages[0].find((c) => c.conversationId === 'a');
    const b = next.pages[0].find((c) => c.conversationId === 'b');
    expect(a).toEqual({ ...conversation('a'), unreadCount: 0, isUnread: false });
    expect(b).toEqual(conversation('b'));
  });

  it('returns the ORIGINAL reference when nothing matched', () => {
    const data = pages([conversation('a'), conversation('b')]);
    const next = clearUnreadInPages(data, 'nonexistent');
    expect(next).toBe(data);
  });

  it('returns the ORIGINAL reference when the conversation is already read', () => {
    const data = pages([conversation('a', 0)]);
    const next = clearUnreadInPages(data, 'a');
    expect(next).toBe(data);
  });

  it('clears every duplicate copy of the conversation across multiple pages', () => {
    const data = pages([conversation('a'), conversation('b')], [conversation('a'), conversation('c')]);
    const next = clearUnreadInPages(data, 'a');

    const firstPageA = next.pages[0].find((c) => c.conversationId === 'a');
    const secondPageA = next.pages[1].find((c) => c.conversationId === 'a');
    expect(firstPageA?.isUnread).toBe(false);
    expect(firstPageA?.unreadCount).toBe(0);
    expect(secondPageA?.isUnread).toBe(false);
    expect(secondPageA?.unreadCount).toBe(0);

    // Untouched rows in both pages.
    expect(next.pages[0].find((c) => c.conversationId === 'b')).toEqual(conversation('b'));
    expect(next.pages[1].find((c) => c.conversationId === 'c')).toEqual(conversation('c'));
  });

  it('leaves an unaffected page as the ORIGINAL array reference', () => {
    const data = pages([conversation('a')], [conversation('b')]);
    const next = clearUnreadInPages(data, 'a');
    expect(next.pages[1]).toBe(data.pages[1]);
  });
});
