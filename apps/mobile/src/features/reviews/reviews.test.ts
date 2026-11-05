import { describe, expect, it } from 'vitest';

import {
  associateReviewerProfiles,
  associateSellerReviewAvatarUrls,
  deriveNextSellerReviewsOffset,
  formatAverageRatingLabel,
  formatReviewAge,
  normalizeSellerReviewRow,
  normalizeSellerReviewSummaryRow,
  resolveReviewerName,
  type NormalizedSellerReview,
  type ReviewerProfileRow,
  type SellerReviewRow,
  type SellerReviewsPage,
  type SellerReviewWithReviewer,
} from '@/features/reviews/reviews';

describe('normalizeSellerReviewSummaryRow', () => {
  it('maps the RPC row to camelCase', () => {
    expect(normalizeSellerReviewSummaryRow({ average_rating: 4.5, review_count: 8 })).toEqual({
      averageRating: 4.5,
      reviewCount: 8,
    });
  });

  it('falls back to 0/0 for an undefined row -- defensive, not the real contract', () => {
    expect(normalizeSellerReviewSummaryRow(undefined)).toEqual({ averageRating: 0, reviewCount: 0 });
  });
});

describe('formatAverageRatingLabel', () => {
  it('reads "No reviews yet" when the count is zero, regardless of the average', () => {
    expect(formatAverageRatingLabel(0, 0)).toBe('No reviews yet');
  });

  it('formats the average to one decimal place alongside the count', () => {
    expect(formatAverageRatingLabel(4.8, 12)).toBe('4.8 (12)');
  });

  it('pads a whole-number average to one decimal place', () => {
    expect(formatAverageRatingLabel(4, 1)).toBe('4.0 (1)');
  });

  it('rounds rather than truncating', () => {
    expect(formatAverageRatingLabel(4.46, 2)).toBe('4.5 (2)');
  });
});

