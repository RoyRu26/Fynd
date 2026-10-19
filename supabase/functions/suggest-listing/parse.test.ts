import { assertEquals, assertThrows } from 'jsr:@std/assert@1';

import { parseAndValidateSuggestion, SuggestionValidationError } from './parse.ts';
import type { CategoryPath } from './categories.ts';

const CATEGORY_PATHS: CategoryPath[] = [
  { path: 'Women > Tops', categoryId: 'cat-women-tops' },
  { path: 'Electronics > Phones & tablets', categoryId: 'cat-electronics-phones' },
];

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Blue denim jacket',
    description: 'Lightly worn blue denim jacket, size M.',
    condition: 'good',
    category_path: 'Women > Tops',
    price_min_amount: 4000,
    price_max_amount: 6000,
    ...overrides,
  };
}

Deno.test('parseAndValidateSuggestion accepts a fully valid input and resolves the category id', () => {
  const result = parseAndValidateSuggestion(validInput(), CATEGORY_PATHS);
  assertEquals(result, {
    title: 'Blue denim jacket',
    description: 'Lightly worn blue denim jacket, size M.',
    condition: 'good',
    categoryId: 'cat-women-tops',
    priceMinAmount: 4000,
    priceMaxAmount: 6000,
  });
});

Deno.test('parseAndValidateSuggestion trims the title', () => {
  const result = parseAndValidateSuggestion(validInput({ title: '  Blue denim jacket  ' }), CATEGORY_PATHS);
  assertEquals(result.title, 'Blue denim jacket');
});

Deno.test('parseAndValidateSuggestion resolves categoryId to null for an unrecognized category_path', () => {
  const result = parseAndValidateSuggestion(validInput({ category_path: 'Not A Real > Path' }), CATEGORY_PATHS);
  assertEquals(result.categoryId, null);
});

Deno.test('parseAndValidateSuggestion rejects a non-object input', () => {
  assertThrows(() => parseAndValidateSuggestion('not an object', CATEGORY_PATHS), SuggestionValidationError);
  assertThrows(() => parseAndValidateSuggestion(null, CATEGORY_PATHS), SuggestionValidationError);
  assertThrows(() => parseAndValidateSuggestion(undefined, CATEGORY_PATHS), SuggestionValidationError);
});

Deno.test('parseAndValidateSuggestion rejects a missing or empty title', () => {
  assertThrows(() => parseAndValidateSuggestion(validInput({ title: undefined }), CATEGORY_PATHS), SuggestionValidationError);
  assertThrows(() => parseAndValidateSuggestion(validInput({ title: '   ' }), CATEGORY_PATHS), SuggestionValidationError);
});

Deno.test('parseAndValidateSuggestion rejects a title over 120 characters', () => {
  assertThrows(
    () => parseAndValidateSuggestion(validInput({ title: 'x'.repeat(121) }), CATEGORY_PATHS),
    SuggestionValidationError,
  );
});

Deno.test('parseAndValidateSuggestion rejects a description over 5000 characters', () => {
  assertThrows(
    () => parseAndValidateSuggestion(validInput({ description: 'x'.repeat(5001) }), CATEGORY_PATHS),
    SuggestionValidationError,
  );
});

Deno.test('parseAndValidateSuggestion rejects a condition outside the real 5-value enum', () => {
  assertThrows(() => parseAndValidateSuggestion(validInput({ condition: 'mint' }), CATEGORY_PATHS), SuggestionValidationError);
  assertThrows(() => parseAndValidateSuggestion(validInput({ condition: 'NEW' }), CATEGORY_PATHS), SuggestionValidationError);
});

Deno.test('parseAndValidateSuggestion accepts every real condition value', () => {
  for (const condition of ['new', 'like_new', 'very_good', 'good', 'fair']) {
    const result = parseAndValidateSuggestion(validInput({ condition }), CATEGORY_PATHS);
    assertEquals(result.condition, condition);
  }
});

Deno.test('parseAndValidateSuggestion rejects a non-integer price', () => {
  assertThrows(
    () => parseAndValidateSuggestion(validInput({ price_min_amount: 40.5 }), CATEGORY_PATHS),
    SuggestionValidationError,
  );
  assertThrows(
    () => parseAndValidateSuggestion(validInput({ price_max_amount: '6000' }), CATEGORY_PATHS),
    SuggestionValidationError,
  );
});

Deno.test('parseAndValidateSuggestion rejects a negative price', () => {
  assertThrows(
    () => parseAndValidateSuggestion(validInput({ price_min_amount: -100 }), CATEGORY_PATHS),
    SuggestionValidationError,
  );
});

Deno.test('parseAndValidateSuggestion rejects price_max_amount below price_min_amount', () => {
  assertThrows(
    () => parseAndValidateSuggestion(validInput({ price_min_amount: 6000, price_max_amount: 4000 }), CATEGORY_PATHS),
    SuggestionValidationError,
  );
});

Deno.test('parseAndValidateSuggestion accepts price_min_amount === price_max_amount', () => {
  const result = parseAndValidateSuggestion(
    validInput({ price_min_amount: 5000, price_max_amount: 5000 }),
    CATEGORY_PATHS,
  );
  assertEquals(result.priceMinAmount, 5000);
  assertEquals(result.priceMaxAmount, 5000);
});
