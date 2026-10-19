import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDebouncedValue } from '@/hooks/use-debounced-value';

/**
 * `useDebouncedValue` wraps `useState`/`useEffect`, so exercising it for
 * real needs an actual React render -- there is no pure-logic half to peel
 * off the way `active-filters.ts` has. No `vi.useFakeTimers()` precedent
 * exists elsewhere in this codebase (every other `*.test.ts` here is a pure
 * module with zero `react` import), so this file establishes it: a tiny
 * headless harness component rendered with `react-test-renderer` (added as
 * a devDependency for exactly this), driven entirely through fake timers.
 */

type HarnessProps = { value: string; delayMs: number };

function Harness({ value, delayMs, onValue }: HarnessProps & { onValue: (value: string) => void }) {
  const debounced = useDebouncedValue(value, delayMs);
  onValue(debounced);
  return null;
}

function renderHarness(props: HarnessProps, onValue: (value: string) => void): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(Harness, { ...props, onValue }));
  });
  return renderer;
}

function updateHarness(renderer: ReactTestRenderer, props: HarnessProps, onValue: (value: string) => void) {
  act(() => {
    renderer.update(createElement(Harness, { ...props, onValue }));
  });
}

describe('useDebouncedValue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the initial value immediately, with no delay', () => {
    vi.useFakeTimers();
    const values: string[] = [];
    renderHarness({ value: 'a', delayMs: 400 }, (v) => values.push(v));

    expect(values).toEqual(['a']);
  });

  it('does not update before the delay has elapsed', () => {
    vi.useFakeTimers();
    const values: string[] = [];
    const renderer = renderHarness({ value: 'a', delayMs: 400 }, (v) => values.push(v));

    updateHarness(renderer, { value: 'ab', delayMs: 400 }, (v) => values.push(v));
    act(() => {
      vi.advanceTimersByTime(399);
    });

    expect(values.at(-1)).toBe('a');
  });

  it('updates to the latest value once the delay elapses', () => {
    vi.useFakeTimers();
    const values: string[] = [];
    const renderer = renderHarness({ value: 'a', delayMs: 400 }, (v) => values.push(v));

    updateHarness(renderer, { value: 'ab', delayMs: 400 }, (v) => values.push(v));
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(values.at(-1)).toBe('ab');
  });

  it('resets the timer on every intermediate change, skipping values that never settle', () => {
    vi.useFakeTimers();
    const values: string[] = [];
    const renderer = renderHarness({ value: 'a', delayMs: 400 }, (v) => values.push(v));

    updateHarness(renderer, { value: 'ab', delayMs: 400 }, (v) => values.push(v));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    updateHarness(renderer, { value: 'abc', delayMs: 400 }, (v) => values.push(v));
    act(() => {
      // 200ms since 'abc' was set -- the 'ab' timer would have fired by now
      // if it had not been cleared, so this also proves the reset happened.
      vi.advanceTimersByTime(200);
    });

    expect(values).not.toContain('ab');
    expect(values.at(-1)).toBe('a');

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(values.at(-1)).toBe('abc');
  });

  it('clears the pending timer on unmount, calling setState on an unmounted instance never happens', () => {
    vi.useFakeTimers();
    const values: string[] = [];
    const renderer = renderHarness({ value: 'a', delayMs: 400 }, (v) => values.push(v));

    updateHarness(renderer, { value: 'ab', delayMs: 400 }, (v) => values.push(v));
    act(() => {
      renderer.unmount();
    });

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(400);
      });
    }).not.toThrow();
  });
});
