// Factory templates — first-class layout variables for the CSP solver.
//
// A template controls the PHYSICAL SHAPE of a cell that holds N
// machines. Single-block (the default — what busLayout produces today)
// packs N machines into a roughly-square cell. Manifold-N spreads them
// across a wider strip with input/output belt rows running along the
// long axis (the canonical Factorio production pattern).
//
// In Phase 1 (this commit) templates are post-busLayout transformations:
// busLayout produces a Blueprint with single-block cells, then the CSP
// solver TRANSFORMS specific cells per a template choice. Phase 2 will
// fold template choice into busLayout's emission path so port
// placements and inserter types fall out of the same pipeline.

import type { Cell } from "../types"

/**
 * Stable id for a template. Add new templates to LAYOUT_TEMPLATES.
 * Persisted in CSP solver state, so renames need migration handling.
 */
export type TemplateId = "single-block" | "manifold-6" | "manifold-12"

/**
 * One factory template. `apply` transforms the cell in place (mutates
 * w/h, port positions) — Phase 1 doesn't need bus-level changes, so a
 * cell-only transformer is enough. Phase 2 may need to return belt
 * adjustments too.
 */
export interface FactoryTemplate {
  id: TemplateId
  /** Short human label for the picker. */
  label: string
  /** Tooltip / description. */
  description: string
  /**
   * Can this template legally apply to a cell with this machine count?
   * single-block accepts everything. manifold-6 wants demanded ≥ 2.
   * manifold-12 wants demanded ≥ 4 (else it's mostly empty space).
   */
  matches(cell: Cell): boolean
  /**
   * In-place expansion. Cell.w and Cell.h are recomputed to the
   * template's footprint. Port positions get redistributed along the
   * wider edges. Phase 1 does the minimum: cell.w / cell.h change and
   * port slots renormalize.
   */
  apply(cell: Cell): void
}

/**
 * Tile footprint of a single machine in the cell (defensive default
 * when machine size is unknown). Matches the busLayout convention.
 */
function machineSize(cell: Cell): { w: number; h: number } {
  // Cells have a `machines` array of MachinePlacement entries; we take
  // the first machine's dimensions as representative (all machines in
  // a cell run the same recipe → same machine type → same footprint).
  const m = cell.machines[0]
  if (m && m.w > 0 && m.h > 0) return { w: m.w, h: m.h }
  return { w: 3, h: 3 } // default assembler-3 size
}

const singleBlock: FactoryTemplate = {
  id: "single-block",
  label: "Single block",
  description:
    "Pack machines into a roughly-square cell. The default — fewer tiles, longer belt taps. Best for small recipes (≤ 3 machines).",
  matches: () => true,
  apply: () => {
    // Identity transform — busLayout already produces the single-block shape.
  },
}

/**
 * Manifold-N: a horizontal strip of N machines per row, stacked into
 * ⌈demanded/N⌉ rows. Width = N × machineW, height = rows × machineH.
 *
 * Phase 1 simply reshapes the cell rectangle; the renderer paints a
 * wider rectangle. Phase 2 will redistribute ports across the strip,
 * draw a feed belt above and a collect belt below, and place inserters
 * at the right perimeter slots.
 */
function manifold(machinesPerRow: number, id: TemplateId, label: string): FactoryTemplate {
  return {
    id,
    label,
    description: `${machinesPerRow}-wide manifold strip. Machines lay out in rows of ${machinesPerRow}; feed/collect belts run along the long axis (Phase 2). Best for recipes with ≥ ${Math.ceil(machinesPerRow / 2)} machines.`,
    matches: (cell) => cell.demanded >= Math.ceil(machinesPerRow / 2),
    apply: (cell) => {
      const m = machineSize(cell)
      const rows = Math.max(1, Math.ceil(cell.demanded / machinesPerRow))
      const cols = Math.min(cell.demanded, machinesPerRow)
      cell.w = cols * m.w
      cell.h = rows * m.h
      // Port positions get re-distributed across the wider west edge so
      // the inputs visually feed each machine slot rather than all
      // bunching at the top.
      const westPorts = cell.inputs.length
      if (westPorts > 0 && cell.h > 0) {
        const stride = Math.max(1, Math.floor(cell.h / Math.max(1, westPorts)))
        for (let i = 0; i < westPorts; i++) {
          // The port's `slot` is its row offset along the cell's W edge.
          cell.inputs[i].slot = Math.min(cell.h - 1, i * stride)
        }
      }
      const eastPorts = cell.outputs.length
      if (eastPorts > 0 && cell.h > 0) {
        const stride = Math.max(1, Math.floor(cell.h / Math.max(1, eastPorts)))
        for (let i = 0; i < eastPorts; i++) {
          cell.outputs[i].slot = Math.min(cell.h - 1, i * stride)
        }
      }
    },
  }
}

const manifold6 = manifold(6, "manifold-6", "Manifold (6-wide)")
const manifold12 = manifold(12, "manifold-12", "Manifold (12-wide)")

/** Keyed registry — add new templates here. */
export const LAYOUT_TEMPLATES: Record<TemplateId, FactoryTemplate> = {
  "single-block": singleBlock,
  "manifold-6": manifold6,
  "manifold-12": manifold12,
}

/** Ordered list for UI pickers; conservative first, aggressive last. */
export const LAYOUT_TEMPLATE_LIST: ReadonlyArray<FactoryTemplate> = [
  singleBlock,
  manifold6,
  manifold12,
]

export const DEFAULT_TEMPLATE: TemplateId = "single-block"

/**
 * Pure helper — returns the template ids that legally apply to a cell.
 * Used by the CSP solver to enumerate per-cell domain values.
 */
export function templatesFor(cell: Cell): TemplateId[] {
  return LAYOUT_TEMPLATE_LIST.filter((t) => t.matches(cell)).map((t) => t.id)
}
