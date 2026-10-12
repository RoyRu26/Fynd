import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import {
  Button,
  Chip,
  IconButton,
  ListingImage,
  Screen,
  Text,
  TextField,
  type IconName,
} from '@/components/ui';
import { radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { useAuth } from '@/features/auth/auth-provider';
import type { ListingImageRow, ListingRow } from '@/features/listings/api';
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
  currencySymbol,
  formatMinorUnitsForInput,
  parsePriceToMinorUnits,
} from '@/features/listings/price';
import {
  listingKeys,
  useListing,
  useListingImageUrls,
  useListingImages,
  useRemoveListingImage,
  useReorderListingImages,
  useUpdateDraft,
  usePublishListing,
} from '@/features/listings/queries';
import { CONDITION_LABELS } from '@/features/listings/condition';
import {
  draftListingSchema,
  LISTING_CONDITIONS,
  publishBlockers,
  type DraftListingInput,
  type ListingFormInput,
  type PublishBlocker,
} from '@/features/listings/schemas';
import {
  formatSizeLabel,
  listingSizesBySystem,
  SIZE_SYSTEM_LABELS,
  type SizeSystem,
} from '@/features/listings/size';

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
        <Text variant="title">Edit draft</Text>
        {/* Photos first and largest, per DESIGN.md §14.4. */}
        <PhotoSection listingId={listing.id} sellerId={listing.seller_id} />
        {/* Keyed by listing id: a fresh mount (and fresh RHF defaultValues)
            only when the displayed listing actually changes, never on an
            incidental background refetch of the same one — which would
            otherwise silently discard in-progress edits. */}
        <ListingFieldsSection key={listing.id} listing={listing} />
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

// ============================================================
// Fields section
// ============================================================

const PUBLISH_BLOCKER_LABELS: Record<PublishBlocker, string> = {
  title: 'Add a title (at least 3 characters)',
  price: 'Set a price',
  condition: 'Choose a condition',
  size: 'Choose a size',
  photos: 'Add at least one photo',
  status: 'This listing has already been published',
};

// Display order the user actually asked for (Clothing, then Footwear, then
// One size) — independent of listingSizesBySystem's own Record key order.
const SIZE_SYSTEM_ORDER: SizeSystem[] = ['alpha', 'eu_shoe', 'one_size'];
// Derived once from the generated enum, same as LISTING_CONDITIONS above —
// not component state, since the grouping never changes at runtime.
const SIZE_GROUPS = listingSizesBySystem();

type PendingAction = 'save' | 'publish' | null;

