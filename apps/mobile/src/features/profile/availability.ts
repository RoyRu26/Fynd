import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { USERNAME_REGEX } from '@/features/profile/schemas';

const DEBOUNCE_MS = 400;

// ILIKE treats _ and % as wildcards; a username may legitimately contain _,
// so it must be escaped to keep this an exact case-insensitive match rather
// than a pattern match.
function escapeForIlike(value: string): string {
  return value.replace(/[%_]/g, (char) => `\\${char}`);
}

/**
 * `excludeUserId` lets the edit-profile screen check availability while
 * keeping the viewer's own current username — without it, re-saving your
 * own unchanged username would always show "taken" (it matches your own
 * row). Onboarding's call site passes no second argument and is unaffected:
 * `.neq('id', undefined)` is never applied.
 */
export function useUsernameAvailability(username: string, excludeUserId?: string) {
  const [debounced, setDebounced] = useState(username);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(username), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [username]);

  const isValidFormat = USERNAME_REGEX.test(debounced);

  const query = useQuery({
    queryKey: ['username-availability', debounced.toLowerCase(), excludeUserId],
    queryFn: async (): Promise<boolean> => {
      let request = supabase.from('profiles').select('id').ilike('username', escapeForIlike(debounced));
      if (excludeUserId) {
        request = request.neq('id', excludeUserId);
      }
      const { data, error } = await request.maybeSingle();
      if (error) throw error;
      return data === null;
    },
    enabled: isValidFormat,
    staleTime: 10_000,
  });

  // Exposed so callers can tell whether the debounce has caught up to the
  // live input value, and avoid showing a result for a stale prior value.
  return { ...query, debounced };
}
