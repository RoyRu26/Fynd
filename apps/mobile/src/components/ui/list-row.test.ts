import { describe, expect, it } from 'vitest';

import {
  getListRowAccessibilityLabel,
  getListRowTitleVariant,
  isListRowInteractive,
} from '@/components/ui/list-row-state';

describe('getListRowTitleVariant', () => {
  it('is body by default', () => {
    expect(getListRowTitleVariant()).toBe('body');
  });

  it('is body when not unread', () => {
    expect(getListRowTitleVariant(false)).toBe('body');
  });

  it('is bodyStrong when unread', () => {
    expect(getListRowTitleVariant(true)).toBe('bodyStrong');
  });
});

describe('isListRowInteractive', () => {
  it('is not interactive without an onPress', () => {
    expect(isListRowInteractive({})).toBe(false);
  });

  it('is interactive with an onPress and no disabled flag', () => {
    expect(isListRowInteractive({ onPress: () => {} })).toBe(true);
  });

  it('is not interactive when disabled, even with an onPress', () => {
    expect(isListRowInteractive({ onPress: () => {}, disabled: true })).toBe(false);
  });

  it('is not interactive when disabled is true and there is no onPress', () => {
    expect(isListRowInteractive({ disabled: true })).toBe(false);
  });
});

describe('getListRowAccessibilityLabel', () => {
  it('uses just the title when there is no subtitle and it is not unread', () => {
    expect(getListRowAccessibilityLabel({ title: 'Alice' })).toBe('Alice');
  });

  it('composes title and subtitle', () => {
    expect(getListRowAccessibilityLabel({ title: 'Alice', subtitle: 'Hey there' })).toBe('Alice, Hey there');
  });

  it('appends Unread when unread, after the subtitle', () => {
    expect(getListRowAccessibilityLabel({ title: 'Alice', subtitle: 'Hey there', unread: true })).toBe(
      'Alice, Hey there, Unread',
    );
  });

  it('appends Unread even without a subtitle', () => {
    expect(getListRowAccessibilityLabel({ title: 'Alice', unread: true })).toBe('Alice, Unread');
  });

  it('does not append Unread when explicitly false', () => {
    expect(getListRowAccessibilityLabel({ title: 'Alice', unread: false })).toBe('Alice');
  });
});
