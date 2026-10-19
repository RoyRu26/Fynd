import { describe, expect, it } from 'vitest';

import {
  createMessageNonce,
  deriveNextMessageCursor,
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
