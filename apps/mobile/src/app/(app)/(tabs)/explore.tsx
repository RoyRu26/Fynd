import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import { CollageBlock, type CollageItem } from '@/components/listing/collage-grid';
import {
  Button,
  Chip,
  EmptyState,
  Icon,
  IconButton,
  ListRow,
  Screen,
  Sheet,
  Skeleton,
  StoryRing,
  Text,
  TextField,
  type IconName,
} from '@/components/ui';
import { useAppTheme } from '@/design/theme-provider';
import { border, minTouchTarget, radius, space } from '@/design/tokens';
import { CategoryPickerContent, getCategoryPickerTitle } from '@/features/categories/category-picker-sheet';
import {
  findCategoryMatch,
  formatCategoryMatchLabel,
  groupCategoriesByParent,
  type Category,
  type CategoryGroup,
} from '@/features/categories/categories';
import { useCategories } from '@/features/categories/queries';
import { describeRemovedTerms, type AttributeKind } from '@/features/listings/attributes';
import { CONDITION_LABELS } from '@/features/listings/condition';
import { mapListingError } from '@/features/listings/errors';
import { currencySymbol, formatMinorUnitsForInput } from '@/features/listings/price';
import { useAttributeVocabulary } from '@/features/listings/queries';
import { LISTING_CONDITIONS } from '@/features/listings/schemas';
import {
  formatSizeLabel,
  listingSizesBySystem,
  SIZE_SYSTEM_LABELS,
  type SizeSystem,
} from '@/features/listings/size';
import {
  deriveActiveFilterChips,
  EMPTY_EXPLORE_FILTERS,
  getExploreEmptyCopy,
  hasActiveFilters,
  parsePriceRangeInput,
  PRICE_CURRENCY,
  removeFilter,
  toSearchFilters,
  type ActiveFilterRemoval,
  type ExploreFilters,
} from '@/features/search/active-filters';
import type { SearchListing } from '@/features/search/api';
import { AttributeFilterFields } from '@/features/search/attribute-filter-fields';
import { BrandFilterField } from '@/features/search/brand-filter-field';
import {
  chunkIntoBlocks,
  COLLAGE_BLOCK_SIZE,
  getCollageBlockHeight,
  getCollageSlot,
  getCollageTileRect,
  isFeatureSlot,
  COLLAGE_GAP,
} from '@/features/search/collage';
import { shuffleWithSeed } from '@/features/search/shuffle';
import { useSearch } from '@/features/search/queries';
import {
  categoryScope,
  clearTermKind,
  pruneTermFiltersForScope,
  SEARCH_SORT_LABELS,
  SEARCH_SORT_ORDER,
  toggleBrandFilter,
  toggleTermFilter,
  type BrandFilterValue,
  type SearchSort,
} from '@/features/search/search';
import { useRecentSearches } from '@/features/search/use-recent-searches';
import { isJustDropped } from '@/features/listings/recency';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

/**
 * Explore — DESIGN.md §14.2's collage wall. Reuses the existing search backend
 * (`features/search/`) exactly as built: no new RPC, no new table.
 *
 * The grid is a `FlatList` whose rows are 9-item BLOCKS, not listings. The
 * handoff's layout spans columns and rows, which no masonry list can express,
 * so each block renders its tiles at absolute positions inside a box of known
 * height (`features/search/collage.ts` owns that geometry and is tested).
 * Keeping it a FlatList is what preserves recycling and `onEndReached`
 * pagination; a plain ScrollView would have meant hand-rolling both.
 *
 * The search pill is a persistent sibling `View` rendered directly under
 * `<Screen>`, ABOVE whichever FlatList is currently shown — never inside
 * either list's `ListHeaderComponent`. Toggling between the collage and the
 * recent-searches list swaps which FlatList is mounted (they carry distinct
 * `key`s), and if the TextField lived in either header it would unmount with
 * it, dropping keyboard focus the instant recent searches appear. Each
 * FlatList is still the screen's only SCROLL container — `onEndReached` never
 * fires correctly if something else does the actual scrolling, hence
 * `Screen`'s default `scroll={false}`.
 *
 * Two things the handoff asks for that the data cannot support yet, both
 * deliberately omitted rather than faked:
 *
 *   * **Save counts.** There is no `ReactionPill` on the tiles because no
 *     query exposes a count: `favorites`' RLS is `user_id = auth.uid()`, so a
 *     client can only ever see its OWN favourites. A real count needs a
 *     `SECURITY DEFINER` RPC or a denormalised counter column — a schema
 *     change, out of scope for a UI task.
 *   * **Vibes.** "Drops" rings and the non-recency stickers use the real
 *     category taxonomy, because vibes are not a column. The tag says
 *     something true rather than inventing a parallel taxonomy.
 *
 * The empty, no-query/no-filter state is a deliberate full-catalog browse, not
 * a "type something" placeholder — `search_listings` treats all-null arguments
 * as "every active listing, newest first" (see `getExploreEmptyCopy`).
 */

