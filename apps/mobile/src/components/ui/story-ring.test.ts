import { describe, expect, it } from 'vitest';

import {
  getStoryRingMetrics,
  STORY_RING_GAP,
  STORY_RING_WIDTH,
} from '@/components/ui/story-ring-state';

describe('getStoryRingMetrics', () => {
  it('treats size as the OUTER diameter', () => {
    expect(getStoryRingMetrics({ size: 64, active: false }).outerSize).toBe(64);
    expect(getStoryRingMetrics({ size: 64, active: true }).outerSize).toBe(64);
  });

  // The property the whole inward-growing design exists for: selecting a ring
  // must not resize it, or the row shifts as selection moves along it.
  it('keeps the outer diameter identical across states, growing inward instead', () => {
    const inactive = getStoryRingMetrics({ size: 64, active: false });
    const active = getStoryRingMetrics({ size: 64, active: true });

    expect(active.outerSize).toBe(inactive.outerSize);
    expect(active.imageSize).toBeLessThan(inactive.imageSize);
  });

  it('uses the thicker stroke when active', () => {
    expect(getStoryRingMetrics({ size: 64, active: true }).ringWidth).toBe(STORY_RING_WIDTH.active);
    expect(getStoryRingMetrics({ size: 64, active: false }).ringWidth).toBe(
      STORY_RING_WIDTH.inactive,
    );
  });

  it('subtracts both the stroke and the gap from each side of the image', () => {
    const { imageSize } = getStoryRingMetrics({ size: 64, active: true });
    expect(imageSize).toBe(64 - (STORY_RING_WIDTH.active + STORY_RING_GAP) * 2);
  });

  it('derives both radii as half their diameters, so nothing renders as a square', () => {
    const metrics = getStoryRingMetrics({ size: 64, active: false });
    expect(metrics.outerRadius).toBe(metrics.outerSize / 2);
    expect(metrics.imageRadius).toBe(metrics.imageSize / 2);
  });

  // react-native rejects negative dimensions, so a too-small size has to
  // degrade rather than throw at render time.
  it('clamps the image at zero instead of going negative', () => {
    expect(getStoryRingMetrics({ size: 4, active: true }).imageSize).toBe(0);
    expect(getStoryRingMetrics({ size: 0, active: true }).imageSize).toBe(0);
  });

  it('states differ by thickness as well as colour, so active survives a greyscale reading', () => {
    expect(STORY_RING_WIDTH.active).toBeGreaterThan(STORY_RING_WIDTH.inactive);
  });
});
