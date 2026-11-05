import { Pressable, StyleSheet, View } from 'react-native';

import {
  getChipHitSlop,
  getChipSurface,
  getChipVisualState,
  type ChipProps,
  type ChipTone,
} from '@/components/ui/chip-state';
import { Icon } from '@/components/ui/icon';
import { Text, type TextColor } from '@/components/ui/text';
import { textVariantStyles } from '@/components/ui/text-variants';
import { minTouchTarget, radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

export type { ChipProps, ChipTone };
export { getChipHitSlop, getChipSurface, getChipVisualState };

const CHIP_PADDING_VERTICAL = space[1];

// Resting visual height, derived from the tokens that produce it (the `label`
// line box plus vertical padding) rather than measured, so the slop is known
// on the first render. Vertical only — see getChipHitSlop.
const CHIP_HIT_SLOP = getChipHitSlop(
  (textVariantStyles.label.lineHeight ?? 0) + CHIP_PADDING_VERTICAL * 2,
  minTouchTarget,
);

export function Chip(props: ChipProps) {
  const { colors } = useAppTheme();
  const { label, disabled, icon, accessibilityLabel } = props;
  const { interactive } = getChipVisualState(props);
  const surface = getChipSurface(props);

  // Selected: solid accent fill — one of DESIGN.md §3's four explicitly
  // sanctioned accent uses ("selected chips/filters"), not an interpretation
  // stretch. Inverse: the neutral extreme, for a committed/dismissible token
  // (see ChipTone). Default: quiet neutral surface with a hairline border.
  const textColor: TextColor =
    surface === 'selected' ? 'onAccent' : surface === 'inverse' ? 'textInverse' : 'text';
  const iconColor = colors[textColor];
  const backgroundColor =
    surface === 'selected' ? colors.accent : surface === 'inverse' ? colors.bgInverse : colors.bgSunken;

  const content = (
    <>
      {icon ? <Icon name={icon} size="sm" color={iconColor} /> : null}
      <Text variant="label" color={textColor}>
        {label}
      </Text>
    </>
  );

  const baseStyle = [
    styles.base,
    {
      backgroundColor,
      borderRadius: radius.sm, // never radius.full — DESIGN.md §7 excludes pills for chips
      // Only the quiet default surface needs a stroke to separate it from the
      // page; both filled surfaces already carry their own edge.
      borderWidth: surface === 'default' ? StyleSheet.hairlineWidth : 0,
      borderColor: colors.border,
    },
  ];

  if (!props.selectable) {
    return (
      <View accessibilityLabel={accessibilityLabel} style={[...baseStyle, { opacity: disabled ? 0.4 : 1 }]}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={props.onPress}
      disabled={!interactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: props.selected, disabled }}
      hitSlop={CHIP_HIT_SLOP}
      style={({ pressed }) => [...baseStyle, { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space[1],
    paddingHorizontal: space[3],
    paddingVertical: CHIP_PADDING_VERTICAL,
  },
});
