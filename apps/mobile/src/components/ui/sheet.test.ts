import { describe, expect, it } from 'vitest';

import {
  clampSheetDragTranslation,
  DRAG_DISMISS_DISTANCE_RATIO,
  DRAG_DISMISS_VELOCITY_THRESHOLD,
  shouldDismissSheetOnRelease,
} from '@/components/ui/sheet-state';

describe('clampSheetDragTranslation', () => {
  it('passes through a positive (downward) translation unchanged', () => {
    expect(clampSheetDragTranslation(120)).toBe(120);
  });

  it('clamps a negative (upward overdrag) translation to 0', () => {
    expect(clampSheetDragTranslation(-40)).toBe(0);
  });

  it('leaves exactly 0 as 0', () => {
    expect(clampSheetDragTranslation(0)).toBe(0);
  });
});

describe('shouldDismissSheetOnRelease', () => {
  it('dismisses on a fast downward flick even with little distance travelled', () => {
    expect(
      shouldDismissSheetOnRelease({ translationY: 10, velocityY: DRAG_DISMISS_VELOCITY_THRESHOLD, sheetHeight: 500 }),
    ).toBe(true);
  });

  it('dismisses when dragged past the distance ratio even at low velocity', () => {
    expect(
      shouldDismissSheetOnRelease({
        translationY: 500 * DRAG_DISMISS_DISTANCE_RATIO,
        velocityY: 0,
        sheetHeight: 500,
      }),
    ).toBe(true);
  });

  it('snaps back when neither threshold is met', () => {
    expect(shouldDismissSheetOnRelease({ translationY: 50, velocityY: 100, sheetHeight: 500 })).toBe(false);
  });

  it('never dismisses when sheetHeight is not yet known (0 or negative)', () => {
    expect(shouldDismissSheetOnRelease({ translationY: 1000, velocityY: 2000, sheetHeight: 0 })).toBe(false);
    expect(shouldDismissSheetOnRelease({ translationY: 1000, velocityY: 2000, sheetHeight: -10 })).toBe(false);
  });

  it('is exact at the distance ratio boundary (>=)', () => {
    const sheetHeight = 400;
    const boundary = sheetHeight * DRAG_DISMISS_DISTANCE_RATIO;
    expect(shouldDismissSheetOnRelease({ translationY: boundary, velocityY: 0, sheetHeight })).toBe(true);
    expect(shouldDismissSheetOnRelease({ translationY: boundary - 1, velocityY: 0, sheetHeight })).toBe(false);
  });
});
