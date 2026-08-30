// Compile-time-only checks for the Chip discriminated union contract.
// Not executed by vitest (this filename doesn't match src/**/*.test.ts) —
// verified instead by `tsc --noEmit`, which fails the build if any expected-
// error directive below does NOT actually produce a type error.
import type { ChipProps } from '@/components/ui/chip';

function checkChip(_props: ChipProps) {}

// Static chip: selectable may be omitted entirely.
checkChip({ label: 'Very good' });

// Static chip: selectable explicitly false is also valid.
checkChip({ label: 'Very good', selectable: false });

// @ts-expect-error - selected is not assignable on a static chip
checkChip({ label: 'Very good', selected: true });

// @ts-expect-error - onPress is not assignable on a static chip
checkChip({ label: 'Very good', onPress: () => {} });

// @ts-expect-error - selected is required when selectable is true
checkChip({ label: 'Size M', selectable: true, onPress: () => {} });

// @ts-expect-error - onPress is required when selectable is true
checkChip({ label: 'Size M', selectable: true, selected: false });

// Selectable chip: fully valid.
checkChip({ label: 'Size M', selectable: true, selected: false, onPress: () => {} });
