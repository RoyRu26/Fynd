import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import { ListingGridTile, TALL_TILE_ASPECT_RATIO } from '@/components/listing/listing-grid-tile';
import {
  Button,
  Chip,
  EmptyState,
  Icon,
  IconButton,
  ListRow,
  Screen,
  Sheet,
  SkeletonListingCard,
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
import { CONDITION_LABELS } from '@/features/listings/condition';
import { mapListingError } from '@/features/listings/errors';
import { currencySymbol, formatMinorUnitsForInput } from '@/features/listings/price';
import { LISTING_CONDITIONS } from '@/features/listings/schemas';
import {
  formatSizeLabel,
  listingSizesBySystem,
  SIZE_SYSTEM_LABELS,
  type SizeSystem,
} from '@/features/listings/size';
import {
  deriveActiveFilterChips,
  formatResultCount,
  getExploreEmptyCopy,
  hasActiveFilters,
  parsePriceRangeInput,
  PRICE_CURRENCY,
  removeFilter,
  type ActiveFilterKey,
} from '@/features/search/active-filters';
import type { SearchFilters, SearchListing } from '@/features/search/api';
import { useSearch } from '@/features/search/queries';
import {
  SEARCH_SORT_LABELS,
  SEARCH_SORT_ORDER,
  type SearchSort,
} from '@/features/search/search';
import { useRecentSearches } from '@/features/search/use-recent-searches';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

/**
 * Explore (ROADMAP 2.3) — DESIGN.md §14.2's dense, image-first 3-up grid,
 * the Instagram Explore structure (not look). Reuses ROADMAP 2.2's search
 * backend (`features/search/`) exactly as built: no new RPC, no new table.
 *
 * The search row (TextField + clear + filters trigger) is a persistent
 * sibling `View` rendered directly under `<Screen>`, ABOVE whichever
 * FlatList is currently shown (ROADMAP 2.4) — not inside either list's own
 * `ListHeaderComponent`. Toggling between the grid and the recent-searches
 * list swaps which FlatList is mounted (they even carry distinct `key`s,
 * since `numColumns` differs and RN doesn't support changing it on an
 * existing instance), and if the TextField lived inside either list's
 * header it would unmount/remount with it, dropping keyboard focus the
 * instant recent searches appear or disappear. Each FlatList is still the
 * screen's only SCROLL container (the search row is a plain non-scrolling
 * View) — `onEndReached` pagination never fires correctly if something else
 * does the actual scrolling, hence `Screen`'s default `scroll={false}`. The
 * active-filter chips stay as the grid FlatList's own (now smaller) header,
 * since they're grid-specific.
 *
 * The empty, no-query/no-filter state is a deliberate full-catalog browse,
 * not a "type something" placeholder — `search_listings` already treats
 * all-null arguments as "every active listing, newest first" (see
 * `getExploreEmptyCopy`'s two distinct branches).
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
const SORT_ICON: IconName = { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' };
const SORT_SELECTED_ICON: IconName = { ios: 'checkmark', android: 'check', web: 'check' };

/**
 * Bottom clearance so the final grid row is not stranded under the native tab
 * bar. `NativeTabs` does not expose its height (and `app-tabs.tsx` is fixed
 * for this task), so these are the platforms' own standard bar heights.
 *
 * Per-platform because one number cannot serve both: iOS's UITabBar is 49pt,
 * while Android's Material `BottomNavigationView` is around 80dp — applying
 * the iOS value there would under-reserve by half a row. Purely additive
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

/** The filter fields this screen commits/drafts — everything in SearchFilters except query/sort, which the screen manages separately. */
type ExploreFilters = Pick<SearchFilters, 'categoryId' | 'condition' | 'size' | 'priceMin' | 'priceMax'>;

const EMPTY_FILTERS: ExploreFilters = {
  categoryId: null,
  condition: null,
  size: null,
  priceMin: null,
  priceMax: null,
};

export default function ExploreScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();

  const [queryInput, setQueryInput] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [committedFilters, setCommittedFilters] = useState<ExploreFilters>(EMPTY_FILTERS);
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

  const searchFilters = useMemo<SearchFilters>(
    () => ({
      query: effectiveQuery.length > 0 ? effectiveQuery : null,
      categoryId: committedFilters.categoryId,
      condition: committedFilters.condition,
      size: committedFilters.size,
      priceMin: committedFilters.priceMin,
      priceMax: committedFilters.priceMax,
      sort,
    }),
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

  const activeChips = useMemo(
    () => deriveActiveFilterChips(committedFilters, committedCategoryLabel),
    [committedFilters, committedCategoryLabel],
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
  const [draftFilters, setDraftFilters] = useState<ExploreFilters>(EMPTY_FILTERS);
  const [draftPriceMinInput, setDraftPriceMinInput] = useState('');
  const [draftPriceMaxInput, setDraftPriceMaxInput] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);

  function openFilterSheet() {
    // Initialized from committedFilters only at the moment the sheet opens
    // (not earlier) — editing a draft copy, discarded on dismiss, never
    // live-previewed against the grid until "Apply".
    setDraftFilters(committedFilters);
    setDraftPriceMinInput(formatMinorUnitsForInput(committedFilters.priceMin));
    setDraftPriceMaxInput(formatMinorUnitsForInput(committedFilters.priceMax));
    setPriceError(null);
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
    setDraftFilters(EMPTY_FILTERS);
    setDraftPriceMinInput('');
    setDraftPriceMaxInput('');
    setPriceError(null);
  }

  // Category view opens inside the SAME Sheet instance as the filters view
  // (an instant content swap, no close/reopen, no second Modal) and on
  // select/clear it switches back to the filters view the same way, with
  // draftFilters.categoryId already updated.
  function openCategoryPicker() {
    setCategoryActiveGroupId(null);
    setPickerView('category');
  }

  function handleCategorySelect(_group: CategoryGroup, leaf: Category) {
    setDraftFilters((prev) => ({ ...prev, categoryId: leaf.id }));
    setPickerView('filters');
  }

  function handleCategoryClear() {
    setDraftFilters((prev) => ({ ...prev, categoryId: null }));
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
    setFilterSheetOpen(false);
  }

  function openSortSheet() {
    setPickerView('sort');
    setFilterSheetOpen(true);
  }

  function handleSortSelect(next: SearchSort) {
    setSort(next);
    setFilterSheetOpen(false);
  }

  function handleRemoveChip(key: ActiveFilterKey) {
    setCommittedFilters((prev) => removeFilter(prev, key));
  }

  // Tabs commit immediately (no draft/Apply round trip) — they are a browse
  // control, not part of the filter sheet's editable draft. `null` is "All".
  function handleCategoryTabSelect(groupId: string | null) {
    setCommittedFilters((prev) => ({ ...prev, categoryId: groupId }));
  }

  function clearAll() {
    setQueryInput('');
    setImmediateQuery(null);
    setCommittedFilters(EMPTY_FILTERS);
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

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SearchListing>) => (
      <ListingGridTile
        listing={item}
        aspectRatio={TALL_TILE_ASPECT_RATIO}
        onPress={() => openListing(item.listingId)}
      />
    ),
    [openListing],
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
      <Text variant="title">Explore</Text>
      <View style={styles.searchRow}>
        <TextField
          containerStyle={styles.searchField}
          placeholder="Search listings"
          accessibilityLabel="Search listings"
          value={queryInput}
          onChangeText={handleQueryInputChange}
          onFocus={() => setSearchFocused(true)}
          onBlur={handleSearchBlur}
          onSubmitEditing={() => Keyboard.dismiss()}
          returnKeyType="search"
          // Both adornments now sit INSIDE the field's stroke rather than
          // beside it. The glyph is decorative — the field's own
          // accessibilityLabel already says "Search listings" — so it is
          // hidden from assistive tech per the `leading` contract.
          leading={
            <View accessible={false} importantForAccessibility="no">
              <Icon name={SEARCH_ICON} size="sm" color={colors.textTertiary} />
            </View>
          }
          trailing={
            queryInput.length > 0 ? (
              <IconButton
                icon={CLEAR_ICON}
                accessibilityLabel="Clear search"
                size="sm"
                onPress={() => {
                  setQueryInput('');
                  setImmediateQuery(null);
                }}
              />
            ) : null
          }
        />
        <FilterButton activeCount={activeChips.length} onPress={openFilterSheet} />
      </View>
    </View>
  );

  // Grid-specific — none of this applies to the recent-searches list, so it
  // stays the grid FlatList's own header rather than joining the persistent
  // search bar above. It scrolls away with the results, which is the point.
  const resultCount = formatResultCount(listings.length, searchQuery.hasNextPage);
  const showResultsRow = !searchQuery.isPending && !searchQuery.isError && resultCount !== null;

  const gridHeader = (
    <View style={styles.gridHeader}>
      <CategoryTabs
        groups={categoryGroups}
        activeGroupId={activeCategoryGroupId}
        onSelect={handleCategoryTabSelect}
      />

      {hasActiveFilters(committedFilters) ? (
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
              accessibilityLabel={`Remove ${chip.label} filter`}
              onPress={() => handleRemoveChip(chip.key)}
            />
          ))}
        </View>
      ) : null}

      {showResultsRow ? (
        <View style={styles.resultsRow}>
          <Text variant="micro" color="textSecondary" style={styles.resultsCount}>
            {resultCount}
          </Text>
          <Pressable
            onPress={openSortSheet}
            accessibilityRole="button"
            // Names the current value, not just the control — otherwise the
            // active sort is only available visually.
            accessibilityLabel={`Sort by ${SEARCH_SORT_LABELS[sort]}. Change sort`}
            style={({ pressed }) => [styles.sortTrigger, { opacity: pressed ? 0.7 : 1 }]}>
            <Text variant="label">{SEARCH_SORT_LABELS[sort]}</Text>
            <Icon name={SORT_ICON} size="sm" color={colors.text} />
          </Pressable>
        </View>
      ) : null}
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
    listEmpty = (
      <View style={styles.skeletonGrid}>
        {Array.from({ length: 6 }, (_, index) => (
          // Same ratio as the real tiles, or every row jumps height the
          // moment results land.
          <SkeletonListingCard key={index} aspectRatio={TALL_TILE_ASPECT_RATIO} />
        ))}
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
          data={listings}
          keyExtractor={(item) => item.listingId}
          renderItem={renderItem}
          numColumns={3}
          ListHeaderComponent={gridHeader}
          ListEmptyComponent={listEmpty}
          contentContainerStyle={styles.gridContent}
          // Required, not optional polish: the grid is on screen WITH the
          // keyboard up the moment the user types a character (that leaves
          // `showRecentSearches`). Without this the enclosing ScrollView
          // captures the first press to dismiss the keyboard, so the first
          // tap on a tab, chip, sort trigger or tile is swallowed. Capture
          // runs root-to-leaf, so setting it on the inner horizontal
          // ScrollView alone does nothing — it has to be here.
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
        accessibilityLabel={pickerView === 'category' ? 'Choose a category' : sheetTitle}>
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
            <View style={styles.categoryField}>
              <Text variant="label" color="textSecondary">
                Category
              </Text>
              <CategoryPressableRow
                label={draftCategoryLabel}
                selected={draftFilters.categoryId !== null}
                onPress={openCategoryPicker}
              />
            </View>

            <View style={styles.conditionField}>
              <Text variant="label" color="textSecondary">
                Condition
              </Text>
              <View style={styles.chipGroup}>
                <Chip
                  label="Any condition"
                  selectable
                  selected={draftFilters.condition === null}
                  onPress={() => setDraftFilters((prev) => ({ ...prev, condition: null }))}
                />
                {LISTING_CONDITIONS.map((value) => (
                  <Chip
                    key={value}
                    label={CONDITION_LABELS[value]}
                    selectable
                    selected={draftFilters.condition === value}
                    onPress={() => setDraftFilters((prev) => ({ ...prev, condition: value }))}
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
                  onPress={() => setDraftFilters((prev) => ({ ...prev, size: null }))}
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
                          onPress={() => setDraftFilters((prev) => ({ ...prev, size: value }))}
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
                onChangeText={setDraftPriceMinInput}
              />
              <TextField
                containerStyle={styles.priceField}
                label={`Max price (${currencySymbol(PRICE_CURRENCY)})`}
                keyboardType="decimal-pad"
                value={draftPriceMaxInput}
                onChangeText={setDraftPriceMaxInput}
              />
            </View>
            {priceError ? (
              <Text variant="caption" color="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
                {priceError}
              </Text>
            ) : null}

            <View style={styles.sheetFooter}>
              <Button variant="secondary" onPress={handleClearDraft} style={styles.sheetFooterButton}>
                Clear
              </Button>
              <Button variant="primary" onPress={handleApplyFilters} style={styles.sheetFooterButton}>
                Apply
              </Button>
            </View>
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
 * The square filter trigger beside the search field, with a count badge.
 *
 * Local to this screen — one caller, so DESIGN.md §15 rule 2 keeps it here
 * rather than in `ui/`. It is not an `IconButton`: that primitive is a
 * transparent circular icon target, where this is a solid `bgInverse` square
 * carrying a badge.
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
 * Top-level category tabs with an underline for the active one.
 *
 * Commits a GROUP id (or null for "All"), which `search_listings` handles
 * natively — it matches `cat.id = p_category_id OR cat.parent_id =
 * p_category_id`, so a group id filters that whole group without any
 * client-side fan-out over its leaves.
 *
 * Horizontally scrollable because the taxonomy is server-owned and can grow
 * past the screen width; the row must never force the labels to shrink or
 * wrap. Local to this screen for the same §15 rule 2 reason as above.
 */
function CategoryTabs({
  groups,
  activeGroupId,
  onSelect,
}: {
  groups: CategoryGroup[];
  activeGroupId: string | null;
  onSelect: (groupId: string | null) => void;
}) {
  const { colors } = useAppTheme();

  // "All" is a real tab, not a special case bolted on at render time — it is
  // the null selection, and modelling it as a row here keeps the active-state
  // logic identical for every tab.
  const tabs: { id: string | null; name: string }[] = [
    { id: null, name: 'All' },
    ...groups.map((group) => ({ id: group.id, name: group.name })),
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tabsRow}
      // The grid FlatList stays the screen's only VERTICAL scroller, so
      // `onEndReached` is unaffected by this horizontal one.
      keyboardShouldPersistTaps="handled">
      {tabs.map((tab) => {
        const selected = tab.id === activeGroupId;
        return (
          <Pressable
            key={tab.id ?? 'all'}
            onPress={() => onSelect(tab.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.name}
            style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.7 : 1 }]}>
            {/*
              Inner box sized to the label, inside a Pressable held to the
              44pt floor. Putting `minWidth` on the Pressable alone would
              stretch the underline to 44 as well, detaching it from the word
              it underlines; this keeps the target big and the rule tight.
            */}
            <View style={styles.tabInner}>
              <Text
                variant="micro"
                color={selected ? 'text' : 'textSecondary'}
                style={styles.tabLabel}>
                {tab.name}
              </Text>
              {/*
                Always rendered, transparent when inactive, so selecting a tab
                never changes the row's height — and so the underline is a
                colour change rather than a layout shift.
              */}
              <View
                style={[
                  styles.tabUnderline,
                  { backgroundColor: selected ? colors.accent : 'transparent' },
                ]}
              />
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
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
    gap: space[3],
    marginBottom: space[3],
  },
  searchRow: {
    flexDirection: 'row',
    // `flex-end` so the button stays on the field's bottom edge if a
    // helper/error line is ever added below the input. This call site passes
    // neither today, so the two are currently the same height and `center`
    // would look identical — this is about not breaking later.
    alignItems: 'flex-end',
    gap: space[2],
  },
  searchField: {
    flex: 1,
  },
  filterButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: radius.md,
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
  tabsRow: {
    flexDirection: 'row',
    gap: space[5],
  },
  tab: {
    // Both axes — `minHeight` alone left "ALL" about 25pt wide, under
    // DESIGN.md §12.1's 44x44 floor. The row's `gap` is dead space, not hit
    // area, so it cannot make up the difference.
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  tabInner: {
    gap: space[2],
  },
  tabLabel: {
    textTransform: 'uppercase',
  },
  tabUnderline: {
    height: border.thick,
    borderRadius: radius.xs,
  },
  resultsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resultsCount: {
    textTransform: 'uppercase',
  },
  sortTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: minTouchTarget,
    gap: space[1],
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
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  footerSpinner: {
    paddingVertical: space[5],
  },
  sheetContent: {
    gap: space[4],
    paddingBottom: space[4],
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
    flexDirection: 'row',
    gap: space[3],
  },
  sheetFooterButton: {
    flex: 1,
  },
});
