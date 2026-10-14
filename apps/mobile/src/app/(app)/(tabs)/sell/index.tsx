import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, EmptyState, Screen, SkeletonRow, Text, type IconName } from '@/components/ui';
import { space } from '@/design/tokens';
import { useAuth } from '@/features/auth/auth-provider';
import type { ListingRow as ListingRowData } from '@/features/listings/api';
import { mapListingError } from '@/features/listings/errors';
import { ListingActionsSheet } from '@/features/listings/listing-actions-sheet';
import { ListingRow } from '@/features/listings/listing-row';
import { useCreateDraft, useMyListings } from '@/features/listings/queries';

// Verified the same way: 'exclamationmark.triangle'/'warning' and
// 'bag'/'shopping_bag' both exist in sf-symbols-typescript and expo-symbols'
// android/symbols.json respectively.
const ERROR_ICON: IconName = { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' };
const EMPTY_ICON: IconName = { ios: 'bag', android: 'shopping_bag', web: 'shopping_bag' };

export default function SellIndex() {
  const router = useRouter();
  const { session } = useAuth();
  const sellerId = session?.user.id;

  const listingsQuery = useMyListings(sellerId);
  const createDraft = useCreateDraft(sellerId);

  const [createError, setCreateError] = useState<string | null>(null);
  const [managingListing, setManagingListing] = useState<ListingRowData | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function openListing(listingId: string) {
    router.push({ pathname: '/(app)/(tabs)/sell/[id]', params: { id: listingId } });
  }

  function manageListing(listing: ListingRowData) {
    setActionError(null);
    setManagingListing(listing);
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
      {actionError ? <ErrorText message={actionError} /> : null}

      {listingsQuery.isPending ? (
        <View style={styles.rows}>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </View>
      ) : listingsQuery.isError ? (
        <EmptyState
          variant="error"
          icon={ERROR_ICON}
          title="Something went wrong"
          body={mapListingError(listingsQuery.error).message}
          actionLabel="Try again"
          onAction={() => listingsQuery.refetch()}
        />
      ) : listings.length === 0 ? (
        <EmptyState variant="empty" icon={EMPTY_ICON} title="You haven't listed anything yet." />
      ) : (
        <View style={styles.sections}>
          {drafts.length > 0 ? (
            <ListingSection
              title="Drafts"
              listings={drafts}
              onPress={(listing) => openListing(listing.id)}
              onManage={manageListing}
            />
          ) : null}
          {others.length > 0 ? (
            <ListingSection
              title="Listed"
              listings={others}
              onPress={(listing) => openListing(listing.id)}
              onManage={manageListing}
            />
          ) : null}
        </View>
      )}

      <ListingActionsSheet
        listing={managingListing}
        sellerId={sellerId}
        onClose={() => setManagingListing(null)}
        onEdit={(listing) => openListing(listing.id)}
        onError={setActionError}
      />
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
  onManage,
}: {
  title: string;
  listings: ListingRowData[];
  onPress: (listing: ListingRowData) => void;
  onManage: (listing: ListingRowData) => void;
}) {
  return (
    <View style={styles.section}>
      <Text variant="label" color="textSecondary">
        {title}
      </Text>
      <View style={styles.rows}>
        {listings.map((listing) => (
          <ListingRow
            key={listing.id}
            listing={listing}
            onPress={() => onPress(listing)}
            onManage={() => onManage(listing)}
          />
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
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
});
