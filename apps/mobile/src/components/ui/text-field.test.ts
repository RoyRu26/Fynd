import { describe, expect, it } from 'vitest';

import { getFieldBorderStyle, getFieldMessage } from '@/components/ui/text-field-state';

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
