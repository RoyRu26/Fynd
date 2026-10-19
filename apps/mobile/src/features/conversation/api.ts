import { supabase } from '@/lib/supabase';
import { requireUserId } from '@/lib/session';
import type { MessageCursor, MessageRow, MessageRpcRow } from '@/features/conversation/conversation';

export type { MessageCursor, MessageRow, MessageRpcRow } from '@/features/conversation/conversation';

/**
 * Database access for one conversation thread.
 *
 * The privilege model this layer respects, enforced server-side:
 *
 *   * `conversation_messages` is `SECURITY INVOKER` (unlike the inbox read
 *     RPCs) — see its own migration comment for why that's correct here:
 *     messages carries no listings-RLS dependency, so the table's own
 *     "Participants read conversation messages" policy is the entire
 *     guarantee, with no DEFINER bypass needed.
 *   * Sending is a direct `insert` into `public.messages`, not an RPC —
 *     see `20260929090100_chat_message_guard_private_schema.sql`'s own
 *     header comment, which states this explicitly as the approved
 *     architecture. RLS pins `sender_id` to `auth.uid()`, the column grant
 *     allowlists exactly `(conversation_id, sender_id, body, client_nonce)`
 *     — `id`/`created_at` are server-controlled — and a flood guard plus a
 *     per-sender unique index on `(conversation_id, sender_id,
 *     client_nonce)` make a retried send idempotent.
 */

/**
 * One page of message history, newest-first — matching
 * `conversation_messages`'s `(created_at, id) DESC` ordering, which is
 * exactly what an inverted `FlatList` wants with no client-side reversal.
 * Returns raw rows; `useMessageHistory` normalizes each one.
 */
export async function fetchMessagePage(params: {
  conversationId: string;
  limit: number;
  cursor: MessageCursor;
}): Promise<MessageRpcRow[]> {
  const { conversationId, limit, cursor } = params;

  const { data, error } = await supabase.rpc('conversation_messages', {
    p_conversation_id: conversationId,
    p_limit: limit,
    p_cursor_created_at: cursor?.createdAt,
    p_cursor_id: cursor?.id,
  });
  if (error) throw error;

  return data;
}

/**
 * Sends one message.
 *
 * A retried send (same `clientNonce`, same sender, same conversation) hits
 * `messages_conversation_sender_nonce_key` and raises Postgres `23505` —
 * per that index's own migration comment, the client contract treats this
 * as "already landed," not a failure. So on `23505` this re-fetches the
 * existing row by the exact natural key
 * `(conversation_id, sender_id, client_nonce)` instead of throwing. Every
 * other error (including the flood guard's `42501`) is rethrown.
 */
export async function sendMessage(params: {
  conversationId: string;
  body: string;
  clientNonce: string;
}): Promise<MessageRow> {
  const { conversationId, body, clientNonce } = params;
  const senderId = await requireUserId('send a message');

  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, body, client_nonce: clientNonce })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: existing, error: fetchError } = await supabase
        .from('messages')
        .select()
        .eq('conversation_id', conversationId)
        .eq('sender_id', senderId)
        .eq('client_nonce', clientNonce)
        .single();
      if (fetchError) throw fetchError;
      return existing;
    }
    throw error;
  }

  return data;
}
