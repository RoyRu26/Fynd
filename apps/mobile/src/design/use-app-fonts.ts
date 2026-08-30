import { useFonts } from 'expo-font';
// Per-weight subpath imports, not the package barrel: the barrel re-exports
// all 7 Manrope weights as top-level require() calls, and Metro does not
// tree-shake require() side effects, so importing from it would bundle all 7
// font files even though only these two weights are used.
import { Manrope_600SemiBold } from '@expo-google-fonts/manrope/600SemiBold';
import { Manrope_700Bold } from '@expo-google-fonts/manrope/700Bold';

export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({ Manrope_600SemiBold, Manrope_700Bold });
  if (__DEV__ && error) {
    console.error(error);
  }
  // Don't block the splash forever if the font genuinely fails to load.
  return loaded || !!error;
}
