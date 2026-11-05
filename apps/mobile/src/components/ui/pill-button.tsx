import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import {
  getPillButtonForegroundColor,
  getPillButtonOpacity,
  PILL_BUTTON_HEIGHT,
  type PillButtonVariant,
} from '@/components/ui/pill-button-state';
import { Text } from '@/components/ui/text';
import { isButtonInteractive } from '@/components/ui/button-state';
import { border, radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import type { SemanticColors } from '@/design/theme';

/**
 * The fill per variant, as a plain `switch` rather than the nested ternary
 * this used to be — one case per variant, same clarity
 * `getPillButtonForegroundColor` already has. Lives here, not in
 * pill-button-state.ts, because it needs resolved theme colors and a border
 * token: that file is deliberately import-free (see its own header) so it
 * stays testable without React Native.
 */
function getPillButtonFillStyle({
  variant,
  pressed,
  colors,
}: {
  variant: PillButtonVariant;
  pressed: boolean;
  colors: SemanticColors;
}): ViewStyle {
  switch (variant) {
    case 'primary':
      return { backgroundColor: pressed ? colors.accentPressed : colors.accent };
    case 'inverse':
      // Solid and borderless, same reasoning as Button's own inverse
      // variant: the fill is already the highest-contrast surface
      // available, so it needs no stroke to separate it from the page.
      return { backgroundColor: colors.bgInverse };
    case 'outline':
      return { backgroundColor: 'transparent', borderWidth: border.thin, borderColor: colors.borderStrong };
  }
}

export type { PillButtonVariant };

export type PillButtonProps = {
  children: string;
  variant?: PillButtonVariant;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * A full-radius 46pt button (DESIGN.md §7's pill carve-out).
 *
 * Separate from `Button` rather than a variant of it because the difference is
 * SHAPE, not emphasis: `Button` is the app's crisp `radius.md` control and its
 * sizes, bevel and radius all assume that. Mixing both shapes behind one
 * component would make "which shape am I getting" depend on an unrelated prop.
 *
 * It deliberately reuses `Button`'s own `isButtonInteractive`, so `loading`
 * forcing non-interactive cannot drift between the two.
 */
export function PillButton({
  children,
  variant = 'primary',
  onPress,
  disabled,
  loading,
  accessibilityLabel,
  style,
}: PillButtonProps) {
  const { colors } = useAppTheme();
  const interactive = isButtonInteractive({ disabled, loading });
  const foregroundColor = getPillButtonForegroundColor(variant);

  return (
    <Pressable
      onPress={onPress}
      disabled={!interactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityState={{ disabled: !interactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        getPillButtonFillStyle({ variant, pressed, colors }),
        { opacity: getPillButtonOpacity({ disabled, pressed, variant }) },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={colors[foregroundColor]} />
      ) : (
        <Text variant="bodyStrong" color={foregroundColor}>
          {children}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    // `minHeight`, never a fixed `height` — the label scales with Dynamic
    // Type and a rigid box clips it. `Button` uses minHeight for the same
    // reason, and `radius.full` clamps to half the RENDERED height, so the
    // ends stay true semicircles however tall the button grows.
    minHeight: PILL_BUTTON_HEIGHT,
    paddingHorizontal: space[6],
    paddingVertical: space[1],
    // `radius.full` clamps to half the height, which is what makes the ends
    // true semicircles at any width.
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
});
