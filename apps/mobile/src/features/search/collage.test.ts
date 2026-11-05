import { describe, expect, it } from 'vitest';

import {
  chunkIntoBlocks,
  COLLAGE_BLOCK_ROWS,
  COLLAGE_BLOCK_SIZE,
  COLLAGE_COLUMNS,
  COLLAGE_GAP,
  COLLAGE_PATTERN,
  COLLAGE_ROW_UNIT,
  getCollageBlockHeight,
  getCollageColumnWidth,
  getCollageRowsHeight,
  getCollageSlot,
  getCollageTileRect,
  isFeatureSlot,
} from '@/features/search/collage';

describe('COLLAGE_PATTERN', () => {
  it('holds exactly one block of items', () => {
    expect(COLLAGE_PATTERN).toHaveLength(COLLAGE_BLOCK_SIZE);
  });

  // The load-bearing property: the spans tile a 3x13 grid with no hole and no
  // overlap. If a future pattern edit breaks this, the collage silently grows
  // gaps or stacks tiles on top of each other.
  it('tiles the 3x13 block exactly — every cell covered once', () => {
    const covered = new Set<string>();

    for (const cell of COLLAGE_PATTERN) {
      for (let c = cell.col; c < cell.col + cell.colSpan; c += 1) {
        for (let r = cell.row; r < cell.row + cell.rowSpan; r += 1) {
          const key = `${c},${r}`;
          expect(covered.has(key)).toBe(false); // no overlap
          covered.add(key);
        }
      }
    }

    expect(covered.size).toBe(COLLAGE_COLUMNS * COLLAGE_BLOCK_ROWS);
  });

  it('stays inside the three columns', () => {
    for (const cell of COLLAGE_PATTERN) {
      expect(cell.col).toBeGreaterThanOrEqual(0);
      expect(cell.col + cell.colSpan).toBeLessThanOrEqual(COLLAGE_COLUMNS);
    }
  });

  it('matches the handoff spans, in order', () => {
    expect(COLLAGE_PATTERN.map((c) => `${c.colSpan}x${c.rowSpan}`)).toEqual([
      '2x4',
      '1x2',
      '1x2',
      '1x3',
      '2x3',
      '1x3',
      '1x3',
      '1x3',
      '3x3',
    ]);
  });
});

describe('getCollageSlot', () => {
  it('returns the cell for each slot in a block', () => {
    expect(getCollageSlot(0)).toEqual({ col: 0, row: 0, colSpan: 2, rowSpan: 4 });
    expect(getCollageSlot(8)).toEqual({ col: 0, row: 10, colSpan: 3, rowSpan: 3 });
  });

  it('throws rather than returning undefined for an out-of-range slot', () => {
    expect(() => getCollageSlot(COLLAGE_BLOCK_SIZE)).toThrow(/out of range/);
    expect(() => getCollageSlot(-1)).toThrow(/out of range/);
  });
});

describe('chunkIntoBlocks', () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => i);

  it('splits into full blocks', () => {
    expect(chunkIntoBlocks(items(18))).toHaveLength(2);
    expect(chunkIntoBlocks(items(18))[0]).toHaveLength(COLLAGE_BLOCK_SIZE);
  });

  it('keeps a short trailing block rather than padding or dropping it', () => {
    const blocks = chunkIntoBlocks(items(11));
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toEqual([9, 10]);
  });

  it('returns nothing for an empty list', () => {
    expect(chunkIntoBlocks([])).toEqual([]);
  });

  it('preserves order across the split', () => {
    expect(chunkIntoBlocks(items(20)).flat()).toEqual(items(20));
  });
});

describe('getCollageColumnWidth', () => {
  it('divides the width after removing the gaps between columns', () => {
    // 3 columns, 2 gaps.
    expect(getCollageColumnWidth(300 + COLLAGE_GAP * 2)).toBe(100);
  });

  it('clamps at zero instead of going negative in a tiny container', () => {
    expect(getCollageColumnWidth(0)).toBe(0);
  });
});

describe('getCollageRowsHeight', () => {
  it('counts the gaps BETWEEN rows, not after the last one', () => {
    expect(getCollageRowsHeight(1)).toBe(COLLAGE_ROW_UNIT);
    expect(getCollageRowsHeight(3)).toBe(COLLAGE_ROW_UNIT * 3 + COLLAGE_GAP * 2);
  });

  it('is zero for no rows', () => {
    expect(getCollageRowsHeight(0)).toBe(0);
    expect(getCollageRowsHeight(-2)).toBe(0);
  });
});