function makeRow(overrides: Partial<SellerReviewRow> = {}): SellerReviewRow {
  return {
    id: 1,
    listing_id: 'listing-1',
    reviewer_id: 'reviewer-1',
    rating: 5,
    comment: 'Great transaction!',
    created_at: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

describe('normalizeSellerReviewRow', () => {
  it('maps every snake_case field to its camelCase domain field', () => {
    expect(normalizeSellerReviewRow(makeRow())).toEqual({
      reviewId: 1,
      listingId: 'listing-1',
      reviewerId: 'reviewer-1',
      rating: 5,
      comment: 'Great transaction!',
      createdAt: '2026-10-01T12:00:00.000Z',
    });
  });

  it('preserves a genuinely null comment rather than coercing it', () => {
    expect(normalizeSellerReviewRow(makeRow({ comment: null })).comment).toBeNull();
  });
});

describe('associateReviewerProfiles', () => {
  function makeNormalized(overrides: Partial<NormalizedSellerReview> = {}): NormalizedSellerReview {
    return {
      reviewId: 1,
      listingId: 'listing-1',
      reviewerId: 'reviewer-1',
      rating: 5,
      comment: 'Great transaction!',
      createdAt: '2026-10-01T12:00:00.000Z',
      ...overrides,
    };
  }

  it('attaches the matching profile by reviewer id', () => {
    const profileRows: ReviewerProfileRow[] = [
      { id: 'reviewer-1', username: 'jamied', display_name: 'Jamie Doe', avatar_path: 'reviewer-1/avatar.jpg' },
    ];

    const [result] = associateReviewerProfiles([makeNormalized()], profileRows);

    expect(result.reviewer).toEqual({
      displayName: 'Jamie Doe',
      username: 'jamied',
      avatarPath: 'reviewer-1/avatar.jpg',
    });
  });

  it('never reorders the reviews themselves -- only enriches each row in place', () => {
    const reviews = [makeNormalized({ reviewId: 1 }), makeNormalized({ reviewId: 2, reviewerId: 'reviewer-2' })];
    const profileRows: ReviewerProfileRow[] = [
      { id: 'reviewer-2', username: 'b', display_name: null, avatar_path: null },
      { id: 'reviewer-1', username: 'a', display_name: null, avatar_path: null },
    ];

    const result = associateReviewerProfiles(reviews, profileRows);

    expect(result.map((row) => row.reviewId)).toEqual([1, 2]);
  });

  it('falls back to nulls for a reviewer id with no matching profile row', () => {
    const [result] = associateReviewerProfiles([makeNormalized()], []);

    expect(result.reviewer).toEqual({ displayName: null, username: null, avatarPath: null });
  });
});

describe('associateSellerReviewAvatarUrls', () => {
  function makeWithReviewer(overrides: Partial<SellerReviewWithReviewer> = {}): SellerReviewWithReviewer {
    return {
      reviewId: 1,
      listingId: 'listing-1',
      reviewerId: 'reviewer-1',
      rating: 5,
      comment: null,
      createdAt: '2026-10-01T12:00:00.000Z',
      reviewer: { displayName: 'Jamie Doe', username: 'jamied', avatarPath: 'reviewer-1/avatar.jpg' },
      ...overrides,
    };
  }

  it('attaches the resolved URL when the path has one', () => {
    const [result] = associateSellerReviewAvatarUrls(
      [makeWithReviewer()],
      { 'reviewer-1/avatar.jpg': 'https://signed.example/avatar.jpg' },
    );

    expect(result.reviewer.avatarUrl).toBe('https://signed.example/avatar.jpg');
  });

  it('resolves to null, never throwing, when the path has no signed URL', () => {
    const [result] = associateSellerReviewAvatarUrls([makeWithReviewer()], {});

    expect(result.reviewer.avatarUrl).toBeNull();
  });

  it('resolves to null when the reviewer has no avatar path at all', () => {
    const [result] = associateSellerReviewAvatarUrls(
      [makeWithReviewer({ reviewer: { displayName: 'Jamie Doe', username: 'jamied', avatarPath: null } })],
      { 'reviewer-1/avatar.jpg': 'https://signed.example/avatar.jpg' },
    );

    expect(result.reviewer.avatarUrl).toBeNull();
  });
});

describe('resolveReviewerName', () => {
  it('prefers the display name when present', () => {
    expect(resolveReviewerName({ displayName: 'Jamie Doe', username: 'jamied' })).toBe('Jamie Doe');
  });

  it('falls back to the username when there is no display name', () => {
    expect(resolveReviewerName({ displayName: null, username: 'jamied' })).toBe('jamied');
  });

  it('falls back to "Fynd user" when neither is set', () => {
    expect(resolveReviewerName({ displayName: null, username: null })).toBe('Fynd user');
  });
});

describe('deriveNextSellerReviewsOffset', () => {
  function makePage(reviewCount: number, totalCount: number): SellerReviewsPage {
    const normalized = Array.from({ length: reviewCount }, (_, index) => normalizeSellerReviewRow(makeRow({ id: index })));
    return {
      reviews: associateSellerReviewAvatarUrls(associateReviewerProfiles(normalized, []), {}),
      totalCount,
    };
  }

  it('advances by the page size when more rows remain', () => {
    expect(deriveNextSellerReviewsOffset(0, makePage(20, 50), 20)).toBe(20);
  });

  it('returns null once the running total reaches totalCount', () => {
    expect(deriveNextSellerReviewsOffset(20, makePage(20, 40), 20)).toBe(null);
  });

  it('returns null for a short page, even if totalCount claims more remain', () => {
    expect(deriveNextSellerReviewsOffset(0, makePage(5, 50), 20)).toBe(null);
  });
});

describe('formatReviewAge', () => {
  const now = new Date('2026-10-20T12:00:00.000Z').getTime();

  it('reads "Just now" for anything under a minute old', () => {
    expect(formatReviewAge('2026-10-20T11:59:30.000Z', now)).toBe('Just now');
  });

  it('formats minutes', () => {
    expect(formatReviewAge('2026-10-20T11:45:00.000Z', now)).toBe('15m ago');
  });

  it('formats hours', () => {
    expect(formatReviewAge('2026-10-20T06:00:00.000Z', now)).toBe('6h ago');
  });

  it('formats days', () => {
    expect(formatReviewAge('2026-10-17T12:00:00.000Z', now)).toBe('3d ago');
  });

  it('formats weeks', () => {
    expect(formatReviewAge('2026-10-02T12:00:00.000Z', now)).toBe('2w ago');
  });

  it('formats years once the elapsed time passes 52 weeks', () => {
    expect(formatReviewAge('2024-10-20T12:00:00.000Z', now)).toBe('2y ago');
  });

  it('never returns a negative-time label for a clock-skewed future timestamp', () => {
    expect(formatReviewAge('2026-10-20T12:00:30.000Z', now)).toBe('Just now');
  });
});
