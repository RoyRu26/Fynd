import type { ListingStatus } from '@/features/listings/status';

/**
 * ROADMAP 1.6 "Manage a listing" — which management actions a listing
 * offers, purely as a function of its current status. No react-native or
 * `@/lib/supabase` import, same as status.ts, so the availability rule is
 * unit-testable and never duplicated inline in a screen or the actions
 * sheet.
 *
 * This is advisory the same way publishBlockers is: every action still goes
 * through its own SECURITY DEFINER RPC, which is the real authority on
 * whether a transition is allowed. This only decides what the UI *offers*.
 */
export type ListingAction = 'edit' | 'mark_reserved' | 'mark_sold' | 'mark_active' | 'remove' | 'delete_draft';

/**
 * The actions menu for a listing, in the order they should be offered.
 *
 * Mirrors the transition matrix the RPCs enforce exactly:
 *   draft    -> edit, delete_draft
 *   active   -> edit, mark_reserved, mark_sold, remove
 *   reserved -> edit, mark_active, mark_sold, remove
 *   sold     -> (terminal, nothing offered)
 *   removed  -> (terminal, nothing offered)
 */
export function getAvailableActions(status: ListingStatus): ListingAction[] {
  switch (status) {
    case 'draft':
      return ['edit', 'delete_draft'];
    case 'active':
      return ['edit', 'mark_reserved', 'mark_sold', 'remove'];
    case 'reserved':
      return ['edit', 'mark_active', 'mark_sold', 'remove'];
    case 'sold':
    case 'removed':
      return [];
  }
}
