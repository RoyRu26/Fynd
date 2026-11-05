import { StyleSheet, View } from 'react-native';

import { Chip, Skeleton, Text } from '@/components/ui';
import { space } from '@/design/tokens';
import type { AttributeKind, AttributeKindInfo, AttributeVocabulary } from '@/features/listings/attributes';
import {
  anyKindLabel,
  filterableKinds,
  filterableTerms,
  isTermKindFull,
  MAX_FILTER_IDS_PER_KIND,
  type AttributeTermFilters,
  type CategoryScope,
} from '@/features/search/search';

/**
 * Explore's attribute filters (ROADMAP 7.4): one multi-select chip wall per
 * kind that applies to the category scope, each led by an "Any {kind}" chip
 * that clears just that kind. Rules live in search.ts; this only renders.
 *
 * Rendered twice by the sheet — `only="item_type"` near the top (it is the
 * most decisive filter after category) and `only="details"` for the rest
 * under a "Details" label. Loading and error states belong to the details
 * half only, so the sheet never shows them twice.
 */
export function AttributeFilterFields({
  vocab,
  vocabError,
  scope,
  termIds,
  onToggle,
  onClearKind,
  only,
}: {
  vocab: AttributeVocabulary | undefined;
  vocabError: boolean;
  scope: CategoryScope;
  termIds: AttributeTermFilters;
  onToggle: (termId: string) => void;
  onClearKind: (kind: AttributeKind) => void;
  only: 'item_type' | 'details';
}) {
  if (!vocab) {
    if (only === 'item_type') return null;
    return (
      <View style={styles.section}>
        <SectionLabel text="Details" />
        {vocabError ? (
          <Text variant="caption" color="textTertiary">
            Couldn&apos;t load more filters.
          </Text>
        ) : (
          <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading filters">
            <Skeleton height={space[8]} />
          </View>
        )}
      </View>
    );
  }

  const kinds = filterableKinds(vocab, scope, termIds).filter((info) =>
    only === 'item_type' ? info.kind === 'item_type' : info.kind !== 'item_type',
  );
  if (kinds.length === 0) return null;

  if (only === 'item_type') {
    return (
      <KindChips
        info={kinds[0]}
        heading="label"
        vocab={vocab}
        scope={scope}
        termIds={termIds}
        onToggle={onToggle}
        onClearKind={onClearKind}
      />
    );
  }

  return (
    <View style={styles.section}>
      <SectionLabel text="Details" />
      {kinds.map((info) => (
        <KindChips
          key={info.kind}
          info={info}
          heading="caption"
          vocab={vocab}
          scope={scope}
          termIds={termIds}
          onToggle={onToggle}
          onClearKind={onClearKind}
        />
      ))}
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <Text variant="label" color="textSecondary">
      {text}
    </Text>
  );
}

function KindChips({
  info,
  heading,
  vocab,
  scope,
  termIds,
  onToggle,
  onClearKind,
}: {
  info: AttributeKindInfo;
  /** `label` when the kind is its own sheet section, `caption` inside the Details group. */
  heading: 'label' | 'caption';
  vocab: AttributeVocabulary;
  scope: CategoryScope;
  termIds: AttributeTermFilters;
  onToggle: (termId: string) => void;
  onClearKind: (kind: AttributeKind) => void;
}) {
  const selected = termIds[info.kind];
  const full = isTermKindFull(termIds, info.kind);

  return (
    <View style={styles.kind}>
      <Text variant={heading} color={heading === 'label' ? 'textSecondary' : 'textTertiary'}>
        {full ? `${info.label} · up to ${MAX_FILTER_IDS_PER_KIND}` : info.label}
      </Text>
      <View style={styles.chips}>
        <Chip
          label={anyKindLabel(info)}
          selectable
          selected={selected.length === 0}
          onPress={() => onClearKind(info.kind)}
        />
        {filterableTerms(vocab, info.kind, scope, selected).map((term) => {
          const isSelected = selected.includes(term.id);
          return (
            <Chip
              key={term.id}
              label={term.label}
              selectable
              selected={isSelected}
              disabled={full && !isSelected}
              accessibilityLabel={`${info.label}, ${term.label}`}
              onPress={() => onToggle(term.id)}
            />
          );
        })}
      </View>
    </View>
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
