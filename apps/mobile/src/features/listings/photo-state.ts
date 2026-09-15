import { MAX_LISTING_PHOTOS } from '@/features/listings/paths';

/**
 * Pure local state for the Sell editor's photo grid.
 *
 * Two categories of photo exist on screen at once: PERSISTED rows (already
 * attached, come from `useListingImages`, ordered by the server's
 * `position`) and LOCAL items (picked but not yet successfully attached —
 * tracked here). This module only ever touches the local half; the
 * persisted half is server state and is never duplicated into local state,
 * which is what keeps "the persisted DB order is authoritative" true by
 * construction rather than by discipline.
 *
 * No react-native import, so this is directly unit-testable.
 */

export type LocalPhotoStatus = 'uploading' | 'failed';

export type LocalPhotoItem = {
  /** Client-generated, stable for the item's lifetime. Not a server id. */
  localId: string;
  sourceUri: string;
  status: LocalPhotoStatus;
  /** Set only when status is 'failed'; a mapped, user-safe message. */
  errorMessage?: string;
};

/**
 * How many more photos may be added, given how many already exist across
 * both categories. `attach_listing_image` is the real authority on the cap
 * — this exists only so the "Add photos" affordance and the picker's own
 * `selectionLimit` can stay under it instead of letting the user pick more
 * than will ever succeed.
 */
export function remainingPhotoSlots(existingCount: number): number {
  return Math.max(0, MAX_LISTING_PHOTOS - existingCount);
}

/**
 * Trims a freshly-picked batch to however many slots are actually left.
 *
 * The picker is given `selectionLimit`, so this should normally be a no-op —
 * but it is what keeps a race (another tab attaching a photo between the
 * limit being computed and the picker resolving) from silently kicking off
 * more uploads than the cap allows.
 */
export function clampToRemainingSlots<T>(picked: T[], remaining: number): T[] {
  if (remaining <= 0) return [];
  return picked.slice(0, remaining);
}

export function addLocalPhotos(
  items: LocalPhotoItem[],
  toAdd: LocalPhotoItem[],
): LocalPhotoItem[] {
  return [...items, ...toAdd];
}

export function removeLocalPhoto(items: LocalPhotoItem[], localId: string): LocalPhotoItem[] {
  return items.filter((item) => item.localId !== localId);
}

export function setLocalPhotoStatus(
  items: LocalPhotoItem[],
  localId: string,
  status: LocalPhotoStatus,
  errorMessage?: string,
): LocalPhotoItem[] {
  return items.map((item) =>
    item.localId === localId ? { ...item, status, errorMessage } : item,
  );
}

/**
 * Swaps an id with its neighbor one position earlier or later.
 *
 * Returns the SAME array reference (not a copy) when the move is a no-op —
 * moving the first id earlier, or the last id later, or an id that isn't in
 * the list at all. Callers use reference equality to skip firing a reorder
 * RPC call for a boundary tap rather than sending a same-as-before order.
 */
export function moveId<T>(ids: T[], id: T, direction: 'earlier' | 'later'): T[] {
  const index = ids.indexOf(id);
  if (index === -1) return ids;

  const targetIndex = direction === 'earlier' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= ids.length) return ids;

  const next = [...ids];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}
