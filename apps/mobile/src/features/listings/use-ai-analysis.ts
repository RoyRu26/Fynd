import { useEffect, useRef, useState } from 'react';
import { useWatch, type UseFormReturn } from 'react-hook-form';

import { findCategorySelection, formatCategoryBreadcrumb, type CategoryGroup } from '@/features/categories/categories';
import { sameBrandSelection } from '@/features/brands/brands';
import {
  pendingOffers,
  planPrefill,
  prefilledKinds,
  type AiField,
  type AiOffer,
  type AiPrefill,
  type OfferContext,
  type SellerSnapshot,
} from '@/features/listings/ai-policy';
import { photoSetSignature, shouldAutoAnalyze, type AiSuggestion } from '@/features/listings/ai-suggestion';
import type { ListingAnalysis } from '@/features/listings/ai-suggestions';
import { useLatestListingAnalysis, useSuggestListingFromPhotos } from '@/features/listings/queries';
import type { DraftListingInput, ListingFormInput } from '@/features/listings/schemas';
import type { AttributeEditor } from '@/features/listings/use-attribute-editor';

/** How long the photo set must stay unchanged (and no upload in flight) before an automatic analysis. */
const PHOTO_SETTLE_MS = 1500;

type FormFieldName = 'title' | 'description' | 'price' | 'categoryId';

export type AiAnalysisStatus = 'idle' | 'analyzing' | 'unavailable';

export type AiAnalysis = {
  status: AiAnalysisStatus;
  /** A short, non-blocking note for the seller (failure or limit), or null. */
  message: string | null;
  /** Whether any analysis (fresh or restored) is available. */
  hasAnalysis: boolean;
  /** "AI suggests: …" offers for values that differ from the seller's, minus dismissed ones. */
  offers: AiOffer[];
  /** Fields currently holding exactly what AI pre-filled — shown with a "Suggested" mark. */
  suggestedFields: ReadonlySet<AiField>;
  priceRange: { minAmount: number; maxAmount: number } | null;
  canReanalyze: boolean;
  reanalyze: () => void;
  applyOffer: (offer: AiOffer) => void;
  dismissField: (field: AiField) => void;
  /** The seller edited a form field: drop its "Suggested" mark. */
  clearSuggested: (field: FormFieldName) => void;
};

/**
 * AI-assisted listing metadata in the draft editor (Phase 2). Owns when an
 * analysis runs and what its result may do; the policy itself is pure
 * (ai-policy.ts).
 *
 *   * Automatic analysis runs only when the analyzed photo set (the first 4
 *     images, in order) CHANGES during this editing session, after it has
 *     been stable for PHOTO_SETTLE_MS with no upload in flight. Text edits
 *     never trigger a request. Opening the editor never triggers one either:
 *     the photo set seen on open is the baseline, and the latest stored
 *     analysis is restored instead (no model call).
 *   * Re-analyze runs on demand; the server sends the saved title,
 *     description and category with the photos, and answers identical inputs
 *     from its cache (no model call, no quota).
 *   * A result pre-fills only fields that are empty AT ARRIVAL (re-checked
 *     inside each update), so it never overwrites what the seller typed in
 *     the meantime. Everything else becomes an offer derived from current
 *     values. Only the newest request's result is used.
 *   * Non-blocking: the seller can keep editing; failures leave a short note
 *     and manual editing exactly as it was.
 */