const CLEAR_ICON: IconName = { ios: 'xmark', android: 'close', web: 'close' };
const FILTERS_ICON: IconName = {
  ios: 'line.3.horizontal.decrease.circle',
  android: 'filter_list',
  web: 'filter_list',
};
const ERROR_ICON: IconName = { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' };
const EMPTY_ICON: IconName = { ios: 'magnifyingglass', android: 'search_off', web: 'search_off' };
const CATEGORY_CHEVRON_ICON: IconName = { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' };
// Verified against the installed packages: 'clock' exists in
// sf-symbols-typescript's types, and 'history' exists in expo-symbols'
// android/symbols.json.
const RECENT_SEARCH_ICON: IconName = { ios: 'clock', android: 'history', web: 'history' };
// Verified the same way as every other IconName here: both names exist in
// sf-symbols-typescript's types and expo-symbols' android/symbols.json.
const SEARCH_ICON: IconName = { ios: 'magnifyingglass', android: 'search', web: 'search' };
const SORT_SELECTED_ICON: IconName = { ios: 'checkmark', android: 'check', web: 'check' };

/** Mirrors `Screen`'s own `padded` horizontal inset (space[5]); see `collageWidth`. */
const SCREEN_HORIZONTAL_PADDING = space[5];

/** Diameter of a Drops ring, per the handoff. */
const DROPS_RING_SIZE = 64;

/** The filter disc inside the search pill, per the handoff. */
const FILTER_BUTTON_SIZE = 36;

/**
 * Bottom clearance so the last collage block is not stranded under the native
 * tab bar. `NativeTabs` does not expose its height (and `app-tabs.tsx` is
 * fixed by the handoff's ground rules), so these are the platforms' own
 * standard bar heights.
 *
 * Per-platform because one number cannot serve both: iOS's UITabBar is 49pt,
 * while Android's Material `BottomNavigationView` is around 80dp — applying
 * the iOS value there would under-reserve by half a block. Purely additive
 * padding on top of `Screen`'s own safe-area inset, so over-reserving costs a
 * little blank space and under-reserving hides content; it errs high.
 */
const NATIVE_TAB_BAR_HEIGHT = Platform.select({ ios: 49, android: 80, default: 56 });

/** Diameter of the filter button's count badge — the same named-constant shape `ListRow` uses for its unread dot. */
const FILTER_BADGE_SIZE = space[5];

// Same display order the Sell editor's size selector already uses —
// independent of listingSizesBySystem's own Record key order.
const SIZE_SYSTEM_ORDER: SizeSystem[] = ['alpha', 'eu_shoe', 'one_size'];
// Derived once from the generated enum, not component state — the grouping
// never changes at runtime.
const SIZE_GROUPS = listingSizesBySystem();

/** The three fields a collage tile needs, before any sticker decision. */
function toCollageBase(listing: SearchListing): CollageItem {
  return { listingId: listing.listingId, title: listing.title, coverUrl: listing.coverUrl };
}

export default function ExploreScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { width: windowWidth } = useWindowDimensions();

  const [queryInput, setQueryInput] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [committedFilters, setCommittedFilters] = useState<ExploreFilters>(EMPTY_EXPLORE_FILTERS);
  const [sort, setSort] = useState<SearchSort>('newest');
  const recent = useRecentSearches();

  const debouncedQuery = useDebouncedValue(queryInput, 400);
  // Tapping a recent search runs it immediately instead of waiting out the
  // 400ms debounce window — set alongside `queryInput` by
  // `handleRecentSearchSelect`, and cleared by `handleQueryInputChange` so
  // normal typing always falls back to the debounce path below.
  const [immediateQuery, setImmediateQuery] = useState<string | null>(null);
  const effectiveQuery = (immediateQuery ?? debouncedQuery).trim();
  // Focused AND empty — not "focused regardless of content". Losing focus
  // or typing a character both naturally fall out of this one boolean, no
  // separate dismiss-on-type handling required.
  const showRecentSearches = searchFocused && queryInput.trim().length === 0;

  function handleQueryInputChange(text: string) {
    setQueryInput(text);
    setImmediateQuery(null);
  }

  function handleSearchBlur() {
    setSearchFocused(false);
    // Uses the LIVE input value, not the debounced one, so a fast-typed
    // search committed before the debounce window elapses still records
    // correctly. Skipped when immediateQuery is still set: that means this
    // blur was triggered by handleRecentSearchSelect's own Keyboard.dismiss()
    // immediately after it already recorded the same query — recording
    // again would be a harmless but redundant AsyncStorage write + re-render.
    if (queryInput.trim().length > 0 && immediateQuery === null) {
      recent.record(queryInput);
    }
  }

  const handleRecentSearchSelect = useCallback(
    (query: string) => {
      setQueryInput(query);
      setImmediateQuery(query);
      recent.record(query);
      Keyboard.dismiss();
    },
    [recent],
  );

  const searchFilters = useMemo(
    () => toSearchFilters(committedFilters, effectiveQuery.length > 0 ? effectiveQuery : null, sort),
    [effectiveQuery, committedFilters, sort],
  );

  const searchQuery = useSearch(searchFilters);
  const listings = useMemo(
    () => searchQuery.data?.pages.flat() ?? [],
    [searchQuery.data],
  );

  const categoriesQuery = useCategories();
  const categoryGroups = useMemo(
    () => (categoriesQuery.data ? groupCategoriesByParent(categoriesQuery.data) : []),
    [categoriesQuery.data],
  );

  // `findCategoryMatch`, not `findCategorySelection`: the category tabs
  // commit a top-level GROUP id, which the leaf-only lookup cannot resolve —
  // and an unresolved label makes `deriveActiveFilterChips` drop the chip,
  // leaving a live filter invisible and unremovable.
  const committedCategoryMatch = findCategoryMatch(categoryGroups, committedFilters.categoryId);
  const committedCategoryLabel = formatCategoryMatchLabel(committedCategoryMatch);
  // A leaf chosen in the filter sheet still lights up its parent tab.
  const activeCategoryGroupId = committedCategoryMatch?.group.id ?? null;

  // Item type, color, style, … (ROADMAP 7.4). Cached for a day; until it
  // loads, attribute filters simply aren't offered and nothing is pruned.
  const vocabQuery = useAttributeVocabulary();
  const vocab = vocabQuery.data;

  const activeChips = useMemo(
    () => deriveActiveFilterChips(committedFilters, committedCategoryLabel, vocab),
    [committedFilters, committedCategoryLabel, vocab],
  );
  const filtersOrQueryActive = hasActiveFilters(committedFilters) || searchFilters.query !== null;

  // ============================================================
  // Filter Sheet draft state
  // ============================================================

  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  // Which content the one Filter Sheet instance shows -- NOT a second Sheet.
  // The category picker used to be its own `CategoryPickerSheet` (its own
  // `<Modal>`) that the filters view closed-and-reopened around, which left
  // a ~240ms window (Sheet's own close-animation duration) where both
  // Modals were simultaneously mounted (see `Sheet`'s `modalVisible`
  // two-phase-close comment). Folding the category view into this Sheet's
  // own body as a plain content swap means there is only ever one Modal
  // mounted for this entire flow.
  //
  // `sort` rides in the same Sheet for the same reason: it is never open at
  // the same time as the others, and reusing this instance keeps the screen
  // at exactly one Modal rather than adding a second that could overlap
  // during a close animation.
  const [pickerView, setPickerView] = useState<'filters' | 'category' | 'sort'>('filters');
  // The category view's own group->leaf drill-down state -- owned here
  // (not inside `CategoryPickerContent`) only so this screen's single Sheet
  // can read it back for its own `title`, exactly as `CategoryPickerSheet`
  // does internally for the Sell flow's separate Sheet.
  const [categoryActiveGroupId, setCategoryActiveGroupId] = useState<string | null>(null);
  const [draftFilters, setDraftFilters] = useState<ExploreFilters>(EMPTY_EXPLORE_FILTERS);
  const [draftPriceMinInput, setDraftPriceMinInput] = useState('');
  const [draftPriceMaxInput, setDraftPriceMaxInput] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);
  // "Removed Hoodie — it doesn't fit Women › Shoes." after a category change
  // in the sheet pruned attribute values; cleared by the next filter edit.
  const [pruneNotice, setPruneNotice] = useState<string | null>(null);
  // Latest committed draft, read by handlers that must derive a side effect
  // (the prune notice + announcement) without doing it inside an updater.
  const draftFiltersRef = useRef(draftFilters);
  useEffect(() => {
    draftFiltersRef.current = draftFilters;
  }, [draftFilters]);
  const draftScope = useMemo(
    () => categoryScope(categoryGroups, draftFilters.categoryId),
    [categoryGroups, draftFilters.categoryId],
  );

  function openFilterSheet() {
    // Initialized from committedFilters only at the moment the sheet opens
    // (not earlier) — editing a draft copy, discarded on dismiss, never
    // live-previewed against the grid until "Apply".
    setDraftFilters(committedFilters);
    setDraftPriceMinInput(formatMinorUnitsForInput(committedFilters.priceMin));
    setDraftPriceMaxInput(formatMinorUnitsForInput(committedFilters.priceMax));
    setPriceError(null);
    setPruneNotice(null);
    setPickerView('filters');
    setCategoryActiveGroupId(null);
    setFilterSheetOpen(true);
  }

  function handleApplyFilters() {
    const parsed = parsePriceRangeInput(draftPriceMinInput, draftPriceMaxInput);
    if (typeof parsed.error === 'string') {
      setPriceError(parsed.error);
      return;
    }
    setCommittedFilters({ ...draftFilters, priceMin: parsed.priceMin, priceMax: parsed.priceMax });
    setFilterSheetOpen(false);
  }

  function handleClearDraft() {
    setDraftFilters(EMPTY_EXPLORE_FILTERS);
    setDraftPriceMinInput('');
    setDraftPriceMaxInput('');
    setPriceError(null);
    setPruneNotice(null);
  }

  // Every in-sheet draft edit goes through here, so the prune notice clears
  // on the next change of any kind, not just term toggles.
  function updateDraft(updater: (prev: ExploreFilters) => ExploreFilters) {
    setPruneNotice(null);
    setDraftFilters(updater);
  }

  function handleDraftPriceMinChange(text: string) {
    setPruneNotice(null);
    setDraftPriceMinInput(text);
  }

  function handleDraftPriceMaxChange(text: string) {
    setPruneNotice(null);
    setDraftPriceMaxInput(text);
  }

  function handleToggleTerm(termId: string) {
    if (!vocab) return;
    updateDraft((prev) => ({ ...prev, termIds: toggleTermFilter(vocab, prev.termIds, termId) }));
  }

  function handleClearTermKind(kind: AttributeKind) {
    updateDraft((prev) => ({ ...prev, termIds: clearTermKind(prev.termIds, kind) }));
  }

  function handleToggleBrand(brand: BrandFilterValue) {
    updateDraft((prev) => ({ ...prev, brands: toggleBrandFilter(prev.brands, brand) }));
  }

  // Category view opens inside the SAME Sheet instance as the filters view
  // (an instant content swap, no close/reopen, no second Modal) and on
  // select/clear it switches back to the filters view the same way, with
  // draftFilters.categoryId already updated.
  function openCategoryPicker() {
    setCategoryActiveGroupId(null);
    setPickerView('category');
  }

  // A narrower category prunes the attribute values that stop applying, and
  // says so (politely, in the sheet) — never silently keeping a filter the
  // category can no longer match.
  function handleCategorySelect(_group: CategoryGroup, leaf: Category) {
    const scope = categoryScope(categoryGroups, leaf.id);
    // The notice is derived outside the (pure) updater from the latest draft;
    // the updater re-prunes from `prev` so the state itself never goes stale.
    const { removed } = pruneTermFiltersForScope(vocab, draftFiltersRef.current.termIds, scope);
    setDraftFilters((prev) => ({
      ...prev,
      categoryId: leaf.id,
      termIds: pruneTermFiltersForScope(vocab, prev.termIds, scope).kept,
    }));
    const notice = describeRemovedTerms(
      removed,
      formatCategoryMatchLabel(findCategoryMatch(categoryGroups, leaf.id)),
    );
    setPruneNotice(notice);
    // accessibilityLiveRegion is Android-only, and a region mounted already
    // holding text is often skipped — announce explicitly as well.
    if (notice) AccessibilityInfo.announceForAccessibility(notice);
    setPickerView('filters');
  }

  // No category is the widest scope, so nothing can stop applying.
  function handleCategoryClear() {
    setDraftFilters((prev) => ({ ...prev, categoryId: null }));
    setPruneNotice(null);
    setPickerView('filters');
  }

  // Backdrop tap / drag dismiss / Android back on the one Filter Sheet:
  // from the category view this steps back to the filters view (still the
  // same Sheet, same Modal, no animation at all); from the filters view it
  // closes the Sheet for real, same as before this refactor.
  // Invariant: every opener sets `pickerView` itself, so the Sheet always
  // opens on a known view. It is deliberately NOT reset here — Sheet keeps the
  // Modal mounted through its ~240ms close animation, so resetting on close
  // would flash the filters view on the way out.
  function handleFilterSheetClose() {
    if (pickerView === 'category') {
      setCategoryActiveGroupId(null);
      setPickerView('filters');
      return;
    }
    // Sort is reached FROM the filters view, so dismissing it steps back
    // there rather than closing the sheet out from under the user.
    if (pickerView === 'sort') {
      setPickerView('filters');
      return;
    }
    setFilterSheetOpen(false);
  }

  // Swaps the view INSIDE the already-open sheet, the same way the category
  // picker does — reached from the filters view, so the sheet is never closed
  // and reopened around it.
  function openSortSheet() {
    setPickerView('sort');
  }

  function handleSortSelect(next: SearchSort) {
    setPruneNotice(null);
    setSort(next);
    setPickerView('filters');
  }

  function handleRemoveChip(removal: ActiveFilterRemoval) {
    setCommittedFilters((prev) => removeFilter(prev, removal));
  }

  // Filters only — the query and sort are the user's own text and choice,
  // not filters, and stay as they are.
  function clearAllFilters() {
    setCommittedFilters(EMPTY_EXPLORE_FILTERS);
  }

  // Tabs commit immediately (no draft/Apply round trip) — they are a browse
  // control, not part of the filter sheet's editable draft. `null` is "All".
  // Attribute values that stop applying are pruned silently here: the
  // active-filter row re-renders right below the rings, which is notice
  // enough for a one-tap browse control.
  function handleCategoryTabSelect(groupId: string | null) {
    const scope = categoryScope(categoryGroups, groupId);
    setCommittedFilters((prev) => ({
      ...prev,
      categoryId: groupId,
      termIds: pruneTermFiltersForScope(vocab, prev.termIds, scope).kept,
    }));
  }

  function clearAll() {
    setQueryInput('');
    setImmediateQuery(null);
    setCommittedFilters(EMPTY_EXPLORE_FILTERS);
  }

  // ============================================================
  // Grid wiring
  // ============================================================

  const openListing = useCallback(
    (listingId: string) => {
      router.push({ pathname: '/(app)/listing/[id]', params: { id: listingId } });
    },
    [router],
  );

  // Derived from the window rather than measured with `onLayout`, so the
  // blocks have their width on the FIRST render — a measured width starts at
  // 0 and would lay the whole collage out twice, visibly. The subtraction
  // mirrors `Screen`'s own `padded` horizontal inset; if that ever changes,
  // this has to follow.
  const collageWidth = windowWidth - SCREEN_HORIZONTAL_PADDING * 2;

  // Shuffle reorders what is already LOADED, not the catalogue — see
  // `shuffleWithSeed`. Seed 0 means "untouched", so the default order is the
  // query's own.
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const orderedListings = useMemo(
    () => shuffleWithSeed(listings, shuffleSeed),
    [listings, shuffleSeed],
  );

  const collageItems = useMemo<CollageItem[]>(
    () =>
      orderedListings.map((listing, index) => {
        const slot = index % COLLAGE_BLOCK_SIZE;
        // "just dropped" reuses the app's single shared recency rule rather
        // than the handoff's 24h. One definition of "new" across the feed and
        // Explore matters more than matching the mock's number, and 48h has
        // its own documented reasoning (see recency.ts).
        if (isJustDropped(listing.createdAt)) {
          return { ...toCollageBase(listing), stickerLabel: 'just dropped', stickerTone: 'accent' };
        }
        // The handoff's "vibe tag" has no column behind it — vibes are not in
        // the schema. The listing's own top-level category is the nearest
        // real data, so the tag says something true instead of inventing a
        // taxonomy. Wide tiles only, per `isFeatureSlot`.
        const categoryName = isFeatureSlot(slot)
          ? findCategoryMatch(categoryGroups, listing.categoryId)?.group.name
          : undefined;
        return categoryName
          ? { ...toCollageBase(listing), stickerLabel: categoryName, stickerTone: 'inverse' }
          : toCollageBase(listing);
      }),
    [orderedListings, categoryGroups],
  );

  const collageBlocks = useMemo(() => chunkIntoBlocks(collageItems), [collageItems]);

  const renderBlock = useCallback(
    ({ item }: ListRenderItemInfo<CollageItem[]>) => (
      <CollageBlock items={item} width={collageWidth} onPressItem={openListing} />
    ),
    [collageWidth, openListing],
  );

  const handleEndReached = useCallback(() => {
    if (searchQuery.hasNextPage && !searchQuery.isFetchingNextPage) {
      searchQuery.fetchNextPage();
    }
  }, [searchQuery]);

  // Matches on groups as well as leaves. The draft is seeded from the
  // committed filters, which a category TAB may have set to a group id — and
  // the leaf-only lookup resolves that to nothing, so the sheet would read
  // "Any category" while a category filter was demonstrably in effect. The
  // value itself survives Apply either way; it was only ever the label that
  // lied.
  const draftCategoryLabel =
    formatCategoryMatchLabel(findCategoryMatch(categoryGroups, draftFilters.categoryId)) ??
    'Any category';

  const sheetTitle =
    pickerView === 'sort'
      ? 'Sort'
      : pickerView === 'filters'
        ? 'Filters'
        : getCategoryPickerTitle(categoryGroups, categoryActiveGroupId);

  // Persistent sibling of whichever FlatList is currently shown (see the
  // header comment) — never itself part of either list's
  // `ListHeaderComponent`, so it never unmounts/remounts when the grid and
  // recent-searches lists swap.
  const searchBar = (
    <View style={styles.searchBar}>
      {/* Lowercase at the call site, not via textTransform — see DESIGN.md §5. */}
      <Text variant="display">explore</Text>
      <TextField
        shape="pill"
        placeholder="Brands, vibes, sizes…"
        accessibilityLabel="Search listings"
        value={queryInput}
        onChangeText={handleQueryInputChange}
        onFocus={() => setSearchFocused(true)}
        onBlur={handleSearchBlur}
        onSubmitEditing={() => Keyboard.dismiss()}
        returnKeyType="search"
        // Both adornments sit INSIDE the pill. The glyph is decorative — the
        // field's own accessibilityLabel already says "Search listings" — so
        // it is hidden from assistive tech per the `leading` contract.
        leading={
          <View accessible={false} importantForAccessibility="no">
            <Icon name={SEARCH_ICON} size="sm" color={colors.textTertiary} />
          </View>
        }
        trailing={
          <View style={styles.searchTrailing}>
            {queryInput.length > 0 ? (
              <IconButton
                icon={CLEAR_ICON}
                accessibilityLabel="Clear search"
                size="sm"
                onPress={() => {
                  setQueryInput('');
                  setImmediateQuery(null);
                }}
              />
            ) : null}
            <FilterButton activeCount={activeChips.length} onPress={openFilterSheet} />
          </View>
        }
      />
    </View>
  );

  // Grid-specific — none of this applies to the recent-searches list, so it
  // stays the grid FlatList's own header rather than joining the persistent
  // search bar above. It scrolls away with the results, which is the point.
  const gridHeader = (
    <View style={styles.gridHeader}>
      <DropsRow
        groups={categoryGroups}
        activeGroupId={activeCategoryGroupId}
        onSelect={handleCategoryTabSelect}
      />

      {activeChips.length > 0 ? (
        <View style={styles.chipRow}>
          {activeChips.map((chip) => (
            <Chip
              key={chip.key}
              label={chip.label}
              icon={CLEAR_ICON}
              // `inverse`, not the accent `selected` fill: these represent
              // filters already in effect and dismissible, not offers to
              // pick. `selected={false}` keeps the accent fill off while
              // still making the chip pressable to remove it.
              tone="inverse"
              selectable
              selected={false}
              accessibilityLabel={chip.accessibilityLabel}
              onPress={() => handleRemoveChip(chip.removal)}
            />
          ))}
          {activeChips.length >= 2 ? (
            <Button variant="ghost" size="sm" accessibilityLabel="Clear all filters" onPress={clearAllFilters}>
              Clear all
            </Button>
          ) : null}
        </View>
      ) : null}

      <View style={styles.sectionRow}>
        <Text variant="displaySm">fresh off the rack</Text>
        <Pressable
          onPress={() => setShuffleSeed((seed) => seed + 1)}
          accessibilityRole="button"
          // Says what it does to what — the control reorders the loaded
          // results, and "Shuffle" alone does not convey that.
          accessibilityLabel="Shuffle the results"
          style={({ pressed }) => [styles.shuffle, { opacity: pressed ? 0.7 : 1 }]}>
          <Text variant="bodyStrong" color="accentText">
            Shuffle
          </Text>
        </Pressable>
      </View>
    </View>
  );

  const renderRecentItem = useCallback(
    ({ item }: ListRenderItemInfo<string>) => (
      <ListRow
        leading={<Icon name={RECENT_SEARCH_ICON} size="sm" color={colors.textTertiary} />}
        title={item}
        accessibilityLabel={`Recent search, ${item}`}
        onPress={() => handleRecentSearchSelect(item)}
        trailing={
          <IconButton
            icon={CLEAR_ICON}
            accessibilityLabel={`Remove "${item}" from recent searches`}
            onPress={() => recent.remove(item)}
          />
        }
      />
    ),
    [colors.textTertiary, recent, handleRecentSearchSelect],
  );

  const recentListHeader = (
    <View style={styles.recentHeader}>
      <Text variant="label" color="textSecondary">
        Recent searches
      </Text>
      {recent.items.length > 0 ? (
        <Button variant="ghost" size="sm" onPress={recent.clear}>
          Clear all
        </Button>
      ) : null}
    </View>
  );

  const recentListEmpty = (
    <EmptyState variant="empty" icon={RECENT_SEARCH_ICON} title="No recent searches yet." />
  );

  let listEmpty: ReactNode = null;
  if (searchQuery.isPending) {
    // Mirrors the collage's own geometry rather than a tile grid, so the
    // loading state occupies the same shape the results will.
    listEmpty = (
      <View style={{ height: getCollageBlockHeight(COLLAGE_BLOCK_SIZE), width: collageWidth }}>
        {Array.from({ length: COLLAGE_BLOCK_SIZE }, (_, slot) => {
          const rect = getCollageTileRect({ cell: getCollageSlot(slot), containerWidth: collageWidth });
          return (
            <View
              key={slot}
              style={{ position: 'absolute', left: rect.left, top: rect.top }}>
              <Skeleton width={rect.width} height={rect.height} radius="lg" />
            </View>
          );
        })}
      </View>
    );
  } else if (searchQuery.isError) {
    listEmpty = (
      <EmptyState
        variant="error"
        icon={ERROR_ICON}
        title="Something went wrong"
        body={mapListingError(searchQuery.error).message}
        actionLabel="Try again"
        onAction={() => searchQuery.refetch()}
      />
    );
  } else {
    const emptyCopy = getExploreEmptyCopy(filtersOrQueryActive);
    listEmpty = (
      <EmptyState
        variant="empty"
        icon={EMPTY_ICON}
        title={emptyCopy.title}
        body={emptyCopy.body}
        actionLabel={filtersOrQueryActive ? 'Clear filters' : undefined}
        onAction={filtersOrQueryActive ? clearAll : undefined}
      />
    );
  }

  return (
    <Screen contentContainerStyle={styles.content}>
      {searchBar}

      {showRecentSearches ? (
        <FlatList
          key="recent"
          data={recent.items}
          keyExtractor={(item) => item}
          renderItem={renderRecentItem}
          ListHeaderComponent={recentListHeader}
          ListEmptyComponent={recentListEmpty}
          keyboardShouldPersistTaps="handled"
        />
      ) : (
        <FlatList
          key="grid"
          // One row per 9-item block, not per listing — the collage's column
          // and row spans cannot be expressed by any masonry list, and this
          // is what keeps recycling and onEndReached working anyway.
          data={collageBlocks}
          keyExtractor={(block) => block[0]?.listingId ?? 'empty'}
          renderItem={renderBlock}
          ItemSeparatorComponent={BlockSeparator}
          ListHeaderComponent={gridHeader}
          ListEmptyComponent={listEmpty}
          contentContainerStyle={styles.gridContent}
          // Required, not optional polish: the grid is on screen WITH the
          // keyboard up the moment the user types a character (that leaves
          // `showRecentSearches`). Without this the enclosing ScrollView
          // captures the first press to dismiss the keyboard, so the first
          // tap on a ring, chip, Shuffle or tile is swallowed. Capture runs
          // root-to-leaf, so setting it on the inner horizontal ScrollView
          // alone does nothing — it has to be here.
          keyboardShouldPersistTaps="handled"
          onEndReached={handleEndReached}
          onEndReachedThreshold={1.5}
          ListFooterComponent={
            searchQuery.isFetchingNextPage ? (
              <ActivityIndicator style={styles.footerSpinner} color={colors.textTertiary} />
            ) : null
          }
        />
      )}

      <Sheet
        visible={filterSheetOpen}
        onClose={handleFilterSheetClose}
        title={sheetTitle}
        // Pinned for the category view rather than following its drill-down
        // title, matching what `CategoryPickerSheet` announces for the same
        // content in the Sell flow. The other two views have no separate
        // wording, and Sheet falls back to `title` on its own.
        accessibilityLabel={pickerView === 'category' ? 'Choose a category' : sheetTitle}
        // Pinned, so Clear/Apply stay reachable however far the (now long)
        // filter list scrolls — and above the keyboard while a price is typed.
        footer={
          pickerView === 'filters' ? (
            <View style={styles.sheetFooter}>
              {priceError ? (
                <Text
                  variant="caption"
                  color="danger"
                  accessibilityLiveRegion="polite"
                  accessibilityRole="alert">
                  {priceError}
                </Text>
              ) : null}
              <View style={styles.sheetFooterButtons}>
                <Button variant="secondary" onPress={handleClearDraft} style={styles.sheetFooterButton}>
                  Clear
                </Button>
                <Button variant="primary" onPress={handleApplyFilters} style={styles.sheetFooterButton}>
                  Apply
                </Button>
              </View>
            </View>
          ) : undefined
        }>
        {pickerView === 'sort' ? (
          <View style={styles.sortOptions}>
            {SEARCH_SORT_ORDER.map((option) => (
              <ListRow
                key={option}
                title={SEARCH_SORT_LABELS[option]}
                // The checkmark alone cannot carry this: `Icon` is decorative
                // by contract and `ListRow` pins `accessibilityRole="button"`
                // with no `selected` state to pass, so without the suffix
                // both rows announce identically and the current sort is
                // visible only to sighted users (DESIGN.md §12.4).
                accessibilityLabel={
                  option === sort
                    ? `${SEARCH_SORT_LABELS[option]}, selected`
                    : SEARCH_SORT_LABELS[option]
                }
                onPress={() => handleSortSelect(option)}
                trailing={
                  option === sort ? (
                    <Icon name={SORT_SELECTED_ICON} size="sm" color={colors.accent} />
                  ) : null
                }
              />
            ))}
          </View>
        ) : pickerView === 'filters' ? (
          <View style={styles.sheetContent}>
            {/*
              Sort lives in the sheet now. 4a's header has no sort control —
              it is "fresh off the rack" + Shuffle — but the capability is
              worth keeping, and the sheet is where the other result controls
              already are. Unlike the drafted filters below, it commits
              immediately: there is nothing to validate or cancel.
            */}
            <View style={styles.sortField}>
              <Text variant="label" color="textSecondary">
                Sort
              </Text>
              <CategoryPressableRow
                label={SEARCH_SORT_LABELS[sort]}
                selected
                onPress={openSortSheet}
              />
            </View>

            <View style={styles.categoryField}>
              <Text variant="label" color="textSecondary">
                Category
              </Text>
              <CategoryPressableRow
                label={draftCategoryLabel}
                selected={draftFilters.categoryId !== null}
                onPress={openCategoryPicker}
              />
              {pruneNotice ? (
                <Text variant="caption" color="textSecondary" accessibilityLiveRegion="polite">
                  {pruneNotice}
                </Text>
              ) : null}
            </View>

            <AttributeFilterFields
              only="item_type"
              vocab={vocab}
              vocabError={vocabQuery.isError}
              scope={draftScope}
              termIds={draftFilters.termIds}
              onToggle={handleToggleTerm}
              onClearKind={handleClearTermKind}
            />

            <BrandFilterField brands={draftFilters.brands} onToggle={handleToggleBrand} />

            <View style={styles.conditionField}>
              <Text variant="label" color="textSecondary">
                Condition
              </Text>
              <View style={styles.chipGroup}>
                <Chip
                  label="Any condition"
                  selectable
                  selected={draftFilters.condition === null}
                  onPress={() => updateDraft((prev) => ({ ...prev, condition: null }))}
                />
                {LISTING_CONDITIONS.map((value) => (
                  <Chip
                    key={value}
                    label={CONDITION_LABELS[value]}
                    selectable
                    selected={draftFilters.condition === value}
                    onPress={() => updateDraft((prev) => ({ ...prev, condition: value }))}
                  />
                ))}
              </View>
            </View>

            <View style={styles.sizeField}>
              <Text variant="label" color="textSecondary">
                Size
              </Text>
              <View style={styles.chipGroup}>
                <Chip
                  label="Any size"
                  selectable
                  selected={draftFilters.size === null}
                  onPress={() => updateDraft((prev) => ({ ...prev, size: null }))}
                />
              </View>
              <View style={styles.sizeGroups}>
                {SIZE_SYSTEM_ORDER.map((system) => (
                  <View key={system} style={styles.sizeGroup}>
                    <Text variant="caption" color="textTertiary">
                      {SIZE_SYSTEM_LABELS[system]}
                    </Text>
                    <View style={styles.chipGroup}>
                      {SIZE_GROUPS[system].map((value) => (
                        <Chip
                          key={value}
                          label={formatSizeLabel(value)}
                          selectable
                          selected={draftFilters.size === value}
                          onPress={() => updateDraft((prev) => ({ ...prev, size: value }))}
                        />
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.priceFields}>
              <TextField
                containerStyle={styles.priceField}
                label={`Min price (${currencySymbol(PRICE_CURRENCY)})`}
                keyboardType="decimal-pad"
                value={draftPriceMinInput}
                onChangeText={handleDraftPriceMinChange}
              />
              <TextField
                containerStyle={styles.priceField}
                label={`Max price (${currencySymbol(PRICE_CURRENCY)})`}
                keyboardType="decimal-pad"
                value={draftPriceMaxInput}
                onChangeText={handleDraftPriceMaxChange}
              />
            </View>

            <AttributeFilterFields
              only="details"
              vocab={vocab}
              vocabError={vocabQuery.isError}
              scope={draftScope}
              termIds={draftFilters.termIds}
              onToggle={handleToggleTerm}
              onClearKind={handleClearTermKind}
            />
          </View>
        ) : (
          <CategoryPickerContent
            groups={categoryGroups}
            activeGroupId={categoryActiveGroupId}
            onActiveGroupChange={setCategoryActiveGroupId}
            onSelect={handleCategorySelect}
            onClear={handleCategoryClear}
            clearLabel="Any category"
          />
        )}
      </Sheet>
    </Screen>
  );
}

/**
 * The filter trigger, a solid `bgInverse` circle sitting INSIDE the search
 * pill's trailing slot.
 *
 * Local to this screen — one caller, so DESIGN.md §15 rule 2 keeps it here
 * rather than in `ui/`. Not an `IconButton`: that primitive is a transparent
 * icon target, where this is a filled disc carrying a count badge.
 */
function FilterButton({ activeCount, onPress }: { activeCount: number; onPress: () => void }) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // The badge is the only visual sign that filters are active, so the
      // count has to be in the accessible name too — otherwise the state is
      // available by sight alone (DESIGN.md §12.4).
      accessibilityLabel={activeCount > 0 ? `Filters, ${activeCount} active` : 'Filters'}
      style={({ pressed }) => [
        styles.filterButton,
        { backgroundColor: colors.bgInverse, opacity: pressed ? 0.7 : 1 },
      ]}>
      <Icon name={FILTERS_ICON} size="md" color={colors.textInverse} />
      {activeCount > 0 ? (
        <View
          style={[styles.filterBadge, { backgroundColor: colors.accent, borderColor: colors.bg }]}
          // Already spoken by the button's own label above; announcing the
          // bare number again adds a second stop saying "3".
          accessible={false}
          importantForAccessibility="no-hide-descendants">
          <Text variant="micro" color="onAccent">
            {activeCount}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The "Drops" row — a horizontal rail of category rings that filter the grid.
 *
 * Replaces the previous underline tabs: both filter by top-level category, and
 * two controls for one filter is one too many.
 *
 * `active` means SELECTED here, not "always on". The handoff draws every ring
 * in the active style, but then the row cannot show which one is in effect —
 * a correctness problem rather than a styling one, so selection wins.
 *
 * Rings carry no image: categories have no artwork in the schema, and
 * `StoryRing` renders a toned circle for a missing `uri`, so the label does
 * the work. The handoff's "vibe" grouping has no column behind it either; the
 * real taxonomy is what this filters on.
 *
 * Horizontally scrollable because the taxonomy is server-owned and can grow
 * past the screen width. Local to this screen per §15 rule 2.
 */
function DropsRow({
  groups,
  activeGroupId,
  onSelect,
}: {
  groups: CategoryGroup[];
  activeGroupId: string | null;
  onSelect: (groupId: string | null) => void;
}) {
  if (groups.length === 0) {
    return null;
  }

  // "All" is a real ring, not a special case bolted on at render time — it is
  // the null selection, so the active-state logic stays identical for every
  // entry.
  const rings: { id: string | null; name: string }[] = [
    { id: null, name: 'All' },
    ...groups.map((group) => ({ id: group.id, name: group.name })),
  ];

  return (
    <View style={styles.drops}>
      <Text variant="micro" color="textSecondary" style={styles.dropsLabel}>
        Drops
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.dropsRow}
        // The grid FlatList stays the screen's only VERTICAL scroller, so
        // `onEndReached` is unaffected by this horizontal one.
        keyboardShouldPersistTaps="handled">
        {rings.map((ring) => {
          const selected = ring.id === activeGroupId;
          return (
            <Pressable
              key={ring.id ?? 'all'}
              onPress={() => onSelect(ring.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={ring.name}
              style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
              {/*
                StoryRing is presentational and takes no label here — the
                Pressable above owns the name and the selected state, so the
                ring does not announce a second time.
              */}
              <StoryRing size={DROPS_RING_SIZE} active={selected} />
              <Text
                variant="micro"
                color={selected ? 'text' : 'textSecondary'}
                numberOfLines={1}
                importantForAccessibility="no"
                style={styles.dropsRingLabel}>
                {ring.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Separator between collage blocks — one gap, so blocks read as one continuous wall. */
function BlockSeparator() {
  return <View style={styles.blockSeparator} />;
}

/**
 * The pressable "Category" field inside the Filter Sheet, mirroring
 * `sell/[id].tsx`'s own `CategoryField` visually (breadcrumb or placeholder
 * + chevron) — kept local since the sell editor's version is unexported and
 * this screen's label text ("Any category" vs. "Choose a category") and
 * absent `disabled` prop make a shared extraction a stretch for a single
 * second caller.
 */
function CategoryPressableRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Category, ${label}`}
      style={({ pressed }) => [
        styles.categoryRow,
        { backgroundColor: colors.bgElevated, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
      ]}>
      <Text variant="body" color={selected ? 'text' : 'textTertiary'}>
        {label}
      </Text>
      <Icon name={CATEGORY_CHEVRON_ICON} size="sm" color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
  },
  searchBar: {
    gap: space[4],
    marginBottom: space[4],
  },
  searchTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  filterButton: {
    width: FILTER_BUTTON_SIZE,
    height: FILTER_BUTTON_SIZE,
    borderRadius: FILTER_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadge: {
    position: 'absolute',
    top: -space[1],
    right: -space[1],
    // `minWidth`, not a fixed width: a two-digit count widens the pill rather
    // than clipping, while a single digit stays a circle.
    minWidth: FILTER_BADGE_SIZE,
    height: FILTER_BADGE_SIZE,
    borderRadius: FILTER_BADGE_SIZE / 2,
    paddingHorizontal: space[1],
    alignItems: 'center',
    justifyContent: 'center',
    // Ringed in the page colour so the badge stays legible where it overlaps
    // the button's own dark fill.
    borderWidth: border.thick,
  },
  gridHeader: {
    gap: space[3],
    marginBottom: space[3],
  },
  drops: {
    gap: space[2],
  },
  dropsLabel: {
    textTransform: 'uppercase',
  },
  dropsRow: {
    flexDirection: 'row',
    gap: space[3],
  },
  dropsRingLabel: {
    marginTop: space[1],
    textAlign: 'center',
    // Caps the caption to the ring, so a long category name cannot widen the
    // rail's rhythm.
    width: DROPS_RING_SIZE,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  shuffle: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
  },
  blockSeparator: {
    height: COLLAGE_GAP,
  },
  sortOptions: {
    paddingBottom: space[4],
  },
  gridContent: {
    // Clears the native tab bar so the last row is reachable; see
    // NATIVE_TAB_BAR_HEIGHT.
    paddingBottom: NATIVE_TAB_BAR_HEIGHT + space[4],
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space[1],
  },
  footerSpinner: {
    paddingVertical: space[5],
  },
  sheetContent: {
    gap: space[4],
    paddingBottom: space[4],
  },
  sortField: {
    gap: space[1],
  },
  categoryField: {
    gap: space[1],
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: minTouchTarget,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderWidth: border.thin,
    borderRadius: radius.md,
  },
  conditionField: {
    gap: space[1],
  },
  sizeField: {
    gap: space[1],
  },
  sizeGroups: {
    gap: space[3],
  },
  sizeGroup: {
    gap: space[1],
  },
  chipGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  priceFields: {
    flexDirection: 'row',
    gap: space[3],
  },
  priceField: {
    flex: 1,
  },
  sheetFooter: {
    gap: space[2],
  },
  sheetFooterButtons: {
    flexDirection: 'row',
    gap: space[3],
  },
  sheetFooterButton: {
    flex: 1,
  },
});
