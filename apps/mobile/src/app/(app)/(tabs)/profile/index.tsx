import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  FlatList,
  Pressable,
  Share,
  StyleSheet,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import {
  Avatar,
  EmptyState,
  IconButton,
  ListingImage,
  PillButton,
  Screen,
  Skeleton,
  SkeletonRow,
  Sticker,
  StoryRing,
  Text,
  type IconName,
} from '@/components/ui';
import { ReviewRow } from '@/components/review/review-row';
import { TALL_TILE_ASPECT_RATIO } from '@/components/listing/listing-grid-tile';
import { elevation, minTouchTarget, radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { groupCategoriesByParent } from '@/features/categories/categories';
import { useCategories } from '@/features/categories/queries';
import {
  deriveClosetHighlights,
  filterClosetListings,
  selectCollagePhotos,
  type ClosetHighlight,
} from '@/features/profile/closet';
import { useFollowCounts } from '@/features/follows/queries';
import { mapListingError } from '@/features/listings/errors';
import { formatClosetShareMessage, formatProfileSummaryLine } from '@/features/profile/profile';
import { useAvatarUrl, useMyCloset, useProfile } from '@/features/profile/queries';
import { useSellerReviewSummary, useSellerReviews } from '@/features/reviews/queries';
import type { SellerReview } from '@/features/reviews/reviews';
import { useSavedListings } from '@/features/saved-items/queries';

/**
 * Profile tab — SCREENS.md Task 7, replacing the plain settings-menu list
 * with DESIGN.md §14.3's "Instagram-shaped structure": a collage-cover
 * identity header, Edit profile / Share closet pills, a category Highlights
 * row, and closet/saved/reviews tabs over a gapless photo grid.
 *
 * "Edit profile", "My listings" and "Saved items" used to be plain `ListRow`
 * navigation rows here; the first is now the "Edit profile" pill, the other
 * two are now in-page tab content (closet/saved) rather than pushed
 * screens — `profile/saved.tsx` is deleted as a result (nothing links to it
 * any more; My Listings stays reachable from the Sell tab's own "See all").
 * "Settings" (where Sign out already lives) is reached through the menu
 * icon instead of its own row.
 *
 * One FlatList at a time, swapped by `key` when the tab changes — same
 * "never nest a second scroller, never mount two at once" precedent
 * Explore's own collage/recent-searches swap documents — with the shared
 * identity header riding along as every list's `ListHeaderComponent`.
 *
 * Deliberately NOT built: the handoff's optional "ships in 24h" seller
 * badge (no shipping-speed column exists anywhere in the schema — the same
 * "hide rather than fake" rule the handoff states for it explicitly).
 */

const MENU_ICON: IconName = { ios: 'line.3.horizontal', android: 'menu', web: 'menu' };
const ERROR_ICON: IconName = { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' };
// Same icon seller/[id].tsx's own EMPTY_LISTINGS_ICON uses for the identical empty state.
const EMPTY_CLOSET_ICON: IconName = { ios: 'bag', android: 'shopping_bag', web: 'shopping_bag' };
// Same pair saved.tsx's own EMPTY_ICON used.
const EMPTY_SAVED_ICON: IconName = { ios: 'heart', android: 'favorite_border', web: 'favorite_border' };
// Same pair reviews/[id].tsx's own EMPTY_ICON uses.
const EMPTY_REVIEWS_ICON: IconName = { ios: 'star', android: 'star_border', web: 'star_border' };

const COLLAGE_HEIGHT = 190;
const POLAROID_SIZE = 150;
const POLAROID_ROTATIONS = [-5, 3, -2] as const;
const POLAROID_OFFSETS = [
  { left: 0, top: 18 },
  { left: 92, top: 0 },
  { left: 184, top: 16 },
] as const;
/** Bespoke, not `border.thick` (2) — the handoff's own polaroid-frame width, same precedent StoryRing's own local ring-width constants follow. */
const POLAROID_BORDER_WIDTH = 4;
const AVATAR_RING_WIDTH = 4;
const HIGHLIGHT_RING_SIZE = 58;
/** "displaySm 14px" — the handoff's own size override of the `displaySm` face/weight, same technique Sticker's 11px label uses atop the same face. Line-height keeps Archivo Expanded's 1.088em natural box clear (DESIGN.md §5 rule 5), same margin displaySm's own 20/24 keeps. */
const TAB_LABEL_FONT_SIZE = 14;
const TAB_LABEL_LINE_HEIGHT = 16;
const TAB_UNDERLINE_HEIGHT = 3;
const TAB_RULE_WIDTH = 1.5;
/** "Name in display 26/28" — same override technique as the tab label, resolved against §5 rule 4's -0.02em tracking rule for this face. */
const NAME_FONT_SIZE = 26;
const NAME_LINE_HEIGHT = 28;
const NAME_LETTER_SPACING = -0.02 * NAME_FONT_SIZE;

type ProfileTabId = 'closet' | 'saved' | 'reviews';
const ALL_TABS: { id: ProfileTabId; label: string }[] = [
  { id: 'closet', label: 'closet' },
  { id: 'saved', label: 'saved' },
  { id: 'reviews', label: 'reviews' },
];

/** The one shape both the closet grid and the saved grid render — gapless, no price, no caption. */
type PhotoTileItem = { listingId: string; title: string; coverUrl: string; sold?: boolean };

export default function ProfileIndex() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const viewerId = session?.user.id;

  const profileQuery = useProfile(viewerId);
  const avatarUrlQuery = useAvatarUrl(profileQuery.data?.avatar_path);
  const followCountsQuery = useFollowCounts(viewerId);
  const reviewSummaryQuery = useSellerReviewSummary(viewerId);

  const categoriesQuery = useCategories();
  const categoryGroups = useMemo(
    () => (categoriesQuery.data ? groupCategoriesByParent(categoriesQuery.data) : []),
    [categoriesQuery.data],
  );

  const closetQuery = useMyCloset(viewerId);
  const closetListings = useMemo(
    () => closetQuery.data?.pages.flatMap((page) => page.listings) ?? [],
    [closetQuery.data],
  );
  const closetTotalCount = closetQuery.data?.pages[0]?.totalCount ?? null;

  const savedQuery = useSavedListings(viewerId);
  const savedListings = useMemo(
    () => savedQuery.data?.pages.flatMap((page) => page.listings) ?? [],
    [savedQuery.data],
  );

  const reviewsQuery = useSellerReviews(viewerId);
  const reviews = useMemo(
    () => reviewsQuery.data?.pages.flatMap((page) => page.reviews) ?? [],
    [reviewsQuery.data],
  );

  const [activeTab, setActiveTab] = useState<ProfileTabId>('closet');
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);

  const highlights = useMemo(
    () => deriveClosetHighlights(closetListings, categoryGroups),
    [closetListings, categoryGroups],
  );
  const filteredCloset = useMemo(
    () => filterClosetListings(closetListings, activeHighlightId, categoryGroups),
    [closetListings, activeHighlightId, categoryGroups],
  );
  const collagePhotos = useMemo(() => selectCollagePhotos(closetListings, 3), [closetListings]);
  const hasReviews = (reviewSummaryQuery.data?.reviewCount ?? 0) > 0;

  // Stable PhotoTileItem arrays — closet/saved both grow via infinite-query
  // pagination, so re-mapping them on every unrelated re-render (toggling a
  // highlight, switching tabs away and back, an avatar refetch) would hand
  // FlatList a new `data` array it can't tell apart from a real change.
  const closetPhotoItems = useMemo<PhotoTileItem[]>(
    () =>
      filteredCloset.map((listing) => ({
        listingId: listing.listingId,
        title: listing.title,
        coverUrl: listing.coverUrl,
        sold: listing.status === 'sold',
      })),
    [filteredCloset],
  );
  const savedPhotoItems = useMemo<PhotoTileItem[]>(
    () =>
      savedListings.map((listing) => ({
        listingId: listing.listingId,
        title: listing.title,
        coverUrl: listing.coverUrl,
      })),
    [savedListings],
  );

  const openListing = useCallback(
    (listingId: string) => {
      router.push({ pathname: '/(app)/listing/[id]', params: { id: listingId } });
    },
    [router],
  );
  const renderPhotoItem = useCallback(
    ({ item }: ListRenderItemInfo<PhotoTileItem>) => (
      <PhotoTile item={item} onPress={() => openListing(item.listingId)} />
    ),
    [openListing],
  );

  function handleHighlightPress(highlightId: string) {
    setActiveTab('closet');
    setActiveHighlightId((current) => (current === highlightId ? null : highlightId));
  }

  async function handleShare(name: string) {
    try {
      await Share.share({ message: formatClosetShareMessage(name) });
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
    }
  }

  if (!viewerId || profileQuery.isPending) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <Skeleton height={20} width={120} radius="xs" />
        </View>
        <Skeleton height={COLLAGE_HEIGHT} radius="lg" />
        <Skeleton height={NAME_LINE_HEIGHT} width="50%" radius="xs" />
        <Skeleton height={minTouchTarget} radius="full" />
      </Screen>
    );
  }

  if (profileQuery.isError) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <EmptyState
          variant="error"
          icon={ERROR_ICON}
          title="Something went wrong"
          body={mapListingError(profileQuery.error).message}
          actionLabel="Try again"
          onAction={() => profileQuery.refetch()}
        />
      </Screen>
    );
  }

  const profile = profileQuery.data;
  const name = profile.display_name ?? profile.username ?? 'Fynd user';
  const summaryLine = formatProfileSummaryLine({
    listingCount: closetTotalCount,
    followersCount: followCountsQuery.data?.followersCount ?? null,
    followingCount: followCountsQuery.data?.followingCount ?? null,
  });

  const header = (
    <View style={styles.header}>
      <View style={styles.topBar}>
        <Text variant="bodyStrong">{profile.username ? `@${profile.username}` : name}</Text>
        <IconButton
          icon={MENU_ICON}
          accessibilityLabel="Menu"
          onPress={() => router.push('/(app)/(tabs)/profile/settings')}
        />
      </View>

      {collagePhotos.length > 0 ? (
        <View style={styles.collage}>
          {collagePhotos.map((photo, index) => (
            <View
              key={photo.listingId}
              // Shadow lives on this OUTER view, never on the one with
              // `overflow: 'hidden'` below — iOS clips a view's own shadow
              // along with its content, so the two have to be separate nodes.
              style={[styles.polaroid, POLAROID_OFFSETS[index], { transform: [{ rotate: `${POLAROID_ROTATIONS[index]}deg` }] }]}>
              <View
                style={[
                  styles.polaroidFrame,
                  // The handoff's own "bgRaised" names what this token system
                  // calls `bgElevated` (DESIGN.md §3's lightest surface step) —
                  // no literal `bgRaised` token exists.
                  { borderColor: colors.bgElevated },
                ]}>
                <ListingImage uri={photo.coverUrl} fill style={styles.polaroidImage} recyclingKey={photo.listingId} />
              </View>
            </View>
          ))}
          <View style={[styles.collageAvatar, { borderColor: colors.bg }]}>
            <Avatar size="xl" source={avatarUrlQuery.data} name={name} />
          </View>
        </View>
      ) : (
        <Avatar size="xl" source={avatarUrlQuery.data} name={name} />
      )}

      <View style={styles.identity}>
        <Text variant="display" style={styles.nameText}>
          {name}
        </Text>
        {summaryLine ? (
          <Text variant="body" color="textSecondary">
            {summaryLine}
          </Text>
        ) : null}
        {profile.bio ? <Text variant="body">{profile.bio}</Text> : null}
      </View>

      <View style={styles.pillsRow}>
        <PillButton
          variant="inverse"
          onPress={() => router.push('/(app)/(tabs)/profile/edit')}
          style={styles.pillFlex}>
          Edit profile
        </PillButton>
        <PillButton variant="outline" onPress={() => handleShare(name)} style={styles.pillFlex}>
          Share closet
        </PillButton>
      </View>

      {highlights.length > 0 ? (
        <HighlightsRow highlights={highlights} activeId={activeHighlightId} onPress={handleHighlightPress} />
      ) : null}

      <ProfileTabs active={activeTab} onChange={setActiveTab} showReviews={hasReviews} />
    </View>
  );

  if (activeTab === 'reviews') {
    return (
      <Screen contentContainerStyle={styles.content}>
        <FlatList
          key="reviews"
          data={reviews}
          keyExtractor={(item) => String(item.reviewId)}
          renderItem={renderReviewItem}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <ListTabEmpty
              query={reviewsQuery}
              loading={<ReviewListSkeleton />}
              icon={EMPTY_REVIEWS_ICON}
              emptyTitle="No reviews yet."
            />
          }
          onEndReached={() => {
            if (reviewsQuery.hasNextPage && !reviewsQuery.isFetchingNextPage) {
              reviewsQuery.fetchNextPage();
            }
          }}
          onEndReachedThreshold={1.5}
        />
      </Screen>
    );
  }

  if (activeTab === 'saved') {
    return (
      <Screen contentContainerStyle={styles.content}>
        <FlatList
          key="saved"
          data={savedPhotoItems}
          keyExtractor={(item) => item.listingId}
          renderItem={renderPhotoItem}
          numColumns={3}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <ListTabEmpty
              query={savedQuery}
              loading={<PhotoGridSkeleton />}
              icon={EMPTY_SAVED_ICON}
              emptyTitle="No saved items yet."
            />
          }
          onEndReached={() => {
            if (savedQuery.hasNextPage && !savedQuery.isFetchingNextPage) {
              savedQuery.fetchNextPage();
            }
          }}
          onEndReachedThreshold={1.5}
        />
      </Screen>
    );
  }

  return (
    <Screen contentContainerStyle={styles.content}>
      <FlatList
        key="closet"
        data={closetPhotoItems}
        keyExtractor={(item) => item.listingId}
        renderItem={renderPhotoItem}
        numColumns={3}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <ListTabEmpty
            query={closetQuery}
            loading={<PhotoGridSkeleton />}
            icon={EMPTY_CLOSET_ICON}
            emptyTitle="You haven't listed anything yet."
          />
        }
        onEndReached={() => {
          if (closetQuery.hasNextPage && !closetQuery.isFetchingNextPage) {
            closetQuery.fetchNextPage();
          }
        }}
        onEndReachedThreshold={1.5}
      />
    </Screen>
  );
}

