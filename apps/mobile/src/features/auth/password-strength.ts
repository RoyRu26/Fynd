import { MIN_PASSWORD_LENGTH } from '@/features/auth/schemas';

// Pure logic for the sign-up password meter. No react-native and no
// @/lib/supabase import, so it is unit-testable per CLAUDE.md's repo layout.

/**
 * Lengths at which each successive segment fills.
 *
 * Seeded from `MIN_PASSWORD_LENGTH` so the first segment lights up exactly
 * when the password becomes *acceptable* — the meter and the zod rule can
 * never disagree about where "valid" starts, which is the one alignment a user
 * can actually observe (bar empty but the form submits, or vice versa).
 */
const SEGMENT_THRESHOLDS = [
  MIN_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH + 2,
  MIN_PASSWORD_LENGTH + 4,
  MIN_PASSWORD_LENGTH + 6,
] as const;

/**
 * Segments in the meter. The design draws four, and these are those four —
 * DERIVED from the thresholds rather than declared alongside them, so the bar
 * can never have more segments than the scorer is able to fill (or fewer, and
 * silently cap).
 */
export const PASSWORD_METER_SEGMENTS = SEGMENT_THRESHOLDS.length;

/**
 * How many meter segments the password has earned, 0 to
 * `PASSWORD_METER_SEGMENTS`.
 *
 * **This measures length and nothing else.** It is not entropy, not a
 * dictionary check, and not a security assessment: "aaaaaaaaaaaa" fills every
 * segment. It exists to give the length rule continuous feedback instead of a
 * single pass/fail at submit, which is a usability affordance — so the copy
 * beside it states the length requirement outright rather than calling a full
 * bar "strong", and nothing in the app gates on this value.
 *
 * Real strength estimation needs a wordlist (zxcvbn-style) and a server-side
 * check to be worth anything; if that lands, this is the function to replace,
 * and the name should stop saying "length".
 */
export function getPasswordLengthScore(password: string): number {
  return SEGMENT_THRESHOLDS.filter((threshold) => password.length >= threshold).length;
}

/**
 * The helper line under the field.
 *
 * Derived from `MIN_PASSWORD_LENGTH` rather than written out, so the copy
 * cannot drift from the rule it describes — the handoff's own mock said "At
 * least 8 characters" against a 6-character rule, which is exactly the drift
 * this prevents.
 */
export const PASSWORD_HELPER_TEXT = `At least ${MIN_PASSWORD_LENGTH} characters`;
