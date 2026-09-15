import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import {
  Button,
  Chip,
  IconButton,
  ListingImage,
  Screen,
  Text,
  type IconName,
} from '@/components/ui';
import { radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { mapListingError } from '@/features/listings/errors';
import { uploadAndAttachListingImage } from '@/features/listings/images';
import { createImageId, MAX_LISTING_PHOTOS } from '@/features/listings/paths';
import {
  addLocalPhotos,
  clampToRemainingSlots,
  moveId,
  remainingPhotoSlots,
  removeLocalPhoto,
  setLocalPhotoStatus,
  type LocalPhotoItem,
} from '@/features/listings/photo-state';
import {
  listingKeys,
  useListing,
  useListingImageUrls,
  useListingImages,
  useRemoveListingImage,
  useReorderListingImages,
} from '@/features/listings/queries';
import type { ListingImageRow } from '@/features/listings/api';

// Verified against the installed packages: every name below exists in
// sf-symbols-typescript's types and in expo-symbols' android/symbols.json.
const BACK_ICON: IconName = { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' };
const REMOVE_ICON: IconName = { ios: 'xmark', android: 'close', web: 'close' };
const RETRY_ICON: IconName = { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' };
const MOVE_EARLIER_ICON: IconName = { ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' };
const MOVE_LATER_ICON: IconName = { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' };

export default function SellEditor() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const listingQuery = useListing(id);
  const listing = listingQuery.data;

  // The listings SELECT policy makes active listings publicly visible, so a
  // row CAN resolve here without belonging to the caller (another seller's
  // active listing). This check is what stands between that and presenting
  // editable UI for it — the query resolving successfully is not enough.
  // A draft belonging to someone else is already invisible to this query
  // (RLS hides it entirely), so this same branch also covers "not found".
  const isOwner = listing !== undefined && listing.seller_id === session?.user.id;
  // Owning the row is not enough on its own: the owner's OWN listing can
  // also be active (published), and photo modification must stop there too
  // — "Do not allow photo modification for active listings" applies
  // regardless of who is asking.
  const isEditableDraft = isOwner && listing?.status === 'draft';

  let body: ReactNode;
  if (listingQuery.isPending) {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.textTertiary} />
      </View>
    );
  } else if (listingQuery.isError) {
    body = (
      <View style={styles.centered}>
        <Text variant="body" color="danger">
          {mapListingError(listingQuery.error).message}
        </Text>
      </View>
    );
  } else if (!isOwner || !listing) {
    body = (
      <View style={styles.centered}>
        <Text variant="body" color="danger">
          This listing isn&apos;t available to edit.
        </Text>
      </View>
    );
  } else if (!isEditableDraft) {
    body = (
      <View style={styles.centered}>
        <Text variant="title">{listing.title ?? 'Untitled listing'}</Text>
        <Text variant="body" color="textSecondary">
          This listing has been published and can no longer be edited here.
        </Text>
      </View>
    );
  } else {
    body = (
      <View style={styles.body}>
        <Text variant="title">{listing.title ?? 'Untitled draft'}</Text>
        <PhotoSection listingId={listing.id} sellerId={listing.seller_id} />
        <Text variant="body" color="textSecondary">
          Title, price, condition, description and publishing are coming in a later step.
        </Text>
      </View>
    );
  }

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <IconButton icon={BACK_ICON} accessibilityLabel="Back" onPress={() => router.back()} />
      </View>
      {body}
    </Screen>
  );
}

// ============================================================
// Photo section
// ============================================================

/**
 * A cell in the rendered grid: either a persisted, attached photo, or a
 * local, in-flight one. This is a view-only union — the persisted half is
 * never copied into local state (see photo-state.ts's header), so ordering
 * always reflects exactly what the server has confirmed.
 */
type PhotoCell =
  | { kind: 'persisted'; image: ListingImageRow; isCover: boolean; url: string | undefined }
  | { kind: 'local'; item: LocalPhotoItem };

function PhotoSection({ listingId, sellerId }: { listingId: string; sellerId: string }) {
  const queryClient = useQueryClient();
  const imagesQuery = useListingImages(listingId);
  const removeImage = useRemoveListingImage(listingId);
  const reorderImages = useReorderListingImages(listingId);

  const persisted = imagesQuery.data ?? [];
  const storagePaths = persisted.map((image) => image.storage_path);
  const urlsQuery = useListingImageUrls(storagePaths);

  const [localPhotos, setLocalPhotos] = useState<LocalPhotoItem[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);
  const [removingImageId, setRemovingImageId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const totalCount = persisted.length + localPhotos.length;
  const remaining = remainingPhotoSlots(totalCount);

  async function runUpload(item: LocalPhotoItem) {
    try {
      await uploadAndAttachListingImage({
        sellerId,
        listingId,
        sourceUri: item.sourceUri,
      });
      setLocalPhotos((prev) => removeLocalPhoto(prev, item.localId));
      queryClient.invalidateQueries({ queryKey: listingKeys.images(listingId) });
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
      setLocalPhotos((prev) =>
        setLocalPhotoStatus(prev, item.localId, 'failed', mapListingError(err).message),
      );
    }
  }

  async function handleAddPhotos() {
    setPickError(null);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPickError(
        permission.canAskAgain
          ? 'Fynd needs access to your photos to add listing pictures.'
          : 'Photo access is turned off for Fynd. Enable it in Settings to add pictures.',
      );
      return;
    }

    const slots = remainingPhotoSlots(persisted.length + localPhotos.length);
    if (slots <= 0) {
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: slots,
      quality: 1,
    });
    if (result.canceled) {
      return;
    }

    const uris = clampToRemainingSlots(
      result.assets.map((asset) => asset.uri),
      slots,
    );
    const newItems: LocalPhotoItem[] = uris.map((uri) => ({
      localId: createImageId(),
      sourceUri: uri,
      status: 'uploading',
    }));
    setLocalPhotos((prev) => addLocalPhotos(prev, newItems));
    newItems.forEach((item) => {
      runUpload(item);
    });
  }

  function handleRetry(item: LocalPhotoItem) {
    setLocalPhotos((prev) => setLocalPhotoStatus(prev, item.localId, 'uploading'));
    runUpload({ ...item, status: 'uploading', errorMessage: undefined });
  }

  function handleRemoveLocal(item: LocalPhotoItem) {
    // Nothing was ever attached for a failed local item, so there is no DB
    // row to delete — only the local entry goes away. Storage may hold an
    // orphaned object from a partial upload; that is the same tolerated
    // orphan the pipeline already accepts (see images.ts), not a new gap.
    setLocalPhotos((prev) => removeLocalPhoto(prev, item.localId));
  }

  function handleRemovePersisted(image: ListingImageRow) {
    Alert.alert('Remove this photo?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setRemovingImageId(image.id);
          try {
            await removeImage.mutateAsync(image);
          } catch (err) {
            if (__DEV__) {
              console.error(err);
            }
            Alert.alert("Couldn't remove photo", mapListingError(err).message);
          } finally {
            setRemovingImageId(null);
          }
        },
      },
    ]);
  }

  async function handleMove(imageId: string, direction: 'earlier' | 'later') {
    if (reordering) return;

    const currentIds = persisted.map((image) => image.id);
    const nextIds = moveId(currentIds, imageId, direction);
    if (nextIds === currentIds) return;

    setReordering(true);
    setReorderError(null);
    try {
      await reorderImages.mutateAsync(nextIds);
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
      setReorderError(mapListingError(err).message);
    } finally {
      setReordering(false);
    }
  }

  const cells: PhotoCell[] = [
    ...persisted.map(
      (image, index): PhotoCell => ({
        kind: 'persisted',
        image,
        isCover: index === 0,
        url: urlsQuery.data?.[image.storage_path],
      }),
    ),
    ...localPhotos.map((item): PhotoCell => ({ kind: 'local', item })),
  ];

  return (
    <View style={styles.photoSection}>
      <View style={styles.photoHeaderRow}>
        <Text variant="label" color="textSecondary">
          Photos
        </Text>
        <Text variant="caption" color="textTertiary">
          {totalCount} / {MAX_LISTING_PHOTOS}
        </Text>
      </View>

      {imagesQuery.isPending ? (
        <ActivityIndicator />
      ) : imagesQuery.isError ? (
        <Text variant="caption" color="danger">
          {mapListingError(imagesQuery.error).message}
        </Text>
      ) : (
        <View style={styles.grid}>
          {cells.map((cell) =>
            cell.kind === 'persisted' ? (
              <PersistedPhotoCell
                key={cell.image.id}
                cell={cell}
                isFirst={cell.isCover}
                isLast={cell.image.id === persisted[persisted.length - 1]?.id}
                busy={removingImageId === cell.image.id || reordering}
                onRemove={() => handleRemovePersisted(cell.image)}
                onMoveEarlier={() => handleMove(cell.image.id, 'earlier')}
                onMoveLater={() => handleMove(cell.image.id, 'later')}
              />
            ) : (
              <LocalPhotoCell
                key={cell.item.localId}
                item={cell.item}
                onRetry={() => handleRetry(cell.item)}
                onRemove={() => handleRemoveLocal(cell.item)}
              />
            ),
          )}

          {remaining > 0 ? (
            <AddPhotosCell onPress={handleAddPhotos} />
          ) : null}
        </View>
      )}

      {pickError ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
          {pickError}
        </Text>
      ) : null}
      {reorderError ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
          {reorderError}
        </Text>
      ) : null}
    </View>
  );
}

