// Single source of truth for everything that tweaks the schematic view.
// Adding a new knob = add a field here + a row in topologyFields.ts; the
// panel UI auto-renders the right control. Persisted to localStorage so
// user prefs survive reloads.
//
// The shape splits into two cohesive subtypes so the boundary at busLayout()
// (and any future "render only" pass) is obvious from the types alone:
//   - LayoutConfig: feeds busLayout(). Changing any of these reshapes the
//     blueprint (cells move, belts repack, sub-buses re-cluster).
//   - RenderConfig: feeds CanvasTiles. Purely visual — change them and the
//     blueprint stays the same, only the pixels change.
// Consumers that want everything just use the SchematicConfig intersection.

import type { BeltTier } from "../../blueprint/util/utilization"
import {
  DEFAULT_LAYOUT_ALGORITHM,
  LAYOUT_ALGORITHMS,
  type LayoutAlgorithmId,
} from "../../blueprint/layout/algorithms"

/** Where final-output belts live relative to cells. */
export type OutputBusSide = "left" | "right" | "split"

/**
 * LAYOUT controls — feed busLayout(). Changing any of these reshapes the
 * blueprint (cells move, belts repack, sub-buses re-cluster). A future
 * panel author looking at busLayout's signature will see `LayoutConfig`
 * and immediately know they shouldn't add a zoom prop here.
 */
export interface LayoutConfig {
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
  cellGapY: number
  groupGapY: number
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

/**
 * RENDER controls — feed CanvasTiles. Pure visual: change them and the
 * blueprint stays the same, only the pixels change.
 *
 * `layoutAlgorithm` is here (not in LayoutConfig) because changing it
 * swaps the entire layout PIPELINE, not a knob within one — semantically
 * a "view choice" the user makes, like zoom or belt tier.
 */
export interface RenderConfig {
  beltTier: BeltTier
  /**
   * Per-item belt-tier override. Maps item key → BeltTier. When set,
   * utilization math for THAT item's lane uses this tier instead of the
   * global `beltTier`. Empty by default.
   */
  beltOverrides: Record<string, BeltTier>
  zoom: number
  bottleneckMode: boolean
  showCrossings: boolean
  /**
   * Which layout algorithm to run. Strangler-fig setup: the legacy
   * "bus-tree" lives alongside any successor (e.g. "auto-bus") so we
   * can A/B them before retiring either. See blueprint/layout/algorithms.ts.
   */
  layoutAlgorithm: LayoutAlgorithmId
}

/**
 * Full schematic config — the intersection of layout + render. Consumers
 * that want the whole thing still get every field. Use `layoutConfig(c)`
 * or `renderConfig(c)` to project a SchematicConfig down to just the
 * subset a particular pipeline stage actually consumes.
 */
export type SchematicConfig = LayoutConfig & RenderConfig

/** Project a SchematicConfig down to just the busLayout()-relevant fields. */
export function layoutConfig(c: SchematicConfig): LayoutConfig {
  return {
    beltSpacing: c.beltSpacing,
    beltGroupSize: c.beltGroupSize,
    beltWidth: c.beltWidth,
    trunkMinConsumers: c.trunkMinConsumers,
    maxNestingDepth: c.maxNestingDepth,
    outputBusSide: c.outputBusSide,
    cellGapY: c.cellGapY,
    groupGapY: c.groupGapY,
    beltAssignments: c.beltAssignments,
  }
}

/** Project a SchematicConfig down to just the CanvasTiles-relevant fields. */
export function renderConfig(c: SchematicConfig): RenderConfig {
  return {
    beltTier: c.beltTier,
    beltOverrides: c.beltOverrides,
    zoom: c.zoom,
    bottleneckMode: c.bottleneckMode,
    showCrossings: c.showCrossings,
    layoutAlgorithm: c.layoutAlgorithm,
  }
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
  beltOverrides: {},
  beltAssignments: {},
  layoutAlgorithm: DEFAULT_LAYOUT_ALGORITHM,
}

export const STORAGE_KEY = "schematic.config.v1"

/**
 * Legacy solver-relevant maps that used to live on SchematicConfig but have
 * since been hoisted up to App. Kept here ONLY so the one-time migration
 * in App.tsx can recover prior persisted values. Do not add new fields.
 */
export interface LegacySchematicOverrides {
  machineOverrides: Record<string, string>
  recipeChoices: Record<string, string>
  machineCategoryDefaults: Record<string, string>
}

export function loadConfig(): SchematicConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    const parsed = JSON.parse(raw) as Partial<SchematicConfig>
    // Merge with defaults so missing fields get filled in if we add new ones.
    // Unknown layoutAlgorithm (e.g. an old id we removed) falls back to the
    // current default rather than passing through and crashing the renderer.
    const layoutAlgorithm =
      parsed.layoutAlgorithm && parsed.layoutAlgorithm in LAYOUT_ALGORITHMS
        ? parsed.layoutAlgorithm
        : DEFAULT_LAYOUT_ALGORITHM
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      // Ensure map-typed fields are always objects (defensive against
      // stale persisted blobs from before these fields existed).
      beltOverrides: parsed.beltOverrides ?? {},
      beltAssignments: parsed.beltAssignments ?? {},
      layoutAlgorithm,
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

/**
 * Read the legacy solver-override maps out of the persisted SchematicConfig
 * JSON. Used ONCE by App.tsx to migrate prior values into App-owned state;
 * after that, App owns these maps directly and writes them under their own
 * localStorage keys.
 */
export function loadLegacyOverrides(): LegacySchematicOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { machineOverrides: {}, recipeChoices: {}, machineCategoryDefaults: {} }
    const parsed = JSON.parse(raw) as Partial<LegacySchematicOverrides>
    return {
      machineOverrides: parsed.machineOverrides ?? {},
      recipeChoices: parsed.recipeChoices ?? {},
      machineCategoryDefaults: parsed.machineCategoryDefaults ?? {},
    }
  } catch {
    return { machineOverrides: {}, recipeChoices: {}, machineCategoryDefaults: {} }
  }
}

export function saveConfig(c: SchematicConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
  } catch {
    // localStorage unavailable (private mode, etc.) — silently skip.
  }
}
