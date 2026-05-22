// I/O shape metadata for a (machine, recipe) producing pair.
//
// Every producing pair has a shape — how many SOLID input streams, FLUID
// input streams, SOLID output streams, FLUID output streams — fully
// determined by the RECIPE (which ingredients/products are fluids per
// `catalog.fluidItems`). The machine just executes it.
//
// This is metadata only (Option A): we compute the shape and surface it
// on FlowNode for downstream consumers (named-factory-template work
// fbp-9iw, clustering heuristics fbp-xm0). Validation against machine
// hard limits (e.g. assembler = 2 input slots, chem plant = 2 fluid +
// 2 solid inputs) is a follow-up.

import type { Recipe } from "../factorio"

export interface IOShape {
  solidsIn: number
  fluidsIn: number
  solidsOut: number
  fluidsOut: number
}

/**
 * Human-readable label for a shape. Format: `totalIn:totalOut`, with a
 * ` (fluids: F→F)` suffix only when there ARE fluids on either side.
 *
 * Examples:
 *   {1,0,1,0} → "1:1"
 *   {2,0,1,0} → "2:1"
 *   {1,1,0,1} → "2:1 (fluids: 1→1)"
 *   {0,2,0,3} → "2:3 (fluids: 2→3)"
 *   {1,0,0,3} → "1:3 (fluids: 0→3)"   // only one side has fluids — still annotated
 */
export function ioShapeLabel(s: IOShape): string {
  const totalIn = s.solidsIn + s.fluidsIn
  const totalOut = s.solidsOut + s.fluidsOut
  const base = `${totalIn}:${totalOut}`
  if (s.fluidsIn + s.fluidsOut > 0) {
    return `${base} (fluids: ${s.fluidsIn}→${s.fluidsOut})`
  }
  return base
}

/**
 * Walk recipe.ingredients & recipe.products, bucketing each STREAM
 * (regardless of stack amount) by whether the item is in the fluid set.
 * Streams count once per distinct item — duplicates inside the same
 * recipe aren't expected from upstream data, but we walk the array as-is
 * (each entry == one stream) since Kirk's dataset never doubles up.
 */
export function computeIOShape(
  recipe: Recipe,
  fluidItems: ReadonlySet<string>,
): IOShape {
  let solidsIn = 0
  let fluidsIn = 0
  let solidsOut = 0
  let fluidsOut = 0
  for (const ing of recipe.ingredients) {
    if (fluidItems.has(ing.item)) fluidsIn++
    else solidsIn++
  }
  for (const prod of recipe.products) {
    if (fluidItems.has(prod.item)) fluidsOut++
    else solidsOut++
  }
  return { solidsIn, fluidsIn, solidsOut, fluidsOut }
}
