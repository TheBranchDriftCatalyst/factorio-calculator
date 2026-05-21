// Schema for the Topology Panel. One row per knob — the panel iterates
// this array and renders the right kind of control for each entry, so
// adding a new tunable is a one-liner.

import type { SchematicConfig } from "./SchematicConfig"
import type { BeltTier } from "../../blueprint/util/utilization"

export type FieldKind =
  | { kind: "toggle" }
  | { kind: "segmented"; options: ReadonlyArray<string> }
  | { kind: "select"; options: ReadonlyArray<string> }
  | { kind: "slider"; min: number; max: number; step: number }

export interface TopologyField {
  key: keyof SchematicConfig
  label: string
  group: "Display" | "Belt" | "Layout"
  hint?: string
  field: FieldKind
}

export const TOPOLOGY_FIELDS: ReadonlyArray<TopologyField> = [
  // Belt
  {
    key: "beltTier",
    label: "Belt tier",
    group: "Belt",
    field: { kind: "select", options: ["yellow", "red", "blue", "turbo"] satisfies BeltTier[] },
  },
  { key: "beltSpacing", label: "Belt spacing", group: "Belt",
    field: { kind: "slider", min: 0, max: 3, step: 1 } },
  { key: "beltWidth", label: "Belt width", group: "Belt",
    field: { kind: "slider", min: 1, max: 4, step: 1 } },
  { key: "beltGroupSize", label: "Belts per block", group: "Belt",
    field: { kind: "slider", min: 2, max: 8, step: 1 } },
  { key: "trunkMinConsumers", label: "Min trunk consumers", group: "Belt",
    field: { kind: "slider", min: 2, max: 6, step: 1 } },
  { key: "maxNestingDepth", label: "Max sub-bus depth", group: "Belt",
    field: { kind: "slider", min: 1, max: 6, step: 1 } },
  // "right" mode (all belts mirrored to the right of cells) is conceptually
  // straightforward but adds significant layout complexity (mirror all X
  // coordinates post-pack). Deferred until there's a clear need; the
  // useful split is "left" (single bus, legacy) vs "split" (inputs left,
  // outputs right).
  { key: "outputBusSide", label: "Output bus", group: "Belt",
    field: { kind: "segmented", options: ["left", "split"] } },
  // Layout
  { key: "cellGapY", label: "Cell gap", group: "Layout",
    field: { kind: "slider", min: 0, max: 4, step: 1 } },
  { key: "groupGapY", label: "Group gap", group: "Layout",
    field: { kind: "slider", min: 1, max: 6, step: 1 } },
  { key: "showCrossings", label: "Mark crossings", group: "Layout",
    field: { kind: "toggle" } },
  // Display
  { key: "zoom", label: "Zoom (px/tile)", group: "Display",
    field: { kind: "slider", min: 8, max: 36, step: 2 } },
  { key: "bottleneckMode", label: "Bottleneck mode", group: "Display", hint: "B",
    field: { kind: "toggle" } },
]
