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

/**
 * Stable string id for a layout algorithm. New impls get a new id added
 * to this union — keep them kebab-case + short. Persisted in
 * RenderConfig.layoutAlgorithm and round-trips through localStorage.
 */
export type LayoutAlgorithmId = "bus-tree" | "auto-bus"

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
 * Placeholder for the auto-bus-splitting layout. Until the new
 * implementation lands, falls back to the bus-tree algorithm so the
 * picker doesn't break when a user selects it. Will be replaced with a
 * real impl in a follow-up commit (fbp-haq Phase 2).
 */
const autoBusAlgorithm: LayoutAlgorithm = {
  id: "auto-bus",
  label: "Auto-bus (preview)",
  description:
    "Algorithm decides how many parallel trunk belts each item earns based on consumer spread. No manual L#/R# assignment.",
  experimental: true,
  // TEMP: until the new impl lands, run the legacy algorithm so the UI
  // is wired end-to-end. Swap to the new impl in a follow-up.
  run: (catalog, flow, opts) => busLayout(catalog, flow, opts),
}

/** Registry keyed by id. Add new algorithms here. */
export const LAYOUT_ALGORITHMS: Record<LayoutAlgorithmId, LayoutAlgorithm> = {
  "bus-tree": busTreeAlgorithm,
  "auto-bus": autoBusAlgorithm,
}

/**
 * Ordered list — used to render the picker. Production-first, experimental
 * last so the picker shows safe defaults at the top.
 */
export const LAYOUT_ALGORITHM_LIST: ReadonlyArray<LayoutAlgorithm> = [
  busTreeAlgorithm,
  autoBusAlgorithm,
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
