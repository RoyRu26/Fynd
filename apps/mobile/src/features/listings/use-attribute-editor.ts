import { useState } from 'react';

import {
  NO_BRAND,
  isBlankBrandInput,
  resolveTypedBrand,
  sameBrandSelection,
  type BrandSelection,
  type BrandSuggestion,
} from '@/features/brands/brands';
import {
  addKeyword as addKeywordTo,
  addTermsToEmptyKinds,
  applyOfferedTerm,
  canonicalSelection,
  describeRemovedTerms,
  MAX_KEYWORDS,
  pruneSelectionForCategory,
  removeKeyword as removeKeywordFrom,
  sameIdList,
  selectionFromValues,
  toggleTerm,
  type AttributeVocabulary,
} from '@/features/listings/attributes';
import {
  useAttributeVocabulary,
  useListingAttributes,
  useSetListingAttributes,
} from '@/features/listings/queries';

export type AttributeEditor = {
  vocab: AttributeVocabulary | undefined;
  /** Vocabulary and the listing's stored values have both loaded. */
  ready: boolean;
  loadError: boolean;
  selection: string[];
  keywords: string[];
  /** The keyword input's text, not yet added. Counts as an unsaved change. */
  keywordDraft: string;
  setKeywordDraft: (text: string) => void;
  /** The chosen brand: a catalog brand, the seller's own text, or none. */
  brand: BrandSelection;
  /** The brand input's text, not yet chosen. Counts as an unsaved change. */
  brandDraft: string;
  brandError: string | null;
  setBrandDraft: (text: string) => void;
  chooseBrand: (suggestion: Pick<BrandSuggestion, 'id' | 'name'>) => void;
  /** Commits `brandDraft` as a catalog brand (if it exactly names one of `suggestions`) or as custom text. */
  submitBrandDraft: (suggestions: readonly BrandSuggestion[]) => void;
  clearBrand: () => void;
  dirty: boolean;
  /** Set after a category change cleared values; cleared on the next edit. */
  notice: string | null;
  keywordError: string | null;
  toggle: (termId: string) => void;
  /** Adds `keywordDraft` as a keyword; clears the input on success. */
  submitKeywordDraft: () => void;
  removeKeyword: (keyword: string) => void;
  // ---- AI (Phase 2). Pre-fill never overwrites: each re-checks emptiness
  // inside the state update, so a value the seller chose a moment earlier
  // always wins over a late result. ----
  /** Adds terms only to kinds that are still empty. */
  prefillTerms: (termIds: readonly string[]) => void;
  /** Sets the brand only if there is none and none is being typed. */
  prefillBrand: (brand: BrandSelection) => void;
  /** Sets keywords only if there are none and none is being typed. */
  prefillKeywords: (keywords: readonly string[]) => void;
  /** The seller accepted an AI offer for a term. */
  applyTerm: (termId: string) => void;
  /** The seller accepted an AI brand offer. */
  applyBrand: (brand: BrandSelection) => void;
  /** The seller accepted an AI keyword offer. */
  addKeywordValue: (keyword: string) => void;
  /**
   * Saves only when dirty, committing any pending keyword or brand text
   * first. Never throws: returns a user-facing message on failure (null on
   * success), so a failed attribute save can't be mistaken for the whole
   * form failing.
   */
  save: () => Promise<string | null>;
};

export const ATTRIBUTE_SAVE_FAILED_MESSAGE =
  "Your other changes were saved, but the details weren't. Tap Save to try again.";

/**
 * Local editing state for a listing's structured details: attribute values,
 * keywords and brand. Kept separate from the react-hook-form form on purpose:
 * the form's fields and save path stay exactly as they were, and these go
 * through their own RPC (`set_listing_attributes`) after the form save.
 *
 * `categoryId` is the form's live, unsaved category. When it changes, values
 * that stop applying are removed right away and `notice` explains which —
 * decision 12. The database prunes the same values on save, so the two always
 * agree; this only makes it visible to the seller before they save. The brand
 * is not category-specific and is never pruned.
 */