function renderReviewItem({ item }: ListRenderItemInfo<SellerReview>) {
  return <ReviewRow review={item} />;
}

// ============================================================
// Shared tab-content empty/loading/error state
// ============================================================

type PagedQueryState = {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
};

/** A gapless 4:5 photo skeleton, matching `PhotoTile`'s actual shape — no price/title caption lines, same ratio, so loading never jumps into place. */
function PhotoGridSkeleton() {
  return (
    <View style={styles.skeletonGrid}>
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} aspectRatio={TALL_TILE_ASPECT_RATIO} style={styles.photoTile} />
      ))}
    </View>
  );
}

/** `ReviewRow`'s shape — a row list, not a photo grid, for the reviews tab's own loading state. */
function ReviewListSkeleton() {
  return (
    <View style={styles.skeletonRows}>
      {Array.from({ length: 4 }, (_, index) => (
        <SkeletonRow key={index} />
      ))}
    </View>
  );
}

function ListTabEmpty({
  query,
  loading,
  icon,
  emptyTitle,
}: {
  query: PagedQueryState;
  /** The tab's own loading shape — a photo grid for closet/saved, rows for reviews. */
  loading: ReactNode;
  icon: IconName;
  emptyTitle: string;
}) {
  if (query.isPending) {
    return loading;
  }
  if (query.isError) {
    return (
      <EmptyState
        variant="error"
        icon={ERROR_ICON}
        title="Something went wrong"
        body={mapListingError(query.error).message}
        actionLabel="Try again"
        onAction={query.refetch}
      />
    );
  }
  return <EmptyState variant="empty" icon={icon} title={emptyTitle} />;
}

