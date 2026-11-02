import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip, TextField } from '@/components/ui';
import { space } from '@/design/tokens';
import { isolate, suggestionAliasHint } from '@/features/brands/brands';
import { useBrandSearch } from '@/features/brands/queries';
import { MAX_FILTER_IDS_PER_KIND, type BrandFilterValue } from '@/features/search/search';

/**
 * Explore's brand filter (ROADMAP 7.4): a typeahead over CATALOG brands only.
 * Unlike the Sell editor's `BrandField` it picks several brands and never
 * offers the typed text itself — a filter has to name something
 * `search_listings` can match by id. Free-text brands stay reachable through
 * the search field. Rules live in search.ts (`toggleBrandFilter`); the only
 * state here is the text being typed.
 */
export function BrandFilterField({
  brands,
  onToggle,
  disabled = false,
}: {
  brands: readonly BrandFilterValue[];
  onToggle: (brand: BrandFilterValue) => void;
  disabled?: boolean;
}) {
  const [typed, setTyped] = useState('');
  // Only suggestions for the text typed right now (see useBrandSearch).
  const suggestions = useBrandSearch(typed);
  const full = brands.length >= MAX_FILTER_IDS_PER_KIND;
  const chosenIds = new Set(brands.map((brand) => brand.id));

  return (
    <View style={styles.field}>
      <TextField
        label="Brand"
        value={typed}
        onChangeText={setTyped}
        returnKeyType="done"
        autoCapitalize="words"
        autoCorrect={false}
        placeholder="Search brands"
        helperText={full ? `Up to ${MAX_FILTER_IDS_PER_KIND} brands.` : undefined}
        disabled={disabled}
      />

      {brands.length > 0 ? (
        <View style={styles.chips}>
          {brands.map((brand) => (
            <Chip
              key={brand.id}
              label={isolate(brand.name)}
              selectable
              selected
              disabled={disabled}
              accessibilityLabel={`Brand, ${isolate(brand.name)}. Remove`}
              onPress={() => onToggle(brand)}
            />
          ))}
        </View>
      ) : null}

      {suggestions.length > 0 ? (
        <View style={styles.chips}>
          {suggestions.map((suggestion) => {
            const hint = suggestionAliasHint(suggestion);
            const selected = chosenIds.has(suggestion.id);
            return (
              <Chip
                key={suggestion.id}
                label={hint ? `${isolate(suggestion.name)} (${isolate(hint)})` : isolate(suggestion.name)}
                selectable
                selected={selected}
                disabled={disabled || (full && !selected)}
                accessibilityLabel={
                  hint ? `Brand, ${suggestion.name}, matched ${isolate(hint)}` : `Brand, ${suggestion.name}`
                }
                onPress={() => {
                  onToggle({ id: suggestion.id, name: suggestion.name });
                  // A pick ends this lookup: the brand moves to the chosen
                  // row above, and the field is ready for the next one.
                  if (!selected) setTyped('');
                }}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: space[2],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
});
