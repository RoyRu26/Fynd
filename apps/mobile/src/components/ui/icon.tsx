import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';

import { iconSize } from '@/design/tokens';

// Stricter than expo-symbols' own SymbolViewProps['name']: every platform is
// required, not optional. expo-symbols' own type lets a caller supply only
// `ios`, which silently renders nothing on Android/web — requiring all three
// here makes "explicit Android/web fallback" a compile-time guarantee at
// every call site instead of a runtime maybe.
export type IconName = { ios: SFSymbol; android: AndroidSymbol; web: AndroidSymbol };

export type IconProps = {
  name: IconName;
  size?: keyof typeof iconSize;
  /** Already-resolved from the caller's useAppTheme().colors — Icon has no theme awareness of its own. */
  color: string;
};

// Purely decorative — never sets accessibilityLabel/accessibilityRole. The
// accessible name always comes from whichever parent renders this (an
// IconButton's required label, or a Chip's own visible text).
export function Icon({ name, size = 'md', color }: IconProps) {
  return <SymbolView name={name} size={iconSize[size]} tintColor={color} />;
}
