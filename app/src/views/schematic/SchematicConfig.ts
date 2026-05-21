// Single source of truth for everything that tweaks the schematic view.
// Adding a new knob = add a field here + a row in topologyFields.ts; the
// panel UI auto-renders the right control. Persisted to localStorage so
// user prefs survive reloads.

import type { BeltTier } from "../../blueprint/util/utilization"

/** Where final-output belts live relative to cells. */
export type OutputBusSide = "left" | "right" | "split"

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
  /**
   * Where the bus for final-output products lives. "left" keeps the
   * legacy single-bus layout; "right" mirrors it; "split" puts inputs
   * on the left and final outputs on the right with cells between them.
   */
  outputBusSide: OutputBusSide
  // Layout
  cellGapY: number
  groupGapY: number
  showCrossings: boolean
  // Camera & display
  zoom: number
  bottleneckMode: boolean
  /**
   * Per-recipe machine override. Maps recipeKey → machineKey. When set,
   * the solver uses the named machine instead of its default (fastest)
   * pick from the recipe's category. Empty by default.
   */
  machineOverrides: Record<string, string>
  /**
   * Per-item belt-tier override. Maps item key → BeltTier. When set,
   * utilization math for THAT item's lane uses this tier instead of the
   * global `beltTier`. Empty by default.
   */
  beltOverrides: Record<string, BeltTier>
  /**
   * Per-item recipe choice. Maps item key → recipe key. The solver
   * consults this BEFORE its default heuristic. Used when an item has
   * multiple recipes (e.g. petroleum-gas via basic vs advanced oil).
   */
  recipeChoices: Record<string, string>
  /**
   * Per-category default machine. Maps recipe-category → machineKey.
   * Applied to every recipe of that category unless a per-recipe
   * `machineOverrides` entry takes precedence. Lets the user say
   * "use Assembling machine 1 for everything" instead of having to
   * pin each recipe individually.
   */
  machineCategoryDefaults: Record<string, string>
  /**
   * Per-item bus assignment. Maps item key → busId. BusIds follow a
   * convention:
   *   - "left"  : default for non-final-output items (legacy single bus)
   *   - "right" : default for final-output items in split mode
   *   - "L2", "L3", ...  : additional buses to the LEFT of cells
   *     (L2 sits to the left of the main "left" bus, L3 further left, …)
   *   - "R2", "R3", ...  : additional buses to the RIGHT of cells
   * Unassigned items fall through to the default bus for their role.
   */
  beltAssignments: Record<string, string>
}

export const DEFAULT_CONFIG: SchematicConfig = {
  beltTier: "yellow",
  beltSpacing: 1,
  beltGroupSize: 4,
  beltWidth: 2,
  trunkMinConsumers: 2,
  maxNestingDepth: 4,
  outputBusSide: "split",
  cellGapY: 2,
  groupGapY: 3,
  showCrossings: true,
  zoom: 18,
  bottleneckMode: false,
  machineOverrides: {},
  beltOverrides: {},
  recipeChoices: {},
  machineCategoryDefaults: {},
  beltAssignments: {},
}

export const STORAGE_KEY = "schematic.config.v1"

/**
 * Fired by `saveConfig` so same-tab consumers (e.g. App.tsx reading
 * `machineOverrides`) can react to changes from SchematicView without
 * waiting on the cross-tab `storage` event (which doesn't fire same-tab).
 */
export const SCHEMATIC_CONFIG_EVENT = "schematic-config-change"

export function loadConfig(): SchematicConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    const parsed = JSON.parse(raw) as Partial<SchematicConfig>
    // Merge with defaults so missing fields get filled in if we add new ones.
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      // Ensure new map-typed fields are always objects (defensive against
      // stale persisted blobs from before these fields existed).
      machineOverrides: parsed.machineOverrides ?? {},
      beltOverrides: parsed.beltOverrides ?? {},
      recipeChoices: parsed.recipeChoices ?? {},
      machineCategoryDefaults: parsed.machineCategoryDefaults ?? {},
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(c: SchematicConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
    // Notify same-tab listeners (App.tsx reads machineOverrides here).
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SCHEMATIC_CONFIG_EVENT))
    }
  } catch {
    // localStorage unavailable (private mode, etc.) — silently skip.
  }
}
