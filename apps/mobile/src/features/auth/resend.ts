// Pure logic for the confirmation-email resend cooldown. No react-native and
// no @/lib/supabase import, so it is unit-testable (CLAUDE.md's repo layout
// rule); `features/listings/recency.ts` is the precedent for feature-local
// pure time math taking `now` as an argument.

/**
 * How long the resend button stays disabled after a send.
 *
 * Client-side courtesy only — it exists so the user sees a timer instead of an
 * opaque failure, NOT as a rate limit. GoTrue enforces the real one server-side
 * and answers `over_email_send_rate_limit`, which `mapAuthError` handles, so a
 * user who defeats this (reinstall, clock change) still cannot spam sends.
 */
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Whole seconds left until `deadlineMs`, clamped at zero.
 *
 * Rounds UP so the final second is actually displayed: at 400ms remaining the
 * countdown reads "0:01" and then "0:00", rather than skipping to zero while
 * the button is still disabled. Clamping (not returning a negative) is what
 * lets callers treat 0 as the single "ready" state regardless of how long ago
 * the deadline passed.
 */
export function secondsRemaining(deadlineMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

/**
 * Formats a whole-second remainder as `M:SS`.
 *
 * Minutes are unpadded and seconds always two digits ("0:42", "1:05"), which
 * is the conventional timer shape and what the design calls for. Negative
 * input is treated as zero so a caller that skips `secondsRemaining` cannot
 * render "-1:-1".
 */
export function formatCooldown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

/**
 * Seconds left in the resend cooldown, or 0 when no cooldown is armed.
 *
 * Clamped to `RESEND_COOLDOWN_SECONDS` at the top as well as 0 at the bottom.
 * The upper clamp is load-bearing, not defensive padding. `useCountdown`'s
 * interval self-clears once a deadline passes, which freezes its clock at that
 * moment — so when a user waits five minutes and then taps Resend, the raw
 * difference between the NEW deadline and that frozen clock is about six
 * minutes, and the button would read "6:00" for a 60-second cooldown. The stale
 * window is not one tick; it is unbounded.
 *
 * A cooldown can never have more time left than its own length, so stating
 * that here makes the whole class of error unrepresentable rather than merely
 * unlikely — which is why this is the only safe thing for callers to display.
 */
export function cooldownSecondsLeft(deadlineMs: number | null, nowMs: number): number {
  if (deadlineMs === null) return 0;
  return Math.min(RESEND_COOLDOWN_SECONDS, secondsRemaining(deadlineMs, nowMs));
}

/** The cooldown is over exactly when nothing is left to wait for. */
export function canResend(secondsLeft: number): boolean {
  return secondsLeft <= 0;
}
