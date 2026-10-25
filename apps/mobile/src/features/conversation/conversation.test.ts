import { describe, expect, it } from 'vitest';

import {
  buildChatListItems,
  createMessageNonce,
  deriveNextMessageCursor,
  formatDaySeparatorLabel,
  isValidMessageBody,
  normalizeMessageRow,
  type ConfirmedMessage,
  type MessageRow,
} from '@/features/conversation/conversation';

function buildRow(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'msg-1',
    conversation_id: 'conv-1',
    sender_id: 'user-1',
    body: 'hello',
    client_nonce: 'nonce-00000001',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildConfirmed(overrides: Partial<ConfirmedMessage> = {}): ConfirmedMessage {
  return {
    kind: 'confirmed',
    id: 'msg-1',
    clientNonce: 'nonce-00000001',
    conversationId: 'conv-1',
    senderId: 'user-1',
    body: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('normalizeMessageRow', () => {
  it('maps every column to its camelCase domain field', () => {
    const row = buildRow();
    expect(normalizeMessageRow(row)).toEqual({
      kind: 'confirmed',
      id: 'msg-1',
      clientNonce: 'nonce-00000001',
      conversationId: 'conv-1',
      senderId: 'user-1',
      body: 'hello',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('accepts the conversation_messages RPC row shape too (structurally identical)', () => {
    const rpcRow = buildRow({ id: 'msg-2', body: 'from the RPC' });
    expect(normalizeMessageRow(rpcRow).id).toBe('msg-2');
    expect(normalizeMessageRow(rpcRow).body).toBe('from the RPC');
  });
});

describe('deriveNextMessageCursor', () => {
  it('returns null when the page is shorter than the page size (history exhausted)', () => {
    const page = [buildConfirmed()];
    expect(deriveNextMessageCursor(page, 30)).toBeNull();
  });

  it('returns null for an empty page', () => {
    expect(deriveNextMessageCursor([], 30)).toBeNull();
  });

  it('derives the cursor from the LAST row of a full page', () => {
    const page = [
      buildConfirmed({ id: 'a', createdAt: '2026-01-03T00:00:00.000Z' }),
      buildConfirmed({ id: 'b', createdAt: '2026-01-02T00:00:00.000Z' }),
    ];
    expect(deriveNextMessageCursor(page, 2)).toEqual({
      createdAt: '2026-01-02T00:00:00.000Z',
      id: 'b',
    });
  });
});

describe('createMessageNonce', () => {
  it('produces a string within the server CHECK constraint bound (8-64 chars)', () => {
    const nonce = createMessageNonce();
    expect(nonce.length).toBeGreaterThanOrEqual(8);
    expect(nonce.length).toBeLessThanOrEqual(64);
  });

  it('produces a different value on each call', () => {
    const a = createMessageNonce();
    const b = createMessageNonce();
    expect(a).not.toBe(b);
  });
});

describe('isValidMessageBody', () => {
  it('rejects an empty string', () => {
    expect(isValidMessageBody('')).toBe(false);
  });

  it('rejects a whitespace-only string', () => {
    expect(isValidMessageBody('   \n\t  ')).toBe(false);
  });

  it('accepts a body at exactly the 2000-character boundary', () => {
    expect(isValidMessageBody('x'.repeat(2000))).toBe(true);
  });

  it('rejects a body one character past the boundary', () => {
    expect(isValidMessageBody('x'.repeat(2001))).toBe(false);
  });

  it('accepts an ordinary non-empty body', () => {
    expect(isValidMessageBody('Is this still available?')).toBe(true);
  });
});

describe('formatDaySeparatorLabel', () => {
  const now = new Date('2026-01-13T15:00:00').getTime();

  it('labels a message from earlier today as "Today"', () => {
    expect(formatDaySeparatorLabel('2026-01-13T09:05:00', now)).toBe('Today');
  });

  it('labels a message from the previous calendar day as "Yesterday", even if nearly 24h ago', () => {
    expect(formatDaySeparatorLabel('2026-01-12T23:58:00', now)).toBe('Yesterday');
  });

  it('labels a message from just after midnight yesterday as "Yesterday" too', () => {
    expect(formatDaySeparatorLabel('2026-01-12T00:05:00', now)).toBe('Yesterday');
  });

  it('labels anything older than yesterday with a bare month/day date', () => {
    expect(formatDaySeparatorLabel('2026-01-01T10:00:00', now)).toBe('Jan 1');
  });

  it('clamps a clock-skewed future timestamp to "Today" instead of a negative day count', () => {
    expect(formatDaySeparatorLabel('2026-01-14T10:00:00', now)).toBe('Today');
  });

  it('returns an empty string for an unparseable timestamp rather than throwing', () => {
    expect(formatDaySeparatorLabel('not-a-date', now)).toBe('');
  });
});

describe('buildChatListItems', () => {
  const now = new Date('2026-01-13T15:00:00').getTime();

  it('inserts one separator for a single-day, single-sender thread, and shows time only on the newest message', () => {
    const messages = [
      buildConfirmed({ id: 'c', senderId: 'a', createdAt: '2026-01-13T12:00:00' }),
      buildConfirmed({ id: 'b', senderId: 'a', createdAt: '2026-01-13T11:00:00' }),
      buildConfirmed({ id: 'a', senderId: 'a', createdAt: '2026-01-13T10:00:00' }),
    ];
    const items = buildChatListItems(messages, now);
    expect(items).toEqual([
      { kind: 'separator', id: 'day:2026-0-13', label: 'Today' },
      { kind: 'message', message: messages[0], showTime: true },
      { kind: 'message', message: messages[1], showTime: false },
      { kind: 'message', message: messages[2], showTime: false },
    ]);
  });

  it('shows time on the newest message of each consecutive same-day sender run', () => {
    // Newest-first: c(a), b(b), a(a) -- two runs of length 1 each, since the
    // middle message is a different sender from both its neighbors.
    const messages = [
      buildConfirmed({ id: 'c', senderId: 'a', createdAt: '2026-01-13T12:00:00' }),
      buildConfirmed({ id: 'b', senderId: 'b', createdAt: '2026-01-13T11:00:00' }),
      buildConfirmed({ id: 'a', senderId: 'a', createdAt: '2026-01-13T10:00:00' }),
    ];
    const items = buildChatListItems(messages, now);
    const showTimeById = Object.fromEntries(
      items
        .filter((item) => item.kind === 'message')
        .map((item) => [item.message.kind === 'confirmed' ? item.message.id : item.message.tempId, item.showTime]),
    );
    expect(showTimeById).toEqual({ c: true, b: true, a: true });
  });

  it('inserts a separator between two different days, and always shows time at a day boundary even for the same sender', () => {
    const messages = [
      buildConfirmed({ id: 'b', senderId: 'a', createdAt: '2026-01-13T09:00:00' }), // today
      buildConfirmed({ id: 'a', senderId: 'a', createdAt: '2026-01-12T20:00:00' }), // yesterday
    ];
    const items = buildChatListItems(messages, now);
    expect(items).toEqual([
      { kind: 'separator', id: 'day:2026-0-13', label: 'Today' },
      { kind: 'message', message: messages[0], showTime: true },
      { kind: 'separator', id: 'day:2026-0-12', label: 'Yesterday' },
      { kind: 'message', message: messages[1], showTime: true },
    ]);
  });

  it('returns an empty array for no messages', () => {
    expect(buildChatListItems([], now)).toEqual([]);
  });
});
