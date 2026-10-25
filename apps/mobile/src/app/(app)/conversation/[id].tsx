import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import {
  EmptyState,
  Icon,
  IconButton,
  ListRow,
  Screen,
  SkeletonRow,
  StoryRing,
  Text,
  type IconName,
} from '@/components/ui';
import { Composer } from '@/components/conversation/composer';
import { DaySeparator } from '@/components/conversation/day-separator';
import { MessageBubble } from '@/components/conversation/message-bubble';
import { MoreActionsSheet } from '@/components/report/more-actions-sheet';
import { PinnedListingStrip } from '@/components/conversation/pinned-listing-strip';
import { ReviewSheet } from '@/components/review/review-sheet';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { buildChatListItems, type ChatListItem } from '@/features/conversation/conversation';
import { mapInboxError } from '@/features/inbox/errors';
import { formatConversationRoleCaption, getInboxRole, resolveOtherPartyName } from '@/features/inbox/inbox';
import { useConversationDetail, useMarkConversationRead } from '@/features/inbox/queries';
import { useSellerReviewSummary } from '@/features/reviews/queries';
import { useMessageHistory, useSendMessage, useConversationRealtime } from '@/features/conversation/queries';
import type { PendingMessage } from '@/features/conversation/optimistic';

/**
 * Conversation thread — ROADMAP 1.3, styled per SCREENS.md Task 8 / the 5a
 * handoff, replacing Task 6's 2d-spec styling entirely: a `StoryRing`
 * avatar + role/rating caption + overflow menu in the header, a restyled
 * `PinnedListingStrip`, day separators and grouped message timestamps
 * (`buildChatListItems`), restyled `MessageBubble`s, and a `Composer` with
 * quick replies on a brand-new thread. All existing data/loading/empty/
 * error logic, the `ReviewSheet`, and pagination are unchanged — restyle
 * only, per the handoff's own ground rule.
 *
 * "Needs backend" items are skipped with a TODO, per the handoff's own
 * instruction: inline offer cards, a heart long-press reaction, and image
 * messages. None has a column, table or RPC anywhere in the schema
 * (`messages` carries only `body`/`client_nonce`/timestamps/ids — see
 * `20260929090000_chat_conversations_and_messages.sql`), so building any of
 * them now would mean inventing data, not restyling against real data.
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
// Same pair seller/[id].tsx's own MORE_ICON uses for the identical overflow menu.
const MORE_ICON: IconName = { ios: 'ellipsis', android: 'more_vert', web: 'more_vert' };

const HEADER_AVATAR_SIZE = 42;
const CHAT_LIST_GAP = 10;

function chatListItemKey(item: ChatListItem): string {
  if (item.kind === 'separator') {
    return item.id;
  }
  return item.message.kind === 'pending' ? item.message.tempId : item.message.id;
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
  // SCREENS.md Task 8's overflow menu (Report / Block), independent of
  // detailQuery's own loading state -- its target is the OTHER participant
  // id, which only exists once the header has loaded, so this is only ever
  // opened from a button that is itself gated on that same data (see body
  // below) rather than from something reachable earlier.
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

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

  const messages = useMemo(() => historyQuery.data?.pages.flat() ?? [], [historyQuery.data]);
  const chatListItems = useMemo(() => buildChatListItems(messages), [messages]);

  const reviewSummaryQuery = useSellerReviewSummary(detailQuery.data?.otherParticipantId);

  const backRow = (
    <View style={styles.header}>
      <IconButton icon={BACK_ICON} accessibilityLabel="Back" onPress={() => router.back()} />
    </View>
  );

  // Mounted only once `header`/`name` are known (both sheets need header
  // data as props) -- fine, since neither can be opened before that same
  // branch below renders the buttons that open them.
  let reviewSheet: ReactNode = null;
  let moreActionsSheet: ReactNode = null;

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
    const reviewSummary = reviewSummaryQuery.data ?? null;
    const captionParts = [
      viewerId ? formatConversationRoleCaption(getInboxRole(header, viewerId)) : null,
      reviewSummary && reviewSummary.reviewCount > 0
        ? `★ ${reviewSummary.averageRating.toFixed(1)}`
        : null,
    ].filter((part): part is string => part !== null);

    let listEmpty: ReactNode = null;
    if (historyQuery.isPending) {
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

    const renderItem = ({ item }: ListRenderItemInfo<ChatListItem>) => {
      if (item.kind === 'separator') {
        return <DaySeparator label={item.label} />;
      }
      return (
        <MessageBubble
          message={item.message}
          isOwn={item.message.senderId === viewerId}
          otherPartyName={name}
          showTime={item.showTime}
          onRetry={(pending: PendingMessage) => retryMessage(pending)}
        />
      );
    };

    body = (
      <View style={styles.body}>
        <View style={styles.identity}>
          <StoryRing size={HEADER_AVATAR_SIZE} uri={header.otherAvatarUrl ?? undefined} active />
          <View style={styles.identityText}>
            <Text variant="bodyStrong">{name}</Text>
            {captionParts.length > 0 ? (
              <Text variant="caption" color="textSecondary">
                {captionParts.join(' · ')}
              </Text>
            ) : null}
          </View>
          <IconButton
            icon={MORE_ICON}
            accessibilityLabel="More actions"
            onPress={() => setMoreMenuOpen(true)}
          />
        </View>

        {header.listingTitle ? (
          <PinnedListingStrip
            title={header.listingTitle}
            priceAmount={header.listingPriceAmount}
            currencyCode={header.listingCurrency}
            size={header.listingSize}
            status={header.listingStatus}
            coverUrl={header.coverUrl}
            onPress={openListing}
          />
        ) : null}

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
          data={chatListItems}
          keyExtractor={chatListItemKey}
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

        <Composer onSend={sendMessage} isSending={isSending} messageCount={messages.length} />
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

    moreActionsSheet = (
      <MoreActionsSheet
        visible={moreMenuOpen}
        onClose={() => setMoreMenuOpen(false)}
        target={{ reportedUserId: header.otherParticipantId }}
        targetKind="user"
        blockTargetUserId={header.otherParticipantId}
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
      {moreActionsSheet}
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
  identityText: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    // 10px, the handoff's own "gap between bubbles" — not space[3] (12), the
    // nearest token, because it's visibly denser and worth getting exactly
    // right for a value this prominent (every bubble, the whole screen).
    gap: CHAT_LIST_GAP,
    paddingVertical: space[2],
  },
  footerSpinner: {
    paddingVertical: space[2],
  },
});
