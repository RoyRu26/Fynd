import { Pressable, StyleSheet } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import type { TextColor } from '@/components/ui/text-variants';
import { iconSize, minTouchTarget } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

export type IconButtonVariant = 'neutral' | 'onMedia';

export type IconButtonProps = {
  icon: IconName;
  accessibilityLabel: string;
  onPress: () => void;
  size?: keyof typeof iconSize;
  variant?: IconButtonVariant;
  /** Tints the icon accentText when true; pass `color` for a different selected hue (e.g. favoriting). */
  selected?: boolean;
  disabled?: boolean;
  color?: TextColor;
};

// Small internal padding around the icon — the visual box is sized to the
// icon, not forced to a full 44pt (which would look oversized around a
// 16-28px icon). hitSlop makes up the difference to reach the 44pt target.
const VISUAL_BOX_PADDING = 8;

export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  size = 'md',
  variant = 'neutral',
  selected,
  disabled,
  color,
}: IconButtonProps) {
  const { colors } = useAppTheme();
  const visualBoxSize = iconSize[size] + VISUAL_BOX_PADDING * 2;
  const hitSlopValue = Math.max(0, (minTouchTarget - visualBoxSize) / 2);

  // onMedia's own scrim is dark regardless of scheme, so its default tint
  // must be textOnMedia (white), never `text` — `text` is near-black in
  // light mode and would be unreadable against the scrim.
  const defaultColor: TextColor = selected ? 'accentText' : variant === 'onMedia' ? 'textOnMedia' : 'text';
  const tintColor = colors[color ?? defaultColor];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected }}
      hitSlop={hitSlopValue}
      style={({ pressed }) => [
        styles.box,
        {
          width: visualBoxSize,
          height: visualBoxSize,
          borderRadius: visualBoxSize / 2,
          backgroundColor: variant === 'onMedia' ? colors.overlayScrim : 'transparent',
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}>
      <Icon name={icon} size={size} color={tintColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
