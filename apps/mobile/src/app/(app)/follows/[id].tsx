import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, type ReactNode } from 'react';
import { FlatList, StyleSheet, View, type ListRenderItemInfo } from 'react-native';

import { Avatar, EmptyState, IconButton, ListRow, Screen, SkeletonRow, Text, type IconName } from '@/components/ui';
import { space } from '@/design/tokens';
import { parseFollowListMode, type FollowListProfile } from '@/features/follows/follows';
import { useFollowList } from '@/features/follows/queries';
import { mapListingError } from '@/features/listings/errors';

/**
 * Follower / Following list — ROADMAP 3.3. The scrollable destination
 * behind the tappable counts on `seller/[id].tsx`'s identity header.
 *
 * One screen, not two near-duplicate ones: `mode` (`'followers' |
 * 'following'`) is a query param, validated defensively via
 * `parseFollowListMode` since it is client-controlled route state, not a
 * server response — an unrecognized or missing value falls back to
 * `'followers'` rather than throwing.
 *
 * Layout mirrors `inbox/index.tsx` exactly (`ListRow` + `Avatar`, same
 * skeleton/empty/error branching), with the manual back row copied from
 * `seller/[id].tsx`'s header — this app's pushed non-tab screens don't use
 * a native header. No inline Follow/Unfollow affordance on rows: that
 * lives one tap away on the destination seller-profile screen, per
 * ROADMAP's exact wording for this item.
 *
 * `mapListingError` is reused here for a non-listing error, same as
 * `seller-profile`'s `profileQuery`/`listingsQuery` branches already do —
 * it maps generic Postgres/network failure shapes to safe copy, nothing
 * listing-specific.
 */

const BACK_ICON: IconName = { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' };
// Same icon already used for the Home feed's "Following" tab empty state
// (`(tabs)/index.tsx`'s `FOLLOWING_EMPTY_ICON`) — this screen is about the
// same social relationship.
const EMPTY_ICON: IconName = { ios: 'person.2', android: 'people', web: 'people' };
const ERROR_ICON: IconName = { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' };

const SKELETON_ROW_COUNT = 6;

const TITLE_BY_MODE = {
  followers: 'Followers',
  following: 'Following',
} as const;

const EMPTY_BODY_BY_MODE = {
  followers: 'No followers yet.',
  following: 'Not following anyone yet.',
} as const;

export default function FollowListScreen() {
  const router = useRouter();
  const { id, mode: modeParam } = useLocalSearchParams<{ id: string; mode?: string }>();
  const mode = parseFollowListMode(modeParam);

  const followListQuery = useFollowList(id, mode);
  const profiles = followListQuery.data?.pages.flatMap((page) => page.profiles) ?? [];

  const openSeller = useCallback(
    (profileId: string) => {
      router.push({ pathname: '/(app)/seller/[id]', params: { id: profileId } });
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FollowListProfile>) => (
      <FollowListRow profile={item} onPress={() => openSeller(item.profileId)} />
    ),
    [openSeller],
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = followListQuery;
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  let listEmpty: ReactNode = null;
  if (followListQuery.isPending) {
    listEmpty = (
      <View style={styles.rows}>
        {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
          <SkeletonRow key={index} />
        ))}
      </View>
    );
  } else if (followListQuery.isError) {
    listEmpty = (
      <EmptyState
        variant="error"
        icon={ERROR_ICON}
        title="Something went wrong"
        body={mapListingError(followListQuery.error).message}
        actionLabel="Try again"
        onAction={() => followListQuery.refetch()}
      />
    );
  } else {
    listEmpty = (
      <EmptyState variant="empty" icon={EMPTY_ICON} title={TITLE_BY_MODE[mode]} body={EMPTY_BODY_BY_MODE[mode]} />
    );
  }

  return (
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <IconButton icon={BACK_ICON} accessibilityLabel="Back" onPress={() => router.back()} />
      </View>
      <Text variant="title" style={styles.title}>
        {TITLE_BY_MODE[mode]}
      </Text>
      <FlatList
        style={styles.list}
        data={profiles}
        keyExtractor={(item) => item.profileId}
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

function FollowListRow({ profile, onPress }: { profile: FollowListProfile; onPress: () => void }) {
  const name = profile.displayName ?? profile.username ?? 'Fynd seller';
  const subtitle = profile.displayName && profile.username ? `@${profile.username}` : undefined;

  return (
    <ListRow
      leading={<Avatar size="md" source={profile.avatarUrl ?? undefined} name={name} />}
      title={name}
      subtitle={subtitle}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: space[4],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    paddingHorizontal: space[4],
  },
  list: {
    flex: 1,
  },
  rows: {
    gap: space[2],
  },
  footerSpinner: {
    paddingVertical: space[2],
  },
});
