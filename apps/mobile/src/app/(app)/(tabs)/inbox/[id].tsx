import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import { Avatar, Button, IconButton, Screen, Text, type IconName } from '@/components/ui';
import { Composer } from '@/components/conversation/composer';
import { MessageBubble } from '@/components/conversation/message-bubble';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { mapInboxError } from '@/features/inbox/errors';
import { resolveOtherPartyName } from '@/features/inbox/inbox';
import { useConversationDetail, useMarkConversationRead } from '@/features/inbox/queries';
import { useMessageHistory, useSendMessage, useConversationRealtime } from '@/features/conversation/queries';
import type { ConversationMessage, PendingMessage } from '@/features/conversation/optimistic';

/**
 * Conversation thread — ROADMAP 1.3. DESIGN.md has no visual spec for this
 * screen yet (see the new §14.7 note): the message list below is a
 * deliberate, minimal PLACEHOLDER built only from `MessageBubble` (plain
 * text rows) and existing primitives, pending a real design pass.
 */

const BACK_ICON: IconName = { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' };

function messageKey(message: ConversationMessage): string {
  return message.kind === 'pending' ? message.tempId : message.id;
}

export default function ConversationScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const viewerId = session?.user.id;
  const { id, lastMessageAt } = useLocalSearchParams<{ id: string; lastMessageAt?: string }>();

  const detailQuery = useConversationDetail(id);
  const markRead = useMarkConversationRead();

  const historyQuery = useMessageHistory(id);
  const { sendMessage, retryMessage, isSending } = useSendMessage(id);
  useConversationRealtime(id);

  // Fires once per conversation id — marks read as far as the inbox row the
  // user actually tapped from (lastMessageAt), falling back to the server's
  // own now()-clamped default when navigated to without that param.
  useEffect(() => {
    markRead.mutate({ conversationId: id, upTo: lastMessageAt });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const openListing = useCallback(() => {
    const listingId = detailQuery.data?.listingId;
    if (listingId) {
      router.push({ pathname: '/(app)/listing/[id]', params: { id: listingId } });
    }
  }, [router, detailQuery.data]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = historyQuery;
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const backRow = (
    <View style={styles.header}>
      <IconButton icon={BACK_ICON} accessibilityLabel="Back" onPress={() => router.back()} />
    </View>
  );

  let body: ReactNode;
  if (detailQuery.isPending) {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.textTertiary} />
      </View>
    );
  } else if (detailQuery.isError) {
    body = (
      <View style={styles.centered}>
        <Text variant="body" color="danger">
          {mapInboxError(detailQuery.error).message}
        </Text>
        <Button variant="secondary" size="sm" onPress={() => detailQuery.refetch()}>
          Try again
        </Button>
      </View>
    );
  } else if (detailQuery.data === null) {
    // Defensive fallback only — see api.ts's own comment: conversation_detail
    // never actually returns an empty result set for "no such
    // conversation"/"not yours", it raises P0002 instead, which surfaces
    // through the isError branch above.
    body = (
      <View style={styles.centered}>
        <Text variant="body" color="textSecondary" style={styles.centeredText}>
          This conversation isn&apos;t available.
        </Text>
        <Button variant="secondary" size="sm" onPress={() => router.back()}>
          Go back
        </Button>
      </View>
    );
  } else {
    const header = detailQuery.data;
    const name = resolveOtherPartyName(header);
    const hasListingTitle = Boolean(header.listingTitle);

    const titleBlock = (
      <View>
        <Text variant="bodyStrong">{name}</Text>
        {header.listingTitle ? (
          <Text variant="caption" color="textSecondary">
            {header.listingTitle}
          </Text>
        ) : null}
      </View>
    );

    const messages = historyQuery.data?.pages.flat() ?? [];

    let listEmpty: ReactNode = null;
    if (historyQuery.isPending) {
      listEmpty = (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.textTertiary} />
        </View>
      );
    } else if (historyQuery.isError) {
      listEmpty = (
        <View style={styles.centered}>
          <Text variant="body" color="danger">
            {mapInboxError(historyQuery.error).message}
          </Text>
          <Button variant="secondary" size="sm" onPress={() => historyQuery.refetch()}>
            Try again
          </Button>
        </View>
      );
    } else {
      listEmpty = (
        <View style={styles.centered}>
          <Text variant="body" color="textSecondary">
            Say hello 👋
          </Text>
        </View>
      );
    }

    const renderItem = ({ item }: ListRenderItemInfo<ConversationMessage>) => (
      <MessageBubble
        message={item}
        isOwn={item.senderId === viewerId}
        otherPartyName={name}
        onRetry={(pending: PendingMessage) => retryMessage(pending)}
      />
    );

    body = (
      <View style={styles.body}>
        <View style={styles.identity}>
          <Avatar size="md" source={header.otherAvatarUrl ?? undefined} name={name} />
          {hasListingTitle ? (
            <Pressable
              onPress={openListing}
              accessibilityRole="link"
              accessibilityLabel={`Open listing: ${header.listingTitle}`}
              style={styles.titlePressable}>
              {titleBlock}
            </Pressable>
          ) : (
            titleBlock
          )}
        </View>

        <FlatList
          style={styles.list}
          inverted
          data={messages}
          keyExtractor={messageKey}
          renderItem={renderItem}
          ListEmptyComponent={listEmpty}
          onEndReached={handleEndReached}
          onEndReachedThreshold={1.5}
          contentContainerStyle={styles.listContent}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.footerSpinner}>
                <ActivityIndicator color={colors.textTertiary} />
              </View>
            ) : null
          }
        />

        <Composer onSend={sendMessage} isSending={isSending} />
      </View>
    );
  }

  return (
    // scroll=false: the FlatList above owns scrolling, same reasoning as
    // inbox/index.tsx's own FlatList — a second scroll container around it
    // would double-scroll.
    <Screen contentContainerStyle={styles.content} keyboardAvoiding scroll={false}>
      {backRow}
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: space[4],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    paddingHorizontal: space[6],
  },
  centeredText: {
    textAlign: 'center',
  },
  body: {
    flex: 1,
    gap: space[4],
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  titlePressable: {
    flexShrink: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: space[3],
    paddingVertical: space[2],
  },
  footerSpinner: {
    paddingVertical: space[2],
  },
});
