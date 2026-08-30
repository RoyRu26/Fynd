import type { TextColor, TextVariant } from '@/components/ui/text-variants';

// Pure logic for Button — no runtime import of any kind (not even
// @/design/tokens, which itself imports react-native at runtime and would
// transitively break the test runner's transform; see text-variants.ts for
// the full explanation). Size-to-pixel lookup tables live in button.tsx
// instead, which is free to import tokens.ts since it's never imported by a
// test file.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export const DISABLED_OPACITY = 0.4;

// `loading` forces non-interactive even when `disabled` is otherwise false —
// this is the one piece of Button's behavior worth locking down with a test
// independent of rendering.
export function isButtonInteractive({
  disabled,
  loading,
}: {
  disabled?: boolean;
  loading?: boolean;
}): boolean {
  return !disabled && !loading;
}

// Single source of truth for a variant's foreground color. Both the label
// Text and the loading ActivityIndicator read from this — they can never
// drift apart, and danger's foreground can never accidentally end up
// coupled to accent's just because the two currently share a hex value.
export function getButtonForegroundColor(variant: ButtonVariant): TextColor {
  switch (variant) {
    case 'primary':
      return 'onAccent';
    case 'secondary':
      return 'text';
    case 'ghost':
      return 'accentText';
    case 'danger':
      return 'onDanger';
  }
}

// Disabled always wins regardless of press state; primary never dims on
// press because it signals press via a background-color swap
// (accent -> accentPressed) instead of opacity, unlike every other variant.
export function getButtonOpacity({
  disabled,
  pressed,
  variant,
}: {
  disabled?: boolean;
  pressed: boolean;
  variant: ButtonVariant;
}): number {
  if (disabled) return DISABLED_OPACITY;
  if (variant === 'primary') return 1;
  return pressed ? 0.7 : 1;
}

export const BUTTON_TEXT_VARIANT: Record<ButtonSize, TextVariant> = {
  sm: 'label',
  md: 'bodyStrong',
  lg: 'bodyStrong',
};
