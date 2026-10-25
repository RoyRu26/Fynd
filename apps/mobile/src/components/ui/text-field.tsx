import { forwardRef, useCallback, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { Text } from '@/components/ui/text';
import {
  getFieldBorderStyle,
  getFieldMessage,
  getFieldRowAlignment,
  type FieldShape,
} from '@/components/ui/text-field-state';
import { border, elevation, radius, space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

export type TextFieldProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  label?: string;
  helperText?: string;
  error?: string;
  disabled?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  /** Outline treatment; see `FieldShape`. Defaults to the app's standard `box`. */
  shape?: FieldShape;
  /**
   * Rendered inside the field's stroke, before the input — a `@` prefix, a
   * currency symbol, a search glyph.
   *
   * Static adornments only. It sits where users tap to focus the field, so an
   * interactive element here would compete with that; put controls in
   * `trailing` instead.
   *
   * Must be hidden from assistive tech (`accessible={false}` plus
   * `importantForAccessibility="no"`). An RN `Text` is an accessibility
   * element by default, so a bare "@" becomes its own stop immediately before
   * the input — announcing a symbol the field's label already implies.
   */
  leading?: ReactNode;
  /**
   * Rendered inside the field's stroke, after the input — a Show/Hide
   * password toggle, a clear button.
   *
   * One obligation on the caller that this component cannot enforce: give the
   * control its own `accessibilityLabel`. The field's label is folded into the
   * input's own label (see below), so an unlabelled child announces as
   * nothing.
   *
   * Sizing is the caller's job too — the row gives an accessory only as much
   * space as it asks for, so a bare text label needs `minWidth`/`minHeight` to
   * reach the 44pt floor (DESIGN.md §12 rule 1).
   */
  trailing?: ReactNode;
};

// No react-hook-form import anywhere in this file. `value`/`onChangeText`/
// `onBlur` (via the spread TextInputProps) are exactly what RHF's
// Controller's `field` object already provides, so wiring is
// <Controller render={({ field, fieldState }) => <TextField value={field.value}
// onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} />} />
// with zero coupling.
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    label,
    helperText,
    error,
    disabled,
    containerStyle,
    shape = 'box',
    leading,
    trailing,
    onFocus,
    onBlur,
    editable,
    ...inputProps
  },
  ref,
) {
  const { colors } = useAppTheme();
  const [focused, setFocused] = useState(false);

  // Kept alongside the forwarded ref so the row can focus the input on press
  // (see the Pressable below). Merged rather than replaced — callers that pass
  // a ref for imperative focus still get it.
  const inputRef = useRef<TextInput | null>(null);
  const setInputRef = useCallback(
    (node: TextInput | null) => {
      inputRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref],
  );

  const message = getFieldMessage({ error, helperText });
  const fieldBorder = getFieldBorderStyle({ focused, hasError: Boolean(error), shape });
  const borderWidth = fieldBorder.width === 'thick' ? border.thick : border.thin;
  const rowAlignment = getFieldRowAlignment({ multiline: inputProps.multiline });

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
      {/*
        The box decoration (fill, stroke, radius, elevation, horizontal
        padding) lives on this row rather than on the TextInput, which is what
        lets `leading`/`trailing` sit INSIDE the stroke. The input keeps only
        its text color and vertical padding, and flexes to fill whatever the
        accessories leave. Android note: `elevation` needs a backgroundColor on
        the same view, so the two have to travel together — they do.

        It MUST be a Pressable, not a View. Moving the horizontal padding off
        the TextInput took those two 16pt strips out of the input's own touch
        area, and a plain View is not a responder — so a tap just inside the
        stroke would miss the input entirely. It would not merely do nothing
        either: `Screen`'s ScrollView uses keyboardShouldPersistTaps="handled",
        under which an UNHANDLED tap dismisses the keyboard, so tapping inside
        a focused field's own border would blur it. Forwarding the press to
        focus() restores the pre-refactor behaviour that the whole visible box
        focuses the field.

        `accessible={false}` keeps this from becoming a second AT node in front
        of the input it exists to serve.
      */}
      <Pressable
        accessible={false}
        onPress={() => inputRef.current?.focus()}
        style={[
          styles.field,
          elevation.raised,
          {
            alignItems: rowAlignment,
            backgroundColor: colors.bgElevated,
            borderWidth,
            borderColor: colors[fieldBorder.colorKey],
            // `radius.full` clamps to half the rendered height, so a pill's
            // ends stay true semicircles however tall the row grows.
            borderRadius: shape === 'pill' ? radius.full : radius.md,
            opacity: disabled ? 0.4 : 1,
          },
        ]}>
        {leading}
        <TextInput
          ref={setInputRef}
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
          style={[styles.input, { color: colors.text }]}
          {...inputProps}
        />
        {trailing}
      </Pressable>
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
  field: {
    flexDirection: 'row',
    paddingHorizontal: space[4],
    // Only separates accessories from the input, so a row with no leading or
    // trailing child renders identically to the pre-slot layout. Note that is
    // a claim about PIXELS only — the hit-testing difference is what the
    // Pressable above exists to undo.
    gap: space[2],
  },
  input: {
    flex: 1,
    paddingVertical: space[3],
  },
});
