import type { ConfirmedMessage } from '@/features/conversation/conversation';

/**
 * Pure cache transforms for optimistic sending.
 *
 * Kept separate from queries.ts for the same reason favorites-cache.ts and
 * inbox-cache.ts are: the whole insert/fail/reconcile path is unit-testable
 * without React, a QueryClient, or a renderer.
 *
 * These all operate on the plain `ConversationMessage[][]` page array (what
 * `InfiniteData.pages` holds), not the `InfiniteData` wrapper itself — the
 * caller in queries.ts is the one that reads/writes `pages` on the actual
 * cache value.
 */

/**
 * A message this device has sent but the server has not yet (or will
 * never) confirm. `tempId` is deterministic from `clientNonce`
 * (`temp:${clientNonce}`, built in queries.ts) — not a fresh id per
 * attempt — so a retry of the same send reuses the identical bubble instead
 * of creating a second one alongside a stuck "failed" one.
 */
export type PendingMessage = {
  kind: 'pending';
  tempId: string;
  clientNonce: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  status: 'sending' | 'failed';
};

export type ConversationMessage = PendingMessage | ConfirmedMessage;

/**
 * Prepends a newly-initiated send to the newest page.
 *
 * Page 0 is the newest page (the history fetch is `created_at desc`, which
 * is also exactly the order an inverted `FlatList` wants) — there is no
 * array reversal anywhere in this feature, so "prepend to page 0" is the
 * one true "put this at the visually-bottom, chronologically-newest spot"
 * operation.
 */
export function insertPendingMessage(
  pages: ConversationMessage[][],
  pending: PendingMessage,
): ConversationMessage[][] {
  if (pages.length === 0) {
    return [[pending]];
  }
  const [first, ...rest] = pages;
  return [[pending, ...first], ...rest];
}

/**
 * Flips one pending message to `'sending'`, in place. Used when a failed
 * bubble is retried with its original `tempId`/`clientNonce` — the same
 * bubble resumes showing a spinner rather than a second one being created
 * alongside the stuck "failed" row.
 *
 * Returns the ORIGINAL reference when nothing matched, matching every other
 * cache transform in this codebase's "unchanged reference means no
 * re-render" convention.
 */
export function markPendingMessageSending(
  pages: ConversationMessage[][],
  tempId: string,
): ConversationMessage[][] {
  return updatePendingStatus(pages, tempId, 'sending');
}

/**
 * Flips one pending message to `'failed'`, in place — never a silent
 * rollback. A send that fails must leave a visible, retryable bubble rather
 * than vanish, which is why `useSendMessage`'s `onError` calls this instead
 * of restoring a pre-mutation snapshot.
 *
 * Returns the ORIGINAL reference when nothing matched, same reasoning as
 * `markPendingMessageSending`.
 */
export function markPendingMessageFailed(
  pages: ConversationMessage[][],
  tempId: string,
): ConversationMessage[][] {
  return updatePendingStatus(pages, tempId, 'failed');
}

function updatePendingStatus(
  pages: ConversationMessage[][],
  tempId: string,
  status: PendingMessage['status'],
): ConversationMessage[][] {
  let changed = false;

  const next = pages.map((page) => {
    let pageChanged = false;

    const nextPage = page.map((message) => {
      if (message.kind !== 'pending' || message.tempId !== tempId || message.status === status) {
        return message;
      }
      pageChanged = true;
      return { ...message, status };
    });

    if (!pageChanged) {
      return page;
    }
    changed = true;
    return nextPage;
  });

  return changed ? next : pages;
}

/**
 * Reconciles a confirmed message (from `useSendMessage`'s own success, or
 * from the Realtime subscription) into the cache. Exactly one of three
 * things happens, checked in this order:
 *
 *   1. A `ConfirmedMessage` with this `id` already exists anywhere -> no-op,
 *      returning the SAME array reference. Covers the Realtime event and
 *      this device's own mutation success racing each other — whichever
 *      lands second is a pure duplicate.
 *   2. A `PendingMessage` matching `opts.tempId` (the mutation-success path,
 *      which knows its own temp id) OR matching `confirmed.clientNonce`
 *      (the Realtime path, which does not) exists -> replaced IN PLACE, at
 *      the same position, so the bubble does not jump in the list.
 *   3. Neither -> genuinely new (typically the other participant's
 *      message) -> prepended to page 0, same convention as
 *      `insertPendingMessage`.
 */
export function mergeConfirmedMessage(
  pages: ConversationMessage[][],
  confirmed: ConfirmedMessage,
  opts?: { tempId?: string },
): ConversationMessage[][] {
  for (const page of pages) {
    for (const message of page) {
      if (message.kind === 'confirmed' && message.id === confirmed.id) {
        return pages;
      }
    }
  }

  let replaced = false;
  const replacedPages = pages.map((page) => {
    if (replaced) {
      return page;
    }
    const index = page.findIndex(
      (message) =>
        message.kind === 'pending' &&
        (message.tempId === opts?.tempId || message.clientNonce === confirmed.clientNonce),
    );
    if (index === -1) {
      return page;
    }
    replaced = true;
    const nextPage = [...page];
    nextPage[index] = confirmed;
    return nextPage;
  });

  if (replaced) {
    return replacedPages;
  }

  if (pages.length === 0) {
    return [[confirmed]];
  }
  const [first, ...rest] = pages;
  return [[confirmed, ...first], ...rest];
}
