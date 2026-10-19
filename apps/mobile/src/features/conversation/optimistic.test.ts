import { describe, expect, it } from 'vitest';

import type { ConfirmedMessage } from '@/features/conversation/conversation';
import {
  insertPendingMessage,
  markPendingMessageFailed,
  markPendingMessageSending,
  mergeConfirmedMessage,
  type ConversationMessage,
  type PendingMessage,
} from '@/features/conversation/optimistic';

function buildPending(overrides: Partial<PendingMessage> = {}): PendingMessage {
  return {
    kind: 'pending',
    tempId: 'temp:nonce-1',
    clientNonce: 'nonce-1',
    conversationId: 'conv-1',
    senderId: 'user-1',
    body: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'sending',
    ...overrides,
  };
}

function buildConfirmed(overrides: Partial<ConfirmedMessage> = {}): ConfirmedMessage {
  return {
    kind: 'confirmed',
    id: 'msg-1',
    clientNonce: 'nonce-1',
    conversationId: 'conv-1',
    senderId: 'user-1',
    body: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('insertPendingMessage', () => {
  it('prepends to page 0 when pages already exist', () => {
    const existing = buildConfirmed({ id: 'existing' });
    const pending = buildPending();
    const pages: ConversationMessage[][] = [[existing], [buildConfirmed({ id: 'older' })]];

    const result = insertPendingMessage(pages, pending);

    expect(result).toEqual([[pending, existing], [buildConfirmed({ id: 'older' })]]);
    // The second page is untouched by reference.
    expect(result[1]).toBe(pages[1]);
  });

  it('creates a first page when there are no pages at all', () => {
    const pending = buildPending();
    expect(insertPendingMessage([], pending)).toEqual([[pending]]);
  });
});

describe('markPendingMessageSending', () => {
  it('flips a matching pending message back to sending, in place', () => {
    const failed = buildPending({ status: 'failed' });
    const pages: ConversationMessage[][] = [[failed, buildConfirmed()]];

    const result = markPendingMessageSending(pages, failed.tempId);

    expect(result[0][0]).toEqual({ ...failed, status: 'sending' });
    expect(result[0][1]).toBe(pages[0][1]);
  });

  it('returns the original reference when no match exists', () => {
    const pages: ConversationMessage[][] = [[buildConfirmed()]];
    expect(markPendingMessageSending(pages, 'temp:does-not-exist')).toBe(pages);
  });
});

describe('markPendingMessageFailed', () => {
  it('flips a matching pending message to failed, in place', () => {
    const sending = buildPending({ status: 'sending' });
    const pages: ConversationMessage[][] = [[sending]];

    const result = markPendingMessageFailed(pages, sending.tempId);

    expect(result[0][0]).toEqual({ ...sending, status: 'failed' });
  });

  it('returns the original reference when no match exists', () => {
    const pages: ConversationMessage[][] = [[buildConfirmed()]];
    expect(markPendingMessageFailed(pages, 'temp:does-not-exist')).toBe(pages);
  });

  it('returns the original reference when the message is already failed', () => {
    const failed = buildPending({ status: 'failed' });
    const pages: ConversationMessage[][] = [[failed]];
    expect(markPendingMessageFailed(pages, failed.tempId)).toBe(pages);
  });
});

describe('mergeConfirmedMessage', () => {
  it('branch 1: no-ops and returns the SAME reference when the id already exists', () => {
    const confirmed = buildConfirmed({ id: 'msg-1' });
    const pages: ConversationMessage[][] = [[confirmed]];

    const result = mergeConfirmedMessage(pages, buildConfirmed({ id: 'msg-1', body: 'different text' }));

    expect(result).toBe(pages);
  });

  it('branch 2: replaces a pending message by tempId, in place (mutation onSuccess path)', () => {
    const pending = buildPending({ tempId: 'temp:nonce-1', clientNonce: 'nonce-1' });
    const other = buildConfirmed({ id: 'other', clientNonce: 'nonce-other' });
    const pages: ConversationMessage[][] = [[pending, other]];
    const confirmed = buildConfirmed({ id: 'msg-1', clientNonce: 'nonce-1' });

    const result = mergeConfirmedMessage(pages, confirmed, { tempId: pending.tempId });

    expect(result[0][0]).toEqual(confirmed);
    expect(result[0][1]).toBe(other);
  });

  it('branch 2: replaces a pending message by clientNonce when no tempId is given (realtime-first path)', () => {
    const pending = buildPending({ tempId: 'temp:nonce-1', clientNonce: 'nonce-1' });
    const pages: ConversationMessage[][] = [[pending]];
    const confirmed = buildConfirmed({ id: 'msg-1', clientNonce: 'nonce-1' });

    const result = mergeConfirmedMessage(pages, confirmed);

    expect(result[0][0]).toEqual(confirmed);
  });

  it('branch 3: prepends a genuinely new message (the other participant) to page 0', () => {
    const mine = buildPending();
    const pages: ConversationMessage[][] = [[mine]];
    const theirs = buildConfirmed({ id: 'theirs', clientNonce: 'their-nonce', senderId: 'user-2' });

    const result = mergeConfirmedMessage(pages, theirs);

    expect(result[0]).toEqual([theirs, mine]);
  });

  it('branch 3: creates a first page when there are no pages at all', () => {
    const confirmed = buildConfirmed();
    expect(mergeConfirmedMessage([], confirmed)).toEqual([[confirmed]]);
  });
});
