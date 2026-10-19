import type { TextVariant } from '@/components/ui/text-variants';

// Pure logic for ListRow — no react-native import at all, same pattern as
// button-state.ts/chip-state.ts, so it can be imported directly by
// list-row.test.ts.

// DESIGN.md §12.4 — unread is never color alone. The caller also renders a
// dot and composes it into the accessible label; this just decides the
// title's font weight half of that signal.
export function getListRowTitleVariant(unread?: boolean): TextVariant {
  return unread ? 'bodyStrong' : 'body';
}

// A row with no onPress is inert display content (e.g. a static summary
// row), never a Pressable — regardless of `disabled`. `disabled` only
// matters for a row that would otherwise be interactive.
export function isListRowInteractive({
  onPress,
  disabled,
}: {
  onPress?: () => void;
  disabled?: boolean;
}): boolean {
  return Boolean(onPress) && !disabled;
}

export function getListRowAccessibilityLabel({
  title,
  subtitle,
  unread,
}: {
  title: string;
  subtitle?: string;
  unread?: boolean;
}): string {
  const parts = [title];
  if (subtitle) parts.push(subtitle);
  if (unread) parts.push('Unread');
  return parts.join(', ');
}
