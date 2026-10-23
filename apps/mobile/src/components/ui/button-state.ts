import type { TextColor, TextVariant } from '@/components/ui/text-variants';

// Pure logic for Button — no runtime import of any kind (not even
// @/design/tokens, which itself imports react-native at runtime and would
// transitively break the test runner's transform; see text-variants.ts for
// the full explanation). Size-to-pixel lookup tables live in button.tsx
// instead, which is free to import tokens.ts since it's never imported by a
// test file.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'inverse';
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
//
// `danger` reads `'danger'` (ink-on-tonal-fill), NOT `'onDanger'`
// (white-on-solid-fill): DESIGN.md §8's destructive-action rule requires
// every destructive control to be outlined/tonal, "NEVER solid-filled,"
// structurally distinct from `primary`'s solid fill so the distinction
// never depends on color vision alone (§12.4). `onDanger` exists for a
// solid-fill foreground that this variant deliberately does not use —
// see button.tsx's matching `getVariantStyle` case for the tonal
// `dangerBg` fill + `danger` border this pairs with. ROADMAP 6.1b's
// "Delete account" is this variant's first real consumer, which is what
// makes landing the compliant treatment now (rather than later) a
// prerequisite, exactly as DESIGN.md's own §8 note calls for.
export function getButtonForegroundColor(variant: ButtonVariant): TextColor {
  switch (variant) {
    case 'primary':
      return 'onAccent';
    case 'secondary':
      return 'text';
    case 'ghost':
      return 'accentText';
    case 'danger':
      return 'danger';
    // The one variant whose fill is a neutral EXTREME rather than a surface
    // or an accent: `bgInverse` flips with the scheme (near-black on paper,
    // paper on near-black), and `textInverse` flips with it in lockstep, so
    // the pair is contrast-correct in both schemes by construction. Note the
    // consequence callers must accept: this is "the opposite of the current
    // background," not "black" — in dark mode it is a cream button. Anything
    // that must stay literally dark in both schemes is NOT this variant.
    case 'inverse':
      return 'textInverse';
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

// The top/bottom bevel highlight is primary-only (secondary/danger have
// their own treatment or none yet — see DESIGN.md's button-bevel note) and
// disappears while pressed, simulating the surface compressing under touch.
// A named, tested function rather than an inline check so extending the
// bevel to another variant later is a deliberate decision, not a silent
// side effect of some other change.
export function shouldShowButtonBevel({
  variant,
  pressed,
}: {
  variant: ButtonVariant;
  pressed: boolean;
}): boolean {
  return variant === 'primary' && !pressed;
}
