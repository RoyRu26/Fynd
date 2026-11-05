import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Text, TextField, type TextFieldProps } from '@/components/ui';
import { minTouchTarget, space } from '@/design/tokens';

/**
 * A `TextField` that masks its value, with an in-field reveal toggle.
 *
 * Exists because three fields need it (sign-in's password, sign-up's password
 * and confirmation) and the toggle carries obligations that are easy to get
 * subtly wrong — the accessible name has to change with the state, and the
 * control must not take focus. Encoding both once beats repeating them.
 *
 * A text toggle rather than an eye icon, per the design: "Show"/"Hide" states
 * what will happen without relying on a glyph convention, and reads at a
 * glance in the ~40px the field has to spare.
 */
export type PasswordFieldProps = Omit<TextFieldProps, 'secureTextEntry' | 'trailing' | 'leading'>;

export function PasswordField(props: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <TextField
      {...props}
      secureTextEntry={!revealed}
      trailing={
        <Pressable
          onPress={() => setRevealed((current) => !current)}
          accessibilityRole="button"
          // Names the ACTION, not the state — a button labelled "Show" that
          // currently shows the password would be read backwards. The label
          // flips with `revealed` so it always describes the next tap.
          accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
          // Deliberately NOT focusable={false}: touch does not move view
          // focus on either platform (Android needs focusableInTouchMode, iOS
          // has no equivalent), so this cannot steal focus from the input and
          // cannot flicker its focus ring. Setting it would only cost
          // D-pad/hardware-keyboard reachability for no benefit.
          style={styles.toggle}>
          <Text variant="label" color="accentText">
            {revealed ? 'Hide' : 'Show'}
          </Text>
        </Pressable>
      }
    />
  );
}

const styles = StyleSheet.create({
  toggle: {
    // Explicit 44x44 rather than hitSlop: slop here would spill left over the
    // input and swallow taps meant to place the caret at the end of the text.
    //
    // `minWidth` is not redundant with the padding. "Hide" is ~4pt narrower
    // than "Show" at this variant, so without a floor the target both fell
    // under 44pt and CHANGED WIDTH on every toggle, shifting the input's right
    // edge. Centring inside the fixed box is what keeps the label still.
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[1],
  },
});
