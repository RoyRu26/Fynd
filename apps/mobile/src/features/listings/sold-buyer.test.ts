import { describe, expect, it } from 'vitest';

import {
  associateSoldBuyerAvatarUrls,
  formatSoldBuyerSubtitle,
  normalizeSoldBuyerRow,
  resolveSoldBuyerName,
  type NormalizedSoldBuyerCandidate,
  type SoldBuyerRpcRow,
} from '@/features/listings/sold-buyer';

/**
 * `SoldBuyerRpcRow`'s generated fields are typed as non-null strings --
 * `RETURNS TABLE` cannot express per-column nullability, see
 * `normalizeSoldBuyerRow`'s own doc comment -- even though several are
 * genuinely nullable at runtime. `overrides` is deliberately untyped
 * (not `Partial<SoldBuyerRpcRow>`) so this helper can construct exactly
 * those runtime-null rows the generated type claims cannot exist.
 */
function makeRow(overrides: Record<string, unknown> = {}): SoldBuyerRpcRow {
  return {
    buyer_id: 'buyer-1',
    buyer_display_name: 'Jamie Doe',
    buyer_username: 'jamied',
    buyer_avatar_path: 'buyer-1/avatar.jpg',
    last_message_at: '2026-10-01T12:00:00.000Z',
    last_message_body: 'Is this still available?',
    ...overrides,
  } as SoldBuyerRpcRow;
}

describe('normalizeSoldBuyerRow', () => {
  it('maps every snake_case field to its camelCase domain field', () => {
    expect(normalizeSoldBuyerRow(makeRow())).toEqual({
      buyerId: 'buyer-1',
      displayName: 'Jamie Doe',
      username: 'jamied',
      avatarPath: 'buyer-1/avatar.jpg',
      lastMessageAt: '2026-10-01T12:00:00.000Z',
      lastMessageBody: 'Is this still available?',
    });
  });

  it('preserves genuine nulls rather than coercing them', () => {
    const normalized = normalizeSoldBuyerRow(
      makeRow({ buyer_display_name: null, buyer_username: null, buyer_avatar_path: null, last_message_body: null }),
    );

    expect(normalized.displayName).toBeNull();
    expect(normalized.username).toBeNull();
    expect(normalized.avatarPath).toBeNull();
    expect(normalized.lastMessageBody).toBeNull();
  });
});

describe('associateSoldBuyerAvatarUrls', () => {
  function makeNormalized(overrides: Partial<NormalizedSoldBuyerCandidate> = {}): NormalizedSoldBuyerCandidate {
    return {
      buyerId: 'buyer-1',
      displayName: 'Jamie Doe',
      username: 'jamied',
      avatarPath: 'buyer-1/avatar.jpg',
      lastMessageAt: '2026-10-01T12:00:00.000Z',
      lastMessageBody: 'Is this still available?',
      ...overrides,
    };
  }

  it('attaches the resolved URL when the path has one', () => {
    const [result] = associateSoldBuyerAvatarUrls(
      [makeNormalized()],
      { 'buyer-1/avatar.jpg': 'https://signed.example/avatar.jpg' },
    );

    expect(result.avatarUrl).toBe('https://signed.example/avatar.jpg');
  });

  it('resolves to null, never throwing, when the path has no signed URL', () => {
    const [result] = associateSoldBuyerAvatarUrls([makeNormalized()], {});

    expect(result.avatarUrl).toBeNull();
  });

  it('resolves to null when the candidate has no avatar path at all', () => {
    const [result] = associateSoldBuyerAvatarUrls(
      [makeNormalized({ avatarPath: null })],
      { 'buyer-1/avatar.jpg': 'https://signed.example/avatar.jpg' },
    );

    expect(result.avatarUrl).toBeNull();
  });
});

describe('resolveSoldBuyerName', () => {
  it('prefers the display name when present', () => {
    expect(resolveSoldBuyerName({ displayName: 'Jamie Doe', username: 'jamied' })).toBe('Jamie Doe');
  });

  it('falls back to the username when there is no display name', () => {
    expect(resolveSoldBuyerName({ displayName: null, username: 'jamied' })).toBe('jamied');
  });

  it('falls back to a generic placeholder when neither is set', () => {
    expect(resolveSoldBuyerName({ displayName: null, username: null })).toBe('Fynd user');
  });
});

describe('formatSoldBuyerSubtitle', () => {
  it('returns the last message body when present', () => {
    expect(formatSoldBuyerSubtitle({ lastMessageBody: 'Is this still available?' })).toBe(
      'Is this still available?',
    );
  });

  it('falls back to a neutral placeholder when the conversation has no messages yet', () => {
    expect(formatSoldBuyerSubtitle({ lastMessageBody: null })).toBe('No messages yet');
  });
});
