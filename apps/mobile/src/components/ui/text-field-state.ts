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

/**
 * The field's outline treatment.
 *
 * `box` is the app's standard crisp input. `pill` is the Turn-4 search field:
 * fully rounded with a heavier, ink-coloured stroke, so it reads as a distinct
 * object on the page rather than as one more form row. It is a SHAPE choice,
 * not an emphasis one — see DESIGN.md §7's pill carve-out.
 */
export type FieldShape = 'box' | 'pill';

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
export type FieldBorderColorKey = 'border' | 'borderFocus' | 'danger' | 'text';

// resting -> thin/border · focused -> thick/borderFocus · error -> thin/danger
// · focused+error -> thick/danger. Width tracks focus only; color tracks
// error first, then focus, then rests.
//
// `pill` differs only at REST: it is always a thick ink stroke, because the
// shape's whole purpose is to read as a standalone object. Focus and error
// still override it exactly as they do for `box`, so a pill field cannot end
// up with a quieter error state than a boxed one.
export function getFieldBorderStyle({
  focused,
  hasError,
  shape = 'box',
}: {
  focused: boolean;
  hasError: boolean;
  shape?: FieldShape;
}): { width: FieldBorderWidth; colorKey: FieldBorderColorKey } {
  if (hasError) {
    return { width: focused ? 'thick' : 'thin', colorKey: 'danger' };
  }
  if (focused) {
    return { width: 'thick', colorKey: 'borderFocus' };
  }
  return shape === 'pill'
    ? { width: 'thick', colorKey: 'text' }
    : { width: 'thin', colorKey: 'border' };
}
