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

import { ListingImage, Text } from '@/components/ui';
import { radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { prefetchFeedCoverImages } from '@/features/feed/api';

/**
 * The listing detail screen's photo gallery: one large, full-width,
 * square-cropped image per page, swiped horizontally, in upload order, with
 * a "1 / N" indicator. No pinch-to-zoom — that's explicitly a later slice.
 *
 * Width is measured (`onLayout`), never guessed — the same pattern Home's
 * own feed page height uses — since it's what both `getItemLayout` and each
 * page's own size need to be exactly right for `pagingEnabled` to snap
 * cleanly.
 */

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
      <View style={{ width, aspectRatio: 1 }}>
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
        // Reserves the square aspect ratio before the first layout pass, so
        // nothing above/below the gallery jumps once width is known.
        <View style={styles.placeholder} />
      )}

      {images.length > 1 ? (
        <View style={[styles.indicator, { backgroundColor: colors.overlayScrim }]}>
          <Text variant="caption" color="textOnMedia">
            {`${index + 1} / ${images.length}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    aspectRatio: 1,
  },
  indicator: {
    position: 'absolute',
    right: space[3],
    bottom: space[3],
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: radius.sm,
  },
});
