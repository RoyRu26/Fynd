import { supabase } from '@/lib/supabase';

/**
 * Favorites — the durable record of what the signed-in user has saved.
 *
 * The server-side shape these functions are written against:
 *
 *   * `favorites` is `(user_id, listing_id, created_at)` with a composite
 *     primary key, so favoriting twice is a `23505` rather than two rows.
 *   * RLS pins `user_id` to `auth.uid()` on insert, and the insert policy
 *     additionally requires the listing to be ACTIVE — so a draft, another
 *     seller's private row, or an invented id is refused with `42501`
 *     before the foreign key is even consulted.
 *   * The column allowlist grants INSERT on `(user_id, listing_id)` only:
 *     `created_at` is server-controlled.
 *   * There is no UPDATE grant at all. A favorite is inserted or deleted.
 *
 * The user id is resolved from the live session inside these functions
 * rather than accepted as a parameter. That is a deliberate API choice: a
 * caller cannot pass someone else's id, so "never write another user's
 * user_id" is enforced by the signature, not by convention. RLS would
 * reject it anyway, but a rejected write is a bug report and an impossible
 * write is not.
 *
 * `listing_events` is NOT written here. The enum carries 'favorite' and
 * 'unfavorite' labels for a future recommender, but there is no
 * server-controlled ingestion path for them yet (the only one that exists
 * is `record_listing_impression`), and the client holds no INSERT privilege
 * on that table. `favorites` is the durable state; events would be history,
 * and adding them is a later, server-side change.
 */

async function requireUserId(): Promise<string> {
  // Reads the in-memory/AsyncStorage session rather than hitting the
  // network, so this costs effectively nothing per toggle.
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const userId = data.session?.user.id;
  if (!userId) {
    throw new Error('Cannot change favorites without a signed-in user');
  }
  return userId;
}

/**
 * Favorites an active listing.
 *
 * A listing that is already favorited raises `23505` from the composite
 * primary key. The mutation hook avoids reaching that by deriving the toggle
 * direction from the feed cache and refusing to fire while a toggle for the
 * same listing is already in flight — but the constraint is what guarantees
 * it, not the client.
 */
export async function addFavorite(listingId: string): Promise<void> {
  const userId = await requireUserId();

  const { error } = await supabase
    .from('favorites')
    .insert({ user_id: userId, listing_id: listingId });
  if (error) throw error;
}

/**
 * Unfavorites a listing.
 *
 * Both columns are filtered explicitly so this is a primary-key lookup.
 * RLS would scope it to the caller's own rows regardless, but relying on
 * the policy to supply half the key would make the query's cost depend on
 * a policy definition elsewhere.
 *
 * Deliberately works whatever the listing's current status: the DELETE
 * policy does not mirror the insert policy's `active` check, so a favorite
 * on a listing that has since sold can still be cleared rather than
 * stranded.
 */
export async function removeFavorite(listingId: string): Promise<void> {
  const userId = await requireUserId();

  const { error } = await supabase
    .from('favorites')
    .delete()
    .eq('user_id', userId)
    .eq('listing_id', listingId);
  if (error) throw error;
}