function ListingFieldsSection({ listing }: { listing: ListingRow }) {
  const sellerId = listing.seller_id;
  const updateDraft = useUpdateDraft(listing.id, sellerId);
  const publish = usePublishListing(sellerId);
  // Shares its cache entry with PhotoSection's own useListingImages(listing.id)
  // call — same query key, same TanStack Query cache, no duplicate fetch.
  // Needed here only for the client-side publish-blocker preview below; the
  // RPC re-derives the real count itself.
  const imagesQuery = useListingImages(listing.id);
  const imageCount = imagesQuery.data?.length ?? 0;

  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [shownBlockers, setShownBlockers] = useState<PublishBlocker[]>([]);

  const form = useForm<ListingFormInput, unknown, DraftListingInput>({
    resolver: zodResolver(draftListingSchema),
    defaultValues: {
      title: listing.title ?? '',
      description: listing.description,
      price: formatMinorUnitsForInput(listing.price_amount),
      condition: listing.condition,
      size: listing.size,
    },
  });
  const { control, handleSubmit, formState } = form;

  // Live preview of what's still missing, recomputed from the form's raw
  // (untransformed) values on every change — so the list updates as the
  // seller types, before they ever tap Publish. Purely advisory, exactly
  // like publishBlockers itself: the RPC is what actually decides.
  const watched = useWatch({ control });
  const liveBlockers = publishBlockers(
    {
      title: watched.title?.trim() || null,
      price_amount: watched.price ? parsePriceToMinorUnits(watched.price) : null,
      condition: watched.condition ?? null,
      size: watched.size ?? null,
      status: listing.status,
    },
    imageCount,
  );

  function applySavedValues(saved: ListingRow) {
    // Resets to the server's canonical values (trimmed title, price
    // reformatted to two decimals, etc.) and clears `isDirty` — the "this is
    // now saved" signal doubles as the reset, rather than a separate toast.
    form.reset({
      title: saved.title ?? '',
      description: saved.description,
      price: formatMinorUnitsForInput(saved.price_amount),
      condition: saved.condition,
      size: saved.size,
    });
  }

  async function onSaveDraft(input: DraftListingInput) {
    setFormError(null);
    setShownBlockers([]);
    setPendingAction('save');
    try {
      const saved = await updateDraft.mutateAsync(input);
      applySavedValues(saved);
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
      setFormError(mapListingError(err).message);
    } finally {
      setPendingAction(null);
    }
  }

  async function onPublish(input: DraftListingInput) {
    setFormError(null);
    setShownBlockers([]);
    setPendingAction('publish');
    try {
      // Publishing always saves first, so whatever the seller just typed is
      // what gets evaluated and, if complete, published — never a stale
      // server copy from before their last keystroke.
      const saved = await updateDraft.mutateAsync(input);
      applySavedValues(saved);

      const blockers = publishBlockers(saved, imageCount);
      if (blockers.length > 0) {
        setShownBlockers(blockers);
        return;
      }

      await publish.mutateAsync(saved.id);
      // On success the cached listing's status flips to 'active'; the
      // parent's isEditableDraft check picks that up on its own next render
      // and swaps to the read-only "published" branch — no extra wiring.
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
      setFormError(mapListingError(err).message);
    } finally {
      setPendingAction(null);
    }
  }

  const busy = pendingAction !== null;
  const blockedAttempt = shownBlockers.length > 0;
  const blockersToDisplay = blockedAttempt ? shownBlockers : liveBlockers;

  return (
    <View style={styles.fields}>
      <Controller
        control={control}
        name="title"
        render={({ field, fieldState }) => (
          <TextField
            label="Title"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            disabled={busy}
          />
        )}
      />

      <Controller
        control={control}
        name="price"
        render={({ field, fieldState }) => (
          <TextField
            label={`Price (${currencySymbol(listing.currency)})`}
            keyboardType="decimal-pad"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            disabled={busy}
          />
        )}
      />

      <View style={styles.conditionField}>
        <Text variant="label" color="textSecondary">
          Condition
        </Text>
        <Controller
          control={control}
          name="condition"
          render={({ field }) => (
            <View style={styles.conditionChips}>
              {LISTING_CONDITIONS.map((value) => (
                <Chip
                  key={value}
                  label={CONDITION_LABELS[value]}
                  selectable
                  selected={field.value === value}
                  disabled={busy}
                  onPress={() => field.onChange(field.value === value ? null : value)}
                />
              ))}
            </View>
          )}
        />
      </View>

      <View style={styles.sizeField}>
        <Text variant="label" color="textSecondary">
          Size
        </Text>
        <Controller
          control={control}
          name="size"
          render={({ field }) => (
            <View style={styles.sizeGroups}>
              {SIZE_SYSTEM_ORDER.map((system) => (
                <View key={system} style={styles.sizeGroup}>
                  <Text variant="caption" color="textTertiary">
                    {SIZE_SYSTEM_LABELS[system]}
                  </Text>
                  <View style={styles.sizeChips}>
                    {SIZE_GROUPS[system].map((value) => (
                      <Chip
                        key={value}
                        label={formatSizeLabel(value)}
                        selectable
                        selected={field.value === value}
                        disabled={busy}
                        onPress={() => field.onChange(field.value === value ? null : value)}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}
        />
      </View>

      <Controller
        control={control}
        name="description"
        render={({ field, fieldState }) => (
          <TextField
            label="Description"
            multiline
            numberOfLines={4}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            disabled={busy}
          />
        )}
      />

      {/* shownBlockers only ever fills after a blocked publish attempt — which
          the now-disabled Publish button prevents in the normal case — so in
          practice this is the server-authoritative fallback for a race (e.g.
          the image count changing between render and submit), and liveBlockers
          is what the seller sees while still editing. Never both at once, so
          one block covers both instead of two near-duplicate lists. */}
      {blockersToDisplay.length > 0 ? (
        <View style={styles.blockersList}>
          <Text
            variant="caption"
            color={blockedAttempt ? 'danger' : 'textTertiary'}
            accessibilityLiveRegion={blockedAttempt ? 'polite' : undefined}
            accessibilityRole={blockedAttempt ? 'alert' : undefined}>
            {blockedAttempt ? "Can't publish yet:" : 'Before you publish:'}
          </Text>
          {blockersToDisplay
            .filter((blocker) => blocker !== 'status')
            .map((blocker) => (
              <Text key={blocker} variant="caption" color={blockedAttempt ? 'danger' : 'textTertiary'}>
                • {PUBLISH_BLOCKER_LABELS[blocker]}
              </Text>
            ))}
        </View>
      ) : null}

      {formError ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
          {formError}
        </Text>
      ) : null}

      <View style={styles.fieldsFooter}>
        <Text variant="caption" color="textTertiary">
          {pendingAction === 'save'
            ? 'Saving…'
            : pendingAction === 'publish'
              ? 'Publishing…'
              : formState.isDirty
                ? 'Unsaved changes'
                : ' '}
        </Text>
        <View style={styles.fieldsActions}>
          <Button
            variant="secondary"
            size="sm"
            onPress={handleSubmit(onSaveDraft)}
            loading={pendingAction === 'save'}
            disabled={busy || !formState.isDirty}>
            Save draft
          </Button>
          <Button
            variant="primary"
            size="sm"
            onPress={handleSubmit(onPublish)}
            loading={pendingAction === 'publish'}
            disabled={busy || liveBlockers.length > 0}>
            Publish
          </Button>
        </View>
      </View>
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
  fields: {
    gap: space[4],
  },
  conditionField: {
    gap: space[1],
  },
  conditionChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  sizeField: {
    gap: space[1],
  },
  sizeGroups: {
    gap: space[3],
  },
  sizeGroup: {
    gap: space[1],
  },
  sizeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  blockersList: {
    gap: space[1],
  },
  fieldsFooter: {
    gap: space[2],
  },
  fieldsActions: {
    flexDirection: 'row',
    gap: space[3],
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
