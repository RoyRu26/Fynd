// Pure numeric drag-dismiss logic for Sheet — no react-native import, same
// pattern as button-state.ts, so it can be imported directly by
// sheet.test.ts. shouldDismissSheetOnRelease/clampSheetDragTranslation also
// run on the UI thread, called from Sheet's pan-gesture worklet callbacks —
// hence the 'worklet' directives, which are no-ops here under Vitest/Node
// (a directive prologue is just a string-literal statement) but let
// Reanimated's Babel plugin compile these for worklet execution.

export const DRAG_DISMISS_VELOCITY_THRESHOLD = 800; // px/s downward
export const DRAG_DISMISS_DISTANCE_RATIO = 0.3; // fraction of sheet height

export function shouldDismissSheetOnRelease({
  translationY,
  velocityY,
  sheetHeight,
}: {
  translationY: number;
  velocityY: number;
  sheetHeight: number;
}): boolean {
  'worklet';
  if (sheetHeight <= 0) return false;
  if (velocityY >= DRAG_DISMISS_VELOCITY_THRESHOLD) return true;
  return translationY >= sheetHeight * DRAG_DISMISS_DISTANCE_RATIO;
}

// Never negative, no upward overdrag — the sheet can be dragged down to
// dismiss but never pulled up past its resting position.
export function clampSheetDragTranslation(translationY: number): number {
  'worklet';
  return Math.max(0, translationY);
}
