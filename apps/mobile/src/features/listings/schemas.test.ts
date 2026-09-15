import { describe, expect, it } from 'vitest';

import {
  DESCRIPTION_MAX_LENGTH,
  LISTING_CONDITIONS,
  draftListingSchema,
  publishBlockers,
  publishableListingSchema,
  TITLE_MAX_LENGTH,
} from '@/features/listings/schemas';

const validForm = {
  title: 'Vintage denim jacket',
  description: 'Barely worn.',
  price: '24.50',
  condition: 'good' as const,
};

describe('draftListingSchema', () => {
  it('accepts a complete draft and converts the price to minor units', () => {
    const result = draftListingSchema.parse(validForm);
    expect(result).toEqual({
      title: 'Vintage denim jacket',
      description: 'Barely worn.',
      price: 2450,
      condition: 'good',
    });
  });

  // M1 made title/price/condition nullable precisely so this is legal.
  it('accepts a fully empty draft, mapping blanks to null', () => {
    const result = draftListingSchema.parse({
      title: '',
      description: '',
      price: '',
      condition: null,
    });
    expect(result).toEqual({ title: null, description: '', price: null, condition: null });
  });

  it('trims the title, matching the trimmed DB constraint', () => {
    expect(draftListingSchema.parse({ ...validForm, title: '  Jacket  ' }).title).toBe('Jacket');
  });

  // '   ' is 3 characters but 0 trimmed, and listings_title_length checks
  // btrim() — so it must be treated as absent, not as a valid short title.
  it('treats a whitespace-only title as absent, not as three characters', () => {
    expect(draftListingSchema.parse({ ...validForm, title: '   ' }).title).toBeNull();
  });

  it('rejects a title that is present but too short', () => {
    expect(draftListingSchema.safeParse({ ...validForm, title: 'ab' }).success).toBe(false);
  });

  it('rejects a title over the DB maximum', () => {
    expect(
      draftListingSchema.safeParse({ ...validForm, title: 'a'.repeat(TITLE_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
    expect(
      draftListingSchema.safeParse({ ...validForm, title: 'a'.repeat(TITLE_MAX_LENGTH) }).success,
    ).toBe(true);
  });

  it('rejects a description over the DB maximum', () => {
    expect(
      draftListingSchema.safeParse({
        ...validForm,
        description: 'a'.repeat(DESCRIPTION_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      draftListingSchema.safeParse({
        ...validForm,
        description: 'a'.repeat(DESCRIPTION_MAX_LENGTH),
      }).success,
    ).toBe(true);
  });

  it('rejects an invalid price that is present', () => {
    expect(draftListingSchema.safeParse({ ...validForm, price: 'abc' }).success).toBe(false);
    expect(draftListingSchema.safeParse({ ...validForm, price: '0' }).success).toBe(false);
    expect(draftListingSchema.safeParse({ ...validForm, price: '-5' }).success).toBe(false);
  });

  it('rejects a condition outside the database enum', () => {
    expect(draftListingSchema.safeParse({ ...validForm, condition: 'mint' }).success).toBe(false);
  });

  it('accepts every condition the database defines', () => {
    for (const condition of LISTING_CONDITIONS) {
      expect(draftListingSchema.safeParse({ ...validForm, condition }).success).toBe(true);
    }
  });
});

describe('publishableListingSchema', () => {
  it('accepts a complete listing', () => {
    expect(publishableListingSchema.parse(validForm)).toEqual({
      title: 'Vintage denim jacket',
      description: 'Barely worn.',
      price: 2450,
      condition: 'good',
    });
  });

  // The difference from the draft schema: blanks are no longer acceptable.
  it('requires a title', () => {
    expect(publishableListingSchema.safeParse({ ...validForm, title: '' }).success).toBe(false);
    expect(publishableListingSchema.safeParse({ ...validForm, title: '   ' }).success).toBe(false);
  });

  it('requires a price', () => {
    expect(publishableListingSchema.safeParse({ ...validForm, price: '' }).success).toBe(false);
  });

  it('requires a condition', () => {
    expect(publishableListingSchema.safeParse({ ...validForm, condition: null }).success).toBe(
      false,
    );
  });

  it('still allows an empty description, which is NOT NULL DEFAULT in the DB', () => {
    expect(publishableListingSchema.safeParse({ ...validForm, description: '' }).success).toBe(
      true,
    );
  });
});

describe('publishBlockers', () => {
  const completeDraft = {
    title: 'Vintage denim jacket',
    price_amount: 2450,
    condition: 'good' as const,
    status: 'draft' as const,
  };

  it('reports nothing for a complete draft with a photo', () => {
    expect(publishBlockers(completeDraft, 1)).toEqual([]);
  });

  it('reports each missing field', () => {
    expect(publishBlockers({ ...completeDraft, title: null }, 1)).toEqual(['title']);
    expect(publishBlockers({ ...completeDraft, price_amount: null }, 1)).toEqual(['price']);
    expect(publishBlockers({ ...completeDraft, condition: null }, 1)).toEqual(['condition']);
  });

  it('reports zero photos', () => {
    expect(publishBlockers(completeDraft, 0)).toEqual(['photos']);
  });

  it('treats a whitespace-only title as missing', () => {
    expect(publishBlockers({ ...completeDraft, title: '   ' }, 1)).toEqual(['title']);
  });

  it('treats a non-positive price as missing', () => {
    expect(publishBlockers({ ...completeDraft, price_amount: 0 }, 1)).toEqual(['price']);
  });

  it('reports an already-published listing, which the RPC rejects as a double publish', () => {
    expect(publishBlockers({ ...completeDraft, status: 'active' }, 1)).toEqual(['status']);
  });

  it('reports every blocker at once', () => {
    expect(
      publishBlockers({ title: null, price_amount: null, condition: null, status: 'draft' }, 0),
    ).toEqual(['title', 'price', 'condition', 'photos']);
  });
});
