import type { TextColor } from '@/components/ui/text-variants';

// Pure logic for EmptyState — no react-native import, same pattern as
// button-state.ts/chip-state.ts, so it can be imported directly by
// empty-state.test.ts.

export type EmptyStateVariant = 'empty' | 'error';

export function getEmptyStateIconColor(variant: EmptyStateVariant): TextColor {
  return variant === 'error' ? 'danger' : 'textSecondary';
}

// Error variant announces itself (polite live region); plain empty states
// are not a dynamic event worth interrupting the screen reader for.
export function getEmptyStateAccessibilityLiveRegion(variant: EmptyStateVariant): 'polite' | 'none' {
  return variant === 'error' ? 'polite' : 'none';
}
