import type { Enums } from '@/types/database';

/**
 * Report domain helpers -- same shape as `condition.ts`/`size.ts`: a type
 * alias onto the generated enum (never a hand-rolled union that could drift
 * from the database) plus a label map and a pure validator.
 *
 * ROADMAP 5.1 "Report a listing or user (reason + note)". The table
 * (`public.reports`, 20261020050442_reports.sql) is insert-only for users --
 * there is no SELECT grant at all, so nothing in this feature ever reads a
 * report back. Everything here exists to shape what gets WRITTEN.
 */

export type ReportReason = Enums<'report_reason'>;

/** The user-facing label. Raw enum strings must never reach the UI. */
export const REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam',
  prohibited_item: 'Prohibited or counterfeit item',
  scam_or_fraud: 'Scam or fraud',
  inappropriate_content: 'Inappropriate content',
  harassment: 'Harassment',
  other: 'Other',
};

/** Every reason, in the fixed display order the reason-picker chip wall uses. */
export const REPORT_REASONS: ReportReason[] = [
  'spam',
  'prohibited_item',
  'scam_or_fraud',
  'inappropriate_content',
  'harassment',
  'other',
];

/**
 * Whether Submit should be disabled because `reason` is `'other'` and
 * `note` is empty (after trimming).
 *
 * Defense in depth, not the real gate -- the server CHECK constraint
 * (`reports_other_reason_requires_note`) is what actually enforces this;
 * this only keeps the sheet from firing a mutation that the server is
 * certain to reject, and disabling a button is a worse UX than never
 * showing the error at all for something this cheap to predict client-side.
 * A `null` reason (nothing selected yet) is not this validator's job --
 * the Submit button's own "no reason selected" disable covers that
 * separately.
 */
export function isOtherReasonMissingNote(reason: ReportReason | null, note: string): boolean {
  return reason === 'other' && note.trim().length === 0;
}