export function useAiAnalysis({
  listingId,
  form,
  editor,
  photoPaths,
  photosInFlight,
  categoryGroups,
  currency,
}: {
  listingId: string;
  form: UseFormReturn<ListingFormInput, unknown, DraftListingInput>;
  editor: AttributeEditor;
  /** The listing's persisted image paths in order, or undefined while loading. */
  photoPaths: string[] | undefined;
  photosInFlight: number;
  categoryGroups: CategoryGroup[];
  currency: string;
}): AiAnalysis {
  const latestQuery = useLatestListingAnalysis(listingId);
  const suggest = useSuggestListingFromPhotos(listingId);
  const watched = useWatch({ control: form.control });

  const [freshAnalysis, setFreshAnalysis] = useState<ListingAnalysis | null>(null);
  const [status, setStatus] = useState<AiAnalysisStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [lastPrefill, setLastPrefill] = useState<AiPrefill | null>(null);
  const [prefilledFormFields, setPrefilledFormFields] = useState<ReadonlySet<FormFieldName>>(new Set());

  // An analysis describes one photo set; it is shown only while the draft
  // still has exactly those photos (first 4, in order). After the photos
  // change, its offers disappear until the new set is analyzed.
  const signature = photoPaths ? photoSetSignature(photoPaths) : null;
  const latest = freshAnalysis ?? latestQuery.data ?? null;
  const analysis = latest && signature !== null && photoSetSignature(latest.imagePaths) === signature ? latest : null;

  // The newest request wins; a result for an older one is ignored.
  const requestSeq = useRef(0);
  const lastRequestedSignature = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Always the editor from the latest render, for results that arrive later.
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });

  const isKnownCategory = (id: string) => findCategorySelection(categoryGroups, id) !== null;
  const offerContext: OfferContext = {
    vocab: editor.vocab,
    isKnownCategory,
    categoryLabel: (id) => {
      const selection = findCategorySelection(categoryGroups, id);
      return selection ? formatCategoryBreadcrumb(selection.group, selection.leaf) : null;
    },
    currency,
  };

  function snapshot(values: Partial<ListingFormInput>, current: AttributeEditor): SellerSnapshot {
    return {
      title: values.title ?? '',
      description: values.description ?? '',
      price: values.price ?? '',
      categoryId: values.categoryId ?? null,
      condition: values.condition ?? null,
      selection: current.selection,
      brand: current.brand,
      brandDraft: current.brandDraft,
      keywords: current.keywords,
      keywordDraft: current.keywordDraft,
    };
  }

  // Runs when a result arrives: `editorRef` gives the editor from the latest
  // render, and every write below re-checks emptiness at that moment.
  function applyPrefill(suggestion: AiSuggestion) {
    const current = editorRef.current;
    const plan = planPrefill(suggestion, snapshot(form.getValues(), current), { ...offerContext, vocab: current.vocab });

    const filled = new Set<FormFieldName>();
    for (const field of ['title', 'description', 'price', 'categoryId'] as const) {
      const value = plan.form[field];
      // Re-read right before writing: never overwrite what was typed meanwhile.
      const now = form.getValues(field);
      if (value === undefined || (typeof now === 'string' ? now.trim() !== '' : now !== null && now !== undefined)) continue;
      form.setValue(field, value, { shouldDirty: true });
      filled.add(field);
    }
    if (plan.termIds.length > 0) current.prefillTerms(plan.termIds);
    if (plan.brand) current.prefillBrand(plan.brand);
    if (plan.keywords) current.prefillKeywords(plan.keywords);

    // Merged with earlier pre-fills, so a re-analysis that fills nothing new
    // keeps the "Suggested" marks on values AI filled before.
    setLastPrefill((previous) => ({
      form: { ...previous?.form, ...plan.form },
      termIds: [...new Set([...(previous?.termIds ?? []), ...plan.termIds])],
      brand: plan.brand ?? previous?.brand ?? null,
      keywords: plan.keywords ?? previous?.keywords ?? null,
    }));
    setPrefilledFormFields((previous) => new Set([...previous, ...filled]));
  }

  async function run() {
    const seq = ++requestSeq.current;
    lastRequestedSignature.current = photoPaths ? photoSetSignature(photoPaths) : null;
    setStatus('analyzing');
    setMessage(null);

    let result;
    try {
      result = await suggest.mutateAsync();
    } catch (err) {
      // suggestListingFromPhotos maps expected failures to {ok:false}; this is
      // the unexpected rest. Never leave the editor stuck "analyzing".
      if (__DEV__) {
        console.error(err);
      }
      if (mounted.current && seq === requestSeq.current) {
        setStatus('unavailable');
        setMessage("Couldn't analyze your photos right now. You can fill in the details yourself.");
      }
      return;
    }
    if (!mounted.current || seq !== requestSeq.current) return;

    if (!result.ok) {
      setStatus(result.reason === 'no_photos' ? 'idle' : 'unavailable');
      setMessage(result.reason === 'no_photos' ? null : result.message);
      return;
    }
    setStatus('idle');
    setFreshAnalysis({ analysisId: result.analysisId, imagePaths: result.imagePaths, suggestion: result.suggestion });
    setDismissed(new Set());
    applyPrefill(result.suggestion);
  }

  // ---- Automatic analysis when the analyzed photo set changes ----
  // The set seen when the photos first load is the baseline: reopening a
  // draft never analyzes by itself (the stored analysis is restored instead).
  const [baseline, setBaseline] = useState<string | null>(null);
  if (baseline === null && signature !== null) {
    setBaseline(signature);
  }

  const ready = editor.ready && categoryGroups.length > 0;
  useEffect(() => {
    const due = shouldAutoAnalyze({
      baseline,
      signature,
      lastRequested: lastRequestedSignature.current,
      photosInFlight,
      ready,
    });
    if (!due) return;
    const timer = setTimeout(() => {
      void run();
    }, PHOTO_SETTLE_MS);
    return () => clearTimeout(timer);
    // `run` is recreated every render; the inputs that should restart the
    // settle timer are exactly these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, baseline, photosInFlight, ready]);

  // ---- Derived on every render from the seller's CURRENT values ----
  const seller = snapshot(watched as Partial<ListingFormInput>, editor);
  const offers = analysis ? pendingOffers(analysis.suggestion, seller, offerContext, dismissed) : [];

  const suggestedFields = new Set<AiField>(prefilledFormFields);
  for (const kind of prefilledKinds(lastPrefill, editor.selection, editor.vocab)) suggestedFields.add(kind);
  if (lastPrefill?.brand && sameBrandSelection(lastPrefill.brand, editor.brand)) suggestedFields.add('brand');
  if (
    lastPrefill?.keywords &&
    lastPrefill.keywords.length === editor.keywords.length &&
    lastPrefill.keywords.every((keyword, index) => editor.keywords[index] === keyword)
  ) {
    suggestedFields.add('keywords');
  }

  return {
    status,
    message,
    hasAnalysis: analysis !== null,
    offers,
    suggestedFields,
    priceRange: analysis?.suggestion.price ?? null,
    canReanalyze: ready && status !== 'analyzing' && (photoPaths?.length ?? 0) > 0 && photosInFlight === 0,
    reanalyze: () => {
      void run();
    },
    applyOffer: (offer) => {
      const action = offer.action;
      switch (action.type) {
        case 'setTitle':
          form.setValue('title', action.value, { shouldDirty: true });
          break;
        case 'setDescription':
          form.setValue('description', action.value, { shouldDirty: true });
          break;
        case 'setPrice':
          form.setValue('price', action.value, { shouldDirty: true });
          break;
        case 'setCategory':
          form.setValue('categoryId', action.categoryId, { shouldDirty: true });
          break;
        case 'setCondition':
          form.setValue('condition', action.value, { shouldDirty: true });
          break;
        case 'addTerm':
          editor.applyTerm(action.termId);
          break;
        case 'setBrand':
          editor.applyBrand(action.brand);
          break;
        case 'addKeyword':
          editor.addKeywordValue(action.keyword);
          break;
      }
    },
    dismissField: (field) => {
      setDismissed((current) => {
        const next = new Set(current);
        for (const offer of offers) if (offer.field === field) next.add(offer.key);
        return next;
      });
    },
    clearSuggested: (field) => {
      setPrefilledFormFields((current) => {
        if (!current.has(field)) return current;
        const next = new Set(current);
        next.delete(field);
        return next;
      });
    },
  };
}
