// Pure layout logic for the welcome screen's photo collage. No react-native
// imports, so it is unit-testable (see welcome-collage.test.ts).

/**
 * Photo slot for each collage tile, given each column's tile count.
 *
 * Slots are numbered row by row ACROSS the columns, skipping rows a column
 * doesn't have (a longer column just contributes extra slots in its deeper
 * rows), so every tile gets its own photo and a partial photo list fills
 * across the collage rather than down one column.
 */
export function getCollagePhotoSlots(columnLengths: readonly number[]): number[][] {
  const slots: number[][] = columnLengths.map(() => []);
  const rows = columnLengths.length > 0 ? Math.max(...columnLengths) : 0;
  let next = 0;
  for (let row = 0; row < rows; row += 1) {
    columnLengths.forEach((length, columnIndex) => {
      if (row < length) slots[columnIndex].push(next++);
    });
  }
  return slots;
}
