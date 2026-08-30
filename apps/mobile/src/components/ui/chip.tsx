import { Pressable, StyleSheet, View } from 'react-native';

import { getChipVisualState, type ChipProps } from '@/components/ui/chip-state';
import { Icon } from '@/components/ui/icon';
import { Text, type TextColor } from '@/components/ui/text';
import { radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

export type { ChipProps };
export { getChipVisualState };

export function Chip(props: ChipProps) {
  const { colors } = useAppTheme();
  const { label, disabled, icon } = props;
  const { interactive, emphasis } = getChipVisualState(props);
  const selected = emphasis === 'selected';

  // Selected: solid accent fill — one of DESIGN.md §3's four explicitly
  // sanctioned accent uses ("selected chips/filters"), not an interpretation
  // stretch. Unselected/static: quiet neutral surface with a hairline border.
  const textColor: TextColor = selected ? 'onAccent' : 'text';
  const iconColor = selected ? colors.onAccent : colors.text;

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
      backgroundColor: selected ? colors.accent : colors.bgSunken,
      borderRadius: radius.sm, // never radius.full — DESIGN.md §7 excludes pills for chips
      borderWidth: selected ? 0 : StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
  ];

  if (!props.selectable) {
    return <View style={[...baseStyle, { opacity: disabled ? 0.4 : 1 }]}>{content}</View>;
  }

  return (
    <Pressable
      onPress={props.onPress}
      disabled={!interactive}
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected, disabled }}
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
    paddingVertical: space[1],
  },
});
