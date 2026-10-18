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

export type CategoryPickerSheetProps = {
  visible: boolean;
  groups: CategoryGroup[];
  onClose: () => void;
  onSelect: (group: CategoryGroup, leaf: Category) => void;
};

/**
 * ROADMAP 2.1 "Categories" — a `Sheet`-based two-level drill-down, Sheet's
 * second real caller beyond `ListingActionsSheet` (1.6). A flat chip wall
 * does not work here the way it does for condition (5 options) or size
 * (~22 grouped by system): ~35 leaves across 6 groups needs a group picked
 * first.
 *
 * `activeGroupId` is local and resets to `null` whenever the sheet closes
 * (backdrop tap, drag dismiss, or a completed selection) — so reopening it
 * always starts back at the top level rather than wherever the seller last
 * left it.
 */
export function CategoryPickerSheet({ visible, groups, onClose, onSelect }: CategoryPickerSheetProps) {
  const { colors } = useAppTheme();
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  function handleClose() {
    setActiveGroupId(null);
    onClose();
  }

  function handleSelect(group: CategoryGroup, leaf: Category) {
    setActiveGroupId(null);
    onSelect(group, leaf);
  }

  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? null;

  return (
    <Sheet
      visible={visible}
      onClose={handleClose}
      title={activeGroup ? activeGroup.name : 'Choose a category'}
      accessibilityLabel="Choose a category">
      <View style={styles.rows}>
        {activeGroup === null
          ? groups.map((group) => (
              <ListRow
                key={group.id}
                title={group.name}
                onPress={() => setActiveGroupId(group.id)}
                trailing={<Icon name={CHEVRON_ICON} size="sm" color={colors.textTertiary} />}
              />
            ))
          : [
              <ListRow
                key="__back"
                title="All categories"
                accessibilityLabel="Back to all categories"
                leading={<Icon name={BACK_ICON} size="sm" color={colors.textSecondary} />}
                onPress={() => setActiveGroupId(null)}
              />,
              ...activeGroup.subcategories.map((leaf) => (
                <ListRow key={leaf.id} title={leaf.name} onPress={() => handleSelect(activeGroup, leaf)} />
              )),
            ]}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: space[1],
  },
});
