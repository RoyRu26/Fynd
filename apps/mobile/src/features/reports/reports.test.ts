import { describe, expect, it } from 'vitest';

import { isOtherReasonMissingNote, REASON_LABELS, REPORT_REASONS } from '@/features/reports/reports';

describe('isOtherReasonMissingNote', () => {
  it('is true for reason=other with an empty note', () => {
    expect(isOtherReasonMissingNote('other', '')).toBe(true);
  });

  it('is true for reason=other with a whitespace-only note', () => {
    expect(isOtherReasonMissingNote('other', '   ')).toBe(true);
  });

  it('is false for reason=other with a real note', () => {
    expect(isOtherReasonMissingNote('other', 'Counterfeit tag inside the collar')).toBe(false);
  });

  it('is false for reason=other with a note that has leading/trailing whitespace but real content', () => {
    expect(isOtherReasonMissingNote('other', '  fake  ')).toBe(false);
  });

  it('is false for any non-other reason, note or not', () => {
    expect(isOtherReasonMissingNote('spam', '')).toBe(false);
    expect(isOtherReasonMissingNote('harassment', '')).toBe(false);
  });

  it('is false when no reason is selected yet -- that is Submit\'s own disable, not this validator\'s', () => {
    expect(isOtherReasonMissingNote(null, '')).toBe(false);
  });
});

describe('REASON_LABELS', () => {
  // The rule this module exists to enforce -- same drift guard
  // size.ts/condition.ts's own label maps use.
  it('has a human-readable label for every reason, with no raw enum string leaking through', () => {
    for (const reason of REPORT_REASONS) {
      const label = REASON_LABELS[reason];
      expect(label).not.toBe(reason);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('covers every reason exactly once', () => {
    expect(Object.keys(REASON_LABELS).sort()).toEqual([...REPORT_REASONS].sort());
  });
});
