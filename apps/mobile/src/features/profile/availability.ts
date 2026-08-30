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

export function useUsernameAvailability(username: string) {
  const [debounced, setDebounced] = useState(username);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(username), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [username]);

  const isValidFormat = USERNAME_REGEX.test(debounced);

  const query = useQuery({
    queryKey: ['username-availability', debounced.toLowerCase()],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .ilike('username', escapeForIlike(debounced))
        .maybeSingle();
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
