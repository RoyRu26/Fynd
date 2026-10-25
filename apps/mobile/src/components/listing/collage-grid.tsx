import { Pressable, StyleSheet, View } from 'react-native';

import { ListingImage, Sticker } from '@/components/ui';
import { radius } from '@/design/tokens';
import {
  getCollageBlockHeight,
  getCollageSlot,
  getCollageTileRect,
  type CollageCell,
} from '@/features/search/collage';

/**
 * One block of Explore's collage (DESIGN.md §14.2).
 *
 * A block is a fixed 9-item pattern rendered with absolute positions inside a
 * relatively-positioned box of known height. That shape is what keeps the
 * screen on a `FlatList` — each list row is one block — so pagination,
 * recycling and `onEndReached` all keep working despite the column and row
 * spans, which no masonry list can express.
 *
 * The geometry itself is pure and tested in `features/search/collage.ts`; this
 * file only turns rects into views.
 */

export type CollageItem = {
  listingId: string;
  title: string;
  coverUrl: string;
  /** Shown as a rotated sticker in the tile's top corner. Omitted renders no sticker. */
  stickerLabel?: string;
  /** `accent` for "just dropped", `inverse` for a category tag. */
  stickerTone?: 'accent' | 'inverse';
};

export type CollageBlockProps = {
  items: CollageItem[];
  /** Width the block has to fill. Column width is derived from it. */
  width: number;
  onPressItem: (listingId: string) => void;
};

// Alternating tilt, by slot. Fixed rather than random so the wall is identical
// on every render — a sticker that re-tilts when an unrelated bit of state
// changes reads as a glitch.
const STICKER_ROTATIONS = [-4, 3, -3, 4, -5, 3, -3, 4, -4] as const;

export function CollageBlock({ items, width, onPressItem }: CollageBlockProps) {
  return (
    <View style={{ height: getCollageBlockHeight(items.length), width }}>
      {items.map((item, slot) => (
        <CollageTile
          key={item.listingId}
          item={item}
          cell={getCollageSlot(slot)}
          rotation={STICKER_ROTATIONS[slot] ?? 0}
          containerWidth={width}
          onPress={() => onPressItem(item.listingId)}
        />
      ))}
    </View>
  );
}

function CollageTile({
  item,
  cell,
  rotation,
  containerWidth,
  onPress,
}: {
  item: CollageItem;
  cell: CollageCell;
  rotation: number;
  containerWidth: number;
  onPress: () => void;
}) {
  const rect = getCollageTileRect({ cell, containerWidth });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // The title is the accessible name even though it is NOT drawn on the
      // tile — 4a deliberately carries no text on the photography, which
      // would otherwise leave every tile announcing as an unlabelled button.
      accessibilityLabel={item.stickerLabel ? `${item.title}, ${item.stickerLabel}` : item.title}
      style={({ pressed }) => [
        styles.tile,
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        { opacity: pressed ? 0.7 : 1 },
      ]}>
      <ListingImage uri={item.coverUrl} fill recyclingKey={item.listingId} style={styles.image} />

      {item.stickerLabel ? (
        <View style={styles.sticker} pointerEvents="none">
          <Sticker
            label={item.stickerLabel}
            tone={item.stickerTone ?? 'accent'}
            rotate={rotation}
            // Folded into the tile's own name above, so it is not announced
            // a second time as a separate node.
            accessibilityLabel=""
          />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    position: 'absolute',
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  sticker: {
    position: 'absolute',
    // Nudged in from the corner so the rotation does not clip against the
    // tile's own `overflow: hidden`.
    top: 10,
    left: 10,
  },
});
