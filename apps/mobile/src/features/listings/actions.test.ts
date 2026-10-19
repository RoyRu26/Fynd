import { describe, expect, it } from 'vitest';

import { getAvailableActions } from '@/features/listings/actions';
import type { ListingStatus } from '@/features/listings/status';

describe('getAvailableActions', () => {
  it('offers edit and delete_draft for a draft', () => {
    expect(getAvailableActions('draft')).toEqual(['edit', 'delete_draft']);
  });

  it('offers edit, mark_reserved, mark_sold and remove for an active listing', () => {
    expect(getAvailableActions('active')).toEqual(['edit', 'mark_reserved', 'mark_sold', 'remove']);
  });

  it('offers edit, mark_active, mark_sold and remove for a reserved listing', () => {
    expect(getAvailableActions('reserved')).toEqual(['edit', 'mark_active', 'mark_sold', 'remove']);
  });

  it('offers nothing for a sold listing -- terminal', () => {
    expect(getAvailableActions('sold')).toEqual([]);
  });

  it('offers nothing for a removed listing -- terminal', () => {
    expect(getAvailableActions('removed')).toEqual([]);
  });

  it('covers every ListingStatus value exhaustively', () => {
    const statuses: ListingStatus[] = ['draft', 'active', 'reserved', 'sold', 'removed'];
    for (const status of statuses) {
      expect(() => getAvailableActions(status)).not.toThrow();
    }
  });

  it('never offers delete_draft outside of draft', () => {
    const statuses: ListingStatus[] = ['active', 'reserved', 'sold', 'removed'];
    for (const status of statuses) {
      expect(getAvailableActions(status)).not.toContain('delete_draft');
    }
  });

  it('never offers edit for a terminal status', () => {
    expect(getAvailableActions('sold')).not.toContain('edit');
    expect(getAvailableActions('removed')).not.toContain('edit');
  });

  it('never offers mark_reserved on a reserved listing itself, and never mark_active on an active one', () => {
    expect(getAvailableActions('active')).not.toContain('mark_active');
    expect(getAvailableActions('reserved')).not.toContain('mark_reserved');
  });
});
