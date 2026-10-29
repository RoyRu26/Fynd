import { StyleSheet, View } from 'react-native';

import { Chip, Text, TextField, type IconName } from '@/components/ui';
import { space } from '@/design/tokens';
import {
  brandSelectionLabel,
  cleanBrandText,
  findExactSuggestion,
  isolate,
  suggestionAliasHint,
  type BrandSelection,
  type BrandSuggestion,
} from '@/features/brands/brands';
import { useBrandSearch } from '@/features/brands/queries';

const REMOVE_ICON: IconName = { ios: 'xmark', android: 'close', web: 'close' };

/**
 * The Sell editor's brand picker. A brand is either a catalog brand (found
 * through typeahead) or the seller's own text for a brand that isn't in the
 * catalog — a typed name never blocks the listing, and sellers can't create
 * catalog brands. All rules live in brands.ts; the draft/selection state is
 * owned by the attribute editor. This only renders them.
 */
export function BrandField({
  brand,
  draft,
  error,
  disabled,
  onDraftChange,
  onChoose,
  onSubmit,
  onClear,
}: {
  brand: BrandSelection;
  draft: string;
  error: string | null;
  disabled: boolean;
  onDraftChange: (text: string) => void;
  onChoose: (suggestion: BrandSuggestion) => void;
  onSubmit: (suggestions: readonly BrandSuggestion[]) => void;
  onClear: () => void;
}) {
  // Only suggestions for the text typed right now (see useBrandSearch).
  const suggestions = useBrandSearch(draft);
  const cleaned = cleanBrandText(draft);

  if (brand.kind !== 'none') {
    const label = brandSelectionLabel(brand) ?? '';
    return (
      <View style={styles.field}>
        <Text variant="caption" color="textTertiary">
          Brand
        </Text>
        {/* Same dismissible-token pattern as the keyword chips and Explore's
            active filters: inverse tone = already chosen, press to remove. */}
        <Chip
          label={label}
          tone="inverse"
          icon={REMOVE_ICON}
          selectable
          selected={false}
          disabled={disabled}
          accessibilityLabel={`Brand, ${isolate(label)}${brand.kind === 'text' ? ', as you typed it' : ''}. Remove`}
          onPress={onClear}
        />
        {brand.kind === 'text' ? (
          <Text variant="caption" color="textTertiary" accessibilityLiveRegion="polite">
            Saved as you typed it. If it matches a Fynd brand, it is linked automatically.
          </Text>
        ) : null}
      </View>
    );
  }

  const matchesSuggestionExactly = findExactSuggestion(cleaned, suggestions) !== null;

  return (
    <View style={styles.field}>
      <TextField
        label="Brand"
        value={draft}
        onChangeText={onDraftChange}
        onSubmitEditing={() => onSubmit(suggestions)}
        submitBehavior="submit"
        returnKeyType="done"
        autoCapitalize="words"
        autoCorrect={false}
        placeholder="Search or type a brand"
        helperText={error ? undefined : 'Pick one from the list, or type your own.'}
        error={error ?? undefined}
        disabled={disabled}
      />
      {cleaned !== '' ? (
        <View style={styles.chips}>
          {suggestions.map((suggestion) => {
            const hint = suggestionAliasHint(suggestion);
            return (
              <Chip
                key={suggestion.id}
                label={hint ? `${suggestion.name} (${isolate(hint)})` : suggestion.name}
                selectable
                selected={false}
                disabled={disabled}
                accessibilityLabel={
                  hint ? `Choose brand ${suggestion.name}, matched ${isolate(hint)}` : `Choose brand ${suggestion.name}`
                }
                onPress={() => onChoose(suggestion)}
              />
            );
          })}
          {!matchesSuggestionExactly ? (
            <Chip
              label={`Use “${isolate(cleaned)}”`}
              selectable
              selected={false}
              disabled={disabled}
              accessibilityLabel={`Use ${isolate(cleaned)} as typed`}
              onPress={() => onSubmit(suggestions)}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: space[1],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
});
