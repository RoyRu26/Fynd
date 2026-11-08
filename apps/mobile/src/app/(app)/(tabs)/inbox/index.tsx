import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View, type ListRenderItemInfo } from 'react-native';

import {
  Avatar,
  Chip,
  EmptyState,
  IconButton,
  ListingImage,
  Screen,
  SkeletonRow,
  StoryRing,
  Text,
  type IconName,
} from '@/components/ui';
import { border, radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { mapInboxError } from '@/features/inbox/errors';
import {
  filterInboxConversations,
  formatInboxTimestamp,
  formatLastMessagePreview,
  getInboxEmptyCopy,
  resolveOtherPartyName,
  selectRecentPartners,
  type InboxConversation,
  type InboxPartner,
  type InboxRoleFilter,
} from '@/features/inbox/inbox';
import { useInboxConversations } from '@/features/inbox/queries';

/**
 * Inbox — SCREENS.md Task 6, replacing DESIGN.md §14.5's plain `ListRow`
 * list with the Turn-4 shape: a Stories row of recent partners, an
 * All/Buying/Selling filter, and a bespoke row (overlapping listing
 * thumbnail, name + time, preview). See the bottom of this file for why the
 * row is custom rather than `ListRow`, and DESIGN.md §14.5 for the
 * All/Buying/Selling-is-`selected`-not-`bgInverse` deviation from the
 * handoff.
 *
 * No realtime here: the inbox-level refetch on tab re-focus is the whole
 * update story for this phase (see useInboxConversations' own doc comment
 * for why — deriving updates from the messages stream is 1.3+).
 *
 * The FlatList is the screen's only scroll container, same reasoning as
 * seller/[id].tsx: onEndReached-driven pagination needs to own the actual
 * scroll offset. Stories + filters ride in its `ListHeaderComponent` for
 * exactly that reason, not as separate siblings above it.
 *
 * "Offers" is not a fourth filter pill, and no row carries an offer
 * `Sticker`: there is no offers table or RPC at all yet (same gap
 * sell/index.tsx's own "buzz" section documents). Hidden rather than faked.
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
// 'square.and.pencil' and 'edit' both likewise verified against those packages.
const COMPOSE_ICON: IconName = { ios: 'square.and.pencil', android: 'edit', web: 'edit' };

const SKELETON_ROW_COUNT = 5;
/** How many distinct recent partners the Stories row renders. */
const STORIES_LIMIT = 15;
const STORY_RING_SIZE = 62;

const INBOX_FILTERS: InboxRoleFilter[] = ['all', 'buying', 'selling'];
const INBOX_FILTER_LABELS: Record<InboxRoleFilter, string> = { all: 'All', buying: 'Buying', selling: 'Selling' };

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

  const [filter, setFilter] = useState<InboxRoleFilter>('all');

  const pages = inboxQuery.data?.pages;
  const conversations = useMemo(() => pages?.flat() ?? [], [pages]);
  // viewerId is only undefined for an instant during session hydration,
  // before this query could have returned any rows — falling back to 'all'
  // just means the filter can never spuriously apply in that narrow window.
  const visible = useMemo(
    () => (viewerId ? filterInboxConversations(conversations, filter, viewerId) : conversations),
    [conversations, filter, viewerId],
  );
  const emptyCopy = getInboxEmptyCopy(filter, conversations.length);
  // Deliberately NOT keyed on `filter` — the Stories row shows recent
  // partners regardless of the active filter, so switching Buying/Selling/All
  // must not re-scan and rebuild it.
  const partners = useMemo(() => selectRecentPartners(conversations, STORIES_LIMIT), [conversations]);

  const openConversation = useCallback(
    (target: { conversationId: string; lastMessageAt: string }) => {
      router.push({
        pathname: '/(app)/conversation/[id]',
        params: { id: target.conversationId, lastMessageAt: target.lastMessageAt },
      });
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<InboxConversation>) => (
      <ConversationRow
        conversation={item}
        viewerId={viewerId}
        onPress={() =>
          openConversation({ conversationId: item.conversationId, lastMessageAt: item.lastMessageAt })
        }
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
    listEmpty = <EmptyState variant="empty" icon={EMPTY_ICON} title={emptyCopy.title} body={emptyCopy.body} />;
  }

  // Stories + filters only once there is something to show them over — an
  // empty inbox shows just the big EmptyState below, same as before.
  const listHeader =
    conversations.length > 0 ? (
      <View style={styles.listHeader}>
        {partners.length > 0 ? <StoriesRow partners={partners} onPressPartner={openConversation} /> : null}
        <FilterRow filter={filter} onChange={setFilter} />
      </View>
    ) : null;

  return (
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <Text variant="display">inbox</Text>
        <IconButton
          icon={COMPOSE_ICON}
          // There is no blank "new message" flow in this app — every
          // conversation starts from a listing's "Message seller" — so this
          // routes to where that actually begins rather than opening a
          // picker with nothing behind it.
          accessibilityLabel="Browse listings to start a conversation"
          onPress={() => router.push('/(app)/(tabs)/explore')}
        />
      </View>
      <FlatList
        style={styles.list}
        data={visible}
        keyExtractor={(item) => item.conversationId}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
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

// ============================================================
// Stories row
// ============================================================

function StoriesRow({
  partners,
  onPressPartner,
}: {
  partners: InboxPartner[];
  onPressPartner: (target: { conversationId: string; lastMessageAt: string }) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.storiesRow}
      // The FlatList above is the screen's only VERTICAL scroller; this one
      // is purely horizontal, same precedent as Explore's own Drops row.
      keyboardShouldPersistTaps="handled">
      {partners.map((partner) => (
        <Pressable
          key={partner.otherParticipantId}
          onPress={() =>
            onPressPartner({ conversationId: partner.conversationId, lastMessageAt: partner.lastMessageAt })
          }
          accessibilityRole="button"
          accessibilityLabel={partner.hasUnread ? `${partner.name}, unread` : partner.name}
          style={({ pressed }) => [styles.storyItem, { opacity: pressed ? 0.7 : 1 }]}>
          {/*
            StoryRing takes no label of its own here — the Pressable above
            already owns the name and state, same reasoning Explore's own
            DropsRow documents for the identical shape.
          */}
          <StoryRing size={STORY_RING_SIZE} uri={partner.avatarUrl ?? undefined} active={partner.hasUnread} person />
          <Text
            variant="micro"
            color={partner.hasUnread ? 'text' : 'textSecondary'}
            numberOfLines={1}
            importantForAccessibility="no"
            style={styles.storyLabel}>
            {partner.name}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// ============================================================
// Filter row
// ============================================================

function FilterRow({
  filter,
  onChange,
}: {
  filter: InboxRoleFilter;
  onChange: (filter: InboxRoleFilter) => void;
}) {
  return (
    <View style={styles.filterRow}>
      {INBOX_FILTERS.map((value) => (
        <Chip
          key={value}
          label={INBOX_FILTER_LABELS[value]}
          selectable
          selected={filter === value}
          onPress={() => onChange(value)}
        />
      ))}
    </View>
  );
}

// ============================================================
// Conversation row
// ============================================================

/**
 * Custom rather than `ListRow`: the handoff's row needs a compound leading
 * visual (avatar + an overlapping, rotated listing thumbnail) that
 * `ListRow`'s plain `leading` slot does not express, an unread dot on the
 * row's trailing edge rather than inline with the title, and unread encoded
 * on the PREVIEW line's weight/color rather than the title's — three
 * differences from `ListRow`'s own contract, which many other screens still
 * rely on unchanged. Reuses `body`/`bodyStrong` for that last part anyway:
 * same same-size, weight-only toggle `list-row-state.ts`'s
 * `getListRowTitleVariant` already established, just applied to the preview
 * line instead of the title.
 */
function ConversationRow({
  conversation,
  viewerId,
  onPress,
}: {
  conversation: InboxConversation;
  viewerId: string | undefined;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  const name = resolveOtherPartyName(conversation);
  // viewerId is only undefined for an instant during session hydration,
  // before this screen's query could have returned any rows — falling back
  // to the other participant's id just means the "You: " prefix can never
  // spuriously apply in that narrow window.
  const preview = formatLastMessagePreview(conversation, viewerId ?? conversation.otherParticipantId);
  const time = formatInboxTimestamp(conversation.lastMessageAt);
  const unread = conversation.isUnread;

  const label = [name, preview, time].filter(Boolean).join(', ') + (unread ? ', Unread' : '');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
      <View style={styles.rowAvatar}>
        <Avatar size="lg" source={conversation.otherAvatarUrl ?? undefined} name={name} />
        <ListingImage
          uri={conversation.coverUrl ?? undefined}
          style={[styles.rowListingThumb, { borderColor: colors.bg }]}
          accessibilityLabel={conversation.listingTitle ? `Listing: ${conversation.listingTitle}` : undefined}
        />
      </View>

      <View style={styles.rowMain}>
        <View style={styles.rowTopLine}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.rowName}>
            {name}
          </Text>
          {time ? (
            <Text variant="caption" color="textSecondary">
              {time}
            </Text>
          ) : null}
        </View>
        <View style={styles.rowBottomLine}>
          <Text
            variant={unread ? 'bodyStrong' : 'body'}
            color={unread ? 'text' : 'textSecondary'}
            numberOfLines={1}
            style={styles.rowPreview}>
            {preview}
          </Text>
          {unread ? <View style={[styles.unreadDot, { backgroundColor: colors.accent }]} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const ROW_AVATAR_SIZE = 56; // Avatar's own `lg` diameter — the nearest existing step to the handoff's 54px (DESIGN.md §15 rule 4: use an existing token first).
const ROW_LISTING_THUMB_WIDTH = 26;
const ROW_LISTING_THUMB_HEIGHT = 32;
const ROW_LISTING_THUMB_ROTATION = 8;
const UNREAD_DOT_SIZE = 10;

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: space[4],
    paddingTop: space[6],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  list: {
    flex: 1,
  },
  listHeader: {
    gap: space[4],
    paddingBottom: space[3],
  },
  rows: {
    gap: space[2],
  },
  footerSpinner: {
    paddingVertical: space[2],
  },

  storiesRow: {
    flexDirection: 'row',
    gap: space[4],
  },
  storyItem: {
    alignItems: 'center',
    gap: space[1],
    width: STORY_RING_SIZE + space[2],
  },
  storyLabel: {
    maxWidth: STORY_RING_SIZE + space[2],
  },

  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
  },
  rowAvatar: {
    width: ROW_AVATAR_SIZE,
    height: ROW_AVATAR_SIZE,
  },
  rowListingThumb: {
    position: 'absolute',
    bottom: -space[1],
    right: -space[1],
    width: ROW_LISTING_THUMB_WIDTH,
    height: ROW_LISTING_THUMB_HEIGHT,
    borderRadius: radius.xs,
    borderWidth: border.thick,
    transform: [{ rotate: `${ROW_LISTING_THUMB_ROTATION}deg` }],
  },
  rowMain: {
    flex: 1,
    gap: space[1],
  },
  rowTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  rowName: {
    flexShrink: 1,
  },
  rowBottomLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  rowPreview: {
    flex: 1,
  },
  unreadDot: {
    width: UNREAD_DOT_SIZE,
    height: UNREAD_DOT_SIZE,
    borderRadius: UNREAD_DOT_SIZE / 2,
  },
});
