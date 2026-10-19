import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, ListRow, Sheet, type IconName } from '@/components/ui';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import type { Category, CategoryGroup } from '@/features/categories/categories';

// Verified against the installed packages, same as every other IconName
// constant in this codebase (e.g. profile/index.tsx's own CHEVRON_ICON):
// both names exist in sf-symbols-typescript's types and expo-symbols'
// android/symbols.json.
const CHEVRON_ICON: IconName = { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' };
const BACK_ICON: IconName = { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' };

export type CategoryPickerContentProps = {
  groups: CategoryGroup[];
  /** Controlled drill-down state -- `null` means the top-level group list. */
  activeGroupId: string | null;
  onActiveGroupChange: (groupId: string | null) => void;
  onSelect: (group: CategoryGroup, leaf: Category) => void;
  /**
   * When provided, renders one extra top-level row ("Any category" by
   * default) above the group list that calls this instead of drilling into
   * a group -- ROADMAP 2.3's Filter Sheet needs an explicit way to clear
   * the category filter; the Sell-flow caller passes neither this nor
   * `clearLabel` and is unaffected (no extra row, identical behavior).
   */
  onClear?: () => void;
  clearLabel?: string;
};

/**
 * The group->leaf drill-down list itself, with no `Sheet` (or any Modal) of
 * its own -- a controlled presentational component so a caller that already
 * owns a Sheet (ROADMAP 2.3's Explore screen, which shows this inside its
 * one Filter Sheet instance alongside a "filters view") can render it
 * without ever mounting a second `<Modal>`. `CategoryPickerSheet` below is
 * the Sell-flow's own thin `Sheet`-wrapped version of the exact same list.
 *
 * `activeGroupId` is a controlled prop (not local state) precisely so two
 * independent callers -- this file's own `CategoryPickerSheet` and
 * `explore.tsx` -- can each own their own drill-down state and read it back
 * for their own Sheet's `title`.
 */
export function CategoryPickerContent({
  groups,
  activeGroupId,
  onActiveGroupChange,
  onSelect,
  onClear,
  clearLabel = 'Any category',
}: CategoryPickerContentProps) {
  const { colors } = useAppTheme();
  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? null;

  function handleSelect(group: CategoryGroup, leaf: Category) {
    onActiveGroupChange(null);
    onSelect(group, leaf);
  }

  function handleClear() {
    onActiveGroupChange(null);
    onClear?.();
  }

  return (
    <View style={styles.rows}>
      {activeGroup === null
        ? [
            ...(onClear ? [<ListRow key="__clear" title={clearLabel} onPress={handleClear} />] : []),
            ...groups.map((group) => (
              <ListRow
                key={group.id}
                title={group.name}
                onPress={() => onActiveGroupChange(group.id)}
                trailing={<Icon name={CHEVRON_ICON} size="sm" color={colors.textTertiary} />}
              />
            )),
          ]
        : [
            <ListRow
              key="__back"
              title="All categories"
              accessibilityLabel="Back to all categories"
              leading={<Icon name={BACK_ICON} size="sm" color={colors.textSecondary} />}
              onPress={() => onActiveGroupChange(null)}
            />,
            ...activeGroup.subcategories.map((leaf) => (
              <ListRow key={leaf.id} title={leaf.name} onPress={() => handleSelect(activeGroup, leaf)} />
            )),
          ]}
    </View>
  );
}

/** Same per-level title `CategoryPickerSheet` has always shown -- shared so
 * any other `Sheet`-owning caller of `CategoryPickerContent` (e.g.
 * `explore.tsx`) can reproduce it exactly for their own Sheet's `title`. */
export function getCategoryPickerTitle(groups: CategoryGroup[], activeGroupId: string | null): string {
  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? null;
  return activeGroup ? activeGroup.name : 'Choose a category';
}

export type CategoryPickerSheetProps = {
  visible: boolean;
  groups: CategoryGroup[];
  onClose: () => void;
  onSelect: (group: CategoryGroup, leaf: Category) => void;
  onClear?: () => void;
  clearLabel?: string;
};

/**
 * ROADMAP 2.1 "Categories" — a `Sheet`-based two-level drill-down, Sheet's
 * second real caller beyond `ListingActionsSheet` (1.6). A flat chip wall
 * does not work here the way it does for condition (5 options) or size
 * (~22 grouped by system): ~35 leaves across 6 groups needs a group picked
 * first.
 *
 * A thin wrapper around `CategoryPickerContent` + `Sheet`: owns the
 * drill-down's `activeGroupId` state itself and resets it to `null`
 * whenever the sheet closes (backdrop tap, drag dismiss, or a completed
 * selection) -- so reopening it always starts back at the top level rather
 * than wherever the seller last left it. Identical external behavior to
 * before this file's `Sheet`-stacking-bug refactor.
 */
export function CategoryPickerSheet({
  visible,
  groups,
  onClose,
  onSelect,
  onClear,
  clearLabel = 'Any category',
}: CategoryPickerSheetProps) {
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  function handleClose() {
    setActiveGroupId(null);
    onClose();
  }

  return (
    <Sheet
      visible={visible}
      onClose={handleClose}
      title={getCategoryPickerTitle(groups, activeGroupId)}
      accessibilityLabel="Choose a category">
      <CategoryPickerContent
        groups={groups}
        activeGroupId={activeGroupId}
        onActiveGroupChange={setActiveGroupId}
        onSelect={onSelect}
        onClear={onClear}
        clearLabel={clearLabel}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: space[1],
  },
});
