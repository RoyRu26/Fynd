import { describe, expect, it } from 'vitest';

import { getChipSurface, getChipVisualState, type ChipProps } from '@/components/ui/chip-state';

describe('getChipVisualState', () => {
  it('a static chip is never interactive', () => {
    const props: ChipProps = { label: 'Very good' };
    expect(getChipVisualState(props)).toEqual({ interactive: false, emphasis: 'default' });
  });

  it('a static chip with selectable: false is never interactive', () => {
    const props: ChipProps = { label: 'Very good', selectable: false };
    expect(getChipVisualState(props)).toEqual({ interactive: false, emphasis: 'default' });
  });

  it('an unselected, enabled selectable chip is interactive with default emphasis', () => {
    const props: ChipProps = { label: 'Size M', selectable: true, selected: false, onPress: () => {} };
    expect(getChipVisualState(props)).toEqual({ interactive: true, emphasis: 'default' });
  });

  it('a selected, enabled selectable chip is interactive with selected emphasis', () => {
    const props: ChipProps = { label: 'Size M', selectable: true, selected: true, onPress: () => {} };
    expect(getChipVisualState(props)).toEqual({ interactive: true, emphasis: 'selected' });
  });

  it('a disabled selectable chip reports interactive: false regardless of selected', () => {
    const selectedDisabled: ChipProps = {
      label: 'Size M',
      selectable: true,
      selected: true,
      disabled: true,
      onPress: () => {},
    };
    expect(getChipVisualState(selectedDisabled)).toEqual({ interactive: false, emphasis: 'selected' });
  });
});

describe('getChipSurface', () => {
  it('defaults to the quiet neutral surface', () => {
    expect(getChipSurface({ label: 'Very good' })).toBe('default');
    expect(getChipSurface({ label: 'Size M', selectable: true, selected: false, onPress: () => {} })).toBe(
      'default',
    );
  });

  it('paints inverse when asked, static or selectable', () => {
    expect(getChipSurface({ label: 'Good', tone: 'inverse' })).toBe('inverse');
    expect(
      getChipSurface({ label: 'Good', tone: 'inverse', selectable: true, selected: false, onPress: () => {} }),
    ).toBe('inverse');
  });

  // The combination that must resolve rather than being left to style order:
  // a selected chip has to LOOK selected, so accent outranks tone.
  it('selection outranks tone — a selected chip is never painted inverse', () => {
    expect(
      getChipSurface({ label: 'Good', tone: 'inverse', selectable: true, selected: true, onPress: () => {} }),
    ).toBe('selected');
  });

  it('tone still applies to a disabled unselected chip', () => {
    expect(
      getChipSurface({
        label: 'Good',
        tone: 'inverse',
        disabled: true,
        selectable: true,
        selected: false,
        onPress: () => {},
      }),
    ).toBe('inverse');
  });
});
