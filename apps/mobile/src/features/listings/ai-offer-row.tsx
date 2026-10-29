import { StyleSheet, View } from 'react-native';

import { Chip, IconButton, Text, type IconName } from '@/components/ui';
import { space } from '@/design/tokens';
import { isolate } from '@/features/brands/brands';
import { shortOfferLabel, type AiOffer } from '@/features/listings/ai-policy';

const DISMISS_ICON: IconName = { ios: 'xmark', android: 'close', web: 'close' };

/**
 * One field's AI offers: "AI suggests: [Vintage] [Navy]  ×". Tapping a value
 * applies it; × dismisses this field's offers. Restrained on purpose — a
 * caption plus the same chips the editor already uses — and it renders
 * nothing when there is nothing to offer. Rules for what is offered live in
 * ai-policy.ts.
 */
export function AiOfferRow({
  offers,
  fieldLabel,
  disabled,
  onApply,
  onDismiss,
}: {
  offers: readonly AiOffer[];
  /** Spoken name of the field, e.g. "Color". */
  fieldLabel: string;
  disabled: boolean;
  onApply: (offer: AiOffer) => void;
  onDismiss: () => void;
}) {
  if (offers.length === 0) return null;

  return (
    // No live region per row: the editor announces a result once, not one
    // announcement per field.
    <View style={styles.row}>
      <Text variant="caption" color="textTertiary">
        AI suggests:
      </Text>
      {offers.map((offer) => (
        <Chip
          key={offer.key}
          label={isolate(shortOfferLabel(offer.label))}
          selectable
          selected={false}
          disabled={disabled}
          accessibilityLabel={`Use AI suggestion for ${fieldLabel}: ${isolate(offer.label)}`}
          onPress={() => onApply(offer)}
        />
      ))}
      <IconButton
        icon={DISMISS_ICON}
        size="sm"
        variant="neutral"
        color="textTertiary"
        disabled={disabled}
        accessibilityLabel={`Dismiss AI suggestions for ${fieldLabel}`}
        onPress={onDismiss}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[2],
  },
});