// ============================================================
// Photo tile (closet + saved) — gapless, 4:5, no price or title caption
// ============================================================

function PhotoTile({ item, onPress }: { item: PhotoTileItem; onPress: () => void }) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.sold ? `${item.title}, Sold` : item.title}
      style={styles.photoTile}>
      <ListingImage
        uri={item.coverUrl}
        aspectRatio={TALL_TILE_ASPECT_RATIO}
        style={styles.photoImage}
        recyclingKey={item.listingId}
      />
      {item.sold ? (
        <>
          {/* The paper wash: a translucent veil of the page's own bg over the photo. */}
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, opacity: 0.55 }]}
            pointerEvents="none"
          />
          <View style={styles.soldStamp} pointerEvents="none">
            <Sticker label="SOLD" tone="accent" rotate={-8} />
          </View>
        </>
      ) : null}
    </Pressable>
  );
}

// ============================================================
// Highlights row
// ============================================================

function HighlightsRow({
  highlights,
  activeId,
  onPress,
}: {
  highlights: ClosetHighlight[];
  activeId: string | null;
  onPress: (id: string) => void;
}) {
  return (
    <View style={styles.highlightsRow}>
      {highlights.map((highlight) => {
        const selected = highlight.id === activeId;
        return (
          <Pressable
            key={highlight.id}
            onPress={() => onPress(highlight.id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={highlight.label}
            style={({ pressed }) => [styles.highlightItem, { opacity: pressed ? 0.7 : 1 }]}>
            {/* StoryRing takes no label here — the Pressable above already owns the name and selected state (same precedent Explore's DropsRow and Inbox's StoriesRow document). */}
            <StoryRing size={HIGHLIGHT_RING_SIZE} active={selected} />
            <Text
              variant="micro"
              color={selected ? 'text' : 'textSecondary'}
              numberOfLines={1}
              importantForAccessibility="no"
              style={styles.highlightLabel}>
              {highlight.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ============================================================
// Tabs
// ============================================================

function ProfileTabs({
  active,
  onChange,
  showReviews,
}: {
  active: ProfileTabId;
  onChange: (tab: ProfileTabId) => void;
  showReviews: boolean;
}) {
  const { colors } = useAppTheme();
  const tabs = showReviews ? ALL_TABS : ALL_TABS.filter((tab) => tab.id !== 'reviews');

  return (
    <View style={[styles.tabsRow, { borderBottomColor: colors.text }]}>
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onChange(tab.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={styles.tabButton}>
            <Text
              variant="displaySm"
              numberOfLines={1}
              style={[
                styles.tabLabel,
                { color: selected ? colors.text : colors.textSecondary },
              ]}>
              {tab.label}
            </Text>
            <View
              style={[
                styles.tabUnderline,
                { backgroundColor: selected ? colors.accent : 'transparent' },
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const COLLAGE_WIDTH = POLAROID_OFFSETS[POLAROID_OFFSETS.length - 1].left + POLAROID_SIZE;

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingTop: space[4],
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  header: {
    gap: space[5],
    marginBottom: space[5],
  },
  collage: {
    height: COLLAGE_HEIGHT,
    width: COLLAGE_WIDTH,
  },
  polaroid: {
    position: 'absolute',
    width: POLAROID_SIZE,
    height: POLAROID_SIZE,
    borderRadius: radius.sm,
    ...elevation.raised,
  },
  polaroidFrame: {
    flex: 1,
    borderRadius: radius.sm,
    borderWidth: POLAROID_BORDER_WIDTH,
    overflow: 'hidden',
  },
  polaroidImage: {
    flex: 1,
  },
  collageAvatar: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    borderRadius: radius.full,
    borderWidth: AVATAR_RING_WIDTH,
  },
  identity: {
    gap: space[2],
  },
  nameText: {
    fontSize: NAME_FONT_SIZE,
    lineHeight: NAME_LINE_HEIGHT,
    letterSpacing: NAME_LETTER_SPACING,
  },
  pillsRow: {
    flexDirection: 'row',
    gap: space[3],
  },
  pillFlex: {
    flex: 1,
  },
  highlightsRow: {
    flexDirection: 'row',
    gap: space[4],
  },
  highlightItem: {
    alignItems: 'center',
    gap: space[1],
    width: HIGHLIGHT_RING_SIZE + space[2],
  },
  highlightLabel: {
    maxWidth: HIGHLIGHT_RING_SIZE + space[2],
  },
  tabsRow: {
    flexDirection: 'row',
    borderBottomWidth: TAB_RULE_WIDTH,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    minHeight: minTouchTarget,
    justifyContent: 'center',
    gap: space[1],
  },
  tabLabel: {
    fontSize: TAB_LABEL_FONT_SIZE,
    lineHeight: TAB_LABEL_LINE_HEIGHT,
  },
  tabUnderline: {
    position: 'absolute',
    bottom: -TAB_RULE_WIDTH,
    left: 0,
    right: 0,
    height: TAB_UNDERLINE_HEIGHT,
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  skeletonRows: {
    gap: space[2],
  },
  photoTile: {
    width: '33.3333%',
  },
  photoImage: {
    width: '100%',
  },
  soldStamp: {
    position: 'absolute',
    top: '42%',
    alignSelf: 'center',
  },
});
