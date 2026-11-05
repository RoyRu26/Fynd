import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  EmptyState,
  Icon,
  ListingImage,
  PillButton,
  Screen,
  Skeleton,
  Sticker,
  Text,
  type IconName,
  type TextColor,
} from '@/components/ui';
import { AppThemeProvider, useAppTheme } from '@/design/theme-provider';
import { radius, space } from '@/design/tokens';
import { useAuth } from '@/features/auth/auth-provider';
import type { ListingRow as ListingRowData } from '@/features/listings/api';
import { mapListingError } from '@/features/listings/errors';
import {
  countRackEligible,
  selectRackItems,
  type RackItem,
  type RackStatusKind,
} from '@/features/listings/rack';
import { useCreateDraft, useListingCovers, useMyListings } from '@/features/listings/queries';

// Verified against the installed packages: 'exclamationmark.triangle'/'warning'
// exists in sf-symbols-typescript's types and expo-symbols' android/symbols.json.
const ERROR_ICON: IconName = { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' };
// 'camera.fill' and 'photo_camera' likewise both exist in those packages.
const CAMERA_ICON: IconName = { ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' };

/** Diameter of the hero card's camera badge. */
const CAMERA_BADGE_SIZE = 56;
/** Rotation of the hero card's corner sticker, per the handoff. */
const HERO_STICKER_ROTATION = 8;

/**
 * How many of the seller's rack-eligible listings the horizontal strip
 * renders. A plain `ScrollView`, not a virtualized list (matching Explore's
 * own "Drops" row), so this caps render cost for a seller with a large
 * catalog; "See all" (routed to My Listings) is what reaches the rest.
 */
const RACK_PREVIEW_LIMIT = 12;
const RACK_THUMB_WIDTH = 76;
const RACK_THUMB_HEIGHT = 96;

/** Stroke width of the "Draft" rack pill's dashed outline, per the handoff. Not `border.thin`/`.thick` (1/2) — a bespoke value for this one badge, same precedent as StoryRing's own local ring-width constants. */
const RACK_DRAFT_PILL_BORDER_WIDTH = 1.5;

const RACK_STATUS_LABEL: Record<RackStatusKind, string> = {
  live: 'Live',
  draft: 'Draft',
  sold: 'Sold',
};

/**
 * Sell tab home (SCREENS.md Task 5) — the hero "snap it. / list it." CTA,
 * then "your rack" (a glanceable strip of the seller's own listings). Full
 * listing management (status filters, drafts, the manage/overflow sheet)
 * lives entirely on My Listings now; "See all" is the one link between them.
 *
 * "buzz" is deliberately not built. It needs two things the data cannot
 * support yet, the same way Explore's own save-count tiles were deliberately
 * omitted (see explore.tsx's header comment for the identical reasoning):
 *
 *   * **Who saved a listing.** `favorites`' RLS is `user_id = auth.uid()`, so
 *     a seller cannot read who favourited their OWN listings — that needs a
 *     `SECURITY DEFINER` RPC or a denormalised counter, a schema change out
 *     of scope for a UI task.
 *   * **Offers.** There is no offers table or RPC at all yet (README.md:
 *     "Buy now / Offer have no backend yet").
 *
 * Per the task's own "hide section if there's no data" rule, that is this
 * section hidden until a real data source exists, not a placeholder built
 * against invented data.
 */
export default function SellIndex() {
  const router = useRouter();
  const { session } = useAuth();
  const sellerId = session?.user.id;

  const listingsQuery = useMyListings(sellerId);
  const createDraft = useCreateDraft(sellerId);

  // Tracks which hero button is in flight so the OTHER one can be disabled
  // (never both spinning for one shared mutation) and so only the pressed
  // button shows its own spinner.
  const [heroAction, setHeroAction] = useState<'camera' | 'gallery' | null>(null);
  const [heroError, setHeroError] = useState<string | null>(null);

  function openListing(listingId: string) {
    router.push({ pathname: '/(app)/(tabs)/sell/[id]', params: { id: listingId } });
  }

  async function startListing(source: 'camera' | 'gallery') {
    setHeroError(null);
    setHeroAction(source);
    try {
      const draft = await createDraft.mutateAsync();
      // `autoPick` tells the editor to open that same picker immediately —
      // see sell/[id].tsx's own doc comment on `autoPick`.
      router.push({ pathname: '/(app)/(tabs)/sell/[id]', params: { id: draft.id, autoPick: source } });
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
      setHeroError(mapListingError(err).message);
    } finally {
      setHeroAction(null);
    }
  }

  const listings = listingsQuery.data ?? [];
  const rackItems = selectRackItems(listings, RACK_PREVIEW_LIMIT);
  const rackTotal = countRackEligible(listings);
  const coversQuery = useListingCovers(rackItems.map((item) => item.id));

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <Text variant="display">sell</Text>

      <HeroCard
        onOpenCamera={() => startListing('camera')}
        onFromGallery={() => startListing('gallery')}
        cameraBusy={heroAction === 'camera' && createDraft.isPending}
        galleryBusy={heroAction === 'gallery' && createDraft.isPending}
      />
      {heroError ? <ErrorText message={heroError} /> : null}

      {listingsQuery.isPending ? (
        <RackSkeleton />
      ) : listingsQuery.isError ? (
        <EmptyState
          variant="error"
          icon={ERROR_ICON}
          title="Something went wrong"
          body={mapListingError(listingsQuery.error).message}
          actionLabel="Try again"
          onAction={() => listingsQuery.refetch()}
        />
      ) : rackItems.length > 0 ? (
        <RackSection
          items={rackItems}
          totalCount={rackTotal}
          coverUrlByListingId={coversQuery.data ?? {}}
          onPressItem={openListing}
          onSeeAll={() => router.push('/(app)/(tabs)/profile/my-listings')}
        />
      ) : null}
    </Screen>
  );
}

function ErrorText({ message }: { message: string }) {
  return (
    <Text
      variant="caption"
      color="danger"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert">
      {message}
    </Text>
  );
}

// ============================================================
// Hero card
// ============================================================

function HeroCard({
  onOpenCamera,
  onFromGallery,
  cameraBusy,
  galleryBusy,
}: {
  onOpenCamera: () => void;
  onFromGallery: () => void;
  cameraBusy: boolean;
  galleryBusy: boolean;
}) {
  // Forces the card's own subtree dark regardless of the device scheme — the
  // same mechanism welcome.tsx and the Home feed use (see welcome.tsx's own
  // comment): every token inside resolves for a dark surface on its own
  // (`bg`, `PillButton`'s outline border/label, `Text`'s default color), so
  // "From gallery"'s outline reads cream-on-dark exactly as the handoff
  // specifies without hand-picking a color at the call site.
  return (
    <AppThemeProvider scheme="dark">
      <HeroCardContent
        onOpenCamera={onOpenCamera}
        onFromGallery={onFromGallery}
        cameraBusy={cameraBusy}
        galleryBusy={galleryBusy}
      />
    </AppThemeProvider>
  );
}

function HeroCardContent({
  onOpenCamera,
  onFromGallery,
  cameraBusy,
  galleryBusy,
}: {
  onOpenCamera: () => void;
  onFromGallery: () => void;
  cameraBusy: boolean;
  galleryBusy: boolean;
}) {
  const { colors } = useAppTheme();
  const busy = cameraBusy || galleryBusy;

  return (
    <View style={[styles.hero, { backgroundColor: colors.bg }]}>
      <View style={styles.heroSticker}>
        <Sticker label="2 min to list" tone="accent" rotate={HERO_STICKER_ROTATION} />
      </View>

      <View
        style={[styles.heroBadge, { backgroundColor: colors.accent }]}
        // Decorative: the headline right below already says what this
        // screen is for.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <Icon name={CAMERA_ICON} size="xl" color={colors.onAccent} />
      </View>

      <View style={styles.heroCopy}>
        <Text variant="display">{'snap it.\nlist it.'}</Text>
        <Text variant="body" style={styles.heroBody}>
          Start with photos. Add the price and details after.
        </Text>
      </View>

      <View style={styles.heroActions}>
        <PillButton
          onPress={onOpenCamera}
          loading={cameraBusy}
          disabled={busy && !cameraBusy}
          style={styles.heroPrimaryButton}>
          Open camera
        </PillButton>
        <PillButton
          variant="outline"
          onPress={onFromGallery}
          loading={galleryBusy}
          disabled={busy && !galleryBusy}>
          From gallery
        </PillButton>
      </View>
    </View>
  );
}

// ============================================================
// "Your rack"
// ============================================================

function RackSection({
  items,
  totalCount,
  coverUrlByListingId,
  onPressItem,
  onSeeAll,
}: {
  items: RackItem<ListingRowData>[];
  totalCount: number;
  coverUrlByListingId: Record<string, string>;
  onPressItem: (listingId: string) => void;
  onSeeAll: () => void;
}) {
  return (
    <View style={styles.rack}>
      <View style={styles.rackHeader}>
        <Text variant="displaySm">your rack</Text>
        <Pressable onPress={onSeeAll} accessibilityRole="button">
          <Text variant="label" color="accentText">
            See all {totalCount}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rackRow}
        // The screen's own Screen is the only VERTICAL scroller; this one is
        // purely horizontal, same precedent as Explore's Drops row.
        keyboardShouldPersistTaps="handled">
        {items.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => onPressItem(item.id)}
            accessibilityRole="button"
            accessibilityLabel={`${item.title ?? 'Untitled draft'}, ${RACK_STATUS_LABEL[item.statusKind]}`}
            style={({ pressed }) => [styles.rackTile, { opacity: pressed ? 0.7 : 1 }]}>
            <ListingImage
              uri={coverUrlByListingId[item.id]}
              style={[styles.rackThumb, item.statusKind === 'sold' ? styles.rackThumbSold : null]}
              recyclingKey={item.id}
            />
            <RackStatusPill kind={item.statusKind} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function RackStatusPill({ kind }: { kind: RackStatusKind }) {
  const { colors } = useAppTheme();

  if (kind === 'draft') {
    return (
      <View style={[styles.rackPill, styles.rackPillOutline, { borderColor: colors.text }]}>
        <Text variant="micro" color="text" style={styles.rackPillLabel}>
          {RACK_STATUS_LABEL.draft}
        </Text>
      </View>
    );
  }

  const fill = kind === 'live' ? colors.accent : colors.bgInverse;
  const labelColor: TextColor = kind === 'live' ? 'onAccent' : 'textInverse';

  return (
    <View style={[styles.rackPill, { backgroundColor: fill }]}>
      <Text variant="micro" color={labelColor} style={styles.rackPillLabel}>
        {RACK_STATUS_LABEL[kind]}
      </Text>
    </View>
  );
}

function RackSkeleton() {
  return (
    <View style={styles.rack}>
      <Skeleton height={24} width={120} radius="xs" />
      <View style={styles.rackRow}>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} width={RACK_THUMB_WIDTH} height={RACK_THUMB_HEIGHT} radius="lg" />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: space[6],
    paddingTop: space[6],
  },

  hero: {
    borderRadius: radius.lg,
    padding: space[6],
    gap: space[5],
  },
  heroSticker: {
    position: 'absolute',
    top: -space[2],
    right: space[4],
    zIndex: 1,
  },
  heroBadge: {
    width: CAMERA_BADGE_SIZE,
    height: CAMERA_BADGE_SIZE,
    borderRadius: CAMERA_BADGE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: {
    gap: space[3],
  },
  heroBody: {
    opacity: 0.75,
  },
  heroActions: {
    flexDirection: 'row',
    gap: space[3],
  },
  heroPrimaryButton: {
    flex: 1,
  },

  rack: {
    gap: space[3],
  },
  rackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rackRow: {
    flexDirection: 'row',
    gap: space[3],
  },
  rackTile: {
    alignItems: 'center',
    gap: space[2],
  },
  rackThumb: {
    width: RACK_THUMB_WIDTH,
    height: RACK_THUMB_HEIGHT,
    borderRadius: radius.lg,
  },
  rackThumbSold: {
    opacity: 0.55,
  },
  rackPill: {
    paddingHorizontal: space[2],
    paddingVertical: space[1] / 2,
    borderRadius: radius.full,
  },
  rackPillOutline: {
    borderWidth: RACK_DRAFT_PILL_BORDER_WIDTH,
    borderStyle: 'dashed',
  },
  rackPillLabel: {
    textTransform: 'uppercase',
  },
});
