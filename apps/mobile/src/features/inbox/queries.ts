import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';

import { fetchConversationDetail, fetchInboxPage, markConversationRead } from '@/features/inbox/api';
import { clearUnreadInPages } from '@/features/inbox/inbox-cache';
import { deriveNextInboxCursor, type InboxConversation, type InboxCursor } from '@/features/inbox/inbox';

/**
 * Small on purpose, matching FEED_PAGE_SIZE's reasoning: a page should
 * comfortably cover several screenfuls of conversations without paying to
 * sign cover images that may never be scrolled to.
 */
export const INBOX_PAGE_SIZE = 20;

export const inboxKeys = {
  all: ['inbox'] as const,
  list: () => [...inboxKeys.all, 'list'] as const,
  detail: (id: string) => [...inboxKeys.all, 'detail', id] as const,
};

type InboxInfiniteData = InfiniteData<InboxConversation[], InboxCursor>;

/**
 * No `enabled: !!userId` gate, mirroring `useFeed()` rather than
 * `useMyListings`'s pattern: `inbox_conversations` takes no explicit
 * seller/user parameter — it reads the viewer from `auth.uid()`
 * server-side — so there is no client-held id this hook needs before it can
 * fire.
 *
 * No realtime subscription: the realtime migration deliberately does not
 * publish `conversations`, and deriving inbox-level updates from the
 * `messages` stream is out of scope here (see the screen's own
 * focus-triggered refetch instead).
 */
export function useInboxConversations() {
  return useInfiniteQuery({
    queryKey: inboxKeys.list(),
    queryFn: ({ pageParam }: { pageParam: InboxCursor }) =>
      fetchInboxPage({ limit: INBOX_PAGE_SIZE, cursor: pageParam }),
    initialPageParam: null as InboxCursor,
    getNextPageParam: (lastPage: InboxConversation[]) =>
      deriveNextInboxCursor(lastPage, INBOX_PAGE_SIZE),
  });
}

/**
 * The thread header for `[id].tsx`, keyed the same way as every other
 * detail screen in this codebase (`useSellerProfile`, `useListingDetail`):
 * through this feature's own `inboxKeys`, not an inline query key the
 * screen invents for itself.
 */
export function useConversationDetail(id: string) {
  return useQuery({
    queryKey: inboxKeys.detail(id),
    queryFn: () => fetchConversationDetail(id),
  });
}

/**
 * Marks a conversation read and clears its unread state in the inbox cache
 * optimistically-on-success (not optimistic-on-mutate: unlike favoriting,
 * there's no user-visible toggle to desync here — the mutation is fired
 * once on thread-open and either it clears the dot or it doesn't).
 */
export function useMarkConversationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markConversationRead,
    onSuccess: (_data, variables) => {
      queryClient.setQueryData<InboxInfiniteData>(inboxKeys.list(), (current) =>
        current ? clearUnreadInPages(current, variables.conversationId) : current,
      );
    },
  });
}
