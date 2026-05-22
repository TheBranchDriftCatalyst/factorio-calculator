// Canonical types for the bus-template blueprint.
//
// The blueprint is NOT a Factorio-accurate tile dump. It's a schematic:
// machines in tile-sized rectangles arranged in ribbons along a typed bus.
// Council ruling D1: main-bus template, not free packing.
//
// In Factorio every belt is 1 tile wide but carries TWO lanes (left/right).
// We model that: a `BusBelt` holds up to two `BusLane`s. To extract from
// either lane we need an INSERTER, which is itself a 1-tile entity that
// occupies a gutter column between the bus and the cells. The packer is
// the thing that knows about gutters; the renderer just draws the placements.
//
// Sub-busses: items consumed by only ONE downstream recipe are "local"
// to a cell group. Each group gets its OWN nested bus (rendered with the
// same 2-lane style) inside its frame. Items consumed by 2+ downstream
// recipes go on the top-level trunk bus.
//
// Orientation: the bus is VERTICAL. Each `BusBelt` occupies a column.
// Lane A is the LEFT half of the tile, lane B the RIGHT half. Items flow
// top-to-bottom. Inserters sit in a gutter column to the right of the
// belts and face EAST (input: belt → cell) or WEST (output: cell → belt).

export type Tile = readonly [x: number, y: number]
export type Facing = "north" | "south" | "east" | "west"

/**
 * Which cell edge a port sits on. W = west (left), E = east (right),
 * N = north (top), S = south (bottom). Inserters live on the perimeter
 * tile flagged by the port's `edge` + `slot`.
 */
export type Edge = "N" | "E" | "S" | "W"

/** A single carried-item sub-lane on a belt. */
export interface BusLane {
  item: string
  rate: number // items/sec carried on this sublane
  /** True when this lane carries a fluid — the renderer styles it as a pipe. */
  isFluid?: boolean
}

/** One Factorio belt tile, carrying up to two items (left/right sub-lanes). */
export interface BusBelt {
  x: number // ABSOLUTE tile column in the canvas
  laneA?: BusLane
  laneB?: BusLane
  /**
   * Optional vertical extent of the belt. When set, the renderer truncates
   * the belt to [y0, y1] instead of running it the full scope height —
   * lets a lane terminate at its last consumer rather than wasting space
   * extending past it. Coordinates are absolute tile rows.
   */
  y0?: number
  y1?: number
}

export interface MachinePlacement {
  recipeKey: string
  machineKey: string
  x: number
  y: number
  w: number
  h: number
  index: number
}

/**
 * Discriminated union describing the bus context a CellPort taps:
 *   • "trunk"  = main bus tap.
 *   • "local"  = sub-bus inside the cell's own group.
 *   • "direct" = 1:1 link straight to the partner cell, no shared bus column.
 *
 * The "direct" variant carries `partnerCellKey`, the recipeKey of the cell at
 * the other end of the connection — TypeScript enforces its presence so the
 * renderer can safely pair ports without nullable checks.
 */
export type PortScope =
  | { kind: "trunk" }
  | { kind: "local" }
  | { kind: "direct"; partnerCellKey: string }

/** A single tap from a (trunk or local) bus to/from a cell. */
export interface CellPort {
  item: string
  rate: number
  /** absolute tile column of the belt being tapped (trunk OR local) */
  beltX: number
  /** absolute tile row of the inserter / where the drop line enters the cell */
  dropY: number
  direction: "input" | "output"
  /** Bus context for this port; see {@link PortScope}. */
  scope: PortScope
  /**
   * Which cell edge this port sits on. Drives perimeter inserter
   * placement: a W-edge port has its inserter at (cell.x - 1, cell.y + slot),
   * an E-edge port at (cell.x + cell.w, cell.y + slot).
   */
  edge: Edge
  /**
   * Offset along the edge where the port lives, in tiles. For W/E it's
   * the row (0 = top of cell); for N/S it's the column (0 = left of cell).
   */
  slot: number
  /**
   * Columns where this port's side-belt crosses ANOTHER belt — these need
   * underground belt / long-inserter in real Factorio. Empty when the
   * path is clear. Each entry is an absolute tile column.
   */
  crossings?: number[]
}

