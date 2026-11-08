import { Switch as RNSwitch } from 'react-native';

import { useAppTheme } from '@/design/theme-provider';

export type SwitchProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  /** Required -- a bare switch has no visible label of its own, same contract as StarRating's `accessibilityLabel`. */
  accessibilityLabel: string;
};

/**
 * A controlled on/off toggle (DESIGN.md §13). A thin, tokenizing wrapper
 * around React Native's own `Switch`, not a hand-rolled reanimated
 * component -- an earlier version of this file built the track/thumb from
 * scratch, which review correctly flagged as both an unjustified §15 rule-2
 * "new primitive for one caller" (the Settings screen's three toggle rows
 * are one caller, not a second distinct one) and unnecessary: the native
 * control already supports tokenized colors via `trackColor`/`thumbColor`,
 * already animates its own thumb natively, and already clears each
 * platform's own touch-target guideline on its own (no `hitSlop` needed,
 * unlike StarRating/Chip which sit on custom-drawn hit areas smaller than
 * 44pt). This wrapper exists only so every caller gets the same semantic
 * tokens rather than each hand-specifying `trackColor`/`thumbColor` --
 * DESIGN.md §15 rule 4's "take the first solution that works," applied
 * literally.
 *
 * `accessibilityRole`/`accessibilityState` are set explicitly rather than
 * left to RN's own defaults, matching every other primitive in this
 * codebase (e.g. Chip, IconButton) that states its accessibility contract
 * directly instead of relying on implicit platform behavior.
 */
export function Switch({ value, onValueChange, disabled, accessibilityLabel }: SwitchProps) {
  const { colors } = useAppTheme();

  return (
    <RNSwitch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: colors.borderStrong, true: colors.accent }}
      thumbColor={colors.switchThumb}
      ios_backgroundColor={colors.borderStrong}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
    />
  );
}
