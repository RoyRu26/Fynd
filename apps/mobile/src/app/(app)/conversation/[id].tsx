import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import {
  Avatar,
  EmptyState,
  Icon,
  IconButton,
  ListRow,
  Screen,
  SkeletonRow,
  Text,
  type IconName,
} from '@/components/ui';
import { Composer } from '@/components/conversation/composer';
import { MessageBubble } from '@/components/conversation/message-bubble';
import { ReviewSheet } from '@/components/review/review-sheet';
import { minTouchTarget, space } from '@/design/tokens';
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
 *
 * Lives at the root, outside (tabs), same reasoning as listing/[id],
 * seller/[id], and follows/[id]: a screen entered from more than one tab's
 * own context doesn't belong inside any single tab's nested stack. This one
 * used to live under (tabs)/inbox/[id] — fine for the Inbox tab's own entry
 * point, but listing/[id].tsx's "Message seller" action (reachable from
 * Home, Explore, a seller profile...) pushed the SAME nested route from
 * outside the Inbox tab's own history, which is what caused a real bug:
 * back() from the conversation had no inbox/index screen underneath it on
 * that tab's stack to return to, and fell all the way back to whatever tab
 * was active before the user ever opened a listing. Rooting it here, like
 * every other multi-entry-point screen, makes back() always return to
 * whatever screen actually pushed it.
 */

const BACK_ICON: IconName = { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' };
// Verified against the installed packages, same discipline as every other
// IconName constant in this codebase: 'star' exists in sf-symbols-
// typescript's types, and 'star_border' exists in expo-symbols' android/
// symbols.json.
const REVIEW_ICON: IconName = { ios: 'star', android: 'star_border', web: 'star_border' };
// Same shape as explore.tsx/inbox/index.tsx's own ERROR_ICON constants.
const ERROR_ICON: IconName = { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' };
// Same "hidden/removed" icon listing-actions-sheet.tsx's ACTION_ICON.remove
// already uses, and seller/[id].tsx's own null-data case reuses.
const UNAVAILABLE_ICON: IconName = { ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' };

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

  // ROADMAP 5.4 -- the review-submission sheet, opened from the "Leave a
  // review" row below. Lives here, not as query-driven visibility, because
  // nothing about dismissing it should ever re-trigger from a refetch.
  const [reviewSheetOpen, setReviewSheetOpen] = useState(false);

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

  // Mounted only once `header`/`name` are known (the sheet needs both as
  // props) -- fine, since it can only ever be opened from the "Leave a
  // review" row in that same branch below, never before.
  let reviewSheet: ReactNode = null;

  let body: ReactNode;
  if (detailQuery.isPending) {
    body = <SkeletonRow />;
  } else if (detailQuery.isError) {
    body = (
      <EmptyState
        variant="error"
        icon={ERROR_ICON}
        title="Something went wrong"
        body={mapInboxError(detailQuery.error).message}
        actionLabel="Try again"
        onAction={() => detailQuery.refetch()}
      />
    );
  } else if (detailQuery.data === null) {
    // Defensive fallback only — see api.ts's own comment: conversation_detail
    // never actually returns an empty result set for "no such
    // conversation"/"not yours", it raises P0002 instead, which surfaces
    // through the isError branch above.
    body = (
      <EmptyState
        variant="empty"
        icon={UNAVAILABLE_ICON}
        title="This conversation isn't available."
        actionLabel="Go back"
        onAction={() => router.back()}
      />
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
      // Deliberately generic, NOT chat-bubble-shaped — DESIGN.md §14.7
      // (message bubble styling) is an open item with no visual spec yet,
      // so a bubble skeleton here would presume a design that doesn't exist.
      listEmpty = (
        <View style={styles.historySkeleton}>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </View>
      );
    } else if (historyQuery.isError) {
      listEmpty = (
        <EmptyState
          variant="error"
          icon={ERROR_ICON}
          title="Something went wrong"
          body={mapInboxError(historyQuery.error).message}
          actionLabel="Try again"
          onAction={() => historyQuery.refetch()}
        />
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

        {/* ROADMAP 5.4 -- rendered only when conversation_detail's own
            `canReview` says this sale is reviewable by the viewer right
            now: a completed sale between exactly these two participants,
            not yet reviewed by the viewer. Disappears on its own once the
            submission succeeds and invalidates this same query, with no
            manual state to flip here. */}
        {header.canReview ? (
          <ListRow
            leading={<Icon name={REVIEW_ICON} color={colors.accent} />}
            title={`Leave a review for ${name}`}
            onPress={() => setReviewSheetOpen(true)}
            accessibilityLabel={`Leave a review for ${name}`}
          />
        ) : null}

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

    reviewSheet = (
      <ReviewSheet
        visible={reviewSheetOpen}
        onClose={() => setReviewSheetOpen(false)}
        conversationId={id}
        listingId={header.listingId}
        revieweeId={header.otherParticipantId}
        revieweeName={name}
      />
    );
  }

  return (
    // scroll=false: the FlatList above owns scrolling, same reasoning as
    // inbox/index.tsx's own FlatList — a second scroll container around it
    // would double-scroll.
    <Screen contentContainerStyle={styles.content} keyboardAvoiding scroll={false}>
      {backRow}
      {body}
      {reviewSheet}
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
  body: {
    flex: 1,
    gap: space[4],
  },
  historySkeleton: {
    gap: space[2],
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  titlePressable: {
    flexShrink: 1,
    // DESIGN.md §12.1: never left to the call site. The two stacked Text
    // lines alone fall well short of 44pt tall, so the touch target is
    // floored here rather than relying on the surrounding row's height.
    minHeight: minTouchTarget,
    justifyContent: 'center',
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
