import type { Database, Enums } from '@/types/database';

/**
 * Pure feed-page logic: RPC-row normalization, signed-URL association, and
 * cursor derivation.
 *
 * No react-native import of any kind — not even transitively through
 * `@/lib/supabase`, which pulls in `@react-native-async-storage/async-storage`
 * and, through it, react-native's own Flow-syntax source that the test
 * runner's transform cannot parse (verified empirically; see tokens.ts /
 * palette.ts for the same split for the same reason). Keeping this logic
 * here — separate from api.ts, which does import `@/lib/supabase` — is what
 * makes it directly unit-testable.
 */

export type FeedCursor = { createdAt: string; id: string } | null;

/** The generated feed_listings RPC row shape, aliased for readability. */
export type FeedListingRpcRow = Database['public']['Functions']['feed_listings']['Returns'][number];

/**
 * A feed card, resolved and ready to render: camelCase, and with the cover
 * photo's signed URL already attached. `coverUrl` is never optional — see
 * `associateCoverUrls`.
 */
export type FeedListing = {
  listingId: string;
  title: string;
  priceAmount: number;
  currency: string;
  condition: Enums<'listing_condition'>;
  size: Enums<'listing_size'>;
  createdAt: string;
  sellerId: string;
  sellerUsername: string | null;
  sellerDisplayName: string | null;
  sellerAvatarPath: string | null;
  sellerAvatarUrl: string | null;
  coverStoragePath: string;
  coverUrl: string;
  isFavorited: boolean;
};

export type NormalizedFeedRow = Omit<FeedListing, 'coverUrl' | 'sellerAvatarUrl'>;

/** The intermediate shape after cover-url resolution but before seller
 * avatar-url resolution — see api.ts's `fetchFeedPage`. */
export type FeedListingWithCover = Omit<FeedListing, 'sellerAvatarUrl'>;

/**
 * Row -> domain normalization.
 *
 * `feed_listings`'s generated return type claims `seller_username`,
 * `seller_display_name`, and `seller_avatar_path` are non-null strings,
 * because PostgreSQL's `RETURNS TABLE` cannot express per-column
 * nullability — but their source columns (`public.profiles`) are genuinely
 * nullable at runtime (a user who hasn't finished onboarding). This is
 * where that gets corrected: the three fields are assigned into properly
 * nullable domain fields rather than trusting the generated type. Never
 * hand-edit database.ts to "fix" this — it is regenerated from the live
 * schema and a hand edit is silently lost on the next `pnpm run gen:types`.
 *
 * `title`, `price_amount`, `condition` and `size` stay non-null in the
 * domain type: `listings_complete_when_not_draft` guarantees every
 * non-draft listing has all four, so the generated type is correct for
 * these — only the `profiles` join columns are the ones the generator gets
 * wrong.
 *
 * `size` is safe to require despite being added long after the other three.
 * It was verified rather than assumed: the rebuilt constraint is VALIDATED
 * (`convalidated = t`, not NOT VALID), and the migration that added it
 * demoted the only two pre-existing active rows to draft rather than
 * grandfathering them — so there is no legacy active row with a null size,
 * and the constraint prevents a new one. `is_favorited` is likewise always
 * present: the RPC computes it with `exists(...)`, which yields a boolean,
 * never null.
 */
export function normalizeFeedRow(row: FeedListingRpcRow): NormalizedFeedRow {
  return {
    listingId: row.listing_id,
    title: row.title,
    priceAmount: row.price_amount,
    currency: row.currency,
    condition: row.condition,
    size: row.size,
    createdAt: row.created_at,
    sellerId: row.seller_id,
    sellerUsername: row.seller_username,
    sellerDisplayName: row.seller_display_name,
    sellerAvatarPath: row.seller_avatar_path,
    coverStoragePath: row.cover_storage_path,
    isFavorited: row.is_favorited,
  };
}

/**
 * Attaches each row's signed cover URL, keyed by storage path — the same
 * shape `createListingImageUrls` already returns.
 *
 * Throws if any row's URL is missing, rather than returning a listing with
 * no cover. A private-bucket signing failure should be rare, but a feed
 * card with a permanently broken image is worse than losing the page to a
 * retry: it reads as a rendering bug, not a transient failure. This is what
 * "one feed page = one RPC + one batch signed-URL request, no partially
 * broken cards" actually requires in code.
 */
export function associateCoverUrls(
  rows: NormalizedFeedRow[],
  urlsByPath: Record<string, string>,
): FeedListingWithCover[] {
  return rows.map((row) => {
    const coverUrl = urlsByPath[row.coverStoragePath];
    if (!coverUrl) {
      throw new Error(`Could not resolve a cover image URL for listing ${row.listingId}`);
    }
    return { ...row, coverUrl };
  });
}

/**
 * Attaches each row's resolved seller avatar URL, keyed by storage path.
 * Null-tolerant, NOT throw-on-missing — unlike `associateCoverUrls` above,
 * an avatar is a legitimate permanent null state (onboarding never sets
 * one), matching `associateInboxCoverUrls`'s tolerant pattern rather than
 * `associateCoverUrls`'s strict one. Callers dedupe seller avatar paths
 * across a page before requesting signed URLs (see api.ts) — this function
 * itself is a plain keyed lookup and does not need to know about that.
 */
export function associateAvatarUrls(
  rows: FeedListingWithCover[],
  urlsByPath: Record<string, string>,
): FeedListing[] {
  return rows.map((row) => ({
    ...row,
    sellerAvatarUrl: row.sellerAvatarPath ? urlsByPath[row.sellerAvatarPath] ?? null : null,
  }));
}

/**
 * The next page's cursor, or `null` when there is no next page.
 *
 * Derived from the LAST row of the page just fetched — `createdAt` and
 * `listingId`, matching `feed_listings`'s `(created_at, id) DESC` ordering
 * exactly. A page shorter than what was requested is the signal that the
 * feed is exhausted: asking again would return zero rows, so pagination
 * stops here instead of spending a request to find that out.
 */
export function deriveNextCursor(
  page: Pick<FeedListing, 'createdAt' | 'listingId'>[],
  pageSize: number,
): FeedCursor {
  if (page.length < pageSize) {
    return null;
  }
  const last = page[page.length - 1];
  return { createdAt: last.createdAt, id: last.listingId };
}