const CELL_GAP = space[2];
const CELL_BASIS = '31%';

function PersistedPhotoCell({
  cell,
  isFirst,
  isLast,
  busy,
  onRemove,
  onMoveEarlier,
  onMoveLater,
}: {
  cell: Extract<PhotoCell, { kind: 'persisted' }>;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onRemove: () => void;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
}) {
  return (
    <View style={styles.cell}>
      <ListingImage
        uri={cell.url}
        style={styles.cellImage}
        recyclingKey={cell.image.id}
        accessibilityLabel={cell.isCover ? 'Cover photo' : 'Listing photo'}
      />
      {cell.isCover ? (
        <View style={styles.coverBadge}>
          <Chip label="Cover" />
        </View>
      ) : null}
      <View style={styles.cellTopRight}>
        <IconButton
          icon={REMOVE_ICON}
          accessibilityLabel="Remove photo"
          onPress={onRemove}
          disabled={busy}
          variant="onMedia"
          size="sm"
        />
      </View>
      <View style={styles.cellBottomRow}>
        <IconButton
          icon={MOVE_EARLIER_ICON}
          accessibilityLabel="Move photo earlier"
          onPress={onMoveEarlier}
          disabled={busy || isFirst}
          variant="onMedia"
          size="sm"
        />
        <IconButton
          icon={MOVE_LATER_ICON}
          accessibilityLabel="Move photo later"
          onPress={onMoveLater}
          disabled={busy || isLast}
          variant="onMedia"
          size="sm"
        />
      </View>
    </View>
  );
}

