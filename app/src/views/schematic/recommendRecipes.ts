// Recipe recommendation algorithm — "what else could we make with
// what we already have on the bus?"
//
// Scans the catalog for recipes whose products aren't already in the
// active flow but whose ingredients OVERLAP with items the flow
// already produces or consumes. Ranks by:
//   1. Coverage: fraction of the candidate's ingredients we already have
//   2. Jaccard: |ingredients ∩ available| / |ingredients ∪ available|
//   3. Ingredient count (prefer simpler recipes)
//
// The intuition: a recipe whose every ingredient is already on the
// bus costs almost nothing to add — just one more cell tapping the
// existing buses. A recipe missing one ingredient would force a new
// production chain. Ranking by coverage surfaces the "free wins."

import type { Catalog, Recipe } from "../../factorio"
import type { FlowGraph } from "../../solver/expand"

export interface RecipeSuggestion {
  /** Item key this recipe produces. */
  item: string
  /** Display name of the item. */
  itemName: string
  /** Recipe that would be added. */
  recipe: Recipe
  /** Fraction of ingredients we already have. 0..1. */
  coverage: number
  /** Jaccard similarity between ingredients and available items. 0..1. */
  jaccard: number
  /** Ingredients already on the bus. */
  matched: string[]
  /** Ingredients we'd need to add a new chain for. */
  missing: string[]
}

export interface RecommendOptions {
  /** Minimum coverage to surface. 0 = show everything. Default 0.5. */
  minCoverage?: number
  /** Cap the number of suggestions. Default 20. */
  limit?: number
}

/**
 * Compute ranked recipe suggestions for adding to the current flow.
 *
 * Items already produced by some cell in `flow` are excluded — no
 * point recommending what we already make.
 */
export function recommendRecipes(
  catalog: Catalog,
  flow: FlowGraph,
  opts: RecommendOptions = {},
): RecipeSuggestion[] {
  const minCoverage = opts.minCoverage ?? 0.5
  const limit = opts.limit ?? 20

  // Items currently produced by some recipe in the flow (their cells exist).
  const produced = new Set<string>()
  for (const node of flow.nodes) {
    if (!node.recipe) continue
    for (const p of node.recipe.products) produced.add(p.item)
  }

  // "Available" = items moving through the flow (intermediates + raw + outputs).
  // This is what's on the bus and a new cell could tap.
  const available = new Set<string>()
  for (const e of flow.edges) available.add(e.item)

  const suggestions: RecipeSuggestion[] = []
  const seenItems = new Set<string>()

  for (const recipe of catalog.recipes.values()) {
    // Skip recipes with no products (shouldn't exist, but defensive).
    if (recipe.products.length === 0) continue
    // The "primary" product = the first non-fluid product if possible,
    // else the first product. This is what we'd add as a target.
    const primary =
      recipe.products.find((p) => !catalog.fluidItems.has(p.item)) ?? recipe.products[0]
    if (produced.has(primary.item)) continue
    if (seenItems.has(primary.item)) continue // dedup multiple recipes per item
    seenItems.add(primary.item)

    const ingItems = recipe.ingredients.map((ing) => ing.item)
    if (ingItems.length === 0) continue

    const matched = ingItems.filter((it) => available.has(it))
    if (matched.length === 0) continue

    const coverage = matched.length / ingItems.length
    if (coverage < minCoverage) continue

    const union = new Set([...ingItems, ...available])
    const jaccard = matched.length / union.size

    suggestions.push({
      item: primary.item,
      itemName: catalog.items.get(primary.item)?.name ?? primary.item,
      recipe,
      coverage,
      jaccard,
      matched,
      missing: ingItems.filter((it) => !available.has(it)),
    })
  }

  suggestions.sort((a, b) => {
    if (b.coverage !== a.coverage) return b.coverage - a.coverage
    if (b.jaccard !== a.jaccard) return b.jaccard - a.jaccard
    // Tiebreaker: simpler recipes first (fewer ingredients).
    return a.recipe.ingredients.length - b.recipe.ingredients.length
  })

  return suggestions.slice(0, limit)
}
