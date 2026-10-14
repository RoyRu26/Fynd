/**
 * Pure profile-editing logic.
 *
 * No react-native import of any kind — not even transitively through
 * `@/lib/supabase` — matching the same split every other feature uses for
 * the same reason: it's what makes this directly unit-testable.
 */

/**
 * Trims the input and collapses an empty/whitespace-only bio to `null`.
 *
 * `null` and "" mean the same thing to a user ("no bio") and there is no
 * reason to make the database the one place that distinction is enforced —
 * the `profiles_bio_length` CHECK constraint accepts an empty string, but
 * the client never sends one.
 */
export function normalizeBio(input: string): string | null {
  const trimmed = input.trim();
  return trimmed.length === 0 ? null : trimmed;
}
