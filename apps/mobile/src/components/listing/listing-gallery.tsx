import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';

import { ListingImage } from '@/components/ui';
import { radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { prefetchFeedCoverImages } from '@/features/feed/api';

/**
 * The listing detail screen's photo gallery (SCREENS.md Task 9 / the 6a
 * handoff): one large, full-width, fixed-height image per page, swiped
 * horizontally, in upload order, with a row of page dots. No pinch-to-zoom
 * — that's explicitly a later slice.
 *
 * Fixed `GALLERY_HEIGHT`, not `aspectRatio` — the handoff's own "500px
 * (≈60% of screen)" is a height, not a crop ratio, and the screen around
 * this component already treats that height as a known constant (the
 * content sheet below overlaps it by a fixed amount). Width is still
 * measured (`onLayout`), never guessed — the same pattern Home's own feed
 * page uses — since `getItemLayout` and each page's own width need to be
 * exactly right for `pagingEnabled` to snap cleanly.
 */

/** The handoff's own number — see this file's header comment for why it's a fixed height, not a ratio. */
export const GALLERY_HEIGHT = 500;
const DOT_BOTTOM_OFFSET = 28;
const DOT_ACTIVE_WIDTH = 22;
const DOT_SIZE = 6;

export type ListingGalleryImage = { id: string; url: string };

export type ListingGalleryProps = {
  images: ListingGalleryImage[];
  /** Used only for each photo's accessibility label. */
  title: string;
};

export function ListingGallery({ images, title }: ListingGalleryProps) {
  const { colors } = useAppTheme();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  useEffect(() => {
    // All of a listing's photos are already resolved signed URLs by the
    // time this renders (one batch call in listing-detail/api.ts) — reusing
    // the feed's own prefetch helper just warms expo-image's cache for
    // whichever pages the FlatList hasn't mounted yet, so swiping ahead
    // never shows a bare skeleton for a photo that was already fetchable.
    prefetchFeedCoverImages(images.map((image) => image.url));
  }, [images]);

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (width === 0) return;
      setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
    },
    [width],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ListingGalleryImage>) => (
      <View style={{ width, height: GALLERY_HEIGHT }}>
        <ListingImage uri={item.url} fill contentFit="cover" accessibilityLabel={title} />
      </View>
    ),
    [width, title],
  );

  const getItemLayout = useCallback(
    (_data: ArrayLike<ListingGalleryImage> | null | undefined, itemIndex: number) => ({
      length: width,
      offset: width * itemIndex,
      index: itemIndex,
    }),
    [width],
  );

  return (
    <View onLayout={onLayout}>
      {width > 0 ? (
        <FlatList
          data={images}
          keyExtractor={(image) => image.id}
          renderItem={renderItem}
          horizontal
          pagingEnabled
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          getItemLayout={getItemLayout}
          onMomentumScrollEnd={onMomentumScrollEnd}
        />
      ) : (
        // Reserves the gallery height before the first layout pass, so
        // nothing above/below the gallery jumps once width is known.
        <View style={styles.placeholder} />
      )}

      {images.length > 1 ? (
        <View style={styles.dots}>
          {images.map((image, dotIndex) => (
            <View
              key={image.id}
              style={[
                styles.dot,
                dotIndex === index ? styles.dotActive : null,
                // "bg at 50%" for the inactive dot — an opacity modifier on
                // the semantic color, same technique the Profile closet
                // grid's sold-item wash already uses, not a second raw color.
                { backgroundColor: colors.bg, opacity: dotIndex === index ? 1 : 0.5 },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    height: GALLERY_HEIGHT,
  },
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: DOT_BOTTOM_OFFSET,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space[1],
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: radius.full,
  },
  dotActive: {
    width: DOT_ACTIVE_WIDTH,
  },
});
