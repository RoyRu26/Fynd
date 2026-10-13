import type { RealtimePostgresInsertPayload } from '@supabase/supabase-js';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useEffect } from 'react';

import { fetchMessagePage, sendMessage } from '@/features/conversation/api';
import {
  createMessageNonce,
  deriveNextMessageCursor,
  normalizeMessageRow,
  type ConfirmedMessage,
  type MessageCursor,
  type MessageRow,
} from '@/features/conversation/conversation';
import {
  insertPendingMessage,
  markPendingMessageFailed,
  markPendingMessageSending,
  mergeConfirmedMessage,
  type ConversationMessage,
  type PendingMessage,
} from '@/features/conversation/optimistic';
import { useAuth } from '@/features/auth/auth-provider';
import { supabase } from '@/lib/supabase';

/**
 * Small on purpose, matching FEED_PAGE_SIZE / INBOX_PAGE_SIZE's reasoning: a
 * page should comfortably cover several screenfuls of a thread without
 * paying to fetch history that may never be scrolled to.
 */
export const MESSAGE_PAGE_SIZE = 30;

export const conversationKeys = {
  all: ['conversation'] as const,
  messages: (id: string) => [...conversationKeys.all, 'messages', id] as const,
};

type ConversationInfiniteData = InfiniteData<ConversationMessage[], MessageCursor>;

/**
 * The message history for one thread, newest-first (index 0 of page 0 is
 * the newest message) — matching exactly what an `inverted` `FlatList`
 * wants, with no array reversal anywhere in this feature.
 *
 * The query function only ever fetches `ConfirmedMessage`s, but
 * `useSendMessage`/`useConversationRealtime` below write optimistic
 * `PendingMessage`s directly into this SAME cache entry via
 * `setQueryData<ConversationInfiniteData>`, so the value this hook actually
 * exposes at render time can legitimately contain both. `select` widens the
 * exposed type to that union with a trivial identity pass-through — sound
 * because every fetched page (`ConfirmedMessage[]`) already satisfies the
 * wider `ConversationMessage[]`.
 */
export function useMessageHistory(conversationId: string) {
  return useInfiniteQuery({
    queryKey: conversationKeys.messages(conversationId),
    queryFn: async ({ pageParam }: { pageParam: MessageCursor }): Promise<ConfirmedMessage[]> => {
      const rows = await fetchMessagePage({
        conversationId,
        limit: MESSAGE_PAGE_SIZE,
        cursor: pageParam,
      });
      return rows.map(normalizeMessageRow);
    },
    initialPageParam: null as MessageCursor,
    getNextPageParam: (lastPage: ConfirmedMessage[]) =>
      deriveNextMessageCursor(lastPage, MESSAGE_PAGE_SIZE),
    select: (data): ConversationInfiniteData => data,
  });
}

// ============================================================
// Sending
// ============================================================

type SendMessageVariables = {
  body: string;
  clientNonce: string;
  /** Distinguishes a brand-new send from a retry of an existing bubble, so
   * `onMutate` either inserts a new pending message or flips the existing
   * one back to `'sending'` — never both, and never a second bubble. */
  isRetry: boolean;
};

/**
 * Sends messages in `conversationId`, with optimistic bubbles and a
 * visible, retryable failure state.
 *
 * Mirrors `useToggleFavorite`'s onMutate/onError/onSuccess shape, with one
 * deliberate difference: `onError` does NOT restore a pre-mutation
 * snapshot. Rolling back would silently vanish the bubble the user just
 * watched themselves send — exactly the "offline send disappears" failure
 * this feature exists to avoid. Instead it flips the SAME pending message
 * to `'failed'`, so the user sees a clear retry affordance.
 *
 * `clientNonce`/`tempId` are what make a retry idempotent end to end:
 * retrying reuses the original `clientNonce`, so a duplicate landing
 * server-side resolves via `sendMessage`'s own `23505` handling rather than
 * creating a second row, and `tempId = temp:${clientNonce}` is deterministic
 * so the SAME pending bubble is reused rather than a second one appearing
 * next to a stuck "failed" one.
 */
