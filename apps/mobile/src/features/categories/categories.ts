/**
 * Pure category-taxonomy logic: row normalization, parent/child grouping,
 * and breadcrumb formatting.
 *
 * No react-native or `@/lib/supabase` import — same split every other pure
 * feature module (listings/size.ts, listing-detail/detail.ts) uses, for the
 * same reason: it keeps this directly unit-testable.
 *
 * `categories` (ROADMAP 2.1) is a self-referencing adjacency-list table, not
 * a client-side enum: the taxonomy itself lives in the database
 * (supabase/migrations/20261018100200_categories.sql) and is fetched
 * through api.ts. This module turns the flat fetched list into the
 * two-level shape the sell-flow picker and the listing-detail breadcrumb
 * both need.
 */

/** The raw row shape fetched by api.ts's `fetchCategories`. */
export type CategoryRow = {
  id: string;
  name: string;
  parent_id: string | null;
  position: number;
};

export type Category = {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
};

export type CategoryGroup = {
  id: string;
  name: string;
  subcategories: Category[];
};

/**
 * Row -> domain. Trivial snake_case -> camelCase; no invariant checking
 * happens here -- that needs the full list (to resolve parent/child
 * references) and lives in `groupCategoriesByParent` below.
 */
export function normalizeCategoryRow(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    position: row.position,
  };
}

function sortCategories(categories: Category[]): Category[] {
  return [...categories].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/**
 * Groups a flat category list into top-level groups with their leaves.
 *
 * Throws rather than silently dropping a malformed row -- a category this
 * client cannot place is a taxonomy bug, not something the sell flow or a
 * future Explore screen (ROADMAP 2.3) should quietly hide a listing's
 * category under. Two invariants are checked, both unreachable against a
 * healthy fetch of the seeded taxonomy:
 *
 *   - a row's `parentId` must resolve to a row THAT IS ITSELF top-level
 *     (parentId === null) somewhere else in the same list -- catches both a
 *     dangling reference and a leaf mistakenly pointing at another leaf
 *     (three levels deep, which this taxonomy never has).
 *   - a top-level row (parentId === null) must have at least one child --
 *     a top-level row with none is neither a usable group nor a leaf.
 */
export function groupCategoriesByParent(rows: Category[]): CategoryGroup[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const childrenByParent = new Map<string, Category[]>();

  for (const row of rows) {
    if (row.parentId === null) continue;
    const parent = byId.get(row.parentId);
    if (!parent || parent.parentId !== null) {
      throw new Error(
        `Category "${row.name}" (${row.id}) has parent_id ${row.parentId}, which does not resolve to a known top-level category`,
      );
    }
    const siblings = childrenByParent.get(row.parentId) ?? [];
    siblings.push(row);
    childrenByParent.set(row.parentId, siblings);
  }

  const topLevel = rows.filter((row) => row.parentId === null);

  return sortCategories(topLevel).map((top) => {
    const subcategories = childrenByParent.get(top.id) ?? [];
    if (subcategories.length === 0) {
      throw new Error(
        `Category "${top.name}" (${top.id}) has no parent_id and no children -- it is neither a valid group nor a valid leaf`,
      );
    }
    return {
      id: top.id,
      name: top.name,
      subcategories: sortCategories(subcategories),
    };
  });
}

// U+203A SINGLE RIGHT-POINTING ANGLE QUOTATION MARK. No existing breadcrumb
// convention elsewhere in this codebase to match (checked), so this is the
// one DESIGN.md's category-chip note (§14.6) points back to.
const BREADCRUMB_SEPARATOR = ' › ';

/**
 * e.g. formatCategoryBreadcrumb(women, shoes) -> "Women › Shoes"
 *
 * Takes anything with a `name` (so a full `CategoryGroup`/`Category` from
 * the picker sheet works directly) rather than the full types specifically,
 * because the listing-detail screen only ever has the two plain names
 * (`categoryParentName`/`categoryName` off `NormalizedListingDetail`, not a
 * full fetched taxonomy) and has no reason to fabricate ids/positions just
 * to call this.
 */
export function formatCategoryBreadcrumb(group: { name: string }, leaf: { name: string }): string {
  return `${group.name}${BREADCRUMB_SEPARATOR}${leaf.name}`;
}

/**
 * Resolves a stored `category_id` back to its group + leaf, for display
 * (the sell-flow category field's breadcrumb, the picker sheet's initial
 * state). `null` for a null id (no category chosen yet) or an id that
 * matches no leaf in `groups` — e.g. while the categories query is still
 * loading. Deliberately non-throwing, unlike `groupCategoriesByParent`'s own
 * invariants: an unresolved SELECTED id is an ordinary, expected transient
 * state here, not a taxonomy data bug.
 */
/**
 * What a stored `category_id` refers to: a whole top-level group, or one leaf
 * inside one.
 *
 * Both are valid filter values. `search_listings` matches
 * `cat.id = p_category_id OR cat.parent_id = p_category_id`, so passing a
 * group id filters to that entire group — which is exactly what Explore's
 * category tabs do, while its filter sheet still passes leaf ids.
 */
export type CategoryMatch =
  | { kind: 'group'; group: CategoryGroup }
  | { kind: 'leaf'; group: CategoryGroup; leaf: Category };

/**
 * Resolves a `category_id` to either kind of match, group ids included —
 * unlike `findCategorySelection` below, which only ever finds leaves.
 *
 * Needed because a UI that can filter by group has two jobs the leaf-only
 * lookup cannot do: label the active-filter chip (a group id would otherwise
 * resolve to no label, and the chip for a live filter would silently vanish),
 * and decide which category tab reads as active when the selection came from
 * the sheet as a leaf — that is `match.group`, so picking "Women › Outerwear"
 * lights up the Women tab.
 *
 * Non-throwing for an unresolved id, for the same reason
 * `findCategorySelection` is: it is an ordinary transient state while the
 * categories query is still loading, not a taxonomy bug.
 */
export function findCategoryMatch(
  groups: CategoryGroup[],
  categoryId: string | null,
): CategoryMatch | null {
  if (categoryId === null) {
    return null;
  }
  for (const group of groups) {
    if (group.id === categoryId) {
      return { kind: 'group', group };
    }
    const leaf = group.subcategories.find((subcategory) => subcategory.id === categoryId);
    if (leaf) {
      return { kind: 'leaf', group, leaf };
    }
  }
  return null;
}

/**
 * The label for a category filter: the group's own name for a whole-group
 * filter, the full breadcrumb for a leaf. `null` when nothing is selected or
 * the id has not resolved yet.
 */
export function formatCategoryMatchLabel(match: CategoryMatch | null): string | null {
  if (match === null) {
    return null;
  }
  return match.kind === 'group' ? match.group.name : formatCategoryBreadcrumb(match.group, match.leaf);
}

export function findCategorySelection(
  groups: CategoryGroup[],
  categoryId: string | null,
): { group: CategoryGroup; leaf: Category } | null {
  if (categoryId === null) {
    return null;
  }
  for (const group of groups) {
    const leaf = group.subcategories.find((subcategory) => subcategory.id === categoryId);
    if (leaf) {
      return { group, leaf };
    }
  }
  return null;
}
