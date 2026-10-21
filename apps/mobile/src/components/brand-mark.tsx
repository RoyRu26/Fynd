import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

import { useAppTheme } from '@/design/theme-provider';

// The real Fynd logo (icon mark + "fynd" wordmark lockup), replacing the
// `wordmark` Text variant on the ambient-background screens (Sign In, Sign
// Up, profile onboarding — DESIGN.md §4a's own list of where that
// background appears). Two flat-color source files, not one recolored at
// runtime: `logo.png` (olive, for light backgrounds) and
// `splash-logo-dark.png` (oat/cream, for dark) are the same pair already
// wired into app.json's splash screen config for light/dark, so this reuses
// them rather than introducing a third variant.
const LOGO_LIGHT = require('@/assets/images/logo.png');
const LOGO_DARK = require('@/assets/images/splash-logo-dark.png');

// Source art is 491x228 (~2.15:1). Sized by height, not a hand-picked
// width, so the aspect ratio can never drift out of sync with the asset.
const SOURCE_ASPECT_RATIO = 491 / 228;
const HEIGHT = 32;

export function BrandMark() {
  const { scheme } = useAppTheme();

  return (
    <Image
      source={scheme === 'dark' ? LOGO_DARK : LOGO_LIGHT}
      accessible
      accessibilityLabel="Fynd"
      contentFit="contain"
      style={styles.image}
    />
  );
}

const styles = StyleSheet.create({
  image: {
    height: HEIGHT,
    width: HEIGHT * SOURCE_ASPECT_RATIO,
  },
});
