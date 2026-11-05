import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { Icon, ListRow, Sheet, type IconName } from '@/components/ui';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { getAvailableActions, type ListingAction } from '@/features/listings/actions';
import type { ListingRow as ListingRowData } from '@/features/listings/api';
import { mapListingError } from '@/features/listings/errors';
import {
  useDeleteDraft,
  useListingConversationBuyers,
  useMarkListingActive,
  useMarkListingReserved,
  useMarkListingSold,
  useRemoveListing,
} from '@/features/listings/queries';
import { MARK_SOLD_ICON, resolveSoldBuyerName } from '@/features/listings/sold-buyer';
import { SoldBuyerPicker } from '@/features/listings/sold-buyer-picker';

// Verified against the installed packages (same discipline as every other
// IconName constant in this codebase): every ios/android/web name below
// exists in sf-symbols-typescript's types and expo-symbols' android/
// symbols.json respectively.
//
// mark_sold reuses MARK_SOLD_ICON from sold-buyer.ts (not a copy of the
// same literal) -- sold-buyer-picker.tsx's "Sold outside Fynd" row needs
// the identical glyph (it's a second view of this exact action), and that
// shared pure module is what both this file and the picker already import
// from, so it's the one place a single value can live without this file
// and the picker importing from each other.
const ACTION_ICON: Record<ListingAction, IconName> = {
  edit: { ios: 'pencil', android: 'edit', web: 'edit' },
  mark_reserved: { ios: 'clock', android: 'schedule', web: 'schedule' },
  mark_active: { ios: 'arrow.uturn.backward', android: 'undo', web: 'undo' },
  mark_sold: MARK_SOLD_ICON,
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
 * reversible between each other. remove/delete_draft close the sheet
 * first, then confirm via a native Alert.alert with a destructive confirm
 * button, mirroring my-listings.tsx's existing handleDeleteDraft shape
 * exactly (DESIGN.md §16 item 8 is still open for Button's solid danger
 * fill, so native Alert stays the destructive-confirmation pattern here
 * too, not a custom in-sheet control).
 *
 * mark_sold is the one action with a second view: ROADMAP 5.3 "Mark sold
 * to a buyer" adds a `view: 'menu' | 'pick_buyer'` split, the same single-
 * `Sheet`-instance shape `MoreActionsSheet` already established for its own
 * menu/report split (one Sheet, content swapped, never a second Modal —
 * see that file's own comment on the close/open animation overlap a
 * sibling-Sheet handoff would otherwise create). `view` resets to `'menu'`
 * whenever the sheet is freshly opened on a (possibly different) listing,
 * mirroring `MoreActionsSheet`'s `prevVisible` sync pattern exactly, just
 * keyed off the listing's id rather than a plain `visible` boolean since
 * this sheet has no boolean prop of its own (`listing !== null` is already
 * `Sheet`'s own `visible`).
 *
 * Tapping "Mark as sold" while the listing's conversation-buyer list is
 * EMPTY, or still resolving (loading or errored), falls straight through
 * to the exact pre-5.3 behaviour: confirm, then `markSold.mutateAsync`
 * with `buyerId: null` — zero regression for the overwhelmingly common
 * case of a listing nobody has messaged about, and a deliberate choice not
 * to block or disable the row while the fetch is in flight (a listing with
 * a genuinely slow/failed fetch must still be markable as sold). The row
 * does show a small trailing spinner while still resolving, though, so a
 * fast tap that lands before the list resolves reads as "still checking,"
 * not as silent, indistinguishable-from-normal behavior that happens to
 * skip the picker. Only once the list is known to be non-empty does
 * tapping switch to the picker view instead.
 */
export function ListingActionsSheet({ listing, sellerId, onClose, onEdit, onError }: ListingActionsSheetProps) {
  const { colors } = useAppTheme();
  const markReserved = useMarkListingReserved(sellerId);
  const markActive = useMarkListingActive(sellerId);
  const markSold = useMarkListingSold(sellerId);
  const remove = useRemoveListing(sellerId);
  const deleteDraft = useDeleteDraft(sellerId);

  const actions = listing ? getAvailableActions(listing.status) : [];
  const canMarkSold = actions.includes('mark_sold');

  // Prefetched whenever the sheet is open on a listing that offers
  // mark_sold -- by the time the user actually taps the row, the list has
  // usually already resolved, so the common case never shows a spinner.
  const conversationBuyersQuery = useListingConversationBuyers(canMarkSold ? listing?.id : undefined);
  const conversationBuyers = conversationBuyersQuery.data ?? [];

  const [view, setView] = useState<'menu' | 'pick_buyer'>('menu');

  // Resets to the menu view every time the sheet opens on a (possibly
  // different) listing -- React's documented "adjust state when a prop
  // changes" pattern, mirroring `MoreActionsSheet`'s own `prevVisible`
  // sync. Keyed off the listing's id rather than a boolean `visible` prop,
  // since this sheet derives its own visibility from `listing !== null`.
  const currentListingId = listing?.id ?? null;
  const [prevListingId, setPrevListingId] = useState(currentListingId);
  if (currentListingId !== prevListingId) {
    setPrevListingId(currentListingId);
    if (currentListingId !== null) setView('menu');
  }

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
      case 'mark_sold': {
        // Still resolving (or failed) is treated the same as empty -- see
        // this component's own doc comment for why: never race or block
        // the action on a slow/failed fetch.
        const stillResolving = conversationBuyersQuery.isPending || conversationBuyersQuery.isError;
        if (stillResolving || conversationBuyers.length === 0) {
          confirmAndRun(
            'Mark as sold?',
            "This moves the listing out of active browsing. This can't be undone.",
            'Mark sold',
            (id) => markSold.mutateAsync({ listingId: id, buyerId: null }),
            listingId,
          );
          return;
        }
        setView('pick_buyer');
        return;
      }
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

  /**
   * A row was tapped in the buyer picker. `buyerId` is `null` for the
   * pinned "Sold outside Fynd" row. Closes the sheet first (resetting
   * `view` back to `'menu'` for next time), then confirms via the SAME
   * destructive `Alert.alert` pattern every other action in this file
   * uses -- now naming the buyer when there is one.
   */
  function handleSelectBuyer(buyerId: string | null) {
    if (!listing) return;
    const listingId = listing.id;
    const buyer = buyerId ? conversationBuyers.find((candidate) => candidate.buyerId === buyerId) : undefined;
    const title = buyer ? `Mark sold to ${resolveSoldBuyerName(buyer)}?` : 'Mark as sold?';

    onClose();
    setView('menu');
    Alert.alert(title, "This moves the listing out of active browsing. This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark sold',
        style: 'destructive',
        onPress: () => run((id) => markSold.mutateAsync({ listingId: id, buyerId }), listingId),
      },
    ]);
  }

  const pickingBuyer = view === 'pick_buyer';

  return (
    <Sheet
      visible={listing !== null}
      onClose={onClose}
      title={pickingBuyer ? 'Mark as sold' : listing ? listing.title ?? 'Untitled listing' : undefined}
      accessibilityLabel={pickingBuyer ? 'Choose who you sold this to' : 'Manage listing'}>
      {pickingBuyer ? (
        <SoldBuyerPicker buyers={conversationBuyers} onSelect={handleSelectBuyer} />
      ) : (
        <View style={styles.rows}>
          {actions.map((action) => {
            const danger = DANGER_ACTIONS.has(action);
            // Trailing spinner only for mark_sold while its own buyer list
            // is still resolving -- a visible "still checking" cue so a
            // fast tap landing before the fetch settles doesn't read as
            // identical to the listing genuinely having no buyers to pick
            // from. Never disables the row: see this component's own doc
            // comment for why a slow/failed fetch must still be markable.
            const showResolvingIndicator = action === 'mark_sold' && conversationBuyersQuery.isPending;
            return (
              <ListRow
                key={action}
                title={ACTION_LABEL[action]}
                titleColor={danger ? 'danger' : 'text'}
                leading={<Icon name={ACTION_ICON[action]} color={danger ? colors.danger : colors.text} />}
                trailing={showResolvingIndicator ? <ActivityIndicator color={colors.textTertiary} /> : undefined}
                onPress={() => handleAction(action)}
                accessibilityLabel={
                  showResolvingIndicator ? `${ACTION_LABEL[action]}, checking who messaged about this listing` : ACTION_LABEL[action]
                }
              />
            );
          })}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: space[1],
  },
});
