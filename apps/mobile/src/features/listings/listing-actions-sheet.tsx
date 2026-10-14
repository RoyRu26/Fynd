import { Alert, StyleSheet, View } from 'react-native';

import { Icon, ListRow, Sheet, type IconName } from '@/components/ui';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { getAvailableActions, type ListingAction } from '@/features/listings/actions';
import type { ListingRow as ListingRowData } from '@/features/listings/api';
import { mapListingError } from '@/features/listings/errors';
import {
  useDeleteDraft,
  useMarkListingActive,
  useMarkListingReserved,
  useMarkListingSold,
  useRemoveListing,
} from '@/features/listings/queries';

// Verified against the installed packages (same discipline as every other
// IconName constant in this codebase): every ios/android/web name below
// exists in sf-symbols-typescript's types and expo-symbols' android/
// symbols.json respectively.
const ACTION_ICON: Record<ListingAction, IconName> = {
  edit: { ios: 'pencil', android: 'edit', web: 'edit' },
  mark_reserved: { ios: 'clock', android: 'schedule', web: 'schedule' },
  mark_active: { ios: 'arrow.uturn.backward', android: 'undo', web: 'undo' },
  mark_sold: { ios: 'checkmark.circle', android: 'check_circle', web: 'check_circle' },
  remove: { ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' },
  delete_draft: { ios: 'trash', android: 'delete', web: 'delete' },
};

const ACTION_LABEL: Record<ListingAction, string> = {
  edit: 'Edit listing',
  mark_reserved: 'Mark as reserved',
  mark_active: 'Mark as active',
  mark_sold: 'Mark as sold',
  remove: 'Remove listing',
  delete_draft: 'Delete draft',
};

// Terminal/destructive actions get a danger-tinted icon AND a danger-colored
// label — never color alone (DESIGN.md §12.4). mark_reserved/mark_active are
// freely reversible between each other, so they stay neutral.
const DANGER_ACTIONS: ReadonlySet<ListingAction> = new Set(['mark_sold', 'remove', 'delete_draft']);

export type ListingActionsSheetProps = {
  /** `null` closes the sheet (also driven by `visible` via Sheet's own prop). */
  listing: ListingRowData | null;
  sellerId: string | undefined;
  onClose: () => void;
  /** Navigates to the editor. The sheet closes itself first; this only navigates. */
  onEdit: (listing: ListingRowData) => void;
  /**
   * Reports a mutation failure message (or `null` to clear a previously
   * reported one) to the caller. The sheet always closes itself before a
   * mutation's promise settles (immediately for reversible actions, right
   * before the confirmation Alert for destructive ones) -- by the time a
   * `catch` runs, Sheet's own Modal has long since stopped rendering
   * (sheet.tsx's close animation is ~240ms, well under any RPC round trip).
   * An error set on local state here would therefore never be seen, so the
   * caller (an always-mounted parent screen) owns displaying it instead.
   */
  onError: (message: string | null) => void;
};

/**
 * ROADMAP 1.6 "Manage a listing" — the overflow menu for a seller's own
 * listing row. The first real caller of Sheet (built in 1.1): one ListRow
 * per action `getAvailableActions` offers for the listing's current status.
 *
 * mark_reserved/mark_active fire immediately, no confirmation — freely
 * reversible between each other. mark_sold/remove/delete_draft close the
 * sheet first, then confirm via a native Alert.alert with a destructive
 * confirm button, mirroring my-listings.tsx's existing handleDeleteDraft
 * shape exactly (DESIGN.md §16 item 8 is still open for Button's solid
 * danger fill, so native Alert stays the destructive-confirmation pattern
 * here too, not a custom in-sheet control).
 */
export function ListingActionsSheet({ listing, sellerId, onClose, onEdit, onError }: ListingActionsSheetProps) {
  const { colors } = useAppTheme();
  const markReserved = useMarkListingReserved(sellerId);
  const markActive = useMarkListingActive(sellerId);
  const markSold = useMarkListingSold(sellerId);
  const remove = useRemoveListing(sellerId);
  const deleteDraft = useDeleteDraft(sellerId);

  const actions = listing ? getAvailableActions(listing.status) : [];

  async function run(mutateAsync: (listingId: string) => Promise<unknown>, listingId: string) {
    onError(null);
    try {
      await mutateAsync(listingId);
    } catch (err) {
      if (__DEV__) {
        console.error(err);
      }
      onError(mapListingError(err).message);
    }
  }

  function confirmAndRun(
    title: string,
    message: string,
    confirmLabel: string,
    mutateAsync: (listingId: string) => Promise<unknown>,
    listingId: string,
  ) {
    // Mirrors my-listings.tsx's handleDeleteDraft: the sheet closes first,
    // then the native confirmation appears on its own, never stacked on top
    // of the sheet.
    onClose();
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: confirmLabel,
        style: 'destructive',
        onPress: () => run(mutateAsync, listingId),
      },
    ]);
  }

  function handleAction(action: ListingAction) {
    if (!listing) return;
    const listingId = listing.id;

    switch (action) {
      case 'edit':
        onClose();
        onEdit(listing);
        return;
      case 'mark_reserved':
        onClose();
        run((id) => markReserved.mutateAsync(id), listingId);
        return;
      case 'mark_active':
        onClose();
        run((id) => markActive.mutateAsync(id), listingId);
        return;
      case 'mark_sold':
        confirmAndRun(
          'Mark as sold?',
          "This moves the listing out of active browsing. This can't be undone.",
          'Mark sold',
          (id) => markSold.mutateAsync(id),
          listingId,
        );
        return;
      case 'remove':
        confirmAndRun(
          'Remove this listing?',
          "It will no longer be visible to buyers. This can't be undone.",
          'Remove',
          (id) => remove.mutateAsync(id),
          listingId,
        );
        return;
      case 'delete_draft':
        confirmAndRun(
          'Delete draft?',
          "This removes the draft and its photos. This can't be undone.",
          'Delete',
          (id) => deleteDraft.mutateAsync(id),
          listingId,
        );
        return;
    }
  }

  return (
    <Sheet
      visible={listing !== null}
      onClose={onClose}
      title={listing ? listing.title ?? 'Untitled listing' : undefined}
      accessibilityLabel="Manage listing">
      <View style={styles.rows}>
        {actions.map((action) => {
          const danger = DANGER_ACTIONS.has(action);
          return (
            <ListRow
              key={action}
              title={ACTION_LABEL[action]}
              titleColor={danger ? 'danger' : 'text'}
              leading={<Icon name={ACTION_ICON[action]} color={danger ? colors.danger : colors.text} />}
              onPress={() => handleAction(action)}
              accessibilityLabel={ACTION_LABEL[action]}
            />
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: space[1],
  },
});
