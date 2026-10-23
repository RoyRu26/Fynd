// Pure logic for StoryRing — no runtime import of any kind, so it is directly
// unit-testable (same split as button-state.ts / chip-state.ts).

/** Ring stroke widths. Active is thicker as well as accent-coloured, so the state never rests on hue alone (DESIGN.md §12.4). */
export const STORY_RING_WIDTH = { active: 2.5, inactive: 1.5 } as const;

/** Breathing room between the ring and the image it encircles. */
export const STORY_RING_GAP = 3;

export type StoryRingMetrics = {
  /** Outer diameter — what the caller asked for. */
  outerSize: number;
  outerRadius: number;
  ringWidth: number;
  gap: number;
  /** Diameter of the image inside the ring. */
  imageSize: number;
  imageRadius: number;
};

/**
 * Resolves the ring's geometry from one `size`.
 *
 * `size` is the OUTER diameter, so a row of rings aligns on its outer edge
 * regardless of active state — the alternative (sizing the image and growing
 * outward) would make an active ring 2pt larger than its neighbours and shift
 * the whole row as selection moves.
 *
 * The image therefore absorbs the difference: it shrinks by twice the ring
 * width plus twice the gap. At the sizes this is used at (64pt) that is a
 * couple of points, invisible against the benefit of a stable row.
 *
 * Clamped at zero so an absurdly small `size` yields a degenerate-but-valid
 * ring rather than a negative dimension, which react-native would reject.
 */
export function getStoryRingMetrics({
  size,
  active,
}: {
  size: number;
  active: boolean;
}): StoryRingMetrics {
  const ringWidth = active ? STORY_RING_WIDTH.active : STORY_RING_WIDTH.inactive;
  const imageSize = Math.max(0, size - (ringWidth + STORY_RING_GAP) * 2);

  return {
    outerSize: size,
    outerRadius: size / 2,
    ringWidth,
    gap: STORY_RING_GAP,
    imageSize,
    imageRadius: imageSize / 2,
  };
}
