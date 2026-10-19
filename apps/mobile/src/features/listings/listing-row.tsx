import { StyleSheet, View } from 'react-native';

import { Chip, IconButton, ListRow, type IconName } from '@/components/ui';
import { space } from '@/design/tokens';
import { getAvailableActions } from '@/features/listings/actions';
import type { ListingRow as ListingRowData } from '@/features/listings/api';
import { formatMoney } from '@/features/listings/price';

// Verified against the installed packages: 'ellipsis' exists in
// sf-symbols-typescript's types, and 'more_vert' exists in expo-symbols'
// android/symbols.json.
const MANAGE_ICON: IconName = { ios: 'ellipsis', android: 'more_vert', web: 'more_vert' };

export type ListingRowProps = {
  listing: ListingRowData;
  onPress: () => void;
  /**
   * Opens the ROADMAP 1.6 actions sheet (ListingActionsSheet). Omit entirely
   * (not just disable) when the listing has no available actions — see
   * below — rather than showing a control that would open an empty sheet.
   */
  onManage?: () => void;
};

/**
 * One row for a seller's own listing — the single renderer shared by the
 * Sell tab's own-listings list and My Listings (DESIGN.md §15's
 * second-caller rule: this stopped being sell/index.tsx-only once My
 * Listings needed the identical row).
 */
export function ListingRow({ listing, onPress, onManage }: ListingRowProps) {
  const price =
    listing.price_amount === null ? null : formatMoney(listing.price_amount, listing.currency);
  const statusLabel = listing.status.charAt(0).toUpperCase() + listing.status.slice(1);
  // A sold/removed listing offers no actions at all (both are terminal), so
  // the overflow control is withheld entirely rather than shown opening an
  // empty sheet.
  const hasActions = getAvailableActions(listing.status).length > 0;

  return (
    <ListRow
      title={listing.title ?? 'Untitled draft'}
      subtitle={price ?? 'No price set'}
      onPress={onPress}
      trailing={
        <View style={styles.rowMeta}>
          <Chip label={statusLabel} />
          {onManage && hasActions ? (
            <IconButton icon={MANAGE_ICON} accessibilityLabel="Manage listing" onPress={onManage} />
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
