import { describe, expect, it } from 'vitest';

import { getFieldBorderStyle, getFieldMessage, getFieldRowAlignment } from '@/components/ui/text-field-state';

describe('getFieldMessage', () => {
  it('shows nothing when both error and helperText are absent', () => {
    expect(getFieldMessage({})).toBeNull();
  });

  it('shows helper text when only helperText is present', () => {
    expect(getFieldMessage({ helperText: 'We never share your email.' })).toEqual({
      text: 'We never share your email.',
      tone: 'helper',
    });
  });

  it('shows the error when only error is present', () => {
    expect(getFieldMessage({ error: 'Enter a valid email address' })).toEqual({
      text: 'Enter a valid email address',
      tone: 'error',
    });
  });

  it('error strictly wins when both are present', () => {
    expect(
      getFieldMessage({ error: 'Enter a valid email address', helperText: 'We never share your email.' }),
    ).toEqual({ text: 'Enter a valid email address', tone: 'error' });
  });
});

describe('getFieldRowAlignment', () => {
  it('centres a single-line field, so an accessory matches the text baseline', () => {
    expect(getFieldRowAlignment({})).toBe('center');
    expect(getFieldRowAlignment({ multiline: false })).toBe('center');
  });

  // The regression this exists to catch: a centred accessory on a growing
  // field drifts to the middle of the box, away from the line it labels.
  it('pins a multiline field to the top, where the caret starts', () => {
    expect(getFieldRowAlignment({ multiline: true })).toBe('flex-start');
  });
});

describe('getFieldBorderStyle', () => {
  it('resting: thin border, border color', () => {
    expect(getFieldBorderStyle({ focused: false, hasError: false })).toEqual({
      width: 'thin',
      colorKey: 'border',
    });
  });

  it('focused: thick border, borderFocus color', () => {
    expect(getFieldBorderStyle({ focused: true, hasError: false })).toEqual({
      width: 'thick',
      colorKey: 'borderFocus',
    });
  });

  it('error: thin border, danger color', () => {
    expect(getFieldBorderStyle({ focused: false, hasError: true })).toEqual({
      width: 'thin',
      colorKey: 'danger',
    });
  });

  it('focused + error: thick border, danger color', () => {
    expect(getFieldBorderStyle({ focused: true, hasError: true })).toEqual({
      width: 'thick',
      colorKey: 'danger',
    });
  });
});

describe('getFieldBorderStyle — pill shape', () => {
  it('rests as a thick ink stroke, unlike the quiet box', () => {
    expect(getFieldBorderStyle({ focused: false, hasError: false, shape: 'pill' })).toEqual({
      width: 'thick',
      colorKey: 'text',
    });
    expect(getFieldBorderStyle({ focused: false, hasError: false, shape: 'box' })).toEqual({
      width: 'thin',
      colorKey: 'border',
    });
  });

  it('defaults to box when no shape is given, so existing call sites are unchanged', () => {
    expect(getFieldBorderStyle({ focused: false, hasError: false })).toEqual({
      width: 'thin',
      colorKey: 'border',
    });
  });

  // The regression worth guarding: a pill must not end up with a quieter
  // error or focus state than a box, which is what would happen if the
  // resting ink stroke took precedence.
  it('focus and error still override the pill rest state', () => {
    expect(getFieldBorderStyle({ focused: true, hasError: false, shape: 'pill' })).toEqual({
      width: 'thick',
      colorKey: 'borderFocus',
    });
    expect(getFieldBorderStyle({ focused: false, hasError: true, shape: 'pill' })).toEqual({
      width: 'thin',
      colorKey: 'danger',
    });
    expect(getFieldBorderStyle({ focused: true, hasError: true, shape: 'pill' })).toEqual({
      width: 'thick',
      colorKey: 'danger',
    });
  });

  it('error beats focus in both shapes', () => {
    for (const shape of ['box', 'pill'] as const) {
      expect(getFieldBorderStyle({ focused: true, hasError: true, shape }).colorKey).toBe('danger');
    }
  });
});
