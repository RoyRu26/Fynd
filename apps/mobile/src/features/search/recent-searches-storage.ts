import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Device-local persistence for ROADMAP 2.4's recent searches — plain query
 * strings only, never a filter snapshot (see `recent-searches.ts`). Reuses
 * `@react-native-async-storage/async-storage`, already a direct dependency
 * and already linked natively for `@/lib/supabase.ts`'s own auth session
 * store, so this needs no new dependency.
 *
 * Mirrors this codebase's `api.ts` I/O-boundary convention — no `.test.ts`,
 * since there is no pure logic here to unit test, just a storage round
 * trip — but unlike `api.ts` (which throws on `error`), this never throws:
 * a corrupt or missing value degrades to an empty list rather than
 * breaking the Explore screen over a cosmetic, best-effort feature.
 */

const STORAGE_KEY = 'fynd/recent-searches';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export async function loadRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return isStringArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveRecentSearches(list: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Best-effort persistence — a failed write just means the list resets
    // next launch, never a user-facing error for a cosmetic feature.
  }
}
