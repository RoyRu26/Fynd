import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button, Chip, Text, TextField } from '@/components/ui';
import { space } from '@/design/tokens';
import type { ReportTarget } from '@/features/reports/api';
import { mapReportError } from '@/features/reports/errors';
import { useSubmitReport } from '@/features/reports/queries';
import {
  isOtherReasonMissingNote,
  REASON_LABELS,
  REPORT_REASONS,
  type ReportReason,
} from '@/features/reports/reports';

export type ReportReasonPickerProps = {
  target: ReportTarget;
  /** Called once the report has actually been submitted successfully -- the caller closes its own Sheet. */
  onSubmitted: () => void;
};

/**
 * ROADMAP 5.1's reason-picker content: a `Chip`-wall single-select of the 6
 * reasons (mirroring `explore.tsx`'s own condition/size filter chip walls
 * exactly -- `flexDirection: 'row', flexWrap: 'wrap'`, one `selectable`
 * `Chip` per value), an optional multiline note below it, and a Submit
 * button.
 *
 * Content only -- no `Sheet` of its own. `MoreActionsSheet` mounts this
 * inside the ONE `Sheet` instance it already owns (swapping it in for the
 * menu view), the same way `explore.tsx` folds `CategoryPickerContent` into
 * its own single Filter Sheet rather than nesting a second `Modal`: two
 * sibling `Sheet`s that hand off from one to the other would briefly mount
 * two native Modals at once during the close/open animation overlap (see
 * `sheet.tsx`'s two-phase close and `explore.tsx`'s own comment on exactly
 * this).
 */
export function ReportReasonPicker({ target, onSubmitted }: ReportReasonPickerProps) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submitReport = useSubmitReport();

  // Defense in depth, not the real gate -- reports_other_reason_requires_note
  // (the server CHECK) is what actually enforces this. See the validator's
  // own doc comment.
  const missingNote = isOtherReasonMissingNote(reason, note);
  const canSubmit = reason !== null && !missingNote;

  function handleSubmit() {
    if (!canSubmit || !reason || submitReport.isPending) return;
    setErrorMessage(null);
    submitReport.mutate(
      { target, reason, note },
      {
        onSuccess: () => {
          onSubmitted();
          // Lightweight post-action feedback, reusing the native-Alert
          // pattern `listing-actions-sheet.tsx` already uses for its own
          // destructive-action confirmations -- not a toast system this
          // codebase doesn't otherwise have.
          Alert.alert('Report submitted', "Thanks for letting us know — we'll take a look.");
        },
        onError: (err) => {
          if (__DEV__) {
            console.error(err);
          }
          setErrorMessage(mapReportError(err).message);
        },
      },
    );
  }

  return (
    <View style={styles.content}>
      <View style={styles.field}>
        <Text variant="label" color="textSecondary">
          Reason
        </Text>
        <View style={styles.chipGroup}>
          {REPORT_REASONS.map((value) => (
            <Chip
              key={value}
              label={REASON_LABELS[value]}
              selectable
              selected={reason === value}
              onPress={() => setReason(value)}
            />
          ))}
        </View>
      </View>

      <TextField
        label="Additional details (optional)"
        placeholder="Add any details that might help us review this"
        value={note}
        onChangeText={setNote}
        multiline
        numberOfLines={4}
      />

      {errorMessage ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
          {errorMessage}
        </Text>
      ) : null}

      <Button onPress={handleSubmit} disabled={!canSubmit} loading={submitReport.isPending}>
        Submit report
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: space[4],
    paddingBottom: space[4],
  },
  field: {
    gap: space[1],
  },
  chipGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
});
