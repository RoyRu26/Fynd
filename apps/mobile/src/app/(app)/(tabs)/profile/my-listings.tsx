import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip, EmptyState, Screen, SkeletonRow, Text, type IconName } from '@/components/ui';
import { space } from '@/design/tokens';
import { useAuth } from '@/features/auth/auth-provider';
import type { ListingRow as ListingRowData } from '@/features/listings/api';
import { mapListingError } from '@/features/listings/errors';
import { ListingActionsSheet } from '@/features/listings/listing-actions-sheet';
import { ListingRow } from '@/features/listings/listing-row';
import { useMyListings } from '@/features/listings/queries';
import {
  filterListingsByStatus,
  FILTER_LABELS,
  getMyListingsEmptyCopy,
  MY_LISTINGS_FILTERS,
  type ListingStatusFilter,
} from '@/features/listings/status';

// Verified against the installed packages: 'exclamationmark.triangle'/'warning'
// and 'bag'/'shopping_bag' both exist in sf-symbols-typescript and
// expo-symbols' android/symbols.json respectively — the same pair sell/index.tsx
// already uses for the same states.
const ERROR_ICON: IconName = { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' };
const EMPTY_ICON: IconName = { ios: 'bag', android: 'shopping_bag', web: 'shopping_bag' };

export default function MyListings() {
  const router = useRouter();
  const { session } = useAuth();
  const sellerId = session?.user.id;

  const listingsQuery = useMyListings(sellerId);

  const [filter, setFilter] = useState<ListingStatusFilter>('all');
  const [managingListing, setManagingListing] = useState<ListingRowData | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function openListing(listingId: string) {
    router.push({ pathname: '/(app)/(tabs)/sell/[id]', params: { id: listingId } });
  }

  function manageListing(listing: ListingRowData) {
    setActionError(null);
    setManagingListing(listing);
  }

  const allListings = listingsQuery.data ?? [];
  const visible = filterListingsByStatus(allListings, filter);
  const emptyCopy = getMyListingsEmptyCopy(filter, allListings.length);

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <Text variant="title">My listings</Text>

      <View style={styles.filters}>
        {MY_LISTINGS_FILTERS.map((value) => (
          <Chip
            key={value}
            label={FILTER_LABELS[value]}
            selectable
            selected={filter === value}
            onPress={() => setFilter(value)}
          />
        ))}
      </View>

      {actionError ? (
        <Text
          variant="caption"
          color="danger"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert">
          {actionError}
        </Text>
      ) : null}

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
      ) : visible.length === 0 ? (
        <EmptyState variant="empty" icon={EMPTY_ICON} title={emptyCopy.title} body={emptyCopy.body} />
      ) : (
        <View style={styles.rows}>
          {visible.map((listing) => (
            <ListingRow
              key={listing.id}
              listing={listing}
              onPress={() => openListing(listing.id)}
              onManage={() => manageListing(listing)}
            />
          ))}
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

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: space[5],
    paddingTop: space[6],
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  rows: {
    gap: space[2],
  },
});