describe('getCollageTileRect', () => {
  const containerWidth = 300 + COLLAGE_GAP * 2; // column width 100

  it('positions a single-cell tile on its column and row', () => {
    const rect = getCollageTileRect({
      cell: { col: 2, row: 7, colSpan: 1, rowSpan: 3 },
      containerWidth,
    });
    expect(rect.left).toBe(2 * (100 + COLLAGE_GAP));
    expect(rect.top).toBe(7 * (COLLAGE_ROW_UNIT + COLLAGE_GAP));
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(getCollageRowsHeight(3));
  });

  // The arithmetic most likely to be written wrong: a span swallows the gaps
  // INSIDE it, so it is span*unit + (span-1)*gap, never span*(unit+gap).
  it('a span absorbs the gaps it covers', () => {
    const rect = getCollageTileRect({
      cell: { col: 0, row: 0, colSpan: 2, rowSpan: 4 },
      containerWidth,
    });
    expect(rect.width).toBe(2 * 100 + COLLAGE_GAP);
    expect(rect.width).not.toBe(2 * (100 + COLLAGE_GAP));
    expect(rect.height).toBe(4 * COLLAGE_ROW_UNIT + 3 * COLLAGE_GAP);
  });

  it('a full-width tile spans the whole container', () => {
    const rect = getCollageTileRect({
      cell: { col: 0, row: 10, colSpan: 3, rowSpan: 3 },
      containerWidth,
    });
    expect(rect.left).toBe(0);
    expect(rect.width).toBeCloseTo(containerWidth, 5);
  });

  // Adjacent tiles must not overlap: tile A's right edge plus one gap is
  // exactly tile B's left edge.
  it('leaves exactly one gap between neighbouring tiles', () => {
    const left = getCollageTileRect({
      cell: { col: 0, row: 4, colSpan: 1, rowSpan: 3 },
      containerWidth,
    });
    const right = getCollageTileRect({
      cell: { col: 1, row: 4, colSpan: 2, rowSpan: 3 },
      containerWidth,
    });
    expect(left.left + left.width + COLLAGE_GAP).toBeCloseTo(right.left, 5);
  });
});

describe('getCollageBlockHeight', () => {
  it('a full block is the whole 13-row pattern', () => {
    expect(getCollageBlockHeight(COLLAGE_BLOCK_SIZE)).toBe(
      getCollageRowsHeight(COLLAGE_BLOCK_ROWS),
    );
  });

  // A partial block must not reserve the full 13 rows, or a dead gap opens
  // below the last tile while the next page loads.
  it('a partial block is only as tall as the slots it actually uses', () => {
    // Slots 0-2 fill rows 0-3.
    expect(getCollageBlockHeight(3)).toBe(getCollageRowsHeight(4));
    expect(getCollageBlockHeight(3)).toBeLessThan(getCollageBlockHeight(COLLAGE_BLOCK_SIZE));
  });

  it('one item is as tall as the first tile', () => {
    expect(getCollageBlockHeight(1)).toBe(getCollageRowsHeight(4));
  });

  it('is zero for an empty block', () => {
    expect(getCollageBlockHeight(0)).toBe(0);
  });

  it('never exceeds a full block, even if handed too many items', () => {
    expect(getCollageBlockHeight(50)).toBe(getCollageRowsHeight(COLLAGE_BLOCK_ROWS));
  });

  it('grows monotonically with item count', () => {
    let previous = 0;
    for (let count = 0; count <= COLLAGE_BLOCK_SIZE; count += 1) {
      const height = getCollageBlockHeight(count);
      expect(height).toBeGreaterThanOrEqual(previous);
      previous = height;
    }
  });
});

describe('isFeatureSlot', () => {
  it('is true only for the wide tiles', () => {
    const wide = COLLAGE_PATTERN.map((_, slot) => isFeatureSlot(slot));
    expect(wide).toEqual([true, false, false, false, true, false, false, false, true]);
  });

  // A sticker on every tile is wallpaper, not a highlight — and on a
  // one-column tile it covers most of the photo it annotates.
  it('leaves most of a block unstickered', () => {
    const count = COLLAGE_PATTERN.filter((_, slot) => isFeatureSlot(slot)).length;
    expect(count).toBeLessThan(COLLAGE_BLOCK_SIZE / 2);
  });
});
