// Pure logic for ReactionPill — no runtime import, directly unit-testable.

/**
 * The pill's accessible name.
 *
 * Extracted rather than inlined because it is the component's only real
 * behaviour, and because the singular case is easy to get wrong in a way
 * nothing catches: the glyph carries no meaning to a screen reader, so this
 * string is the ENTIRE announcement. "1 saves" is the kind of wrong that ships.
 */
export function getReactionPillLabel(count: number): string {
  return `${count} ${count === 1 ? 'save' : 'saves'}`;
}
