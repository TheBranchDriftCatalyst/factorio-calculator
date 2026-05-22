// Strangler-fig registry for swappable layout algorithms.
//
// Today the schematic has exactly one layout (busLayout — the original
// single-bus-tree-with-direct-links pipeline). Tomorrow we want to ship
// alternative layouts (intelligent auto-bus-splitting, named factory
// templates, beacon-aware Sugiyama) without rewriting the existing one
// in-place. This module is the contract every layout impl must satisfy
// plus a registry the UI dispatches through.
//
// New layouts get added to LAYOUT_ALGORITHMS. SchematicConfig.layoutAlgorithm
// names which one to run. Eventually we may retire the original — but only
// after a successor has lived alongside it long enough to earn that
// retirement.

import type { Catalog } from "../../factorio"
import type { FlowGraph } from "../../solver/expand"
import type { LayoutConfig } from "../../views/schematic/SchematicConfig"
import type { Blueprint } from "../types"
import { busLayout } from "./busLayout"
import { autoBusLayout } from "./autoBus"
import { cspLayout } from "./csp"
import { interleavedLayout } from "./interleaved"

/**
 * Stable string id for a layout algorithm. New impls get a new id added
 * to this union — keep them kebab-case + short. Persisted in
 * RenderConfig.layoutAlgorithm and round-trips through localStorage.
 */
export type LayoutAlgorithmId = "bus-tree" | "auto-bus" | "csp" | "interleaved"

export interface LayoutAlgorithm {
  id: LayoutAlgorithmId
  /** Short label for the TopologyPanel picker. */
  label: string
  /** One-sentence description shown as the picker's title tooltip. */
  description: string
  /** Run the layout. Same shape every impl produces: a Blueprint. */
  run(
    catalog: Catalog,
    flow: FlowGraph,
    opts: Partial<LayoutConfig>,
  ): Blueprint
  /**
   * Marks the impl as experimental in the UI (yellow chip, picker
   * shows a "preview" tag). Used while a new algorithm is still proving
   * itself. Defaults to false.
   */
  experimental?: boolean
}

/**
 * The current production layout — the recursive bus-tree with direct-
 * connection links and per-item bus assignments. Wraps the existing
 * `busLayout()` entry point with no behavioral change so we can dispatch
 * through the registry without churning the impl.
 */
const busTreeAlgorithm: LayoutAlgorithm = {
  id: "bus-tree",
  label: "Bus tree",
  description:
    "Recursive bus-tree with direct-link cells and per-item bus assignments. The original layout — predictable, supports manual L#/R# overrides.",
  run: (catalog, flow, opts) => busLayout(catalog, flow, opts),
}

/**
 * Auto-bus layout: a v0 strangler-fig successor that overrides
 * user-supplied beltAssignments with computed ones. Heavy-consumer items
 * are spread across parallel left-bus columns ("left" + "L2") based on
 * a deterministic heuristic. See blueprint/layout/autoBus.ts.
 *
 * Experimental until the heuristic is tuned across a wider set of
 * factories — once stable, this becomes the default and 'bus-tree' is
 * retired.
 */
const autoBusAlgorithm: LayoutAlgorithm = {
  id: "auto-bus",
  label: "Auto-bus (preview)",
  description:
    "Algorithm decides bus assignments from consumer spread. Heavy-consumer items get spread across parallel left-bus columns automatically. No manual L#/R# pinning required.",
  experimental: true,
  run: (catalog, flow, opts) => autoBusLayout(catalog, flow, opts),
}

/**
 * CSP solver: backtracks over per-cell template choices (single-block,
 * manifold-6, manifold-12) with anneal as the inner loop over bus
 * assignments. Joint optimization of templates + bus assignments;
 * extends scoreBlueprint with width + waste penalties so the solver
 * naturally trades column count against tap distance.
 */
const cspAlgorithm: LayoutAlgorithm = {
  id: "csp",
  label: "CSP (preview)",
  description:
    "Joint backtrack over factory templates (single-block / manifold-6 / manifold-12) with simulated annealing inner loop. Slowest but finds the tightest layouts.",
  experimental: true,
  run: (catalog, flow, opts) => cspLayout(catalog, flow, opts),
}

/**
 * Interleaved bus columns: real Factorio main-bus stages. Cells are
 * grouped by recipe-DAG depth into "stages"; each stage gets its own
 * input bus on the LEFT and feeds the next stage's bus on the RIGHT.
 * The bus grows wider as you move through the factory (new items
 * appear at each stage). Matches how players actually design bases.
 */
const interleavedAlgorithm: LayoutAlgorithm = {
  id: "interleaved",
  label: "Interleaved (preview)",
  description:
    "Stages cells by recipe-DAG depth. Each stage has its own input bus on its left; outputs feed the next stage's bus. The bus widens left → right as new intermediates appear — the canonical 'main bus' factory pattern.",
  experimental: true,
  run: (catalog, flow, opts) => interleavedLayout(catalog, flow, opts),
}

/** Registry keyed by id. Add new algorithms here. */
export const LAYOUT_ALGORITHMS: Record<LayoutAlgorithmId, LayoutAlgorithm> = {
  "bus-tree": busTreeAlgorithm,
  "auto-bus": autoBusAlgorithm,
  csp: cspAlgorithm,
  interleaved: interleavedAlgorithm,
}

/**
 * Ordered list — used to render the picker. Production-first, experimental
 * last so the picker shows safe defaults at the top.
 */
export const LAYOUT_ALGORITHM_LIST: ReadonlyArray<LayoutAlgorithm> = [
  busTreeAlgorithm,
  autoBusAlgorithm,
  cspAlgorithm,
  interleavedAlgorithm,
]

export const DEFAULT_LAYOUT_ALGORITHM: LayoutAlgorithmId = "bus-tree"

/**
 * Single entry point that views call. Looks up the algorithm by id and
 * dispatches. Unknown ids (e.g. from stale persisted config after we
 * rename an algorithm) fall back to the default — never crash.
 */
export function runLayout(
  id: LayoutAlgorithmId,
  catalog: Catalog,
  flow: FlowGraph,
  opts: Partial<LayoutConfig> = {},
): Blueprint {
  const algo = LAYOUT_ALGORITHMS[id] ?? LAYOUT_ALGORITHMS[DEFAULT_LAYOUT_ALGORITHM]
  return algo.run(catalog, flow, opts)
}
