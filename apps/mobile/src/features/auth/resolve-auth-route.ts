import type { Session } from '@supabase/supabase-js';

// Minimal, React/IO-free shape a TanStack Query profile query result is adapted to.
export type ProfileQueryState =
  | { status: 'pending' }
  | { status: 'error'; error: unknown }
  | { status: 'success'; data: { username: string | null; display_name: string | null } };

export type ResolvedAuthRoute =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'onboarding' }
  | { status: 'app' }
  | { status: 'error'; error: unknown };

/**
 * Pure snapshot -> state mapping. No React, no I/O, no concept of time:
 * timeout handling deliberately lives one layer up, in AuthRouteProvider.
 */
export function resolveAuthRoute(params: {
  session: Session | null | undefined;
  profile: ProfileQueryState;
}): ResolvedAuthRoute {
  const { session, profile } = params;

  if (session === undefined) {
    return { status: 'loading' };
  }

  if (session === null) {
    return { status: 'unauthenticated' };
  }

  if (profile.status === 'pending') {
    return { status: 'loading' };
  }

  if (profile.status === 'error') {
    return { status: 'error', error: profile.error };
  }

  const isIncomplete = profile.data.username === null || profile.data.display_name === null;
  return { status: isIncomplete ? 'onboarding' : 'app' };
}
