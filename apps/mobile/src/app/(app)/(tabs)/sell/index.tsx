import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { Button, Chip, IconButton, Screen, Text, type IconName } from '@/components/ui';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { useAuth } from '@/features/auth/auth-provider';
import type { ListingRow } from '@/features/listings/api';
import { mapListingError } from '@/features/listings/errors';
import { formatMoney } from '@/features/listings/price';
import { useCreateDraft, useDeleteDraft, useMyListings } from '@/features/listings/queries';

// Verified against the installed packages: 'trash' exists in
// sf-symbols-typescript's types, and 'delete' exists in expo-symbols'
// android/symbols.json.
const DELETE_ICON: IconName = { ios: 'trash', android: 'delete', web: 'delete' };

export default function SellIndex() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const sellerId = session?.user.id;

  const listingsQuery = useMyListings(sellerId);
  const createDraft = useCreateDraft(sellerId);
  const deleteDraft = useDeleteDraft(sellerId);

  const [createError, setCreateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openListing(listingId: string) {
    router.push({ pathname: '/(app)/(tabs)/sell/[id]', params: { id: listingId } });
  }

  async function handleNewListing() {
    setCreateError(null);
    try {
      const draft = await createDraft.mutateAsync();
      openListing(draft.id);
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
      setCreateError(mapListingError(err).message);
    }
  }

  function handleDeleteDraft(listing: ListingRow) {
    Alert.alert(
      'Delete draft?',
      "This removes the draft and its photos. This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleteError(null);
            try {
              await deleteDraft.mutateAsync(listing.id);
            } catch (err) {
              if (__DEV__) {
                console.error(err);
              }
              setDeleteError(mapListingError(err).message);
            }
          },
        },
      ],
    );
  }

  const listings = listingsQuery.data ?? [];
  // RLS also scopes this table to "active OR own", but "mine" must never rely
  // on that alone — useMyListings already filters by seller_id server-side;
  // this is just the client-side split for the two section headers.
  const drafts = listings.filter((listing) => listing.status === 'draft');
  const others = listings.filter((listing) => listing.status !== 'draft');

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text variant="title">Your listings</Text>
        <Button size="sm" onPress={handleNewListing} loading={createDraft.isPending}>
          New listing
        </Button>
      </View>

      {createError ? <ErrorText message={createError} /> : null}
      {deleteError ? <ErrorText message={deleteError} /> : null}

      {listingsQuery.isPending ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.textTertiary} />
        </View>
      ) : listingsQuery.isError ? (
        <View style={styles.centered}>
          <Text variant="body" color="danger">
            {mapListingError(listingsQuery.error).message}
          </Text>
          <Button variant="secondary" size="sm" onPress={() => listingsQuery.refetch()}>
            Try again
          </Button>
        </View>
      ) : listings.length === 0 ? (
        <View style={styles.centered}>
          <Text variant="body" color="textSecondary">
            You haven&apos;t listed anything yet.
          </Text>
        </View>
      ) : (
        <View style={styles.sections}>
          {drafts.length > 0 ? (
            <ListingSection
              title="Drafts"
              listings={drafts}
              onPress={(listing) => openListing(listing.id)}
              onDelete={handleDeleteDraft}
              deleteDisabled={deleteDraft.isPending}
            />
          ) : null}
          {others.length > 0 ? (
            <ListingSection
              title="Listed"
              listings={others}
              onPress={(listing) => openListing(listing.id)}
            />
          ) : null}
        </View>
      )}
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

function ListingSection({
  title,
  listings,
  onPress,
  onDelete,
  deleteDisabled,
}: {
  title: string;
  listings: ListingRow[];
  onPress: (listing: ListingRow) => void;
  onDelete?: (listing: ListingRow) => void;
  deleteDisabled?: boolean;
}) {
  return (
    <View style={styles.section}>
      <Text variant="label" color="textSecondary">
        {title}
      </Text>
      <View style={styles.rows}>
        {listings.map((listing) => (
          <ListingListRow
            key={listing.id}
            listing={listing}
            onPress={() => onPress(listing)}
            onDelete={onDelete ? () => onDelete(listing) : undefined}
            deleteDisabled={deleteDisabled}
          />
        ))}
      </View>
    </View>
  );
}

function ListingListRow({
  listing,
  onPress,
  onDelete,
  deleteDisabled,
}: {
  listing: ListingRow;
  onPress: () => void;
  onDelete?: () => void;
  deleteDisabled?: boolean;
}) {
  const { colors } = useAppTheme();
  const price =
    listing.price_amount === null ? null : formatMoney(listing.price_amount, listing.currency);
  const statusLabel = listing.status.charAt(0).toUpperCase() + listing.status.slice(1);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.bgElevated, opacity: pressed ? 0.7 : 1 },
      ]}>
      <View style={styles.rowMain}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {listing.title ?? 'Untitled draft'}
        </Text>
        <Text variant="caption" color="textSecondary">
          {price ?? 'No price set'}
        </Text>
      </View>
      <View style={styles.rowMeta}>
        <Chip label={statusLabel} />
        {/* Delete is never offered here for anything but a draft: the RLS
            DELETE policy would reject an active listing anyway, but the
            button is withheld rather than shown-then-failing. */}
        {onDelete ? (
          <IconButton
            icon={DELETE_ICON}
            accessibilityLabel="Delete draft"
            onPress={onDelete}
            disabled={deleteDisabled}
            color="danger"
          />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: space[6],
    paddingTop: space[6],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  centered: {
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[10],
  },
  sections: {
    gap: space[6],
  },
  section: {
    gap: space[2],
  },
  rows: {
    gap: space[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderRadius: space[3],
  },
  rowMain: {
    flex: 1,
    gap: space[1],
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
});
