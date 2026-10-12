import type { InboxConversation } from '@/features/inbox/inbox';

/**
 * Pure cache transform for marking a conversation read.
 *
 * Kept separate from queries.ts so the optimistic-update path is
 * unit-testable without React, a QueryClient, or a renderer — mirrors
 * feed/favorites-cache.ts's split for the same reason.
 *
 * Structurally compatible with TanStack's `InfiniteData<InboxConversation[],
 * TPageParam>`, generic over the page-param type so a transformed value can
 * be handed straight back to `setQueryData` without a cast.
 */
export type InboxPages<TPageParam = unknown> = {
  pages: InboxConversation[][];
  pageParams: TPageParam[];
};

/**
 * Sets `unreadCount: 0` and `isUnread: false` on every copy of one
 * conversation, across every loaded page.
 *
 * "Every copy" is deliberate, not defensive — same reasoning as
 * `setFavoriteInPages`: the inbox is keyset-paginated on
 * `(last_message_at, id)`, which makes duplicates across pages unlikely,
 * but a refetch that re-slices page boundaries mid-scroll can still put the
 * same conversation in two loaded pages at once. Clearing only the first
 * match would leave a second row showing a stale unread dot.
 *
 * Returns the ORIGINAL reference when nothing matched. TanStack compares by
 * reference to decide whether to notify subscribers, so an unchanged
 * reference means marking a conversation that has already scrolled out of
 * the cache costs no re-render of the inbox.
 */
export function clearUnreadInPages<TPageParam>(
  data: InboxPages<TPageParam>,
  conversationId: string,
): InboxPages<TPageParam> {
  let changed = false;

  const pages = data.pages.map((page) => {
    let pageChanged = false;

    const next = page.map((conversation) => {
      if (
        conversation.conversationId !== conversationId ||
        (conversation.unreadCount === 0 && !conversation.isUnread)
      ) {
        return conversation;
      }
      pageChanged = true;
      return { ...conversation, unreadCount: 0, isUnread: false };
    });

    if (!pageChanged) {
      return page;
    }
    changed = true;
    return next;
  });

  if (!changed) {
    return data;
  }
  return { ...data, pages };
}
