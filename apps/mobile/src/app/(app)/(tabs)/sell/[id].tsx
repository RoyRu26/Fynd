import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import {
  Button,
  Chip,
  Icon,
  IconButton,
  ListingImage,
  Screen,
  Text,
  TextField,
  type IconName,
} from '@/components/ui';
import { border, minTouchTarget, radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { CategoryPickerSheet } from '@/features/categories/category-picker-sheet';
import {
  findCategorySelection,
  formatCategoryBreadcrumb,
  groupCategoriesByParent,
  type Category,
  type CategoryGroup,
} from '@/features/categories/categories';
import { useCategories } from '@/features/categories/queries';
import {
  applySuggestionToForm,
  clearSuggestedField,
  type SuggestedFieldName,
} from '@/features/listings/ai-suggestion-apply';
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
  formatMoney,
  parsePriceToMinorUnits,
} from '@/features/listings/price';
import {
  listingKeys,
  useListing,
  useListingImageUrls,
  useListingImages,
  useRemoveListingImage,
  useReorderListingImages,
  useSuggestListingFromPhotos,
  useUpdateDraft,
  useUpdateListingDetails,
  usePublishListing,
} from '@/features/listings/queries';
import { CONDITION_LABELS } from '@/features/listings/condition';
import {
  draftListingSchema,
  LISTING_CONDITIONS,
  publishableListingSchema,
  publishBlockers,
  type DraftListingInput,
  type ListingFormInput,
  type PublishableListingInput,
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
// Same chevron used for the category field's disclosure affordance — matches
// profile/index.tsx's own CHEVRON_ICON and category-picker-sheet.tsx's.
const CATEGORY_CHEVRON_ICON: IconName = { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' };

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
  // ROADMAP 1.6 "Manage a listing" widens this from draft-only: an owner's
  // active or reserved listing is now editable too, through
  // update_listing_details rather than the plain draft UPDATE path. sold
  // and removed stay permanently read-only — both are terminal statuses.
  const isEditable =
    isOwner && (listing?.status === 'draft' || listing?.status === 'active' || listing?.status === 'reserved');

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
  } else if (!isEditable) {
    // Only sold/removed reach here: isOwner is true and the listing exists,
    // so draft/active/reserved are all covered by the editable branch below.
    body = (
      <View style={styles.centered}>
        <Text variant="title">{listing.title ?? 'Untitled listing'}</Text>
        <Text variant="body" color="textSecondary">
          {listing.status === 'sold'
            ? 'This listing has been sold and can no longer be edited.'
            : 'This listing has been removed and can no longer be edited.'}
        </Text>
      </View>
    );
  } else {
    const isDraft = listing.status === 'draft';
    body = (
      <View style={styles.body}>
        <Text variant="title">{isDraft ? 'Edit draft' : 'Edit listing'}</Text>
        {/* Photos first and largest, per DESIGN.md §14.4. Read-only once the
            listing is no longer a draft -- listing_images stays draft-scoped
            at the RLS/RPC layer, so editing is photo-read-only here too. */}
        <PhotoSection listingId={listing.id} sellerId={listing.seller_id} editable={isDraft} />
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

function PhotoSection({
  listingId,
  sellerId,
  editable,
}: {
  listingId: string;
  sellerId: string;
  editable: boolean;
}) {
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

  // Once a listing is no longer a draft, listing_images stays draft-scoped
  // at the RLS/RPC layer -- there is no attach/remove/reorder path left to
  // call. Local, in-flight uploads can only ever exist on a draft (the Add
  // photos control below is withheld entirely once !editable), so the
  // non-editable cell list is just the persisted rows, plain.
  const cells: PhotoCell[] = editable
    ? [
        ...persisted.map(
          (image, index): PhotoCell => ({
            kind: 'persisted',
            image,
            isCover: index === 0,
            url: urlsQuery.data?.[image.storage_path],
          }),
        ),
        ...localPhotos.map((item): PhotoCell => ({ kind: 'local', item })),
      ]
    : persisted.map(
        (image, index): PhotoCell => ({
          kind: 'persisted',
          image,
          isCover: index === 0,
          url: urlsQuery.data?.[image.storage_path],
        }),
      );

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
                editable={editable}
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

          {editable && remaining > 0 ? <AddPhotosCell onPress={handleAddPhotos} /> : null}
        </View>
      )}

      {editable && pickError ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
          {pickError}
        </Text>
      ) : null}
      {editable && reorderError ? (
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
  category: 'Choose a category',
  photos: 'Add at least one photo',
  status: 'This listing has already been published',
};

// Display order the user actually asked for (Clothing, then Footwear, then
// One size) — independent of listingSizesBySystem's own Record key order.
const SIZE_SYSTEM_ORDER: SizeSystem[] = ['alpha', 'eu_shoe', 'one_size'];
// Derived once from the generated enum, same as LISTING_CONDITIONS above —
// not component state, since the grouping never changes at runtime.
const SIZE_GROUPS = listingSizesBySystem();

/**
 * The pressable "Category" field, shared between the draft and
 * active/reserved editors (ROADMAP 2.1). Reuses TextField's label-above
 * convention but is a plain pressable row rather than a TextField itself —
 * category selection happens entirely in `CategoryPickerSheet`, never by
 * typing.
 */
function CategoryField({
  categoryId,
  groups,
  disabled,
  onPress,
  suggested,
}: {
  categoryId: string | null;
  groups: CategoryGroup[];
  disabled: boolean;
  onPress: () => void;
  /**
   * ROADMAP 4.3 "Suggestions in the sell flow". Optional, defaulting to
   * falsy, so the published-listing editor's call site (which never
   * applies AI suggestions) is completely unaffected.
   */
  suggested?: boolean;
}) {
  const { colors } = useAppTheme();
  const selection = findCategorySelection(groups, categoryId);
  const label = selection ? formatCategoryBreadcrumb(selection.group, selection.leaf) : 'Choose a category';

  return (
    <View style={styles.categoryField}>
      <View style={styles.fieldLabelRow}>
        <Text variant="label" color="textSecondary">
          Category
        </Text>
        {suggested ? <Chip label="Suggested" /> : null}
      </View>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Category, ${label}`}
        style={({ pressed }) => [
          styles.categoryRow,
          {
            backgroundColor: colors.bgElevated,
            borderColor: colors.border,
            opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
          },
        ]}>
        <Text variant="body" color={selection ? 'text' : 'textTertiary'}>
          {label}
        </Text>
        <Icon name={CATEGORY_CHEVRON_ICON} size="sm" color={colors.textTertiary} />
      </Pressable>
    </View>
  );
}

type PendingAction = 'save' | 'publish' | null;

/**
 * Dispatches between the draft editor (unchanged) and the active/reserved
 * editor (ROADMAP 1.6): different mutation, different validation schema —
 * `update_listing_details` re-validates the same completeness rules
 * `publish_listing` already enforces, so the client side uses the exact
 * same `publishableListingSchema`, not a new one.
 */
function ListingFieldsSection({ listing }: { listing: ListingRow }) {
  if (listing.status === 'draft') {
    return <DraftFieldsSection listing={listing} />;
  }
  return <PublishedFieldsSection listing={listing} />;
}

function DraftFieldsSection({ listing }: { listing: ListingRow }) {
  const sellerId = listing.seller_id;
  const updateDraft = useUpdateDraft(listing.id, sellerId);
  const publish = usePublishListing(sellerId);
  // Shares its cache entry with PhotoSection's own useListingImages(listing.id)
  // call — same query key, same TanStack Query cache, no duplicate fetch.
  // Needed here only for the client-side publish-blocker preview below; the
  // RPC re-derives the real count itself.
  const imagesQuery = useListingImages(listing.id);
  const imageCount = imagesQuery.data?.length ?? 0;

  // 24h-cached reference data (see queries.ts) -- `?? []` covers the brief
  // loading window before the first fetch resolves, during which the
  // category field simply shows its placeholder rather than any value.
  const categoriesQuery = useCategories();
  const categoryGroups = categoriesQuery.data ? groupCategoriesByParent(categoriesQuery.data) : [];
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [shownBlockers, setShownBlockers] = useState<PublishBlocker[]>([]);

  // ROADMAP 4.3 "Suggestions in the sell flow". `suggestedFields` is which
  // fields currently show a "Suggested" chip; `suggestedPriceRange` is only
  // ever read while 'price' is in that set, to render the price field's
  // helper text. Neither is persisted — both are pure local UI state that
  // seeding the form from a suggestion writes, and editing a field clears.
  const suggest = useSuggestListingFromPhotos();
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestedFields, setSuggestedFields] = useState<Set<SuggestedFieldName>>(new Set());
  const [suggestedPriceRange, setSuggestedPriceRange] = useState<{ min: number; max: number } | null>(null);

  const form = useForm<ListingFormInput, unknown, DraftListingInput>({
    resolver: zodResolver(draftListingSchema),
    defaultValues: {
      title: listing.title ?? '',
      description: listing.description,
      price: formatMinorUnitsForInput(listing.price_amount),
      condition: listing.condition,
      size: listing.size,
      categoryId: listing.category_id,
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
      category_id: watched.categoryId ?? null,
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
      categoryId: saved.category_id,
    });
  }

  /**
   * ROADMAP 4.3. Never auto-publishes and never touches the DB — it only
   * seeds local form state via `form.setValue(..., { shouldDirty: true })`,
   * the exact same mechanism the category picker's own `onSelect` already
   * uses. All `ok:false` reasons (no_photos/rate_limited/ai_unavailable/
   * invalid_request) render identically: stop pending, leave the form
   * untouched, show `result.message` inline — the Edge Function already
   * returns a safe, display-ready string, so there is no per-reason
   * branching here.
   */
  async function handleSuggest() {
    setSuggestError(null);
    try {
      const result = await suggest.mutateAsync(listing.id);
      if (!result.ok) {
        setSuggestError(result.message);
        return;
      }

      const { values, suggestedFields: fields } = applySuggestionToForm(result.suggestion, categoryGroups);
      form.setValue('title', values.title, { shouldDirty: true });
      form.setValue('description', values.description, { shouldDirty: true });
      form.setValue('condition', values.condition, { shouldDirty: true });
      form.setValue('price', values.price, { shouldDirty: true });
      if (values.categoryId !== undefined) {
        form.setValue('categoryId', values.categoryId, { shouldDirty: true });
      }
      setSuggestedFields(new Set(fields));
      setSuggestedPriceRange({ min: result.suggestion.priceMinAmount, max: result.suggestion.priceMaxAmount });
    } catch (err) {
      // suggestListingFromPhotos maps its own transport failures into an
      // ok:false result rather than throwing — reaching here means something
      // genuinely unexpected happened (e.g. a bug), not an expected failure.
      if (__DEV__) {
        console.error(err);
      }
      setSuggestError("Couldn't get suggestions right now.");
    }
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
      <View style={styles.suggestSection}>
        <Button
          variant="secondary"
          size="sm"
          onPress={handleSuggest}
          loading={suggest.isPending}
          disabled={suggest.isPending || imageCount === 0}>
          Suggest from photos
        </Button>
        {imageCount === 0 ? (
          <Text variant="caption" color="textTertiary">
            Add a photo first
          </Text>
        ) : null}
        {suggestError ? (
          <Text variant="caption" color="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
            {suggestError}
          </Text>
        ) : null}
      </View>

      <View style={styles.fieldWithLabel}>
        <View style={styles.fieldLabelRow}>
          <Text variant="label" color="textSecondary">
            Title
          </Text>
          {suggestedFields.has('title') ? <Chip label="Suggested" /> : null}
        </View>
        <Controller
          control={control}
          name="title"
          render={({ field, fieldState }) => (
            <TextField
              value={field.value}
              onChangeText={(text) => {
                field.onChange(text);
                setSuggestedFields((prev) => clearSuggestedField(prev, 'title'));
              }}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              disabled={busy}
              accessibilityLabel={['Title', suggestedFields.has('title') ? 'Suggested' : null, fieldState.error?.message]
                .filter(Boolean)
                .join(', ')}
            />
          )}
        />
      </View>

      <View style={styles.fieldWithLabel}>
        <View style={styles.fieldLabelRow}>
          <Text variant="label" color="textSecondary">
            {`Price (${currencySymbol(listing.currency)})`}
          </Text>
          {suggestedFields.has('price') ? <Chip label="Suggested" /> : null}
        </View>
        <Controller
          control={control}
          name="price"
          render={({ field, fieldState }) => (
            <TextField
              keyboardType="decimal-pad"
              value={field.value}
              onChangeText={(text) => {
                field.onChange(text);
                setSuggestedFields((prev) => clearSuggestedField(prev, 'price'));
              }}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              disabled={busy}
              helperText={
                suggestedFields.has('price') && suggestedPriceRange
                  ? `Suggested range: ${formatMoney(suggestedPriceRange.min, listing.currency)}–${formatMoney(suggestedPriceRange.max, listing.currency)}`
                  : undefined
              }
              accessibilityLabel={[
                `Price (${currencySymbol(listing.currency)})`,
                suggestedFields.has('price') ? 'Suggested' : null,
                fieldState.error?.message,
              ]
                .filter(Boolean)
                .join(', ')}
            />
          )}
        />
      </View>

      <Controller
        control={control}
        name="categoryId"
        render={({ field }) => (
          <>
            <CategoryField
              categoryId={field.value}
              groups={categoryGroups}
              disabled={busy}
              onPress={() => setCategoryPickerOpen(true)}
              suggested={suggestedFields.has('categoryId')}
            />
            <CategoryPickerSheet
              visible={categoryPickerOpen}
              groups={categoryGroups}
              onClose={() => setCategoryPickerOpen(false)}
              onSelect={(_group: CategoryGroup, leaf: Category) => {
                field.onChange(leaf.id);
                setCategoryPickerOpen(false);
                setSuggestedFields((prev) => clearSuggestedField(prev, 'categoryId'));
              }}
            />
          </>
        )}
      />

      <View style={styles.conditionField}>
        <View style={styles.fieldLabelRow}>
          <Text variant="label" color="textSecondary">
            Condition
          </Text>
          {suggestedFields.has('condition') ? <Chip label="Suggested" /> : null}
        </View>
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
                  onPress={() => {
                    field.onChange(field.value === value ? null : value);
                    setSuggestedFields((prev) => clearSuggestedField(prev, 'condition'));
                  }}
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

      <View style={styles.fieldWithLabel}>
        <View style={styles.fieldLabelRow}>
          <Text variant="label" color="textSecondary">
            Description
          </Text>
          {suggestedFields.has('description') ? <Chip label="Suggested" /> : null}
        </View>
        <Controller
          control={control}
          name="description"
          render={({ field, fieldState }) => (
            <TextField
              multiline
              numberOfLines={4}
              value={field.value}
              onChangeText={(text) => {
                field.onChange(text);
                setSuggestedFields((prev) => clearSuggestedField(prev, 'description'));
              }}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              disabled={busy}
              accessibilityLabel={[
                'Description',
                suggestedFields.has('description') ? 'Suggested' : null,
                fieldState.error?.message,
              ]
                .filter(Boolean)
                .join(', ')}
            />
          )}
        />
      </View>

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

/**
 * The active/reserved editor (ROADMAP 1.6). Same fields and the same
 * `ListingFormInput` shape as the draft editor, but validated against
 * `publishableListingSchema` (nothing optional — a non-draft row is already
 * complete and must stay that way) and saved via `update_listing_details`
 * rather than the plain draft UPDATE path. No publish blockers, no Publish
 * button: the listing is already published.
 */
// Unlike ListingFormInput (shared with the draft editor, where condition/
// size/categoryId may be null), publishableListingSchema requires all
// three — so this form's own field-values type narrows them to non-null to
// match the resolver's input.
type PublishedFormInput = Omit<ListingFormInput, 'condition' | 'size' | 'categoryId'> & {
  condition: NonNullable<ListingFormInput['condition']>;
  size: NonNullable<ListingFormInput['size']>;
  categoryId: NonNullable<ListingFormInput['categoryId']>;
};

function PublishedFieldsSection({ listing }: { listing: ListingRow }) {
  const sellerId = listing.seller_id;
  const updateListingDetails = useUpdateListingDetails(listing.id, sellerId);

  const categoriesQuery = useCategories();
  const categoryGroups = categoriesQuery.data ? groupCategoriesByParent(categoriesQuery.data) : [];
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<PublishedFormInput, unknown, PublishableListingInput>({
    resolver: zodResolver(publishableListingSchema),
    defaultValues: {
      title: listing.title ?? '',
      description: listing.description,
      price: formatMinorUnitsForInput(listing.price_amount),
      // Non-null by the listings_complete_when_not_draft CHECK constraint —
      // any active/reserved row (this component's only callers) already has
      // all three set. ListingRow's generated type stays nullable because
      // the columns themselves are nullable for drafts.
      condition: listing.condition!,
      size: listing.size!,
      categoryId: listing.category_id!,
    },
  });
  const { control, handleSubmit, formState } = form;

  async function onSave(input: PublishableListingInput) {
    setFormError(null);
    setSaving(true);
    try {
      const saved = await updateListingDetails.mutateAsync(input);
      // Resets to the server's canonical values and clears isDirty, same
      // "saved state doubles as the reset" signal DraftFieldsSection uses.
      // Non-null for the same reason as the defaultValues above: a row this
      // RPC just saved is active/reserved, so all three are guaranteed set.
      form.reset({
        title: saved.title ?? '',
        description: saved.description,
        price: formatMinorUnitsForInput(saved.price_amount),
        condition: saved.condition!,
        size: saved.size!,
        categoryId: saved.category_id!,
      });
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
      setFormError(mapListingError(err).message);
    } finally {
      setSaving(false);
    }
  }

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
            disabled={saving}
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
            disabled={saving}
          />
        )}
      />

      <Controller
        control={control}
        name="categoryId"
        render={({ field }) => (
          <>
            <CategoryField
              categoryId={field.value}
              groups={categoryGroups}
              disabled={saving}
              onPress={() => setCategoryPickerOpen(true)}
            />
            <CategoryPickerSheet
              visible={categoryPickerOpen}
              groups={categoryGroups}
              onClose={() => setCategoryPickerOpen(false)}
              onSelect={(_group: CategoryGroup, leaf: Category) => {
                field.onChange(leaf.id);
                setCategoryPickerOpen(false);
              }}
            />
          </>
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
                  disabled={saving}
                  onPress={() => field.onChange(value)}
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
                        disabled={saving}
                        onPress={() => field.onChange(value)}
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
            disabled={saving}
          />
        )}
      />

      {formError ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
          {formError}
        </Text>
      ) : null}

      <View style={styles.fieldsFooter}>
        <Text variant="caption" color="textTertiary">
          {saving ? 'Saving…' : formState.isDirty ? 'Unsaved changes' : ' '}
        </Text>
        <View style={styles.fieldsActions}>
          <Button
            variant="primary"
            size="sm"
            onPress={handleSubmit(onSave)}
            loading={saving}
            disabled={saving || !formState.isDirty}>
            Save changes
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
  editable,
  onRemove,
  onMoveEarlier,
  onMoveLater,
}: {
  cell: Extract<PhotoCell, { kind: 'persisted' }>;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  /** Plain thumbnail, no controls at all, once the listing is not a draft. */
  editable: boolean;
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
      {editable ? (
        <>
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
        </>
      ) : null}
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
  suggestSection: {
    gap: space[2],
    alignItems: 'flex-start',
  },
  fieldWithLabel: {
    gap: space[1],
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  categoryField: {
    gap: space[1],
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: minTouchTarget,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderWidth: border.thin,
    borderRadius: radius.md,
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
