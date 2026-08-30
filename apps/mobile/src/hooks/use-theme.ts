import { Colors } from '@/constants/theme';
import { useAppTheme } from '@/design/theme-provider';

/**
 * @deprecated Legacy compatibility only. Powers the existing starter
 * `ThemedText`/`ThemedView` and the current (pre-rebuild) tab bars during the
 * design-system migration. New primitives and all new Fynd UI must read
 * `useAppTheme().colors` (src/design/theme-provider.tsx) directly — never
 * import `Colors` from `@/constants/theme` in new code.
 */
export function useTheme() {
  const { scheme } = useAppTheme();

  return Colors[scheme];
}
