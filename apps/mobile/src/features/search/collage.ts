// Pure layout logic for Explore's collage grid. No react-native and no
// `@/lib/supabase` import, so the packing is unit-testable on its own.

/** Columns in the collage. */
export const COLLAGE_COLUMNS = 3;

/** Items per repeating block. */
export const COLLAGE_BLOCK_SIZE = 9;

/** Rows one full block occupies. */
export const COLLAGE_BLOCK_ROWS = 13;

/** Height of one row unit, in points. */
export const COLLAGE_ROW_UNIT = 58;

/** Gap between tiles, both axes, in points. */
export const COLLAGE_GAP = 6;

export type CollageCell = {
  /** Zero-based column of the tile's left edge. */
  col: number;
  /** Zero-based row of the tile's top edge, absolute across blocks. */
  row: number;
  colSpan: number;
  rowSpan: number;
};

/**
 * The repeating 9-item pattern, as explicit positions rather than a packing
 * algorithm.
 *
 * The handoff gives the pattern as spans — [2x4, 1x2, 1x2, 1x3, 2x3, 1x3,
 * 1x3, 1x3, 3x3] (cols x rows) — and those tile a 3x13 grid EXACTLY:
 * 8+2+2+3+6+3+3+3+9 = 39 = 3 x 13. Because the fit is exact and fixed, the
 * positions are a constant, not something to re-derive at runtime: a shelf
 * packer would compute the same answer every time, could drift if its
 * tie-breaking changed, and would make the layout hard to reason about from
 * the source.
 *
 * Laid out as four full-width bands: rows 0-3, 4-6, 7-9, 10-12.
 */
export const COLLAGE_PATTERN: readonly CollageCell[] = [
  { col: 0, row: 0, colSpan: 2, rowSpan: 4 },
  { col: 2, row: 0, colSpan: 1, rowSpan: 2 },
  { col: 2, row: 2, colSpan: 1, rowSpan: 2 },
  { col: 0, row: 4, colSpan: 1, rowSpan: 3 },
  { col: 1, row: 4, colSpan: 2, rowSpan: 3 },
  { col: 0, row: 7, colSpan: 1, rowSpan: 3 },
  { col: 1, row: 7, colSpan: 1, rowSpan: 3 },
  { col: 2, row: 7, colSpan: 1, rowSpan: 3 },
  { col: 0, row: 10, colSpan: 3, rowSpan: 3 },
];

/** The pattern slot for one position within a block. */
export function getCollageSlot(slotIndex: number): CollageCell {
  const cell = COLLAGE_PATTERN[slotIndex];
  if (!cell) {
    throw new Error(
      `Collage slot ${slotIndex} is out of range — a block holds ${COLLAGE_BLOCK_SIZE} items`,
    );
  }
  return cell;
}

/**
 * Splits a flat list into blocks of `COLLAGE_BLOCK_SIZE`.
 *
 * Blocks are what gets rendered as list rows, which is what keeps this on a
 * `FlatList` (and therefore keeps `onEndReached` pagination and recycling)
 * despite the spans: each row is one fixed-height block that positions its own
 * tiles absolutely. A span-aware list would otherwise force a plain
 * `ScrollView` and hand-rolled pagination.
 *
 * The final block is short whenever the item count is not a multiple of 9;
 * `getCollageBlockHeight` sizes it to only the slots actually present.
 */
export function chunkIntoBlocks<T>(items: readonly T[]): T[][] {
  const blocks: T[][] = [];
  for (let index = 0; index < items.length; index += COLLAGE_BLOCK_SIZE) {
    blocks.push(items.slice(index, index + COLLAGE_BLOCK_SIZE));
  }
  return blocks;
}

/** Width of a single column, given the space the grid has to fill. */
export function getCollageColumnWidth(containerWidth: number): number {
  const totalGaps = COLLAGE_GAP * (COLLAGE_COLUMNS - 1);
  return Math.max(0, (containerWidth - totalGaps) / COLLAGE_COLUMNS);
}

/** Pixel height of `rowCount` row units, gaps between them included. */
export function getCollageRowsHeight(rowCount: number): number {
  if (rowCount <= 0) return 0;
  return rowCount * COLLAGE_ROW_UNIT + (rowCount - 1) * COLLAGE_GAP;
}

/**
 * Absolute rect for one tile inside its block.
 *
 * A span covers its own columns/rows PLUS the gaps it swallows between them —
 * which is why this is `span * unit + (span - 1) * gap` rather than
 * `span * (unit + gap)`. Getting that wrong leaves every multi-span tile a few
 * points short and the grid subtly ragged.
 */
export function getCollageTileRect({
  cell,
  containerWidth,
}: {
  cell: CollageCell;
  containerWidth: number;
}): { left: number; top: number; width: number; height: number } {
  const columnWidth = getCollageColumnWidth(containerWidth);

  return {
    left: cell.col * (columnWidth + COLLAGE_GAP),
    top: cell.row * (COLLAGE_ROW_UNIT + COLLAGE_GAP),
    width: cell.colSpan * columnWidth + (cell.colSpan - 1) * COLLAGE_GAP,
    height: getCollageRowsHeight(cell.rowSpan),
  };
}

/**
 * Height of a block holding `itemCount` items (1..9).
 *
 * Derived from the lowest occupied row rather than fixed at 13, so a trailing
 * partial block does not reserve empty space below the last tile — visible as
 * a dead gap above the tab bar while more pages load.
 */
export function getCollageBlockHeight(itemCount: number): number {
  const slots = Math.min(itemCount, COLLAGE_BLOCK_SIZE);
  if (slots <= 0) return 0;

  let lowestRow = 0;
  for (let slot = 0; slot < slots; slot += 1) {
    const cell = getCollageSlot(slot);
    lowestRow = Math.max(lowestRow, cell.row + cell.rowSpan);
  }
  return getCollageRowsHeight(lowestRow);
}

/**
 * Whether a slot is one of the pattern's wide tiles.
 *
 * Stickers go only on these. Tagging every tile turns a highlight into
 * wallpaper — the thing stops meaning "look at this" — and on a
 * single-column tile a rotated sticker covers most of the photo it is
 * supposed to be annotating.
 */
export function isFeatureSlot(slotIndex: number): boolean {
  return getCollageSlot(slotIndex).colSpan >= 2;
}
