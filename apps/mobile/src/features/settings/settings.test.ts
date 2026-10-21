import { describe, expect, it } from 'vitest';

import { normalizeNotificationPreferences } from '@/features/settings/settings';

describe('normalizeNotificationPreferences', () => {
  it('maps all-true defaults to the camelCase domain shape', () => {
    expect(
      normalizeNotificationPreferences({
        notify_new_message: true,
        notify_new_review: true,
        notify_new_follower: true,
      }),
    ).toEqual({
      notifyNewMessage: true,
      notifyNewReview: true,
      notifyNewFollower: true,
    });
  });

  it('round-trips explicit false values rather than defaulting them away', () => {
    expect(
      normalizeNotificationPreferences({
        notify_new_message: false,
        notify_new_review: false,
        notify_new_follower: false,
      }),
    ).toEqual({
      notifyNewMessage: false,
      notifyNewReview: false,
      notifyNewFollower: false,
    });
  });

  it('round-trips a mix of true/false independently per column', () => {
    expect(
      normalizeNotificationPreferences({
        notify_new_message: false,
        notify_new_review: true,
        notify_new_follower: false,
      }),
    ).toEqual({
      notifyNewMessage: false,
      notifyNewReview: true,
      notifyNewFollower: false,
    });
  });

  it('defensively defaults null/undefined values to true, not false', () => {
    expect(
      normalizeNotificationPreferences({
        notify_new_message: null,
        notify_new_review: undefined,
        notify_new_follower: null,
      }),
    ).toEqual({
      notifyNewMessage: true,
      notifyNewReview: true,
      notifyNewFollower: true,
    });
  });
});
