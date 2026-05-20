// Single source of truth for everything that tweaks the schematic view.
// Adding a new knob = add a field here + a row in topologyFields.ts; the
// panel UI auto-renders the right control. Persisted to localStorage so
// user prefs survive reloads.

import type { BeltTier } from "../../blueprint/util/utilization"

export interface SchematicConfig {
  // Belts
  beltTier: BeltTier
  beltSpacing: number       // tiles between trunk belts
  beltGroupSize: number     // belts per packed block
  beltWidth: number         // tiles per belt (each holds 2 sub-lanes)
  /**
   * Minimum consumer count (in scope) for an item to be promoted to a
   * bus belt at THIS scope vs pushed down into a sub-cluster. Raising
   * this collapses more chains into sub-buses; lowering it promotes
   * more items to the top-level main bus.
   */
  trunkMinConsumers: number
  /**
   * Cap how many nested sub-bus levels the layout will recurse into.
   * Past this depth, any cluster that would recurse further is flattened
   * (its cells become leaves of the current scope). Useful when a deep
   * factory feels too cramped or too splintered.
   */
  maxNestingDepth: number
  // Layout
  cellGapY: number
  groupGapY: number
  showCrossings: boolean
  // Camera & display
  zoom: number
  bottleneckMode: boolean
}

export const DEFAULT_CONFIG: SchematicConfig = {
  beltTier: "yellow",
  beltSpacing: 1,
  beltGroupSize: 4,
  beltWidth: 2,
  trunkMinConsumers: 2,
  maxNestingDepth: 4,
  cellGapY: 2,
  groupGapY: 3,
  showCrossings: true,
  zoom: 18,
  bottleneckMode: false,
}

const STORAGE_KEY = "schematic.config.v1"

export function loadConfig(): SchematicConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    const parsed = JSON.parse(raw) as Partial<SchematicConfig>
    // Merge with defaults so missing fields get filled in if we add new ones.
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(c: SchematicConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
  } catch {
    // localStorage unavailable (private mode, etc.) — silently skip.
  }
}
