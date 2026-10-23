import type { IconName } from '@/components/ui/icon';

// Pure logic + discriminated-union types for Chip — no runtime react-native
// import (the `IconName` import is type-only and gets erased), so this can
// be imported directly by chip.test.ts and chip.type-check.ts.

/**
 * A chip's resting surface — what it looks like when it is NOT
 * accent-selected.
 *
 * `inverse` is for a chip that represents something already COMMITTED and
 * dismissible, like Explore's active-filter tokens: the filter is in effect,
 * so the chip is a statement rather than an offer. `default`'s quiet neutral
 * surface reads as "available to pick", which is the wrong register for that.
 */
export type ChipTone = 'default' | 'inverse';

export type ChipBase = {
  label: string;
  disabled?: boolean;
  icon?: IconName;
  /** Resting surface; see `ChipTone`. Ignored while a selectable chip is selected. */
  tone?: ChipTone;
  /** Overrides the root element's accessible name; falls back to the label/icon-derived default otherwise. */
  accessibilityLabel?: string;
};

// A static chip's type has no onPress/selected fields at all — passing them
// is a compile error. `selectable` is optional here (defaulting to static)
// so `<Chip label="Very good" />` is valid without writing `selectable={false}`.
export type StaticChipProps = ChipBase & {
  selectable?: false;
  selected?: never;
  onPress?: never;
};

// A selectable chip requires both `selected` and `onPress` — a filter
// chip's selection state is always known, never optional.
export type SelectableChipProps = ChipBase & {
  selectable: true;
  selected: boolean;
  onPress: () => void;
};

export type ChipProps = StaticChipProps | SelectableChipProps;

export function getChipVisualState(props: ChipProps): {
  interactive: boolean;
  emphasis: 'selected' | 'default';
} {
  if (!props.selectable) return { interactive: false, emphasis: 'default' };
  return { interactive: !props.disabled, emphasis: props.selected ? 'selected' : 'default' };
}

/** The three surfaces a chip can paint. */
export type ChipSurface = 'selected' | 'inverse' | 'default';

/**
 * Resolves the chip's actual surface from its selection state and tone.
 *
 * Selection OUTRANKS tone, deliberately. The accent fill means "this is
 * selected" and is one of DESIGN.md §3's four sanctioned accent uses; tone
 * only describes how the chip rests. Letting `tone` win would produce a
 * selected chip that does not look selected, which is a correctness problem,
 * not a styling preference — so the combination resolves rather than being
 * left to whichever style object happens to be applied last.
 */
export function getChipSurface(props: ChipProps): ChipSurface {
  if (props.selectable && props.selected) return 'selected';
  return props.tone === 'inverse' ? 'inverse' : 'default';
}
