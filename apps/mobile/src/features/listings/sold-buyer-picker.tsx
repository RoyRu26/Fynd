import { StyleSheet, View } from 'react-native';

import { Avatar, Icon, ListRow } from '@/components/ui';
import { space } from '@/design/tokens';
import { useAppTheme } from '@/design/theme-provider';
import {
  MARK_SOLD_ICON,
  formatSoldBuyerSubtitle,
  resolveSoldBuyerName,
  type SoldBuyerCandidate,
} from '@/features/listings/sold-buyer';

export type SoldBuyerPickerProps = {
  buyers: SoldBuyerCandidate[];
  /** `null` is "Sold outside Fynd" -- no buyer tracked. */
  onSelect: (buyerId: string | null) => void;
};

/**
 * ROADMAP 5.3's buyer-picker content: one `ListRow` + `Avatar` per person
 * who messaged about this listing (most-recent-first, already ordered that
 * way by `listing_conversation_buyers`), plus one pinned trailing row for
 * "sold to someone who never messaged in-app".
 *
 * Content only -- no `Sheet` of its own, mirroring `ReportReasonPicker`'s
 * exact shape: `ListingActionsSheet` mounts this inside the ONE `Sheet`
 * instance it already owns, swapped in for the menu view, rather than
 * nesting a second `Modal` (same `sheet.tsx` two-phase-close reasoning
 * `MoreActionsSheet`'s own doc comment spells out).
 *
 * No "blocked" indicator on any row -- ROADMAP 5.2 stops future contact,
 * it does not erase the past, and a real sale through messaging is
 * legitimate history the seller can record regardless of a later block.
 * See the migration's own header comment for the full reasoning; this
 * component simply never asks the question.
 */
export function SoldBuyerPicker({ buyers, onSelect }: SoldBuyerPickerProps) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.rows}>
      {buyers.map((buyer) => {
        const name = resolveSoldBuyerName(buyer);
        return (
          <ListRow
            key={buyer.buyerId}
            leading={<Avatar size="md" source={buyer.avatarUrl ?? undefined} name={name} />}
            title={name}
            subtitle={formatSoldBuyerSubtitle(buyer)}
            onPress={() => onSelect(buyer.buyerId)}
            accessibilityLabel={`Mark as sold to ${name}`}
          />
        );
      })}
      <ListRow
        leading={<Icon name={MARK_SOLD_ICON} color={colors.text} />}
        title="Sold outside Fynd"
        subtitle="No buyer from this listing's messages"
        onPress={() => onSelect(null)}
        accessibilityLabel="Mark as sold, with no buyer from Fynd messages"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: space[1],
  },
});
