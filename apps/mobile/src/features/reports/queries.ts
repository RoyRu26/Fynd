import { useMutation } from '@tanstack/react-query';

import { submitReport, type ReportTarget } from '@/features/reports/api';
import type { ReportReason } from '@/features/reports/reports';

/**
 * Files a report as the signed-in user.
 *
 * No query key, no cache invalidation: `reports` is insert-only for users
 * (no SELECT grant at all -- see `api.ts`'s doc comment), so there is
 * nothing cached anywhere in this app that a successful report could ever
 * invalidate or update. A single `useMutation`, nothing else -- unlike
 * `useToggleFollow`/`useToggleFavoriteFromDetail`, there is no optimistic
 * update to stage or roll back, since there is no visible state this
 * mutation changes.
 */
export function useSubmitReport() {
  return useMutation({
    mutationFn: ({ target, reason, note }: { target: ReportTarget; reason: ReportReason; note: string }) =>
      submitReport(target, reason, note),
  });
}
