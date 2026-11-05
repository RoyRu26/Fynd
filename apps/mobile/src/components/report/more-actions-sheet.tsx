import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Icon, ListRow, Sheet, type IconName } from '@/components/ui';
import { ReportReasonPicker } from '@/components/report/report-reason-picker';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { mapBlockError } from '@/features/blocks/errors';
import { useIsBlockedByMe, useToggleBlock } from '@/features/blocks/queries';
import type { ReportTarget } from '@/features/reports/api';

// Verified against the installed packages (same discipline as every other
// IconName constant in this codebase): 'flag' exists in sf-symbols-
// typescript's types, and in expo-symbols' android/symbols.json.
const REPORT_ICON: IconName = { ios: 'flag', android: 'flag', web: 'flag' };
// Verified against the installed packages: 'nosign' exists in
// sf-symbols-typescript's types, and 'block' exists in expo-symbols'
// android/symbols.json.
const BLOCK_ICON: IconName = { ios: 'nosign', android: 'block', web: 'block' };

export type MoreActionsTargetKind = 'listing' | 'user';

export type MoreActionsSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** The thing this menu's Report row targets. Only read while `visible`. */
  target: ReportTarget;
  /** Drives the "Report listing"/"Report user" label and the report view's title. */
  targetKind: MoreActionsTargetKind;
  /**
   * The USER to block — ROADMAP 5.2. Independent of `target`/`targetKind`
   * above: Report can target a listing or a user, but Block is always
   * user-level regardless of entry point, so on the feed card and listing
   * detail this is the LISTING's seller id, not the listing itself. Every
   * call site has this available already (the seller/profile id their own
   * data already carries).
   */
  blockTargetUserId: string;
};

/**
 * ROADMAP 5.1/5.2 — the "more" overflow menu opened from a non-owner's
 * ellipsis button on the feed card, listing detail, and seller profile
 * (DESIGN.md §14.1's icon rail: "Share and more/report as the smallest,
 * lowest-contrast elements" — Share is out of scope per ROADMAP). The one
 * component all 3 call sites mount, now carrying both its Report row
 * (5.1) and its Block/Unblock row (5.2).
 *
 * ONE `Sheet` instance for the whole flow, not two handed off from one to
 * the other: `view` switches its content between the menu (a `ListRow`
 * per action) and the report reason-picker, exactly how `explore.tsx`
 * folds its category picker into the same Filter Sheet instance rather
 * than nesting a second `Modal` — see that screen's own comment on the
 * ~240ms double-Modal window a close/open handoff between two sibling
 * `Sheet`s would otherwise create.
 *
 * Block/unblock gets no second view of its own, unlike Report: it is a
 * single confirm-and-fire action, not a form, so it stays entirely on the
 * `menu` view and never touches `view` state at all.
 *
 * Deliberately a real extensible MENU, not a single-purpose button
 * mislabeled as one — ROADMAP 5.2 is the reason the menu view was built as
 * its own list in the first place, rather than the ellipsis button opening
 * the report picker directly.
 */
export function MoreActionsSheet({ visible, onClose, target, targetKind, blockTargetUserId }: MoreActionsSheetProps) {
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const viewerId = session?.user.id;
  const [view, setView] = useState<'menu' | 'report'>('menu');

  const isBlockedQuery = useIsBlockedByMe(viewerId, blockTargetUserId);
  const isBlocked = isBlockedQuery.data ?? false;
  const { toggleBlock, isPending: blockPending } = useToggleBlock(blockTargetUserId, viewerId);

  // Resets to the menu view each time the sheet is freshly opened (React's
  // documented "adjust state when a prop changes" pattern, mirroring
  // `Sheet`'s own `prevVisible` sync) -- so closing mid-report and
  // reopening never resumes on the report view.
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) setView('menu');
  }

  const reportLabel = targetKind === 'listing' ? 'Report listing' : 'Report user';
  const blockLabel = isBlocked ? 'Unblock this seller' : 'Block this seller';

  function handleClose() {
    setView('menu');
    onClose();
  }

  function runToggleBlock() {
    toggleBlock(isBlocked, {
      onError: (err) => {
        if (__DEV__) {
          console.error(err);
        }
        Alert.alert("Couldn't block seller", mapBlockError(err).message);
      },
    });
  }

  function handleBlockPress() {
    if (blockPending) return;

    if (isBlocked) {
      // Unblocking is the restorative half of a reversible pair -- fires
      // immediately, no confirmation, mirroring Follow/Unfollow needing
      // none.
      onClose();
      runToggleBlock();
      return;
    }

    // Mirrors `listing-actions-sheet.tsx`'s own confirm-then-run pattern
    // exactly: the sheet closes first, then the native confirmation
    // appears on its own, never stacked on top of the sheet.
    onClose();
    Alert.alert(
      'Block this seller?',
      "You won't see their listings and neither of you will be able to message the other. You can unblock them anytime from this menu.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Block', style: 'destructive', onPress: runToggleBlock },
      ],
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={handleClose}
      title={view === 'report' ? reportLabel : undefined}
      accessibilityLabel={view === 'report' ? reportLabel : 'More actions'}>
      {view === 'menu' ? (
        <View style={styles.rows}>
          <ListRow
            title={reportLabel}
            leading={<Icon name={REPORT_ICON} color={colors.text} />}
            onPress={() => setView('report')}
            accessibilityLabel={reportLabel}
          />
          <ListRow
            title={blockLabel}
            // Danger-tinted only for the Block direction, not Unblock --
            // mirrors `listing-actions-sheet.tsx`'s own DANGER_ACTIONS
            // convention (a destructive action gets a danger icon AND a
            // danger-colored label, never color alone, DESIGN.md §12.4);
            // unblocking is restorative, not destructive.
            titleColor={isBlocked ? 'text' : 'danger'}
            leading={<Icon name={BLOCK_ICON} color={isBlocked ? colors.text : colors.danger} />}
            onPress={handleBlockPress}
            disabled={blockPending}
            accessibilityLabel={blockLabel}
          />
        </View>
      ) : (
        <ReportReasonPicker target={target} onSubmitted={handleClose} />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: space[1],
  },
});
