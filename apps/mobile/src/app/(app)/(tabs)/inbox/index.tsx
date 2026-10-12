import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { FlatList, StyleSheet, View, type ListRenderItemInfo } from 'react-native';

import {
  Avatar,
  EmptyState,
  ListingImage,
  ListRow,
  Screen,
  SkeletonRow,
  Text,
  type IconName,
} from '@/components/ui';
import { radius, space } from '@/design/tokens';
import { useAuth } from '@/features/auth/auth-provider';
import { formatLastMessagePreview, resolveOtherPartyName, type InboxConversation } from '@/features/inbox/inbox';
import { mapInboxError } from '@/features/inbox/errors';
import { useInboxConversations } from '@/features/inbox/queries';

/**
 * Inbox — DESIGN.md §14.5. "Pure ListRow + Avatar. The calmest surface in
 * the app." No realtime here: the inbox-level refetch on tab re-focus is
 * the whole update story for this phase (see useInboxConversations' own doc
 * comment for why — deriving updates from the messages stream is 1.3+).
 *
 * The FlatList is the screen's only scroll container, same reasoning as
 * seller/[id].tsx: onEndReached-driven pagination needs to own the actual
 * scroll offset.
 */

// Verified against the installed packages: 'bubble.left.and.bubble.right'
// exists in sf-symbols-typescript's dist/index.d.ts, and
// 'chat_bubble_outline' exists in expo-symbols' android/symbols.json.
const EMPTY_ICON: IconName = {
  ios: 'bubble.left.and.bubble.right',
  android: 'chat_bubble_outline',
  web: 'chat_bubble_outline',
};
// Same icon already used by sell/index.tsx's own error EmptyState.
const ERROR_ICON: IconName = { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' };

const SKELETON_ROW_COUNT = 5;

export default function InboxIndex() {
  const router = useRouter();
  const { session } = useAuth();
  const viewerId = session?.user.id;

  const inboxQuery = useInboxConversations();
  const { refetch } = inboxQuery;

  // NativeTabs keeps every tab mounted, so there is no natural remount to
  // refetch on tab-back. Refetch only on a false->true focus transition —
  // not on every render while focused, and not on first mount (the initial
  // query fetch already covers that).
  const isFocused = useIsFocused();
  const wasFocused = useRef(isFocused);
  useEffect(() => {
    if (isFocused && !wasFocused.current) {
      refetch();
    }
    wasFocused.current = isFocused;
  }, [isFocused, refetch]);

  const conversations = inboxQuery.data?.pages.flat() ?? [];

  const openConversation = useCallback(
    (conversation: InboxConversation) => {
      router.push({
        pathname: '/(app)/(tabs)/inbox/[id]',
        params: { id: conversation.conversationId, lastMessageAt: conversation.lastMessageAt },
      });
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<InboxConversation>) => (
      <ConversationRow
        conversation={item}
        viewerId={viewerId}
        onPress={() => openConversation(item)}
      />
    ),
    [viewerId, openConversation],
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = inboxQuery;
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  let listEmpty: ReactNode = null;
  if (inboxQuery.isPending) {
    listEmpty = (
      <View style={styles.rows}>
        {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
          <SkeletonRow key={index} />
        ))}
      </View>
    );
  } else if (inboxQuery.isError) {
    listEmpty = (
      <EmptyState
        variant="error"
        icon={ERROR_ICON}
        title="Something went wrong"
        body={mapInboxError(inboxQuery.error).message}
        actionLabel="Try again"
        onAction={() => inboxQuery.refetch()}
      />
    );
  } else {
    listEmpty = (
      <EmptyState
        variant="empty"
        icon={EMPTY_ICON}
        title="No messages yet."
        body="When you contact a seller, or someone messages you about a listing, it'll show up here."
      />
    );
  }

  return (
    <Screen contentContainerStyle={styles.content}>
      <Text variant="title">Inbox</Text>
      <FlatList
        style={styles.list}
        data={conversations}
        keyExtractor={(item) => item.conversationId}
        renderItem={renderItem}
        ListEmptyComponent={listEmpty}
        onEndReached={handleEndReached}
        onEndReachedThreshold={1.5}
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.footerSpinner}>
              <SkeletonRow />
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

function ConversationRow({
  conversation,
  viewerId,
  onPress,
}: {
  conversation: InboxConversation;
  viewerId: string | undefined;
  onPress: () => void;
}) {
  const name = resolveOtherPartyName(conversation);
  // viewerId is only undefined for an instant during session hydration,
  // before this screen's query could have returned any rows — falling back
  // to the other participant's id just means the "You: " prefix can never
  // spuriously apply in that narrow window.
  const subtitle = formatLastMessagePreview(conversation, viewerId ?? conversation.otherParticipantId);

  return (
    <ListRow
      leading={<Avatar size="md" name={name} />}
      title={name}
      subtitle={subtitle}
      unread={conversation.isUnread}
      onPress={onPress}
      trailing={
        <ListingImage
          uri={conversation.coverUrl ?? undefined}
          style={styles.cover}
          accessibilityLabel={
            conversation.listingTitle ? `Listing: ${conversation.listingTitle}` : undefined
          }
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: space[4],
    paddingTop: space[6],
  },
  list: {
    flex: 1,
  },
  rows: {
    gap: space[2],
  },
  cover: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
  },
  footerSpinner: {
    paddingVertical: space[2],
  },
});
