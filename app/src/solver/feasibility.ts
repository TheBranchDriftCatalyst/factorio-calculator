// Machine ↔ recipe feasibility checks.
//
// IOShape (ioShape.ts) tells us how many streams a recipe needs.
// Machine.slots (machineSlots.ts) tells us how many a machine can
// physically accept. This module answers the obvious question: can THIS
// machine actually run THIS recipe?
//
// Used by:
//   - solver pickMachine() — filter infeasible candidates BEFORE
//     selecting the fastest.
//   - CellDetails — surface a ⚠ chip + tooltip when the picked machine
//     can't actually run the recipe.
//   - fbp-9iw factory templates — gate manifold templates on whether
//     the (machine, recipe) is even valid.

import type { Machine, Recipe } from "../factorio"
import { computeIOShape, type IOShape } from "./ioShape"

export interface FeasibilityResult {
  ok: boolean
  /**
   * Human-readable reasons the pair is infeasible. Empty when ok=true.
   * Multiple reasons can coexist (e.g. too many solids in AND too many
   * fluids out — useful to surface all at once vs hiding the second
   * after the first is fixed).
   */
  reasons: string[]
  /** The shape we computed for the recipe. Cached for callers. */
  shape: IOShape
}

/**
 * Check whether a machine can physically run a recipe. Compares the
 * recipe's IO shape against the machine's slot counts.
 */
export function checkFeasibility(
  machine: Machine,
  recipe: Recipe,
  fluidItems: ReadonlySet<string>,
): FeasibilityResult {
  const shape = computeIOShape(recipe, fluidItems)
  const reasons: string[] = []
  if (shape.solidsIn > machine.slots.input.solid) {
    reasons.push(
      `recipe has ${shape.solidsIn} solid inputs but ${machine.name} has ${machine.slots.input.solid} solid slot${machine.slots.input.solid === 1 ? "" : "s"}`,
    )
  }
  if (shape.fluidsIn > machine.slots.input.fluid) {
    reasons.push(
      `recipe has ${shape.fluidsIn} fluid inputs but ${machine.name} has ${machine.slots.input.fluid} fluid input slot${machine.slots.input.fluid === 1 ? "" : "s"}`,
    )
  }
  if (shape.solidsOut > machine.slots.output.solid) {
    reasons.push(
      `recipe has ${shape.solidsOut} solid outputs but ${machine.name} has ${machine.slots.output.solid} solid output slot${machine.slots.output.solid === 1 ? "" : "s"}`,
    )
  }
  if (shape.fluidsOut > machine.slots.output.fluid) {
    reasons.push(
      `recipe has ${shape.fluidsOut} fluid outputs but ${machine.name} has ${machine.slots.output.fluid} fluid output slot${machine.slots.output.fluid === 1 ? "" : "s"}`,
    )
  }
  return { ok: reasons.length === 0, reasons, shape }
}

/**
 * Convenience boolean form for filter/sort predicates.
 */
export function isMachineFeasible(
  machine: Machine,
  recipe: Recipe,
  fluidItems: ReadonlySet<string>,
): boolean {
  return checkFeasibility(machine, recipe, fluidItems).ok
}
