import { describe, expect, it } from 'vitest';

import {
  DESCRIPTION_MAX_LENGTH,
  LISTING_CONDITIONS,
  draftListingSchema,
  publishBlockers,
  publishableListingSchema,
  TITLE_MAX_LENGTH,
} from '@/features/listings/schemas';
import { LISTING_SIZES } from '@/features/listings/size';

const VALID_CATEGORY_ID = 'c0000001-0000-4000-8000-000000000001';

const validForm = {
  title: 'Vintage denim jacket',
  description: 'Barely worn.',
  price: '24.50',
  condition: 'good' as const,
  size: 'alpha_m' as const,
  categoryId: VALID_CATEGORY_ID,
};

describe('draftListingSchema', () => {
  it('accepts a complete draft and converts the price to minor units', () => {
    const result = draftListingSchema.parse(validForm);
    expect(result).toEqual({
      title: 'Vintage denim jacket',
      description: 'Barely worn.',
      price: 2450,
      condition: 'good',
      size: 'alpha_m',
      categoryId: VALID_CATEGORY_ID,
    });
  });

  // M1 made title/price/condition nullable precisely so this is legal; size
  // and categoryId (ROADMAP 2.1) follow the same rule.
  it('accepts a fully empty draft, mapping blanks to null', () => {
    const result = draftListingSchema.parse({
      title: '',
      description: '',
      price: '',
      condition: null,
      size: null,
      categoryId: null,
    });
    expect(result).toEqual({
      title: null,
      description: '',
      price: null,
      condition: null,
      size: null,
      categoryId: null,
    });
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

  // The draft half of the size contract: a seller can save progress before
  // they have decided on a size, exactly as with title/price/condition.
  it('accepts a draft with no size', () => {
    expect(draftListingSchema.safeParse({ ...validForm, size: null }).success).toBe(true);
  });

  it('rejects a size outside the database enum', () => {
    expect(draftListingSchema.safeParse({ ...validForm, size: 'M' }).success).toBe(false);
    expect(draftListingSchema.safeParse({ ...validForm, size: 'medium' }).success).toBe(false);
    expect(draftListingSchema.safeParse({ ...validForm, size: 'eu_shoe_99' }).success).toBe(false);
  });

  it('accepts every size the database defines', () => {
    for (const size of LISTING_SIZES) {
      expect(draftListingSchema.safeParse({ ...validForm, size }).success).toBe(true);
    }
  });

  // The draft half of the category contract (ROADMAP 2.1): a seller can save
  // progress before picking a category, exactly as with size.
  it('accepts a draft with no category', () => {
    expect(draftListingSchema.safeParse({ ...validForm, categoryId: null }).success).toBe(true);
  });

  it('rejects a categoryId that is not a UUID', () => {
    expect(draftListingSchema.safeParse({ ...validForm, categoryId: 'women-tops' }).success).toBe(
      false,
    );
  });
});

describe('publishableListingSchema', () => {
  it('accepts a complete listing', () => {
    expect(publishableListingSchema.parse(validForm)).toEqual({
      title: 'Vintage denim jacket',
      description: 'Barely worn.',
      price: 2450,
      condition: 'good',
      size: 'alpha_m',
      categoryId: VALID_CATEGORY_ID,
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

  it('requires a size', () => {
    expect(publishableListingSchema.safeParse({ ...validForm, size: null }).success).toBe(false);
  });

  it('accepts a valid normalized size, including the numeric escape path', () => {
    expect(publishableListingSchema.safeParse({ ...validForm, size: 'alpha_xl' }).success).toBe(
      true,
    );
    expect(publishableListingSchema.safeParse({ ...validForm, size: 'eu_shoe_42' }).success).toBe(
      true,
    );
    expect(publishableListingSchema.safeParse({ ...validForm, size: 'one_size' }).success).toBe(
      true,
    );
  });

  it('still allows an empty description, which is NOT NULL DEFAULT in the DB', () => {
    expect(publishableListingSchema.safeParse({ ...validForm, description: '' }).success).toBe(
      true,
    );
  });

  // ROADMAP 2.1: publishing now requires a category, same as condition/size.
  it('requires a category', () => {
    expect(
      publishableListingSchema.safeParse({ ...validForm, categoryId: null }).success,
    ).toBe(false);
  });

  it('rejects a categoryId that is not a UUID', () => {
    expect(
      publishableListingSchema.safeParse({ ...validForm, categoryId: 'women-tops' }).success,
    ).toBe(false);
  });
});

describe('publishBlockers', () => {
  const completeDraft = {
    title: 'Vintage denim jacket',
    price_amount: 2450,
    condition: 'good' as const,
    size: 'alpha_m' as const,
    category_id: VALID_CATEGORY_ID as string | null,
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

  // The new publish requirement. An otherwise-complete listing with a photo
  // is still blocked purely for want of a size, matching publish_listing's
  // own guard — the DB remains authoritative, this just explains it first.
  it('reports a missing size on an otherwise-complete listing', () => {
    expect(publishBlockers({ ...completeDraft, size: null }, 1)).toEqual(['size']);
  });

  it('accepts a numeric shoe size as satisfying the size requirement', () => {
    expect(publishBlockers({ ...completeDraft, size: 'eu_shoe_42' }, 1)).toEqual([]);
  });

  it('accepts one_size as satisfying the size requirement', () => {
    expect(publishBlockers({ ...completeDraft, size: 'one_size' }, 1)).toEqual([]);
  });

  // ROADMAP 2.1's own new publish requirement, mirroring size exactly.
  it('reports a missing category on an otherwise-complete listing', () => {
    expect(publishBlockers({ ...completeDraft, category_id: null }, 1)).toEqual(['category']);
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
      publishBlockers(
        {
          title: null,
          price_amount: null,
          condition: null,
          size: null,
          category_id: null,
          status: 'draft',
        },
        0,
      ),
      // Order matches publish_listing's own guard order, so the first
      // blocker a seller is shown is the first one the server would hit.
    ).toEqual(['title', 'price', 'condition', 'size', 'category', 'photos']);
  });
});
