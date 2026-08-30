import { Text as RNText, type StyleProp, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import {
  textVariantFace,
  textVariantStyles,
  type TextColor,
  type TextFace,
  type TextVariant,
} from '@/components/ui/text-variants';
import { fontFamily } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

export type { TextColor, TextVariant };

export type TextProps = Omit<RNTextProps, 'style'> & {
  variant?: TextVariant;
  color?: TextColor;
  style?: StyleProp<TextStyle>;
};

const FACE_FONT_FAMILY: Record<TextFace, string | undefined> = {
  displaySemiBold: fontFamily.displaySemiBold,
  displayBold: fontFamily.displayBold,
  system: undefined,
  systemMono: fontFamily.mono,
};

export function Text({ variant = 'body', color = 'text', style, ...rest }: TextProps) {
  const { colors } = useAppTheme();
  const fontFamilyForVariant = FACE_FONT_FAMILY[textVariantFace[variant]];

  return (
    <RNText
      style={[
        textVariantStyles[variant],
        fontFamilyForVariant ? { fontFamily: fontFamilyForVariant } : null,
        { color: colors[color] },
        style,
      ]}
      {...rest}
    />
  );
}