/** An inserter glyph sitting in a gutter column (trunk gutter OR group gutter). */
export interface InserterPlacement {
  x: number
  y: number
  facing: Facing
  /**
   * Whether this inserter feeds INTO the cell (input port) or OUT of it
   * (output port). Used by the renderer for ring color — `facing` alone
   * isn't enough since an E-edge output points east just like a W-edge
   * input does.
   */
  direction: "input" | "output"
  /** absolute column of the belt this inserter taps */
  beltX: number
  cellKey: string
  item: string
  rate: number
  scope: "trunk" | "local" | "direct"
}

/**
 * A direct producer→consumer link for an item with exactly one producer
 * AND one consumer in scope. Replaces the full vertical bus column with
 * a short segment running between the two cells' W perimeter inserters.
 */
export interface DirectConnection {
  item: string
  rate: number
  fromCellKey: string
  toCellKey: string
  /** absolute tile column the connecting segment lives in */
  x: number
  /** producer-side slot Y (top of segment) */
  y0: number
  /** consumer-side slot Y (bottom of segment) */
  y1: number
  /** True if this is a fluid (pipe-style, not belt) */
  isFluid?: boolean
}

export interface Cell {
  recipeKey: string
  recipeName: string
  demanded: number
  x: number
  y: number
  w: number
  h: number
  machines: MachinePlacement[]
  inputs: CellPort[]
  outputs: CellPort[]
  /**
   * Per-edge view of `inputs[] ∪ outputs[]`. Each port appears in exactly
   * one bucket. Renderer reads this to draw perimeter inserters.
   */
  portsByEdge: Record<Edge, CellPort[]>
}

/**
 * A cell group — a "sub-bus" cluster. Its local items get their own bus
 * INSIDE the group's frame, rendered as vertical 2-lane belts.
 */
export interface CellGroup {
  id: string
  /** tile bounding box that envelops the local belts + cells */
  x: number
  y: number
  w: number
  h: number
  cellKeys: string[]
  /** local belts (sub-bus). Belt x values are absolute tile columns. */
  localBelts: BusBelt[]
  /** absolute column of the local gutter (where local inserters live) */
  localGutterX: number
  /** for the label "sub-bus · N items" */
  localItems: string[]
  /** sum of demanded machine counts across member cells (rollup chip) */
  totalMachines: number
  /** sum of node powerW across member recipes (rollup chip) */
  totalPowerW: number
}

/**
 * Recursive bus-node. The schematic is now a tree where every node has its
 * OWN belts (items consumed by ≥2 cells within the node's scope) and zero
 * or more child nodes (sub-clusters bound by single-consumer items).
 *
 * The root node is the top-level "main bus"; children may themselves act
 * as main-buses for their own descendants. This matches the user's
 * mental model where "a main bus can be a sub-bus to another."
 */
export interface BusNode {
  id: string
  /** 0 = root */
  depth: number
  /** absolute tile bounding box */
  x: number
  y: number
  w: number
  h: number
  /** belts running vertically through this node's height */
  belts: BusBelt[]
  /** column of the gutter just past the last belt; -1 if no belts at this scope */
  gutterX: number
  /** items running on `belts` at this scope */
  scopeItems: string[]
  /** child sub-clusters, stacked vertically below the previous */
  children: BusNode[]
  /** leaf cells directly in this node (NOT recursed) */
  cellKeys: string[]
  /** rollup chip */
  totalMachines: number
  totalPowerW: number
}

export interface Blueprint {
  width: number
  height: number
  /**
   * How many tiles wide each belt is. Each belt has 2 sub-lanes (left/right
   * halves of the belt). Larger values give more visual room for labels +
   * icons. Default 2.
   */
  beltWidth: number
  /**
   * Cols [0 .. busWidth-1] are: trunk belts + group gaps + 1-tile trunk gutter.
   * If there are no trunk items, busWidth === 0.
   */
  busWidth: number
  /** trunk gutter absolute X. `-1` when there's no trunk bus. */
  gutterX: number
  /** Main trunk-bus belts — only items with ≥2 downstream consumers. */
  belts: BusBelt[]
  /** Legacy flat list of groups (mirror of root.children for backwards-compat with tests/renderer). */
  groups: CellGroup[]
  /** Recursive bus-tree root. New code should walk this tree; flat `groups[]`/`belts[]` is derived from it. */
  root: BusNode | null
  cells: Cell[]
  /** All inserters (trunk-gutter AND group-local-gutter), differentiated by `scope`. */
  inserters: InserterPlacement[]
  /** 1:1 producer→consumer links rendered as short segments rather than full bus columns. */
  directConnections: DirectConnection[]
  unsupported: Array<{ recipeKey: string; reason: string }>
}