export function useSendMessage(conversationId: string) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const senderId = session?.user.id;
  const queryKey = conversationKeys.messages(conversationId);

  const mutation = useMutation({
    mutationFn: (variables: SendMessageVariables) =>
      sendMessage({ conversationId, body: variables.body, clientNonce: variables.clientNonce }),

    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey });

      const tempId = `temp:${variables.clientNonce}`;

      queryClient.setQueryData<ConversationInfiniteData>(queryKey, (current) => {
        if (!current) {
          return current;
        }
        if (variables.isRetry) {
          return { ...current, pages: markPendingMessageSending(current.pages, tempId) };
        }
        // senderId is only missing for an instant during session hydration,
        // before a signed-out user could have reached this screen at all —
        // if it happens, skip the optimistic insert rather than fabricate an
        // owner for the bubble; the real row still lands via onSuccess.
        if (!senderId) {
          return current;
        }
        const pending: PendingMessage = {
          kind: 'pending',
          tempId,
          clientNonce: variables.clientNonce,
          conversationId,
          senderId,
          body: variables.body,
          createdAt: new Date().toISOString(),
          status: 'sending',
        };
        return { ...current, pages: insertPendingMessage(current.pages, pending) };
      });
    },

    onError: (_error, variables) => {
      const tempId = `temp:${variables.clientNonce}`;
      queryClient.setQueryData<ConversationInfiniteData>(queryKey, (current) =>
        current ? { ...current, pages: markPendingMessageFailed(current.pages, tempId) } : current,
      );
    },

    onSuccess: (data: MessageRow, variables) => {
      const confirmed = normalizeMessageRow(data);
      const tempId = `temp:${variables.clientNonce}`;
      queryClient.setQueryData<ConversationInfiniteData>(queryKey, (current) =>
        current
          ? { ...current, pages: mergeConfirmedMessage(current.pages, confirmed, { tempId }) }
          : current,
      );
    },
  });

  return {
    sendMessage: (body: string) => {
      mutation.mutate({ body, clientNonce: createMessageNonce(), isRetry: false });
    },
    /** Re-sends a failed bubble with the SAME clientNonce/tempId. */
    retryMessage: (pending: PendingMessage) => {
      mutation.mutate({ body: pending.body, clientNonce: pending.clientNonce, isRetry: true });
    },
    isSending: mutation.isPending,
  };
}

// ============================================================
// Realtime
// ============================================================

/**
 * Live delivery for `conversationId`, via Postgres Changes on
 * `public.messages` — the first Realtime subscription anywhere in this
 * app. See `20260929090300_chat_messages_realtime.sql`'s own header for why
 * Postgres Changes rather than Broadcast, and why `conversations` itself is
 * not subscribed here.
 *
 * `apply_rls` re-evaluates "Participants read conversation messages" per
 * subscriber, per row, so a client cannot widen what it receives by
 * tampering with the channel filter — the filter below is purely an
 * efficiency knob that narrows delivery to this one thread.
 *
 * Re-subscribes whenever `conversationId` changes, and always unsubscribes
 * on cleanup via `supabase.removeChannel` — verified against the installed
 * `@supabase/supabase-js@2.112.4` API shape (`channel().on('postgres_changes',
 * { event, schema, table, filter }, callback).subscribe()`), not assumed.
 */
export function useConversationRealtime(conversationId: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const queryKey = conversationKeys.messages(conversationId);

    const handleInsert = (payload: RealtimePostgresInsertPayload<MessageRow>) => {
      const confirmed = normalizeMessageRow(payload.new);
      // No tempId: a message arriving over Realtime did not originate from
      // this device's own mutation, so `mergeConfirmedMessage`'s
      // clientNonce-matching branch is the one that can fire (this
      // participant's own send, echoed back before `onSuccess` ran) —
      // otherwise it is genuinely new, from the other participant.
      queryClient.setQueryData<ConversationInfiniteData>(queryKey, (current) =>
        current ? { ...current, pages: mergeConfirmedMessage(current.pages, confirmed, {}) } : current,
      );
    };

    const channel = supabase
      .channel(`conversation-messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        handleInsert,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient]);
}
