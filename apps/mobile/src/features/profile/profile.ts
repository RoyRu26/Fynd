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

/**
 * The Profile tab's "24 listings · 318 followers · 96 following" line
 * (SCREENS.md Task 7). Each count is independently omittable — `null` means
 * "not loaded yet, or not implemented," which the handoff itself calls out
 * ("hide follow counts if not implemented"); this just makes "hide" literal
 * rather than printing "null" or "0" for a count the screen never resolved.
 * `null` overall (not `''`) when every count is missing, so the caller can
 * skip rendering the line's container entirely rather than rendering an
 * empty one.
 */
export function formatProfileSummaryLine(counts: {
  listingCount: number | null;
  followersCount: number | null;
  followingCount: number | null;
}): string | null {
  const parts: string[] = [];
  if (counts.listingCount !== null) {
    parts.push(counts.listingCount === 1 ? '1 listing' : `${counts.listingCount} listings`);
  }
  if (counts.followersCount !== null) {
    parts.push(counts.followersCount === 1 ? '1 follower' : `${counts.followersCount} followers`);
  }
  if (counts.followingCount !== null) {
    parts.push(counts.followingCount === 1 ? '1 following' : `${counts.followingCount} following`);
  }
  return parts.length === 0 ? null : parts.join(' · ');
}

/** The native share sheet's message for "Share closet". No URL: there is no public web presence or universal link to share yet, and a fabricated one nobody could open would be worse than text alone. */
export function formatClosetShareMessage(name: string): string {
  return `Check out ${name}'s closet on Fynd!`;
}
