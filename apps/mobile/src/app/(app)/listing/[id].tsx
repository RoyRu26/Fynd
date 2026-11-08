import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  EmptyState,
  Icon,
  Screen,
  Skeleton,
  SkeletonRow,
  Sticker,
  StoryRing,
  Text,
  type IconName,
} from '@/components/ui';
import { GALLERY_HEIGHT, ListingGallery } from '@/components/listing/listing-gallery';
import { MoreActionsSheet } from '@/components/report/more-actions-sheet';
import { gradientGalleryHeader, minTouchTarget, radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { useIsBlockedEitherWay } from '@/features/blocks/queries';
import { formatCategoryBreadcrumb } from '@/features/categories/categories';
import { mapInboxError } from '@/features/inbox/errors';
import { useStartConversation } from '@/features/inbox/queries';
import { brandSelectionLabel } from '@/features/brands/brands';
import { attributeBadgeTerms } from '@/features/listings/attributes';
import { CONDITION_LABELS } from '@/features/listings/condition';
import { mapListingError } from '@/features/listings/errors';
import { formatMoney } from '@/features/listings/price';
import { useAttributeVocabulary, useListingAttributes } from '@/features/listings/queries';
import { formatSizeLabel } from '@/features/listings/size';
import { useSetFavorite } from '@/features/favorites/queries';
import { useListingDetail } from '@/features/listing-detail/queries';

/**
 * Listing Detail v1 — SCREENS.md Task 9 / the 6a handoff, restyling
 * DESIGN.md §14.6 in place: a full-bleed gallery with a floating header,
 * a content sheet overlapping it, and a sticky bottom action bar. All
 * existing logic is unchanged — loading skeleton, error/unavailable states,
 * favorite toggle, MoreActionsSheet/Report, handleMessageSeller, ownership
 * rules (see each branch's own comment below for what carried over
 * verbatim from the pre-restyle version).
 *
 * This route lives outside the (tabs) NativeTabs group (see (app)/_layout's
 * Stack), so opening it pushes over Home and hides the floating tab bar —
 * no custom bottom nav was added for it.
 *
 * Deliberately NOT ownership-aware, with narrow exceptions: favoriting and
 * the seller row stay ownership-agnostic (the caller's own active listing
 * renders through the exact same branch as anyone else's — see the RLS note
 * below), but the sticky "Message seller" bar (DESIGN.md §14.6) is hidden on
 * a listing the viewer owns, since messaging yourself is refused
 * server-side anyway (get_or_create_listing_conversation's own guard) and a
 * button that always errors is worse than no button. The "Active listings
 * are public and sellers see own listings" RLS policy *would* also let an
 * owner see their own draft/reserved/sold/removed listing here, which is why
 * useListingDetail's own normalization treats anything but an active row as
 * "unavailable" regardless of who's asking — see detail.ts's doc comment.
 *
 * ROADMAP 5.2 adds a second reason to hide that same action bar: a block
 * between the viewer and this seller, in either direction
 * (`useIsBlockedEitherWay`, via `public.is_blocked_with`). This is
 * proactive UX only — the real enforcement is server-side
 * (`get_or_create_listing_conversation` and the `messages` INSERT policy),
 * so a race between this check resolving and a block landing fails closed
 * at the server, never open.
 *
 * `Screen edges={[]}`: every inset is handled by hand instead (the floating
 * header's top offset, the sticky bar's bottom padding, the fallback
 * header's top offset for the loading/error/unavailable states) — the
 * gallery has to run edge-to-edge under the status bar, which `Screen`'s
 * own `edges` reservation would otherwise prevent for the whole screen.
 *
 * No blur anywhere ("bg 88%/94% + blur" in the handoff): same documented
 * simplification `Composer` already uses for its own "bg 94% + blur" —
 * `expo-blur` isn't a dependency anywhere in this app, and a raw rgba
 * literal would violate DESIGN.md §15 rule 1 regardless. A solid `bg` fill
 * is visually close and adds neither.
 */

const BACK_ICON: IconName = { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' };
const HEART_ICON: IconName = { ios: 'heart', android: 'favorite_border', web: 'favorite_border' };
const HEART_FILLED_ICON: IconName = { ios: 'heart.fill', android: 'favorite', web: 'favorite' };
// Verified against the installed packages: 'ellipsis' exists in
// sf-symbols-typescript's types, and 'more_vert' exists in expo-symbols'
// android/symbols.json.
const MORE_ICON: IconName = { ios: 'ellipsis', android: 'more_vert', web: 'more_vert' };
// Verified the same way: 'bubble.left.and.bubble.right.fill' and
// 'chat_bubble' both exist in sf-symbols-typescript and expo-symbols'
// android/symbols.json respectively — filled, not outline, to match the
// sticky bar's own solid `buttonPrimary` fill.
const MESSAGE_ICON: IconName = {
  ios: 'bubble.left.and.bubble.right.fill',
  android: 'chat_bubble',
  web: 'chat_bubble',
};
// Same shape as explore.tsx/inbox/index.tsx's own ERROR_ICON constants.
const ERROR_ICON: IconName = { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' };
// Same "hidden/removed" icon listing-actions-sheet.tsx's ACTION_ICON.remove
// already uses, and seller/[id].tsx's/conversation/[id].tsx's own null-data
// cases reuse.
const UNAVAILABLE_ICON: IconName = { ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' };

const FLOATING_BUTTON_SIZE = minTouchTarget;
const GALLERY_GRADIENT_HEIGHT = 120;
/** Bespoke, not `radius.xl` (16) — the handoff's own sheet radius, deliberately larger than the token scale's top step (DESIGN.md §15 rule 4: a per-element override when the design asks for a size the scale doesn't have). Also how far the sheet overlaps the gallery. */
const SHEET_RADIUS = 28;
const SHEET_PADDING_TOP = space[6]; // 24
const SHEET_PADDING_H = space[5]; // 20
const SHEET_GAP = 18; // bespoke — between the handoff's own space[6]=24 and space[5]=20
const SELLER_AVATAR_SIZE = 52;
/** Bespoke, not `border.thick` (2) — the handoff's own border width, same precedent `PinnedListingStrip`'s `CARD_BORDER_WIDTH` follows. */
const CARD_BORDER_WIDTH = 1.5;
/** Bespoke, not `border.thick` — the handoff's own hard-shadow offsets, same precedent `PinnedListingStrip`'s `CARD_SHADOW_OFFSET` and `Composer`'s `SEND_SHADOW_OFFSET` follow. */
const SELLER_CARD_SHADOW_OFFSET = 3;
const ACTION_BUTTON_SHADOW_OFFSET = 2;
const ACTION_BUTTON_SIZE = 52;
const CONDITION_STICKER_ROTATION = 3;
const PRICE_FONT_SIZE = 40;
const PRICE_LETTER_SPACING = -0.02 * PRICE_FONT_SIZE;
const PRICE_LINE_HEIGHT_RATIO = 1.2;
const BADGE_GAP = space[2]; // 8

/** The sticky bar's own content height (padding + button), for the scroll content's bottom padding — see this file's own `Screen edges={[]}` note. */
const ACTION_BAR_CONTENT_HEIGHT = space[3] * 2 + ACTION_BUTTON_SIZE;

export default function ListingDetailScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const viewerId = session?.user.id;
  const { id } = useLocalSearchParams<{ id: string }>();

  const detailQuery = useListingDetail(id);
  // Structured details (item type, colors, …) as extra read-only badges. A
  // separate fetch on purpose: the detail query is unchanged, and if this one
  // fails or is slow the page simply shows no extra badges.
  const attributeVocabQuery = useAttributeVocabulary();
  const listingAttributesQuery = useListingAttributes(id);
  const attributeTerms =
    attributeVocabQuery.data && listingAttributesQuery.data
      ? attributeBadgeTerms(attributeVocabQuery.data, listingAttributesQuery.data.values)
      : [];
  const brandLabel = listingAttributesQuery.data ? brandSelectionLabel(listingAttributesQuery.data.brand) : null;
  const { setFavorite, pendingListingIds } = useSetFavorite();
  const favoritePending = pendingListingIds.has(id);
  const startConversation = useStartConversation();
  // ROADMAP 5.2 -- proactive UX on top of the server-side RLS/RPC
  // enforcement (get_or_create_listing_conversation and the messages
  // INSERT policy are what actually prevent messaging either way): hides
  // the "Message seller" action bar once a block exists between the
  // viewer and this seller, in EITHER direction. `is_blocked_with` never
  // reveals which side blocked which -- see its own migration's header.
  //
  // Defaulting `?? false` while this query is still pending would show the
  // action bar for an instant on every load before flipping it away for a
  // genuinely blocked pair -- unlike isOwnListing (synchronous) or
  // isFavorited (bundled into detailQuery's own single fetch), this is a
  // SECOND round trip with nothing to piggyback on. The action bar's own
  // gate below additionally waits on `isBlockedEitherWayQuery.isPending`,
  // so "don't know yet" reads as "don't show yet," not "assume not blocked."
  const isBlockedEitherWayQuery = useIsBlockedEitherWay(detailQuery.data?.sellerId);
  const isBlockedEitherWay = isBlockedEitherWayQuery.data ?? false;
  const isBlockedEitherWayPending = isBlockedEitherWayQuery.isPending;
  // ROADMAP 5.1 — the "more" menu's Report entry point. Hidden entirely on
  // the viewer's own listing (see `isOwnListing` below and the floating
  // header), so this only ever opens for someone else's listing.
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  function handleMessageSeller(listingId: string) {
    if (startConversation.isPending) return; // belt-and-suspenders on top of the button's own loading-gated disable
    startConversation.mutate(listingId, {
      onSuccess: (conversationId) => {
        router.push({ pathname: '/(app)/conversation/[id]', params: { id: conversationId } });
      },
    });
  }

  let body: ReactNode;
  let actionBar: ReactNode = null;
  // Lifted out of the loaded-data branch below so the floating header can
  // gate its "more" button on it without waiting for `detailQuery.data`.
  let isOwnListing = false;

  if (detailQuery.isPending) {
    // DESIGN.md §14.6's real layout order: gallery -> price -> title ->
    // attribute chips -> seller row.
    body = (
      <View style={styles.fallbackBody}>
        <Skeleton width="100%" aspectRatio={1} radius="md" />
        <View style={styles.section}>
          <Skeleton height={28} width="40%" radius="xs" />
          <Skeleton height={24} width="70%" radius="xs" />
          <View style={styles.chipRow}>
            <Skeleton height={32} width={80} radius="sm" />
            <Skeleton height={32} width={80} radius="sm" />
            <Skeleton height={32} width={80} radius="sm" />
          </View>
        </View>
        <SkeletonRow />
      </View>
    );
  } else if (detailQuery.isError) {
    body = (
      <EmptyState
        variant="error"
        icon={ERROR_ICON}
        title="Something went wrong"
        body={mapListingError(detailQuery.error).message}
        actionLabel="Try again"
        onAction={() => detailQuery.refetch()}
      />
    );
  } else if (detailQuery.data === null) {
    body = (
      <EmptyState
        variant="empty"
        icon={UNAVAILABLE_ICON}
        title="This listing isn't available anymore."
        actionLabel="Go back"
        onAction={() => router.back()}
      />
    );
  } else {
    const listing = detailQuery.data;
    const price = formatMoney(listing.priceAmount, listing.currency);
    const sellerName = listing.sellerDisplayName ?? listing.sellerUsername ?? 'Fynd seller';
    // viewerId is only undefined for an instant during session hydration,
    // before detailQuery could plausibly have resolved yet — same window
    // inbox/index.tsx's own ConversationRow documents. If it somehow did,
    // isOwnListing reads false here and the action bar could flash visible
    // on the viewer's own listing for an instant; harmless, since
    // get_or_create_listing_conversation's own guard rejects messaging
    // yourself server-side regardless.
    isOwnListing = viewerId === listing.sellerId;

    body = (
      <View>
        <View style={styles.galleryWrap}>
          <ListingGallery images={listing.images} title={listing.title} />
          {/* Keeps the status bar readable over a bright photo — see
              gradientGalleryHeader's own doc comment in tokens.ts. */}
          <View
            style={[styles.galleryGradient, { experimental_backgroundImage: [gradientGalleryHeader] }]}
            pointerEvents="none"
          />
          <View style={[styles.floatingHeader, { top: insets.top + space[3] }]}>
            <FloatingCircleButton icon={BACK_ICON} accessibilityLabel="Back" onPress={() => router.back()} />
            {/* Default/neutral variant, NOT onMedia -- hidden on the
                viewer's own listing, mirroring how the sticky "Message
                seller" bar below is already hidden for the same reason. */}
            {!isOwnListing ? (
              <FloatingCircleButton
                icon={MORE_ICON}
                accessibilityLabel="More actions"
                onPress={() => setMoreMenuOpen(true)}
              />
            ) : null}
          </View>
        </View>

        <View style={[styles.sheet, { backgroundColor: colors.bg }]}>
          <View style={styles.priceRow}>
            <Text variant="price" style={styles.priceText}>
              {price}
            </Text>
            <Sticker
              label={`${CONDITION_LABELS[listing.condition]} condition`}
              tone="accent"
              rotate={CONDITION_STICKER_ROTATION}
            />
          </View>

          {/* RTL fix (SCREENS.md Task 9): writingDirection/textAlign 'auto'
              (in styles.titleText) so Hebrew/mixed titles render correctly
              instead of forcing LTR layout on RTL script. */}
          <Text variant="title" style={styles.titleText}>
            {listing.title}
          </Text>

          <View style={styles.badgeRow}>
            <FilledBadge label={formatSizeLabel(listing.size)} />
            <OutlineBadge
              label={formatCategoryBreadcrumb(
                { name: listing.categoryParentName },
                { name: listing.categoryName },
              )}
            />
            {brandLabel ? <OutlineBadge label={brandLabel} /> : null}
            {attributeTerms.map((term) => (
              <OutlineBadge key={term.id} label={term.label} />
            ))}
          </View>

          {/* Same RTL fix as the title above — see styles.descriptionText. */}
          <Text variant="body" color="textSecondary" style={styles.descriptionText}>
            {listing.description}
          </Text>

          <View style={styles.sellerCardWrap}>
            <View
              style={[styles.sellerCardShadow, { backgroundColor: colors.text }]}
              pointerEvents="none"
            />
            <Pressable
              onPress={() =>
                router.push({ pathname: '/(app)/seller/[id]', params: { id: listing.sellerId } })
              }
              accessibilityRole="button"
              accessibilityLabel={`View ${sellerName}'s profile`}
              style={({ pressed }) => [
                styles.sellerCard,
                { backgroundColor: colors.bgElevated, borderColor: colors.text, opacity: pressed ? 0.7 : 1 },
              ]}>
              {/* One Pressable for the whole card, not the avatar/name/pill
                  separately — same "never left to the call site" reasoning
                  this row already documented before the restyle: a floored
                  minHeight plus the card's own padding reaches 44pt with no
                  side effect on the rest of the sheet. "View closet" is a
                  purely visual pill, not a second tap target. */}
              <StoryRing size={SELLER_AVATAR_SIZE} uri={listing.sellerAvatarUrl ?? undefined} active person />
              <View style={styles.sellerCardMain}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {sellerName}
                </Text>
                <Text variant="caption" color="textSecondary">
                  Seller
                </Text>
              </View>
              <View style={[styles.viewClosetPill, { borderColor: colors.text }]}>
                <Text variant="label" numberOfLines={1}>
                  View closet
                </Text>
              </View>
            </Pressable>
          </View>
        </View>
      </View>
    );

    if (!isOwnListing && !isBlockedEitherWay && !isBlockedEitherWayPending) {
      actionBar = (
        <View
          style={[
            styles.actionBar,
            {
              borderTopColor: colors.border,
              backgroundColor: colors.bg,
              paddingBottom: space[3] + insets.bottom,
            },
          ]}>
          {startConversation.isError ? (
            <Text variant="caption" color="danger">
              {mapInboxError(startConversation.error).message}
            </Text>
          ) : null}
          <View style={styles.actionBarRow}>
            <FavoriteButton
              isFavorited={listing.isFavorited}
              disabled={favoritePending}
              onPress={() => setFavorite(id, !listing.isFavorited)}
            />
            <MessageSellerButton
              loading={startConversation.isPending}
              onPress={() => handleMessageSeller(listing.listingId)}
            />
          </View>
        </View>
      );
    }
  }

  const isFallback = !detailQuery.data;

  return (
    <Screen edges={[]} contentContainerStyle={styles.content} padded={false} scroll={false}>
      {isFallback ? (
        <View style={[styles.fallbackHeader, { paddingTop: insets.top + space[3] }]}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [styles.fallbackBackButton, { opacity: pressed ? 0.7 : 1 }]}>
            <Icon name={BACK_ICON} size="md" color={colors.text} />
          </Pressable>
        </View>
      ) : null}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={[
          styles.scrollContent,
          isFallback
            ? styles.fallbackScrollContent
            : { paddingBottom: ACTION_BAR_CONTENT_HEIGHT + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
      {actionBar}
      {detailQuery.data ? (
        <MoreActionsSheet
          visible={moreMenuOpen}
          onClose={() => setMoreMenuOpen(false)}
          target={{ listingId: detailQuery.data.listingId }}
          targetKind="listing"
          blockTargetUserId={detailQuery.data.sellerId}
        />
      ) : null}
    </Screen>
  );
}

// ============================================================
// Floating header circle (back / more)
// ============================================================

function FloatingCircleButton({
  icon,
  accessibilityLabel,
  onPress,
}: {
  icon: IconName;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.floatingButton, { backgroundColor: colors.bg, opacity: pressed ? 0.7 : 1 }]}>
      <Icon name={icon} size="md" color={colors.text} />
    </Pressable>
  );
}

// ============================================================
// Sticky bar buttons
// ============================================================

function FavoriteButton({
  isFavorited,
  disabled,
  onPress,
}: {
  isFavorited: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
      accessibilityState={{ disabled, selected: isFavorited }}
      style={({ pressed }) => [
        styles.favoriteButton,
        { borderColor: colors.borderStrong, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}>
      <Icon
        name={isFavorited ? HEART_FILLED_ICON : HEART_ICON}
        size="md"
        color={colors[isFavorited ? 'favoriteActive' : 'text']}
      />
    </Pressable>
  );
}

function MessageSellerButton({ loading, onPress }: { loading: boolean; onPress: () => void }) {
  const { colors } = useAppTheme();
  const interactive = !loading;
  return (
    <View style={styles.messageButtonWrap}>
      {/* The hard shadow: a real offset backing View, not a platform shadow
          — same technique PinnedListingStrip/Composer already use. */}
      <View style={[styles.messageButtonShadow, { backgroundColor: colors.text }]} pointerEvents="none" />
      <Pressable
        onPress={onPress}
        disabled={!interactive}
        accessibilityRole="button"
        accessibilityLabel="Message seller"
        accessibilityState={{ disabled: !interactive, busy: loading }}
        style={({ pressed }) => [
          styles.messageButton,
          {
            backgroundColor: pressed ? colors.buttonPrimaryPressed : colors.buttonPrimary,
            opacity: loading ? 0.7 : 1,
          },
        ]}>
        {loading ? (
          <ActivityIndicator color={colors.onButtonPrimary} />
        ) : (
          <>
            <Icon name={MESSAGE_ICON} size="sm" color={colors.onButtonPrimary} />
            <Text variant="bodyStrong" color="onButtonPrimary">
              Message seller
            </Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

// ============================================================
// Static attribute badges — pill-shaped, so not `Chip` (DESIGN.md §7: a
// pill is reachable only through PillButton/ReactionPill, and the Sell
// tab's own static rack-status pill is the one other named exception,
// local to that screen for the identical reason these are local here).
// Neither is interactive: they're display-only tags, never a filter.
// ============================================================

function FilledBadge({ label }: { label: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.badge, { backgroundColor: colors.bgInverse }]}>
      <Text variant="label" color="textInverse" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function OutlineBadge({ label }: { label: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.badge, styles.outlineBadge, { borderColor: colors.text }]}>
      <Text variant="label" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  fallbackScrollContent: {
    paddingHorizontal: space[5],
    paddingBottom: space[5],
  },
  fallbackHeader: {
    paddingHorizontal: space[5],
  },
  fallbackBackButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackBody: {
    gap: space[6],
    paddingTop: space[4],
  },

  galleryWrap: {
    height: GALLERY_HEIGHT,
  },
  galleryGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: GALLERY_GRADIENT_HEIGHT,
  },
  floatingHeader: {
    position: 'absolute',
    left: space[5],
    right: space[5],
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  floatingButton: {
    width: FLOATING_BUTTON_SIZE,
    height: FLOATING_BUTTON_SIZE,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sheet: {
    marginTop: -SHEET_RADIUS,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    paddingTop: SHEET_PADDING_TOP,
    paddingHorizontal: SHEET_PADDING_H,
    gap: SHEET_GAP,
  },
  section: {
    gap: space[3],
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  priceText: {
    fontSize: PRICE_FONT_SIZE,
    // Not equal to the font size: a line box that tight clips the tops of the
    // digits and the ₪ sign on iOS. Same ≈1.2 leading as the `price` variant.
    lineHeight: Math.round(PRICE_FONT_SIZE * PRICE_LINE_HEIGHT_RATIO),
    letterSpacing: PRICE_LETTER_SPACING,
  },
  titleText: {
    textAlign: 'auto',
    writingDirection: 'auto',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: BADGE_GAP,
  },
  badge: {
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.full,
  },
  outlineBadge: {
    borderWidth: CARD_BORDER_WIDTH,
  },
  descriptionText: {
    textAlign: 'auto',
    writingDirection: 'auto',
  },
  chipRow: {
    flexDirection: 'row',
    gap: space[2],
  },

  sellerCardWrap: {},
  sellerCardShadow: {
    position: 'absolute',
    top: SELLER_CARD_SHADOW_OFFSET,
    left: 0,
    right: 0,
    bottom: -SELLER_CARD_SHADOW_OFFSET,
    borderRadius: radius.xl,
  },
  sellerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[3],
    borderRadius: radius.xl,
    borderWidth: CARD_BORDER_WIDTH,
    minHeight: minTouchTarget,
  },
  sellerCardMain: {
    flex: 1,
    gap: space[1] / 2,
  },
  viewClosetPill: {
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.full,
    borderWidth: CARD_BORDER_WIDTH,
  },

  actionBar: {
    gap: space[2],
    paddingTop: space[3],
    paddingHorizontal: space[4],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  favoriteButton: {
    width: ACTION_BUTTON_SIZE,
    height: ACTION_BUTTON_SIZE,
    borderRadius: radius.full,
    borderWidth: CARD_BORDER_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageButtonWrap: {
    flex: 1,
  },
  messageButtonShadow: {
    position: 'absolute',
    top: ACTION_BUTTON_SHADOW_OFFSET,
    left: 0,
    right: 0,
    bottom: -ACTION_BUTTON_SHADOW_OFFSET,
    borderRadius: radius.full,
  },
  messageButton: {
    height: ACTION_BUTTON_SIZE,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
});
