import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import {
  BUTTON_TEXT_VARIANT,
  getButtonForegroundColor,
  getButtonOpacity,
  isButtonInteractive,
  type ButtonSize,
  type ButtonVariant,
} from '@/components/ui/button-state';
import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/design/theme-provider';
import { minTouchTarget, radius, space } from '@/design/tokens';
import type { SemanticColors } from '@/design/theme';

export type { ButtonSize, ButtonVariant };
export { getButtonForegroundColor, isButtonInteractive };

// 44pt is enforced via minHeight for every size, per DESIGN.md §13's literal
// wording for Button ("44pt enforced") — no size ever drops below the floor;
// sm/md/lg differentiate through padding and Text variant instead. Lives
// here, not in button-state.ts, since it needs tokens.ts's runtime values.
const BUTTON_MIN_HEIGHT: Record<ButtonSize, number> = { sm: minTouchTarget, md: 48, lg: 56 };
const BUTTON_HORIZONTAL_PADDING: Record<ButtonSize, number> = { sm: space[4], md: space[5], lg: space[6] };

export type ButtonProps = {
  children: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  onPress,
  disabled,
  loading,
  accessibilityLabel,
  style,
}: ButtonProps) {
  const { colors } = useAppTheme();
  const interactive = isButtonInteractive({ disabled, loading });
  const foregroundColor = getButtonForegroundColor(variant);

  return (
    <Pressable
      onPress={onPress}
      disabled={!interactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityState={{ disabled: !interactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: BUTTON_MIN_HEIGHT[size],
          paddingHorizontal: BUTTON_HORIZONTAL_PADDING[size],
          borderRadius: radius.md,
        },
        getVariantStyle({ variant, colors, pressed, disabled }),
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={colors[foregroundColor]} />
      ) : (
        <Text variant={BUTTON_TEXT_VARIANT[size]} color={foregroundColor}>
          {children}
        </Text>
      )}
    </Pressable>
  );
}

function getVariantStyle({
  variant,
  colors,
  pressed,
  disabled,
}: {
  variant: ButtonVariant;
  colors: SemanticColors;
  pressed: boolean;
  disabled?: boolean;
}): ViewStyle {
  const opacity = getButtonOpacity({ disabled, pressed, variant });

  switch (variant) {
    case 'primary':
      return { backgroundColor: pressed ? colors.accentPressed : colors.accent, opacity };
    case 'secondary':
      return {
        backgroundColor: colors.bgElevated,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.borderStrong,
        opacity,
      };
    case 'ghost':
      return { backgroundColor: 'transparent', opacity };
    case 'danger':
      return { backgroundColor: colors.danger, opacity };
  }
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
