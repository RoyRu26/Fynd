// Pure logic for TextField — no runtime import of any kind, not even
// @/design/tokens (which itself imports react-native at runtime and would
// transitively break the test runner's transform; see text-variants.ts for
// the full explanation). Border width is expressed as a semantic label,
// not a resolved pixel number — text-field.tsx (untested, free to import
// tokens.ts) maps the label to the actual border.thin/border.thick value.

// Error strictly wins over helper text; neither shows when both are absent.
export function getFieldMessage({
  error,
  helperText,
}: {
  error?: string;
  helperText?: string;
}): { text: string; tone: 'error' | 'helper' } | null {
  if (error) return { text: error, tone: 'error' };
  if (helperText) return { text: helperText, tone: 'helper' };
  return null;
}

export type FieldRowAlignment = 'center' | 'flex-start';

/**
 * Cross-axis alignment for the field row that holds `leading`, the input and
 * `trailing`.
 *
 * Single-line fields centre, so an accessory optically matches the text
 * baseline. Multiline fields must NOT centre: the row grows with the content,
 * and a centred accessory would drift toward the middle of a four-line box,
 * detached from the first line it belongs to. Pinning to the top keeps it
 * where the caret starts.
 *
 * Extracted rather than inlined because it is the one layout rule that varies
 * with a caller-supplied prop — the thing most likely to regress silently when
 * someone later adds an accessory to a multiline field.
 */
export function getFieldRowAlignment({ multiline }: { multiline?: boolean }): FieldRowAlignment {
  return multiline ? 'flex-start' : 'center';
}

export type FieldBorderWidth = 'thin' | 'thick';
export type FieldBorderColorKey = 'border' | 'borderFocus' | 'danger';

// resting -> thin/border · focused -> thick/borderFocus · error -> thin/danger
// · focused+error -> thick/danger. Width tracks focus only; color tracks
// error first, then focus, then rests.
export function getFieldBorderStyle({
  focused,
  hasError,
}: {
  focused: boolean;
  hasError: boolean;
}): { width: FieldBorderWidth; colorKey: FieldBorderColorKey } {
  return {
    width: focused ? 'thick' : 'thin',
    colorKey: hasError ? 'danger' : focused ? 'borderFocus' : 'border',
  };
}
