import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Chip, IconButton, ListingImage, Text, type IconName } from '@/components/ui';
import { FeedCardGestures } from '@/components/feed/feed-card-gestures';
import { gradientScrim, space } from '@/design/tokens';
import { useToggleFavorite } from '@/features/feed/queries';
import { CONDITION_LABELS } from '@/features/listings/condition';
import { formatMoney } from '@/features/listings/price';
import { formatSizeLabel } from '@/features/listings/size';
import type { FeedListing } from '@/features/feed/pagination';

/**
 * One page of the Home feed: full-bleed cover photo (wrapped in
 * FeedCardGestures for tap-or-swipe-left-to-open-detail and
 * double-tap-to-like) and the DESIGN.md §14.1 tier 2-4 overlay — price,
 * title, a condition + size chip pair, a seller row, and a favorite
 * action. Still deliberately minimal beyond that — no share, comments,
 * follow, chat, timestamps, or shipping metadata; those are later slices,
 * not omissions.
 *
 * The overlay's gradient scrim lives on that block's own box, not a
 * separate full-card layer: the box is bottom-anchored with no `top`, so
 * it (and the gradient painted on it) is only ever as tall as the content
 * actually needs — the rest of the photo above it is never darkened.
 *
 * No card-within-card otherwise: every OTHER layer here is a plain
 * full-size View stacked on the photo, never an inset surface with its
 * own background/border.
 */

// Breathing room between the overlay's lowest content and the tab bar's own
// top edge, once the safe-area inset below has already cleared the bar
// itself. One centralized value (within the 16-24px range asked for), not a
// number repeated per screen.
const FEED_OVERLAY_BOTTOM_GAP = space[5];

// Verified against the installed packages: 'heart'/'heart.fill' exist in
// sf-symbols-typescript's types, and 'favorite_border'/'favorite' exist in
// expo-symbols' android/symbols.json.
const FAVORITE_ICON: IconName = { ios: 'heart', android: 'favorite_border', web: 'favorite_border' };
const FAVORITED_ICON: IconName = { ios: 'heart.fill', android: 'favorite', web: 'favorite' };

export type FeedCardProps = {
  listing: FeedListing;
  /** Forwarded to useToggleFavorite so it targets the same cache entry the
   * visible feed is actually reading — see useFeed's own includeOwn flag. */
  includeOwn?: boolean;
  /** Forwarded to useToggleFavorite alongside includeOwn — see useFeed's own
   * followingOnly flag (ROADMAP 3.2's "For you"/"Following" toggle). */
  followingOnly?: boolean;
};

export function FeedCard({ listing, includeOwn, followingOnly }: FeedCardProps) {
  const router = useRouter();

  // Formatted from the listing's OWN stored currency, never a hardcoded
  // symbol — `listings.currency` defaults to ILS but travels on every row,
  // so the card renders whatever that row actually says.
  const price = formatMoney(listing.priceAmount, listing.currency);
  const sellerName = listing.sellerDisplayName ?? listing.sellerUsername ?? 'Fynd seller';

  // Real, per-device measurement, not a guessed tab-bar height. expo-router's
  // NativeTabs nests each tab's screen content in its own safe-area scope
  // (a dedicated SafeAreaProvider on iOS; a react-native-screens SafeAreaView
  // on Android) specifically so the content underneath can ask "how much of
  // me is covered by the floating bar" — see app-tabs.tsx and the NativeTabs
  // source under expo-router/build/native-tabs/NativeTabsView.*.js. Reading
  // it here, directly, is what keeps this card full-bleed: only the overlay's
  // bottom padding grows, never the card's own height or the image beneath.
  const insets = useSafeAreaInsets();

  // Cache-optimistic toggle + the same "disable while this listing's own
  // mutation is in flight" race guard the hook already implements — nothing
  // feed-card-specific to add here, just wiring.
  const { toggleFavorite, pendingListingIds } = useToggleFavorite(includeOwn, followingOnly);
  const favoritePending = pendingListingIds.has(listing.listingId);

  // Double-tap is never a toggle: it only ever favorites, and only when
  // there's something to do — already-favorited and already-pending both
  // skip the mutation (never a duplicate send, never an unfavorite) while
  // still letting the caller replay the pop animation unconditionally.
  const handleDoubleTap = useCallback(() => {
    if (listing.isFavorited || favoritePending) return;
    toggleFavorite(listing.listingId, listing.isFavorited);
  }, [listing.isFavorited, listing.listingId, favoritePending, toggleFavorite]);

  const handleSingleTap = useCallback(() => {
    router.push({ pathname: '/(app)/listing/[id]', params: { id: listing.listingId } });
  }, [router, listing.listingId]);

  return (
    <View style={styles.card}>
      <FeedCardGestures onDoubleTap={handleDoubleTap} onSingleTap={handleSingleTap}>
        <ListingImage
          uri={listing.coverUrl}
          fill
          contentFit="cover"
          recyclingKey={listing.listingId}
          accessibilityLabel={listing.title}
        />
      </FeedCardGestures>

      {/* box-none: the row itself must never swallow the vertical swipe that
          pages the feed. Only the IconButton below — an actual Pressable —
          ever claims a touch. The scrim lives on THIS view, not a separate
          full-card layer: it is bottom-anchored with no `top`, so its own
          height — and therefore the gradient's extent — is whatever this
          content actually needs, not an arbitrary fraction of the photo. */}
      <View
        pointerEvents="box-none"
        style={[
          styles.overlay,
          { paddingBottom: insets.bottom + FEED_OVERLAY_BOTTOM_GAP },
        ]}>
        <View pointerEvents="none" style={styles.metadata}>
          <Text variant="price" color="textOnMedia">
            {price}
          </Text>
          <Text variant="heading" color="textOnMedia" numberOfLines={2}>
            {listing.title}
          </Text>
          <View style={styles.chipRow}>
            <Chip label={CONDITION_LABELS[listing.condition]} />
            <Chip label={formatSizeLabel(listing.size)} />
          </View>
          <View style={styles.sellerRow}>
            <Avatar size="sm" source={listing.sellerAvatarUrl ?? undefined} name={sellerName} />
            <Text variant="label" color="textOnMedia" numberOfLines={1} style={styles.sellerName}>
              {sellerName}
            </Text>
          </View>
        </View>

        <IconButton
          icon={listing.isFavorited ? FAVORITED_ICON : FAVORITE_ICON}
          accessibilityLabel={listing.isFavorited ? 'Remove from favorites' : 'Add to favorites'}
          onPress={() => toggleFavorite(listing.listingId, listing.isFavorited)}
          disabled={favoritePending}
          variant="onMedia"
          color={listing.isFavorited ? 'favoriteActive' : undefined}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // No `top`: height is intrinsic to the content (metadata + button +
    // padding) rather than stretched to the full card, which is what keeps
    // the gradient below confined to this block instead of washing over
    // most of the photo.
    experimental_backgroundImage: [gradientScrim],
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: space[5],
    paddingTop: space[5],
    // paddingBottom is set inline — it depends on the per-device safe-area
    // inset above, not a static token.
    gap: space[3],
  },
  metadata: {
    flex: 1,
    gap: space[2],
  },
  chipRow: {
    flexDirection: 'row',
    gap: space[2],
  },
  sellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  sellerName: {
    flexShrink: 1,
  },
});
