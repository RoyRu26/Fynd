import type { IconName } from '@/components/ui/icon';

// Pure logic + discriminated-union types for Chip — no runtime react-native
// import (the `IconName` import is type-only and gets erased), so this can
// be imported directly by chip.test.ts and chip.type-check.ts.

export type ChipBase = {
  label: string;
  disabled?: boolean;
  icon?: IconName;
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
