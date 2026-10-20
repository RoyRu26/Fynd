import type { IconName } from '@/components/ui';
import type { Database } from '@/types/database';

/**
 * Pure logic for ROADMAP 5.3 "Mark sold to a buyer": RPC-row normalization
 * and the picker's display fallbacks for `listing_conversation_buyers`.
 *
 * No react-native or `@/lib/supabase` import of any kind — same split as
 * `inbox/inbox.ts` and `follows/follows.ts`, and for the identical reason:
 * `@/lib/supabase` transitively pulls in react-native's own Flow-syntax
 * source, which the Vitest transform cannot parse. Keeping this logic here,
 * separate from `api.ts` (which does import `@/lib/supabase`), is what makes
 * it directly unit-testable.
 */

/** The generated `listing_conversation_buyers` RPC row shape, aliased for readability. */
export type SoldBuyerRpcRow =
  Database['public']['Functions']['listing_conversation_buyers']['Returns'][number];

// Shared by listing-actions-sheet.tsx's ACTION_ICON.mark_sold and
// sold-buyer-picker.tsx's pinned "Sold outside Fynd" row -- deliberately
// the same glyph, since the picker's pinned row is a second view of the
// exact same action. Lives here (not in either of those two files) so
// neither one has to import from the other to share it, and the `IconName`
// import above is type-only (erased at compile time), so this stays a
// plain object literal with no runtime react-native dependency -- the
// same purity this module's own header comment is about.
// Verified against the installed packages, same discipline as every other
// IconName constant in this codebase.
export const MARK_SOLD_ICON: IconName = { ios: 'checkmark.circle', android: 'check_circle', web: 'check_circle' };

/** One buyer the seller may pick, resolved and ready to render. */
export type SoldBuyerCandidate = {
  buyerId: string;
  displayName: string | null;
  username: string | null;
  avatarPath: string | null;
  avatarUrl: string | null;
  lastMessageAt: string;
  lastMessageBody: string | null;
};

export type NormalizedSoldBuyerCandidate = Omit<SoldBuyerCandidate, 'avatarUrl'>;

/**
 * Row -> domain normalization.
 *
 * `listing_conversation_buyers`'s generated return type claims
 * `buyer_display_name`/`buyer_username`/`buyer_avatar_path` are all
 * non-null, because PostgreSQL's `RETURNS TABLE` cannot express per-column
 * nullability — but every one is genuinely nullable at runtime, the same
 * `profiles` columns `inbox.ts`'s `normalizeInboxRow` and `follows.ts`'s
 * `normalizeFollowListRow` already correct for the identical reason (a
 * profile that hasn't finished onboarding). `last_message_body` is
 * likewise claimed non-null but `conversations.last_message_body` carries
 * no NOT NULL constraint — a conversation the buyer opened but never sent
 * a message into genuinely has it as null.
 */
export function normalizeSoldBuyerRow(row: SoldBuyerRpcRow): NormalizedSoldBuyerCandidate {
  return {
    buyerId: row.buyer_id,
    displayName: row.buyer_display_name,
    username: row.buyer_username,
    avatarPath: row.buyer_avatar_path,
    lastMessageAt: row.last_message_at,
    lastMessageBody: row.last_message_body,
  };
}

/**
 * Attaches each candidate's resolved avatar URL. Null-tolerant, never
 * throw-on-missing — same contract as `associateInboxAvatarUrls`/
 * `associateFollowListAvatarUrls`: a missing avatar is a legitimate
 * permanent state, not an invariant violation.
 */
export function associateSoldBuyerAvatarUrls(
  rows: NormalizedSoldBuyerCandidate[],
  urlsByPath: Record<string, string>,
): SoldBuyerCandidate[] {
  return rows.map((row) => ({
    ...row,
    avatarUrl: row.avatarPath ? urlsByPath[row.avatarPath] ?? null : null,
  }));
}

/**
 * The picker row's title: display name, else username, else a sensible
 * default — the exact same fallback chain as `inbox.ts`'s
 * `resolveOtherPartyName`, which this mirrors rather than reinventing
 * (both resolve "how do we refer to this profile" from the identical pair
 * of nullable columns).
 */
export function resolveSoldBuyerName(buyer: {
  displayName: string | null;
  username: string | null;
}): string {
  return buyer.displayName ?? buyer.username ?? 'Fynd user';
}

/**
 * The picker row's subtitle: the last message's body (truncated by the
 * server already, see `conversations.last_message_body`), or a neutral
 * placeholder for a conversation the buyer opened but never actually sent
 * a message into — distinct wording from `inbox.ts`'s own "Say hello 👋"
 * fallback, which is phrased as an instruction to the VIEWER (the buyer,
 * in that screen); here the viewer is the SELLER deciding who to mark as
 * sold-to, for whom "say hello" would not make sense.
 */
export function formatSoldBuyerSubtitle(buyer: { lastMessageBody: string | null }): string {
  return buyer.lastMessageBody ?? 'No messages yet';
}
