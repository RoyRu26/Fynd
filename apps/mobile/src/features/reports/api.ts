import { supabase } from '@/lib/supabase';
import { requireUserId } from '@/lib/session';
import type { ReportReason } from '@/features/reports/reports';

/**
 * Database access for the reports feature.
 *
 * The server-side shape this function is written against
 * (`public.reports`, 20261020050442_reports.sql):
 *
 *   * Exactly one of `listing_id`/`reported_user_id` may be set -- enforced
 *     by both a CHECK constraint and the insert policy's WITH CHECK, so
 *     `ReportTarget` below is a discriminated union rather than two
 *     optional fields, making "both" or "neither" a type error here before
 *     it could ever reach the server as a runtime one.
 *   * RLS pins `reporter_id` to `auth.uid()` on insert, mirroring
 *     `favorites.user_id`/`follows.follower_id` -- the client sets it
 *     explicitly to its own id (via the shared `requireUserId`) and the
 *     WITH CHECK verifies the match.
 *   * The insert policy also refuses self-targeting (reporting your own
 *     listing, or yourself) and `reason = 'other'` requires a non-empty
 *     `note` (a table CHECK).
 *   * There is NO select/update/delete grant to `authenticated` at all --
 *     insert-only for users, per ROADMAP 5.1. Nothing in this feature ever
 *     reads a report back, and there is deliberately no cache entry for it
 *     in `queries.ts`.
 */

export type ReportTarget = { listingId: string } | { reportedUserId: string };

/**
 * Files a report as the signed-in user.
 *
 * `note` is sent trimmed, and as `null` rather than `''` when empty --
 * `reports_note_length`/`reports_other_reason_requires_note` both treat
 * null and empty-after-trim the same way, but sending null keeps an
 * unused optional field out of the row entirely rather than storing an
 * empty string that reads as "a note was given."
 *
 * A duplicate report against the same target raises `23505` from whichever
 * of the two partial unique indexes applies; self-targeting or a target
 * the policy refuses to acknowledge (an invented id, your own listing,
 * yourself) raises `42501`. Both are mapped to user-facing copy by
 * `mapReportError`, not handled here.
 */
export async function submitReport(target: ReportTarget, reason: ReportReason, note: string): Promise<void> {
  const reporterId = await requireUserId('file a report');

  const { error } = await supabase.from('reports').insert({
    reporter_id: reporterId,
    listing_id: 'listingId' in target ? target.listingId : null,
    reported_user_id: 'reportedUserId' in target ? target.reportedUserId : null,
    reason,
    note: note.trim() || null,
  });
  if (error) throw error;
}
