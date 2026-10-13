import { StyleSheet, View } from 'react-native';

import { Chip, IconButton, ListRow, type IconName } from '@/components/ui';
import { space } from '@/design/tokens';
import type { ListingRow as ListingRowData } from '@/features/listings/api';
import { formatMoney } from '@/features/listings/price';

// Verified against the installed packages: 'trash' exists in
// sf-symbols-typescript's types, and 'delete' exists in expo-symbols'
// android/symbols.json.
const DELETE_ICON: IconName = { ios: 'trash', android: 'delete', web: 'delete' };

export type ListingRowProps = {
  listing: ListingRowData;
  onPress: () => void;
  /** Omit entirely (not just disable) for anything but a draft — see below. */
  onDelete?: () => void;
  deleteDisabled?: boolean;
};

/**
 * One row for a seller's own listing — the single renderer shared by the
 * Sell tab's own-listings list and My Listings (DESIGN.md §15's
 * second-caller rule: this stopped being sell/index.tsx-only once My
 * Listings needed the identical row).
 */
export function ListingRow({ listing, onPress, onDelete, deleteDisabled }: ListingRowProps) {
  const price =
    listing.price_amount === null ? null : formatMoney(listing.price_amount, listing.currency);
  const statusLabel = listing.status.charAt(0).toUpperCase() + listing.status.slice(1);

  return (
    <ListRow
      title={listing.title ?? 'Untitled draft'}
      subtitle={price ?? 'No price set'}
      onPress={onPress}
      trailing={
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
      }
    />
  );
}

const styles = StyleSheet.create({
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
});
