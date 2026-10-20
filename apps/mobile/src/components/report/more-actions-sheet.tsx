import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, ListRow, Sheet, type IconName } from '@/components/ui';
import { ReportReasonPicker } from '@/components/report/report-reason-picker';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import type { ReportTarget } from '@/features/reports/api';

// Verified against the installed packages (same discipline as every other
// IconName constant in this codebase): 'flag' exists in sf-symbols-
// typescript's types, and in expo-symbols' android/symbols.json.
const REPORT_ICON: IconName = { ios: 'flag', android: 'flag', web: 'flag' };

export type MoreActionsTargetKind = 'listing' | 'user';

export type MoreActionsSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** The thing this menu's Report row targets. Only read while `visible`. */
  target: ReportTarget;
  /** Drives the "Report listing"/"Report user" label and the report view's title. */
  targetKind: MoreActionsTargetKind;
};

/**
 * ROADMAP 5.1 — the "more" overflow menu opened from a non-owner's ellipsis
 * button on the feed card, listing detail, and seller profile (DESIGN.md
 * §14.1's icon rail: "Share and more/report as the smallest, lowest-
 * contrast elements" — Share is out of scope per ROADMAP, so Report is
 * this menu's only row today). The one component all 3 call sites mount.
 *
 * ONE `Sheet` instance for the whole flow, not two handed off from one to
 * the other: `view` switches its content between the menu (a `ListRow`
 * per action) and the report reason-picker, exactly how `explore.tsx`
 * folds its category picker into the same Filter Sheet instance rather
 * than nesting a second `Modal` — see that screen's own comment on the
 * ~240ms double-Modal window a close/open handoff between two sibling
 * `Sheet`s would otherwise create.
 *
 * Deliberately a real extensible MENU, not a single-purpose button
 * mislabeled as one: ROADMAP 5.2 ("Block") adds a second `ListRow` here
 * later, which is the whole reason the menu view is its own list rather
 * than the ellipsis button opening the report picker directly.
 */
export function MoreActionsSheet({ visible, onClose, target, targetKind }: MoreActionsSheetProps) {
  const { colors } = useAppTheme();
  const [view, setView] = useState<'menu' | 'report'>('menu');

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

  function handleClose() {
    setView('menu');
    onClose();
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
