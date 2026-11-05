import { Pressable, StyleSheet, View } from 'react-native';

import { ListingImage, Sticker, Text, type StickerTone } from '@/components/ui';
import { minTouchTarget, radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { formatSizeLabel } from '@/features/listings/size';
import { formatMoney } from '@/features/listings/price';
import type { Database } from '@/types/database';

/**
 * The thread's pinned listing strip (SCREENS.md Task 8 / the 5a handoff,
 * replacing Task 6's 2d-spec styling) — what the conversation is actually
 * about, always visible above the messages. A `bgElevated` card with a
 * 1.5px `text` border and a hard, offset `text`-colour shadow (a real
 * backing `View`, not a platform shadow — same technique `Sticker` already
 * uses, for the same reason: a platform shadow is soft, the handoff's "hard
 * 0x3 shadow" is not).
 *
 * Omits itself entirely when there is no listing to show (`title` null) —
 * reachable only defensively today: `conversations.listing_id` cascades on
 * delete (20260929090000), so a conversation cannot currently outlive its
 * listing (see 20261020113820's own note correcting this function's
 * inherited "hard-deleted listing" rationale).
 */

type ListingStatus = Database['public']['Enums']['listing_status'];

const THUMB_WIDTH = 46;
const THUMB_HEIGHT = 58;
const THUMB_ROTATION = -4;
const THUMB_BORDER_WIDTH = 2;
const CARD_BORDER_WIDTH = 1.5;
/** Bespoke, not `border.thick` (2) — the handoff's own hard-shadow offset, same precedent `Sticker`'s own `STICKER_SHADOW_OFFSET` follows. */
const CARD_SHADOW_OFFSET = 3;
const STATUS_STICKER_ROTATION = 3;

export type PinnedListingStripProps = {
  title: string;
  priceAmount: number | null;
  currencyCode: string | null;
  size: Database['public']['Enums']['listing_size'] | null;
  status: ListingStatus | null;
  coverUrl: string | null;
  onPress: () => void;
};

/** Live for active/reserved, Sold for sold — the two states the handoff names. `null` for anything else (a hard-deleted listing's null group), which just omits the sticker. */
function getStatusStickerTone(status: ListingStatus | null): { label: string; tone: StickerTone } | null {
  switch (status) {
    case 'active':
    case 'reserved':
      return { label: 'Live', tone: 'accent' };
    case 'sold':
      return { label: 'Sold', tone: 'inverse' };
    default:
      return null;
  }
}

export function PinnedListingStrip({
  title,
  priceAmount,
  currencyCode,
  size,
  status,
  coverUrl,
  onPress,
}: PinnedListingStripProps) {
  const { colors } = useAppTheme();
  const price = priceAmount !== null && currencyCode !== null ? formatMoney(priceAmount, currencyCode) : null;
  const sizeLabel = size !== null ? formatSizeLabel(size) : null;
  const meta = [price, sizeLabel].filter((part): part is string => part !== null).join(' · ');
  const statusSticker = getStatusStickerTone(status);

  const accessibilityLabel = [`Open listing: ${title}`, meta, statusSticker?.label]
    .filter((part): part is string => Boolean(part))
    .join(', ');

  return (
    <View style={styles.wrapper}>
      {/* The hard shadow: a real offset backing View, not a platform shadow — see this file's own header comment. */}
      <View style={[styles.shadow, { backgroundColor: colors.text }]} pointerEvents="none" />
      <Pressable
        onPress={onPress}
        accessibilityRole="link"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: colors.bgElevated, borderColor: colors.text, opacity: pressed ? 0.7 : 1 },
        ]}>
        <View style={[styles.thumbWrap, { transform: [{ rotate: `${THUMB_ROTATION}deg` }] }]}>
          <ListingImage uri={coverUrl ?? undefined} fill style={[styles.thumb, { borderColor: colors.bg }]} />
        </View>
        <View style={styles.main}>
          <Text variant="label" numberOfLines={1}>
            {title}
          </Text>
          {meta ? (
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
        {statusSticker ? (
          <View style={styles.statusStickerWrap}>
            <Sticker label={statusSticker.label} tone={statusSticker.tone} rotate={STATUS_STICKER_ROTATION} />
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // No horizontal margin of its own: the handoff's "16px side margin" is
  // the screen's own standard inset (`Screen`'s default `padded`, space[5]),
  // which every other element in this screen already relies on the same
  // way — adding a second margin here would double it.
  wrapper: {},
  shadow: {
    position: 'absolute',
    top: CARD_SHADOW_OFFSET,
    left: 0,
    right: 0,
    bottom: -CARD_SHADOW_OFFSET,
    borderRadius: radius.xl,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[3],
    borderRadius: radius.xl,
    borderWidth: CARD_BORDER_WIDTH,
    minHeight: minTouchTarget,
  },
  thumbWrap: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
  },
  thumb: {
    borderRadius: radius.xs,
    borderWidth: THUMB_BORDER_WIDTH,
  },
  main: {
    flex: 1,
    gap: space[1] / 2,
  },
  statusStickerWrap: {
    alignSelf: 'flex-start',
  },
});