function LocalPhotoCell({
  item,
  onRetry,
  onRemove,
}: {
  item: LocalPhotoItem;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.cell}>
      <ListingImage uri={item.sourceUri} style={styles.cellImage} />
      <View style={[StyleSheet.absoluteFill, styles.cellOverlay, { backgroundColor: colors.overlayScrim }]}>
        {item.status === 'uploading' ? (
          <ActivityIndicator color={colors.textOnMedia} />
        ) : (
          <>
            <Text variant="caption" color="textOnMedia" style={styles.cellOverlayText}>
              Failed
            </Text>
            <View style={styles.cellOverlayActions}>
              <IconButton
                icon={RETRY_ICON}
                accessibilityLabel="Retry upload"
                onPress={onRetry}
                variant="onMedia"
                size="sm"
              />
              <IconButton
                icon={REMOVE_ICON}
                accessibilityLabel="Remove"
                onPress={onRemove}
                variant="onMedia"
                size="sm"
              />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function AddPhotosCell({ onPress }: { onPress: () => void }) {
  return (
    <Button variant="secondary" onPress={onPress} accessibilityLabel="Add photos" size="sm" style={styles.addCell}>
      Add photos
    </Button>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: space[6],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    paddingHorizontal: space[6],
  },
  body: {
    gap: space[5],
  },
  photoSection: {
    gap: space[2],
  },
  photoHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CELL_GAP,
  },
  cell: {
    width: CELL_BASIS,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  cellImage: {
    width: '100%',
  },
  coverBadge: {
    position: 'absolute',
    left: space[1],
    bottom: space[1],
  },
  cellTopRight: {
    position: 'absolute',
    right: space[1],
    top: space[1],
  },
  cellBottomRow: {
    position: 'absolute',
    right: space[1],
    bottom: space[1],
    flexDirection: 'row',
    gap: space[1],
  },
  cellOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
  },
  cellOverlayText: {
    textAlign: 'center',
  },
  cellOverlayActions: {
    flexDirection: 'row',
    gap: space[2],
  },
  addCell: {
    width: CELL_BASIS,
    aspectRatio: 1,
  },
});
