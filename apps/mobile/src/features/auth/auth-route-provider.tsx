import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { useAuth } from '@/features/auth/auth-provider';
import { resolveAuthRoute } from '@/features/auth/resolve-auth-route';
import { useProfile } from '@/features/profile/queries';

const TIMEOUT_MS = 8000;

export type AuthRouteState =
  | { status: 'loading' }
  | { status: 'timed-out'; retry: () => void }
  | { status: 'unauthenticated' }
  | { status: 'onboarding' }
  | { status: 'app' }
  | { status: 'error'; error: unknown; retry: () => void };

const AuthRouteContext = createContext<AuthRouteState | null>(null);

/**
 * Sole owner of resolved auth-route state: the one profile query, the one
 * resolveAuthRoute() call, and the one timeout timer live here. Every
 * consumer reads the same context value on the same render, so nothing
 * downstream can independently drift or time out at a different moment.
 */
export function AuthRouteProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const profileQuery = useProfile(userId);

  const pure = resolveAuthRoute({
    session,
    profile:
      profileQuery.status === 'pending'
        ? { status: 'pending' }
        : profileQuery.status === 'error'
          ? { status: 'error', error: profileQuery.error }
          : { status: 'success', data: profileQuery.data },
  });

  const [timedOut, setTimedOut] = useState(false);

  // Reset timedOut the moment a *new* loading phase begins (including a
  // fresh attempt after retry()) — done during render, not in an effect
  // below, since retrying re-enters 'loading' without necessarily changing
  // the effect's own dependency in a way that should call setState directly
  // in its body. This is React's documented pattern for resetting state when
  // a derived value changes: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevStatus, setPrevStatus] = useState(pure.status);
  if (pure.status !== prevStatus) {
    setPrevStatus(pure.status);
    if (pure.status === 'loading') {
      setTimedOut(false);
    }
  }

  useEffect(() => {
    if (pure.status !== 'loading') {
      return;
    }
    const timer = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pure.status]);

  const retry = () => {
    setTimedOut(false);
    profileQuery.refetch();
  };

  let value: AuthRouteState;
  if (pure.status === 'loading' && timedOut) {
    value = { status: 'timed-out', retry };
  } else if (pure.status === 'error') {
    value = { status: 'error', error: pure.error, retry };
  } else {
    value = pure;
  }

  return <AuthRouteContext.Provider value={value}>{children}</AuthRouteContext.Provider>;
}

export function useAuthRouteState(): AuthRouteState {
  const ctx = useContext(AuthRouteContext);
  if (!ctx) {
    throw new Error('useAuthRouteState must be used within AuthRouteProvider');
  }
  return ctx;
}