export function useAttributeEditor(
  listingId: string,
  categoryId: string | null,
  categoryLabel: string | null,
): AttributeEditor {
  const vocabQuery = useAttributeVocabulary();
  const attributesQuery = useListingAttributes(listingId);
  const setAttributes = useSetListingAttributes(listingId);
  const vocab = vocabQuery.data;

  const [hydrated, setHydrated] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraftState] = useState('');
  const [brand, setBrand] = useState<BrandSelection>(NO_BRAND);
  const [brandDraft, setBrandDraftState] = useState('');
  const [brandError, setBrandError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<{
    selection: string[];
    keywords: string[];
    brand: BrandSelection;
  }>({ selection: [], keywords: [], brand: NO_BRAND });
  const [notice, setNotice] = useState<string | null>(null);
  const [keywordError, setKeywordError] = useState<string | null>(null);

  const [previousCategoryId, setPreviousCategoryId] = useState(categoryId);

  // Both adjustments below run during render ("adjusting state when a prop
  // changes"), not in effects, so there's never a frame showing stale values.

  // Hydrate once, and only from data fetched for this mount: a cached copy
  // can predate a save made a moment ago by another editor instance (draft
  // -> published swap after Publish), and saving that back would undo it.
  // Later refetches must not clobber in-progress edits; after our own save
  // the baseline is already current.
  if (!hydrated && vocab && attributesQuery.data && attributesQuery.isFetchedAfterMount) {
    const stored = selectionFromValues(vocab, attributesQuery.data.values);
    // The form's category may already differ from the saved one (e.g. picked
    // before the values loaded); start from what's valid under it, and say so.
    const { kept, removed } = pruneSelectionForCategory(vocab, stored, categoryId);
    setSelection(kept);
    setNotice(describeRemovedTerms(removed, categoryLabel));
    setKeywords(attributesQuery.data.keywords);
    setBrand(attributesQuery.data.brand);
    setBaseline({
      selection: stored,
      keywords: attributesQuery.data.keywords,
      brand: attributesQuery.data.brand,
    });
    setHydrated(true);
  }

  // Prune on a category change — from the picker or from an AI suggestion
  // alike, since both write the same form field.
  if (previousCategoryId !== categoryId) {
    setPreviousCategoryId(categoryId);
    if (vocab && hydrated) {
      const { kept, removed } = pruneSelectionForCategory(vocab, selection, categoryId);
      if (removed.length > 0) setSelection(kept);
      setNotice(describeRemovedTerms(removed, categoryLabel));
    }
  }

  const dirty =
    hydrated &&
    !!vocab &&
    (!sameIdList(canonicalSelection(vocab, selection), canonicalSelection(vocab, baseline.selection)) ||
      !sameIdList(keywords, baseline.keywords) ||
      keywordDraft.trim() !== '' ||
      !sameBrandSelection(brand, baseline.brand) ||
      !isBlankBrandInput(brandDraft));

  return {
    vocab,
    ready: hydrated,
    loadError: vocabQuery.isError || attributesQuery.isError,
    selection,
    keywords,
    keywordDraft,
    setKeywordDraft: (text) => {
      setKeywordError(null);
      setKeywordDraftState(text);
    },
    brand,
    brandDraft,
    brandError,
    setBrandDraft: (text) => {
      setBrandError(null);
      setBrandDraftState(text);
    },
    chooseBrand: (suggestion) => {
      setBrandError(null);
      setBrand({ kind: 'brand', id: suggestion.id, name: suggestion.name });
      setBrandDraftState('');
    },
    submitBrandDraft: (suggestions) => {
      const result = resolveTypedBrand(brandDraft, suggestions);
      setBrandError(result.error);
      if (result.error || result.selection.kind === 'none') return;
      setBrand(result.selection);
      setBrandDraftState('');
    },
    clearBrand: () => {
      setBrandError(null);
      // Removing a custom brand hands its text back to the input, so fixing a
      // typo doesn't mean retyping the whole name.
      if (brand.kind === 'text') setBrandDraftState(brand.text);
      setBrand(NO_BRAND);
    },
    dirty,
    notice,
    keywordError,
    toggle: (termId) => {
      if (!vocab) return;
      setNotice(null);
      setSelection((current) => toggleTerm(vocab, current, termId));
    },
    submitKeywordDraft: () => {
      const result = addKeywordTo(keywords, keywordDraft);
      setKeywordError(result.error);
      setKeywords(result.keywords);
      if (result.error === null) setKeywordDraftState('');
    },
    removeKeyword: (keyword) => {
      setKeywordError(null);
      setKeywords((current) => removeKeywordFrom(current, keyword));
    },
    prefillTerms: (termIds) => {
      if (!vocab || !hydrated) return;
      setSelection((current) => addTermsToEmptyKinds(vocab, current, termIds));
    },
    prefillBrand: (suggested) => {
      if (!hydrated || !isBlankBrandInput(brandDraft)) return;
      setBrand((current) => (current.kind === 'none' ? suggested : current));
    },
    prefillKeywords: (suggested) => {
      if (!hydrated || keywordDraft.trim() !== '') return;
      setKeywords((current) => (current.length === 0 ? [...suggested].slice(0, MAX_KEYWORDS) : current));
    },
    applyTerm: (termId) => {
      if (!vocab) return;
      setNotice(null);
      setSelection((current) => applyOfferedTerm(vocab, current, termId));
    },
    applyBrand: (suggested) => {
      setBrandError(null);
      setBrandDraftState('');
      setBrand(suggested);
    },
    addKeywordValue: (keyword) => {
      setKeywordError(null);
      setKeywords((current) =>
        current.includes(keyword) || current.length >= MAX_KEYWORDS ? current : [...current, keyword],
      );
    },
    save: async () => {
      if (!dirty || !vocab) return null;

      // Typed but never added: add it now rather than silently dropping it.
      const pendingKeywords = addKeywordTo(keywords, keywordDraft);
      if (pendingKeywords.error) {
        setKeywordError(pendingKeywords.error);
        return ATTRIBUTE_SAVE_FAILED_MESSAGE;
      }

      // Same for brand text. No suggestions are available here, so it is sent
      // as text and the server resolves an exact alias match itself; the
      // brand it stored is adopted below.
      let brandToSave = brand;
      if (!isBlankBrandInput(brandDraft)) {
        const pendingBrand = resolveTypedBrand(brandDraft, []);
        if (pendingBrand.error) {
          setBrandError(pendingBrand.error);
          return ATTRIBUTE_SAVE_FAILED_MESSAGE;
        }
        brandToSave = pendingBrand.selection;
      }

      let saved;
      try {
        saved = await setAttributes.mutateAsync({
          termIds: canonicalSelection(vocab, selection),
          keywords: pendingKeywords.keywords,
          brand: brandToSave,
        });
      } catch (err) {
        if (__DEV__) {
          console.error(err);
        }
        return ATTRIBUTE_SAVE_FAILED_MESSAGE;
      }

      // Adopt what the server stored — typed brand text may now be a catalog brand.
      const savedSelection = canonicalSelection(vocab, selectionFromValues(vocab, saved.values));
      setKeywords(saved.keywords);
      setBrand(saved.brand);
      setKeywordDraftState('');
      setBrandDraftState('');
      setBaseline({ selection: savedSelection, keywords: saved.keywords, brand: saved.brand });
      return null;
    },
  };
}
