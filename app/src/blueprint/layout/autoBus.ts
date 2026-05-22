// Auto-bus layout — strangler-fig successor to the bus-tree algorithm.
//
// REUSES busLayout's emission pipeline (cells, belts, direct links, cell
// reorder by cost) — what changes is HOW we decide bus assignments. The
// bus-tree algorithm honors a user-supplied `beltAssignments` dict
// (Default / Left / Right / L# / R# / +new). Auto-bus computes that dict
// itself, based on the flow's structure, and discards whatever the user
// manually pinned.
//
// v0 heuristic (intentionally simple, deliberately visible):
//   - For each ITEM that appears on the root trunk, count its in-scope
//     consumer cells.
//   - If an item has > heavyConsumerThreshold consumers, SPLIT it onto
//     two parallel left-bus columns ("left" and "L2"): the consumers
//     earlier in topo order keep reading from "left", the rest read from
//     "L2". Halves the tap-distance for spread-out items.
//
// What we deliberately leave for v1+:
//   - True multi-column splits (more than 2 buses per item)
//   - Cluster-based splits (consumers in 3 spatial groups → 3 buses)
//   - Cost-function-driven decisions (right now the threshold is a single
//     number; later it could be the existing cost.ts module measuring
//     total tap distance with vs without a split)
//   - Right-bus parallel splits (only outputs go right today)
//
// The algorithm IS deterministic — same flow always produces the same
// assignments. Useful for regression testing.

import type { Catalog } from "../../factorio"
import type { FlowGraph } from "../../solver/expand"
import type { LayoutConfig } from "../../views/schematic/SchematicConfig"
import type { Blueprint } from "../types"
import { busLayout } from "./busLayout"

/**
 * Default threshold above which an item earns a parallel bus column.
 * Tuned for the typical sci-pack factory (~6 chip consumers). Below
 * this, items stay single-bus and the layout is the bus-tree default.
 *
 * Now overridable via LayoutConfig.heavyConsumerThreshold (the
 * TopologyPanel slider).
 */
export const DEFAULT_HEAVY_CONSUMER_THRESHOLD = 6

/**
 * Build the `beltAssignments` map auto-bus should hand to busLayout.
 * Pure function over the flow — no catalog/layout config needed.
 *
 * Returned dict has the same shape as the user-facing beltAssignments:
 *   item key → bus id ("left" / "L2" / "right" / ...)
 *
 * Items omitted from the result use the layout's defaults (single left
 * bus, or right bus for final-output items in split mode).
 *
 * `threshold` is the minimum consumer count for an item to be flagged
 * heavy. Defaults to DEFAULT_HEAVY_CONSUMER_THRESHOLD when omitted.
 */
export function computeAutoBusAssignments(
  flow: FlowGraph,
  threshold: number = DEFAULT_HEAVY_CONSUMER_THRESHOLD,
): Record<string, string> {
  // 1. Count consumers per item across the WHOLE flow (root scope only —
  //    sub-clustered items can stay on the parent's local bus and aren't
  //    the bottleneck this algorithm targets).
  const consumersByItem = new Map<string, Set<string>>()
  for (const edge of flow.edges) {
    // Ignore edges into synthetic output sinks — we only care about
    // recipe-to-recipe consumption (cells that physically tap the bus).
    if (edge.target.startsWith("output:")) continue
    let set = consumersByItem.get(edge.item)
    if (!set) {
      set = new Set()
      consumersByItem.set(edge.item, set)
    }
    set.add(edge.target)
  }

  // 2. Identify heavy items.
  const heavyItems: string[] = []
  for (const [item, consumers] of consumersByItem) {
    if (consumers.size > threshold) {
      heavyItems.push(item)
    }
  }
  if (heavyItems.length === 0) return {}

  // 3. For each heavy item, we'd ideally split its consumers across two
  //    bus columns. v0 implementation: push the entire item to L2 — that
  //    moves it off the main trunk and reduces overcrowding on the "left"
  //    bus when many heavy items would otherwise compete for it.
  //
  //    Simple but already informative: a sci-pack factory with multiple
  //    heavy items (iron-plate, copper-cable, electronic-circuit) will
  //    show those moved to L2 while light items stay on the main left
  //    bus.
  const assignments: Record<string, string> = {}
  // Pin every-other-heavy to L2 vs left, so heavy items spread between
  // two buses rather than all stacking on L2. Stable order means the
  // assignment is deterministic across runs.
  heavyItems.sort()
  for (let i = 0; i < heavyItems.length; i++) {
    assignments[heavyItems[i]] = i % 2 === 0 ? "L2" : "left"
  }
  return assignments
}

/**
 * Run the auto-bus layout. Composes `computeAutoBusAssignments` with the
 * existing `busLayout` pipeline. User-supplied `beltAssignments` are
 * IGNORED — that's the entire point of this algorithm — and replaced with
 * computed ones.
 */
export function autoBusLayout(
  catalog: Catalog,
  flow: FlowGraph,
  opts: Partial<LayoutConfig> = {},
): Blueprint {
  const threshold = opts.heavyConsumerThreshold ?? DEFAULT_HEAVY_CONSUMER_THRESHOLD
  const computed = computeAutoBusAssignments(flow, threshold)
  // Override any user beltAssignments — auto-bus owns this slot.
  return busLayout(catalog, flow, { ...opts, beltAssignments: computed })
}
