import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui/text';
import { getFieldBorderStyle, getFieldMessage } from '@/components/ui/text-field-state';
import { border, elevation, radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

export type TextFieldProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  label?: string;
  helperText?: string;
  error?: string;
  disabled?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
};

// No react-hook-form import anywhere in this file. `value`/`onChangeText`/
// `onBlur` (via the spread TextInputProps) are exactly what RHF's
// Controller's `field` object already provides, so wiring is
// <Controller render={({ field, fieldState }) => <TextField value={field.value}
// onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} />} />
// with zero coupling.
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, helperText, error, disabled, containerStyle, onFocus, onBlur, editable, ...inputProps },
  ref,
) {
  const { colors } = useAppTheme();
  const [focused, setFocused] = useState(false);

  const message = getFieldMessage({ error, helperText });
  const fieldBorder = getFieldBorderStyle({ focused, hasError: Boolean(error) });
  const borderWidth = fieldBorder.width === 'thick' ? border.thick : border.thin;

  // RN has no reliable cross-platform aria-describedby equivalent for
  // TextInput, so the practical way to associate the error with the field
  // for screen readers is to fold it into the accessibilityLabel itself.
  const accessibilityLabel = [label, error].filter(Boolean).join(', ') || undefined;

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text variant="label" color="textSecondary">
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        editable={disabled ? false : editable}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        placeholderTextColor={colors.textTertiary}
        style={[
          styles.input,
          elevation.raised,
          {
            color: colors.text,
            backgroundColor: colors.bgElevated,
            borderWidth,
            borderColor: colors[fieldBorder.colorKey],
            borderRadius: radius.md,
            opacity: disabled ? 0.4 : 1,
          },
        ]}
        {...inputProps}
      />
      {message ? (
        <Text variant="caption" color={message.tone === 'error' ? 'danger' : 'textTertiary'}>
          {message.text}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: space[1],
  },
  input: {
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
});
