import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';

export type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  /** Horizontal padding space[5] (20) — DESIGN.md §6's "spacious" density, the category every current consumer (auth/onboarding/Sell/Profile/detail) falls into. */
  padded?: boolean;
  keyboardAvoiding?: boolean;
  edges?: Edge[];
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
};

// Deliberately does not render <StatusBar> — system chrome is a root-layout/
// route-level concern (see src/app/_layout.tsx), not a layout primitive's job.
export function Screen({
  children,
  scroll = false,
  padded = true,
  keyboardAvoiding = false,
  edges = ['top', 'bottom'],
  contentContainerStyle,
  style,
}: ScreenProps) {
  const { colors } = useAppTheme();
  const paddingStyle = padded ? styles.padded : undefined;

  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[paddingStyle, contentContainerStyle]}
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, paddingStyle, contentContainerStyle]}>{children}</View>
  );

  const body = keyboardAvoiding ? (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {content}
    </KeyboardAvoidingView>
  ) : (
    content
  );

  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: colors.bg }, style]}>
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: space[5],
  },
});
