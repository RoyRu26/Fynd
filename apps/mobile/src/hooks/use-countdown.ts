import { useEffect, useState } from 'react';

/**
 * Re-renders roughly once a second while `deadlineMs` is in the future, and
 * returns the current wall clock each tick. Pass `null` to idle.
 *
 * Deliberately a clock rather than a counter. Decrementing a stored "seconds
 * left" drifts — timers fire late, and JS timers are throttled outright while
 * the app is backgrounded, so a counter that ticked 60 times would still read
 * 60 after the user spent two minutes in their mail app. Deriving the
 * remainder from a FIXED deadline instead (see `features/auth/resend.ts`)
 * means the value self-corrects rather than accumulating that error.
 *
 * What this does NOT do, precisely: `now` is state written only by the
 * interval callback, so it is not resynced at the moment the app
 * foregrounds — the display stays at its pre-background value until the next
 * tick fires, up to ~1s after JS timers resume. A counter would be wrong
 * permanently; this is wrong for about a second. Closing that last second
 * needs an `AppState` listener, which is not worth the wiring here.
 *
 * Same `useState` + `useEffect`-with-cleanup shape as `use-debounced-value.ts`;
 * the effect body is the whole of the hook's own logic, so there is nothing
 * here to split into a pure module — the derivation that DOES have invariants
 * lives in `resend.ts` and is tested there.
 *
 * It never calls setState in the effect body (the lint rule is right about
 * that), and the interval self-clears on arrival — so once a countdown
 * finishes, `now` FREEZES at that moment and can be arbitrarily stale by the
 * time a new deadline is armed, not merely a tick behind. Callers must
 * therefore clamp rather than trust the raw difference; `resend.ts`'s
 * `cooldownSecondsLeft` is the worked example.
 */
export function useCountdown(deadlineMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadlineMs === null || deadlineMs <= Date.now()) return;

    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      // Stop on arrival rather than ticking forever behind a finished
      // countdown — nothing downstream changes once the remainder clamps to 0.
      if (current >= deadlineMs) clearInterval(timer);
    }, 1000);

    return () => clearInterval(timer);
  }, [deadlineMs]);

  return now;
}
