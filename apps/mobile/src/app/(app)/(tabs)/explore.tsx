import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import { ListingGridTile } from '@/components/listing/listing-grid-tile';
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
  findCategorySelection,
  formatCategoryBreadcrumb,
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
  getExploreEmptyCopy,
  hasActiveFilters,
  parsePriceRangeInput,
  PRICE_CURRENCY,
  removeFilter,
  type ActiveFilterKey,
} from '@/features/search/active-filters';
import type { SearchFilters, SearchListing } from '@/features/search/api';
import { useSearch } from '@/features/search/queries';
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
      sort: 'newest',
    }),
    [effectiveQuery, committedFilters],
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

  const committedCategorySelection = findCategorySelection(categoryGroups, committedFilters.categoryId);
  const committedCategoryLabel = committedCategorySelection
    ? formatCategoryBreadcrumb(committedCategorySelection.group, committedCategorySelection.leaf)
    : null;

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
  const [pickerView, setPickerView] = useState<'filters' | 'category'>('filters');
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
  function handleFilterSheetClose() {
    if (pickerView === 'category') {
      setCategoryActiveGroupId(null);
      setPickerView('filters');
      return;
    }
    setFilterSheetOpen(false);
  }

  function handleRemoveChip(key: ActiveFilterKey) {
    setCommittedFilters((prev) => removeFilter(prev, key));
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
      <ListingGridTile listing={item} onPress={() => openListing(item.listingId)} />
    ),
    [openListing],
  );

  const handleEndReached = useCallback(() => {
    if (searchQuery.hasNextPage && !searchQuery.isFetchingNextPage) {
      searchQuery.fetchNextPage();
    }
  }, [searchQuery]);

  const draftCategorySelection = findCategorySelection(categoryGroups, draftFilters.categoryId);
  const draftCategoryLabel = draftCategorySelection
    ? formatCategoryBreadcrumb(draftCategorySelection.group, draftCategorySelection.leaf)
    : 'Any category';

  // Persistent sibling of whichever FlatList is currently shown (see the
  // header comment) — never itself part of either list's
  // `ListHeaderComponent`, so it never unmounts/remounts when the grid and
  // recent-searches lists swap.
  const searchBar = (
    <View style={styles.searchBar}>
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
        />
        {queryInput.length > 0 ? (
          <IconButton
            icon={CLEAR_ICON}
            accessibilityLabel="Clear search"
            onPress={() => {
              setQueryInput('');
              setImmediateQuery(null);
            }}
          />
        ) : null}
        <IconButton icon={FILTERS_ICON} accessibilityLabel="Filters" onPress={openFilterSheet} />
      </View>
    </View>
  );

  // Grid-specific — active-filter chips never apply to the recent-searches
  // list, so this stays the grid FlatList's own header, not the persistent
  // search bar above.
  const gridHeader = hasActiveFilters(committedFilters) ? (
    <View style={styles.chipRow}>
      {activeChips.map((chip) => (
        <Chip
          key={chip.key}
          label={chip.label}
          icon={CLEAR_ICON}
          selectable
          selected={false}
          accessibilityLabel={`Remove ${chip.label} filter`}
          onPress={() => handleRemoveChip(chip.key)}
        />
      ))}
    </View>
  ) : null;

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
          <SkeletonListingCard key={index} />
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
        title={pickerView === 'filters' ? 'Filters' : getCategoryPickerTitle(categoryGroups, categoryActiveGroupId)}
        accessibilityLabel={pickerView === 'filters' ? 'Filters' : 'Choose a category'}>
        {pickerView === 'filters' ? (
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
    marginBottom: space[3],
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  searchField: {
    flex: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    marginBottom: space[3],
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
