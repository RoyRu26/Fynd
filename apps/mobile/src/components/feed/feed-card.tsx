import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Button, IconButton, ListingImage, Text, type IconName } from '@/components/ui';
import { FeedCardGestures } from '@/components/feed/feed-card-gestures';
import { MoreActionsSheet } from '@/components/report/more-actions-sheet';
import { gradientScrim, radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { useSetFavorite } from '@/features/favorites/queries';
import { mapInboxError } from '@/features/inbox/errors';
import { useStartConversation } from '@/features/inbox/queries';
import { CONDITION_LABELS } from '@/features/listings/condition';
import { formatMoney } from '@/features/listings/price';
import { isJustDropped } from '@/features/listings/recency';
import { formatSizeLabel } from '@/features/listings/size';
import type { FeedListing } from '@/features/feed/pagination';

/**
 * One page of the Home feed: full-bleed cover photo (wrapped in
 * FeedCardGestures for tap-or-swipe-left-to-open-detail and
 * double-tap-to-like) and the DESIGN.md §14.1 overlay.
 *
 * The overlay is one bottom-anchored caption block: optional "Just dropped"
 * tag, then a row pairing [seller row + title + specs] with the two-icon
 * action rail (favorite, then "more" — ROADMAP 5.1's Report entry point, via
 * `MoreActionsSheet`) at its right edge, then the full-width action row
 * (price plate + "Text seller").
 *
 * The rail is top-aligned within that row, so the favorite button lines up
 * with the seller's avatar. That placement is doing three jobs at once: it
 * matches the design, it keeps the rail out of the title's way (the rail
 * claims real horizontal space rather than floating over it), and it puts
 * the rail far enough down the scrim's ramp to have actual backing — stacked
 * above the whole caption it sat in the gradient's transparent top, where
 * the accent-tinted favorited glyph measured ~1.4:1. The action row stays
 * OUTSIDE that row so price + CTA still span the card's full width.
 *
 * Everything stays content-sized: no fixed offsets from the bottom edge,
 * unlike the design mock's 100px/250px.
 *
 * Deliberately still minimal: no share (named in §14.1's rail but not in any
 * shipped ROADMAP item), no comments, no follow, no shipping or location
 * (the columns do not exist), and no rendered timestamp — "Just dropped" is
 * the one derived binary recency flag §14.1 permits, and it shows no date,
 * clock time, or age.
 *
 * Buy now / Offer from the mock are deliberately absent: there is no
 * payments backend, and a dead primary CTA on the product's most-used screen
 * is worse than no CTA. "Text seller" is the single primary action, reusing
 * the same `get_or_create_listing_conversation` flow as listing detail.
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

// DESIGN.md §5 rule 5 permits capping Dynamic Type on the feed overlay
// specifically: this block sits over photography with a finite amount of
// room, and §14.1's own tier 1 says the photo stays dominant. Everything
// here also carries numberOfLines, so the cap bounds growth rather than
// clipping. `Button` forwards `style` to its own Pressable but renders its
// label through its own `Text`, which takes no TEXT-style or
// maxFontSizeMultiplier pass-through — so the CTA's label is not capped. It
// grows, which is graceful, not clipped.
const FEED_OVERLAY_MAX_FONT_SCALE = 1.4;

// The seller row is a 32pt avatar beside a 20pt line — short of §12.1's 44pt
// on its own. hitSlop rather than minHeight so the caption block does not
// gain 12pt of dead vertical space (which would also make the scrim taller);
// the slop expands into the tag above and the title below, both of which are
// pointerEvents="none", so it competes with nothing.
const SELLER_ROW_HIT_SLOP = { top: space[2], bottom: space[2], left: space[2], right: space[2] };

// Verified against the installed packages: 'heart'/'heart.fill' exist in
// sf-symbols-typescript's types, and 'favorite_border'/'favorite' exist in
// expo-symbols' android/symbols.json.
const FAVORITE_ICON: IconName = { ios: 'heart', android: 'favorite_border', web: 'favorite_border' };
const FAVORITED_ICON: IconName = { ios: 'heart.fill', android: 'favorite', web: 'favorite' };
// Verified against the installed packages: 'ellipsis' exists in
// sf-symbols-typescript's types, and 'more_vert' exists in expo-symbols'
// android/symbols.json.
const MORE_ICON: IconName = { ios: 'ellipsis', android: 'more_vert', web: 'more_vert' };

export type FeedCardProps = {
  listing: FeedListing;
};

export function FeedCard({ listing }: FeedCardProps) {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { session } = useAuth();

  // Formatted from the listing's OWN stored currency, never a hardcoded
  // symbol — `listings.currency` defaults to ILS but travels on every row,
  // so the card renders whatever that row actually says.
  const price = formatMoney(listing.priceAmount, listing.currency);
  const sellerName = listing.sellerDisplayName ?? listing.sellerUsername ?? 'Fynd seller';
  // The VISUAL identity is the @handle where one exists (§14.1 tier 4); the
  // SPOKEN identity below stays `sellerName`, since a screen reader reading
  // out a handle character by character helps nobody.
  const sellerHandle = listing.sellerUsername ? `@${listing.sellerUsername}` : sellerName;
  const specsLine = `${formatSizeLabel(listing.size)} · ${CONDITION_LABELS[listing.condition]}`;
  const justDropped = isJustDropped(listing.createdAt);

  // `session` is undefined for an instant during hydration, so the CTA can
  // flash on the viewer's own listing; harmless, because
  // get_or_create_listing_conversation refuses self-messaging server-side
  // regardless. Production feeds exclude own listings anyway — but
  // index.tsx's INCLUDE_OWN_LISTINGS_FOR_LOCAL_TESTING flag is exactly the
  // configuration a developer runs locally, so without this guard the only
  // locally reachable state of this button is the broken one.
  const isOwnListing = session?.user.id === listing.sellerId;

  // Real, per-device measurement, not a guessed tab-bar height. expo-router's
  // NativeTabs nests each tab's screen content in its own safe-area scope
  // (a dedicated SafeAreaProvider on iOS; a react-native-screens SafeAreaView
  // on Android) specifically so the content underneath can ask "how much of
  // me is covered by the floating bar" — see app-tabs.tsx and the NativeTabs
  // source under expo-router/build/native-tabs/NativeTabsView.*.js. Reading
  // it here, directly, is what keeps this card full-bleed: only the overlay's
  // bottom padding grows, never the card's own height or the image beneath.
  const insets = useSafeAreaInsets();

  // Shared with the detail screen: patches every cache showing this heart
  // and disables it while this listing's own change is in flight.
  const { setFavorite, pendingListingIds } = useSetFavorite();
  const favoritePending = pendingListingIds.has(listing.listingId);

  // Per-card instance on purpose: pending and error state belong to the card
  // the user actually tapped, not to the feed. Known limitation, not worth a
  // hook rewrite to fix: if this card unmounts before the RPC settles (page
  // ~2 screens away fast), TanStack drops mutate's per-call onSuccess and no
  // navigation happens — windowSize={5} makes that take real effort to hit.
  const startConversation = useStartConversation();

  // No useIsBlockedEitherWay here, unlike listing detail: feed_listings
  // already filters blocked sellers in BOTH directions server-side
  // (20261020065008), so a blocked seller's card cannot reach this component
  // at all — and the check would be one extra query per mounted card.

  // ROADMAP 5.1 — the "more" menu's Report entry point. Local to this card
  // instance, same as every other piece of this card's own UI state.
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // Double-tap is never a toggle: it only ever favorites, and only when
  // there's something to do — already-favorited and already-pending both
  // skip the mutation (never a duplicate send, never an unfavorite) while
  // still letting the caller replay the pop animation unconditionally.
  const handleDoubleTap = useCallback(() => {
    if (listing.isFavorited || favoritePending) return;
    setFavorite(listing.listingId, true);
  }, [listing.isFavorited, listing.listingId, favoritePending, setFavorite]);

  const handleSingleTap = useCallback(() => {
    router.push({ pathname: '/(app)/listing/[id]', params: { id: listing.listingId } });
  }, [router, listing.listingId]);

  function handleOpenSeller() {
    router.push({ pathname: '/(app)/seller/[id]', params: { id: listing.sellerId } });
  }

  function handleTextSeller() {
    // Belt-and-suspenders on top of the Button's own loading-gated disable,
    // mirroring listing/[id].tsx's identical guard.
    if (startConversation.isPending) return;
    startConversation.mutate(listing.listingId, {
      onSuccess: (conversationId) => {
        router.push({ pathname: '/(app)/conversation/[id]', params: { id: conversationId } });
      },
    });
  }

  // The composed label is the ONLY path this listing's data takes to a
  // screen-reader user: every static Text in the overlay below is hidden from
  // the accessibility tree to avoid reading all of it twice (see the overlay's
  // own comment). So it has to carry everything the sighted caption shows.
  // `size M` rather than a bare `M`, which VoiceOver pronounces "em".
  const photoLabel = [
    justDropped ? 'Just dropped' : null,
    listing.title,
    price,
    `size ${formatSizeLabel(listing.size)}`,
    CONDITION_LABELS[listing.condition],
    `from ${sellerName}`,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.card}>
      <FeedCardGestures
        onDoubleTap={handleDoubleTap}
        onSingleTap={handleSingleTap}
        accessibilityLabel={photoLabel}>
        <ListingImage uri={listing.coverUrl} fill contentFit="cover" recyclingKey={listing.listingId} />
      </FeedCardGestures>

      {/* box-none throughout: the overlay and its containers must never
          swallow the vertical swipe that pages the feed, nor the taps that
          "tap anywhere to open detail" depends on. Only real controls — the
          two IconButtons, the seller row, the CTA — claim a touch.

          The scrim lives on THIS view, not a separate full-card layer: it is
          bottom-anchored with no `top`, so its own height — and therefore the
          gradient's extent — is whatever this content actually needs, not an
          arbitrary fraction of the photo. */}
      <View
        pointerEvents="box-none"
        style={[styles.overlay, { paddingBottom: insets.bottom + FEED_OVERLAY_BOTTOM_GAP }]}>
        <View pointerEvents="box-none" style={styles.caption}>
          {/* EVERY non-interactive group below — including the error plate —
              carries `pointerEvents="none"`, and it is load-bearing: a plain
              View IS a hit-test target, and the GestureDetector is a SIBLING
              of this overlay, not an ancestor, so a touch landing here would
              die rather than fall through. Drop it on any one of them and
              "tap there to open the listing" silently stops working, with
              nothing visual to catch it.

              The hide-from-accessibility props are separate and narrower:
              they go on the three PURELY DECORATIVE groups (tag, title block,
              price plate), whose content the photo's own composed label
              already speaks. The error plate is deliberately excluded — it is
              the one piece of overlay text a screen-reader user must hear.

              The hide props must also stay on the INDIVIDUAL groups. Moving
              them up to this caption container would delete the seller row
              and the CTA from the accessibility tree entirely, again with no
              visible change. The visual order alternates static and
              interactive, so a single wrapper is not possible without
              reordering the design. */}
          {justDropped ? (
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.tagPlate, { backgroundColor: colors.accent }]}>
              <Text
                variant="micro"
                color="onAccent"
                numberOfLines={1}
                maxFontSizeMultiplier={FEED_OVERLAY_MAX_FONT_SCALE}
                style={styles.tagLabel}>
                Just dropped
              </Text>
            </View>
          ) : null}

          {/* The rail rides alongside this block rather than above the whole
              caption, top-aligned so the favorite button lines up with the
              seller's avatar (DESIGN.md §14.1). Two consequences, both
              wanted: the rail claims its own horizontal space so it can never
              overlap the title, and it sits far enough down the scrim's ramp
              for its own glyphs to have real backing. The action row below is
              deliberately OUTSIDE this row, so price + CTA still span the
              card's full width. */}
          <View pointerEvents="box-none" style={styles.upperRow}>
            <View pointerEvents="box-none" style={styles.upperLeft}>
              {/* One Pressable for the whole row, never the avatar and name
                  separately — matching listing/[id].tsx's own seller row.
                  alignSelf keeps it hugging its content: stretched to the
                  caption's full width, a tap to the right of the handle would
                  open the closet instead of the listing. */}
              <Pressable
                onPress={handleOpenSeller}
                accessibilityRole="button"
                accessibilityLabel={`View ${sellerName}'s closet`}
                hitSlop={SELLER_ROW_HIT_SLOP}
                style={({ pressed }) => [styles.sellerRow, { opacity: pressed ? 0.7 : 1 }]}>
                {/* Empty label (not undefined) short-circuits Avatar's own
                    `accessible={Boolean(label)}`, so the avatar never becomes a
                    nested node inside this row's own label. Initials still
                    render — and with no avatar images in the product yet, the
                    initials path is the live one. */}
                <Avatar
                  size="sm"
                  source={listing.sellerAvatarUrl ?? undefined}
                  name={sellerName}
                  accessibilityLabel=""
                />
                <Text
                  variant="label"
                  color="textOnMedia"
                  numberOfLines={1}
                  maxFontSizeMultiplier={FEED_OVERLAY_MAX_FONT_SCALE}
                  style={styles.handle}>
                  {sellerHandle}
                </Text>
              </Pressable>

              <View
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.titleBlock}>
                <Text
                  variant="heading"
                  color="textOnMedia"
                  numberOfLines={2}
                  maxFontSizeMultiplier={FEED_OVERLAY_MAX_FONT_SCALE}
                  style={styles.title}>
                  {listing.title}
                </Text>
                {/* Full-opacity textOnMedia, never dimmed (§14.1): the scrim only
                    guarantees legibility for opaque on-media text, and the mock's
                    72% would measure ≈2.77:1 over a bright photo. De-emphasis is
                    carried by size and tracking instead. */}
                <Text
                  variant="micro"
                  color="textOnMedia"
                  numberOfLines={1}
                  maxFontSizeMultiplier={FEED_OVERLAY_MAX_FONT_SCALE}
                  style={styles.specs}>
                  {specsLine}
                </Text>
              </View>
                </View>

            <View pointerEvents="box-none" style={styles.actionRail}>
              <IconButton
                icon={listing.isFavorited ? FAVORITED_ICON : FAVORITE_ICON}
                accessibilityLabel={
                  listing.isFavorited ? 'Remove from favorites' : 'Add to favorites'
                }
                onPress={() => setFavorite(listing.listingId, !listing.isFavorited)}
                disabled={favoritePending}
                selected={listing.isFavorited}
                variant="onMedia"
                color={listing.isFavorited ? 'favoriteActive' : undefined}
              />
              <IconButton
                icon={MORE_ICON}
                accessibilityLabel="More actions"
                onPress={() => setMoreMenuOpen(true)}
                variant="onMedia"
              />
            </View>
          </View>

          {/* Opaque plate, not bare danger text over the photo: `danger` on an
              unknown bright image is worst-case ~1.5:1. A SOLID `danger` fill
              with an `onDanger` label, not `danger`-on-`dangerBg` — the
              latter measures 3.89:1 in the dark scheme (below §12.2's 4.5:1
              for this caption-sized text) and is not actually asserted
              anywhere in palette.test.ts, whereas onDanger-on-danger is a
              tested pair at 4.60:1. The card simply grows upward by a line in
              the error state — nothing reflows or clips, since the overlay is
              bottom-anchored and content-sized.

              Deliberately NOT hidden from the accessibility tree, unlike the
              static groups around it: a blind user who taps "Text seller" and
              gets nothing needs to be told why. That makes it a conditional
              sixth AT stop (§14.1). `accessibilityLiveRegion` is Android-only,
              so `accessibilityRole="alert"` is what carries the announcement
              on iOS — both live on the Text, matching the six existing error
              call sites (explore.tsx, sell/[id].tsx). */}
          {startConversation.isError ? (
            <View pointerEvents="none" style={[styles.errorPlate, { backgroundColor: colors.danger }]}>
              <Text
                variant="caption"
                color="onDanger"
                numberOfLines={2}
                maxFontSizeMultiplier={FEED_OVERLAY_MAX_FONT_SCALE}
                accessibilityLiveRegion="polite"
                accessibilityRole="alert">
                {mapInboxError(startConversation.error).message}
              </Text>
            </View>
          ) : null}

          <View pointerEvents="box-none" style={styles.actionRow}>
            {/* §14.1 tier 2 + §3 rule 2's named exception: the price is the
                one element allowed to be loud, and the only solid accent fill
                on the card besides the tag. Opaque, so it never depends on
                the photo underneath (the feed is forced dark: onAccent on the
                dark accent is 7.5:1, enforced by palette.test.ts).
                `flexShrink: 0` pins the plate to its
                content width so the CTA's `flex: 1` absorbs the remainder
                rather than the two fighting over it; a long price therefore
                squeezes the CTA, whose label wraps and grows the row taller
                rather than clipping. */}
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.pricePlate, { backgroundColor: colors.accent }]}>
              <Text
                variant="price"
                color="onAccent"
                numberOfLines={1}
                maxFontSizeMultiplier={FEED_OVERLAY_MAX_FONT_SCALE}>
                {price}
              </Text>
            </View>

            {/* `secondary`, not `primary`: the card already carries two solid
                accent fills (tag + price), and a third would blow §3 rule 2's
                restraint. In the dark scheme secondary is an opaque
                bgElevated fill at ~15:1, immune to whatever photo is beneath,
                which keeps price as the loud element per tier 2. */}
            {isOwnListing ? null : (
              <Button
                variant="secondary"
                size="md"
                style={styles.cta}
                loading={startConversation.isPending}
                onPress={handleTextSeller}>
                Text seller
              </Button>
            )}
          </View>
        </View>
      </View>

      <MoreActionsSheet
        visible={moreMenuOpen}
        onClose={() => setMoreMenuOpen(false)}
        target={{ listingId: listing.listingId }}
        targetKind="listing"
        blockTargetUserId={listing.sellerId}
      />
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
    // No `top`: height is intrinsic to the caption's own content rather than
    // stretched to the full card, which is what keeps the gradient confined
    // to this block instead of washing over most of the photo.
    experimental_backgroundImage: [gradientScrim],
    paddingHorizontal: space[5],
    paddingTop: space[5],
    // paddingBottom is set inline — it depends on the per-device safe-area
    // inset above, not a static token.
  },
  caption: {
    gap: space[2],
  },
  // `flex-start` is what aligns the favorite button with the seller's avatar:
  // both children start at this row's top edge.
  upperRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
  },
  upperLeft: {
    flex: 1,
    gap: space[2],
  },
  actionRail: {
    alignItems: 'center',
    gap: space[4],
  },
  tagPlate: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },
  // Uppercase + tracking are this card's documented type deviation (§14.1).
  tagLabel: {
    textTransform: 'uppercase',
    letterSpacing: 2.2,
  },
  sellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    alignSelf: 'flex-start',
  },
  handle: {
    flexShrink: 1,
  },
  titleBlock: {
    gap: space[1],
  },
  title: {
    textTransform: 'uppercase',
    letterSpacing: -0.2,
  },
  specs: {
    textTransform: 'uppercase',
    letterSpacing: 1.8,
  },
  errorPlate: {
    borderRadius: radius.sm,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    marginTop: space[1],
  },
  pricePlate: {
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    flexShrink: 0,
  },
  cta: {
    flex: 1,
  },
});
