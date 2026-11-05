import { StyleSheet, View } from 'react-native';

import { Chip, Skeleton, Text, TextField, type IconName } from '@/components/ui';
import { space } from '@/design/tokens';
import { BrandField } from '@/features/brands/brand-field';
import { AiOfferRow } from '@/features/listings/ai-offer-row';
import { offersForField, type AiField, type AiOffer } from '@/features/listings/ai-policy';
import {
  applicableKinds,
  isKindFull,
  MAX_KEYWORDS,
  selectableTerms,
} from '@/features/listings/attributes';
import type { AttributeEditor } from '@/features/listings/use-attribute-editor';

const REMOVE_ICON: IconName = { ios: 'xmark', android: 'close', web: 'close' };

/**
 * The Sell editor's "Details" group: brand, one chip row per attribute kind
 * that applies to the chosen category, then keywords. All optional — nothing here
 * blocks publishing. State and rules live in `useAttributeEditor` /
 * attributes.ts; this only renders them.
 *
 * `ai` (drafts only) adds the AI offers for each field and a "Suggested"
 * mark on values AI pre-filled; without it the group is exactly as before.
 */
export type DetailsAiProps = {
  offers: readonly AiOffer[];
  suggested: ReadonlySet<AiField>;
  onApply: (offer: AiOffer) => void;
  onDismiss: (field: AiField) => void;
};

export function ListingDetailsFields({
  editor,
  categoryId,
  disabled,
  ai,
}: {
  editor: AttributeEditor;
  categoryId: string | null;
  disabled: boolean;
  ai?: DetailsAiProps;
}) {
  function offerRow(field: AiField, fieldLabel: string) {
    if (!ai) return null;
    return (
      <AiOfferRow
        offers={offersForField(ai.offers, field)}
        fieldLabel={fieldLabel}
        disabled={disabled}
        onApply={ai.onApply}
        onDismiss={() => ai.onDismiss(field)}
      />
    );
  }

  function suggestedNote(field: AiField) {
    if (!ai?.suggested.has(field)) return null;
    return (
      <Text variant="caption" color="textTertiary">
        Suggested from your photos
      </Text>
    );
  }

  if (editor.loadError) {
    return (
      <View style={styles.section}>
        <SectionHeader />
        <Text variant="caption" color="danger">
          Couldn&apos;t load details. Your other changes still save.
        </Text>
      </View>
    );
  }

  if (!editor.ready || !editor.vocab) {
    return (
      <View style={styles.section}>
        <SectionHeader />
        <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading details">
          <Skeleton height={space[8]} />
        </View>
      </View>
    );
  }

  const vocab = editor.vocab;
  const kinds = applicableKinds(vocab, categoryId);

  return (
    <View style={styles.section}>
      <SectionHeader />

      {editor.notice ? (
        <Text variant="caption" color="textSecondary" accessibilityLiveRegion="polite">
          {editor.notice}
        </Text>
      ) : null}

      {/* Brand applies to every category, so it is offered even before one is chosen. */}
      <BrandField
        brand={editor.brand}
        draft={editor.brandDraft}
        error={editor.brandError}
        disabled={disabled}
        onDraftChange={editor.setBrandDraft}
        onChoose={editor.chooseBrand}
        onSubmit={editor.submitBrandDraft}
        onClear={editor.clearBrand}
      />
      {suggestedNote('brand')}
      {offerRow('brand', 'Brand')}

      {categoryId === null ? (
        <Text variant="caption" color="textTertiary">
          Choose a category to add item type, color and more.
        </Text>
      ) : null}

      {kinds.map((info) => {
        const full = isKindFull(vocab, editor.selection, info.kind);
        return (
          <View key={info.kind} style={styles.kind}>
            <Text variant="caption" color="textTertiary">
              {[
                info.label,
                info.maxValues > 1 ? `up to ${info.maxValues}` : null,
                ai?.suggested.has(info.kind) ? 'Suggested' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            <View style={styles.chips}>
              {selectableTerms(vocab, info.kind, categoryId, editor.selection).map((term) => {
                const selected = editor.selection.includes(term.id);
                return (
                  <Chip
                    key={term.id}
                    label={term.label}
                    selectable
                    selected={selected}
                    disabled={disabled || (full && !selected)}
                    accessibilityLabel={`${info.label}, ${term.label}`}
                    onPress={() => editor.toggle(term.id)}
                  />
                );
              })}
            </View>
            {offerRow(info.kind, info.label)}
          </View>
        );
      })}

      <View style={styles.kind}>
        <TextField
          label={`Keywords · up to ${MAX_KEYWORDS}`}
          value={editor.keywordDraft}
          onChangeText={editor.setKeywordDraft}
          onSubmitEditing={editor.submitKeywordDraft}
          submitBehavior="submit"
          returnKeyType="done"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="e.g. crewneck, 90s, זיפר"
          helperText={editor.keywordError ? undefined : 'Help buyers find it. Press return to add each one.'}
          error={editor.keywordError ?? undefined}
          disabled={disabled || editor.keywords.length >= MAX_KEYWORDS}
        />
        {editor.keywords.length > 0 ? (
          <View style={styles.chips}>
            {editor.keywords.map((keyword) => (
              // Same dismissible-token pattern as Explore's active filters:
              // inverse tone = already committed, press to remove.
              <Chip
                key={keyword}
                label={keyword}
                tone="inverse"
                icon={REMOVE_ICON}
                selectable
                selected={false}
                disabled={disabled}
                accessibilityLabel={`Remove keyword ${keyword}`}
                onPress={() => editor.removeKeyword(keyword)}
              />
            ))}
          </View>
        ) : null}
        {suggestedNote('keywords')}
        {offerRow('keywords', 'Keywords')}
      </View>
    </View>
  );
}

function SectionHeader() {
  return (
    <Text variant="label" color="textSecondary">
      Details
    </Text>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: space[3],
  },
  kind: {
    gap: space[1],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
});
