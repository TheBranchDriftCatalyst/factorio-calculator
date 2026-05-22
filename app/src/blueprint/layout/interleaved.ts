// Interleaved bus columns — fbp-tj6.
//
// The bus-tree and auto-bus layouts both treat the factory as ONE
// vertical bus (or split-bus) with all cells packed in a single
// column between them. That works for small factories but breaks
// down at scale: cells far from the bus have long taps, items
// produced LATE in the chain still have to be routed BACK to the
// main bus to feed downstream consumers, and the whole thing reads
// as one giant block of recipes.
//
// Real Factorio main-bus designs DON'T do that. They stage:
//   bus_0 (raw)        ← iron ore, copper ore, coal, stone, …
//   stage 0 cells      ← smelters making iron-plate, copper-plate, …
//   bus_1 (intermediates) ← + iron-plate, copper-plate, stone-brick, …
//   stage 1 cells      ← assemblers making circuits, gears, cables, …
//   bus_2              ← + circuits, gears, …
//   stage 2 cells      ← assemblers making science packs, modules, …
//   bus_3 (final)      ← outputs delivered here
//
// Each cell taps from the bus IMMEDIATELY TO ITS LEFT and drops
// outputs onto the bus IMMEDIATELY TO ITS RIGHT. Bus widens as we
// go right (new items added per stage) — exactly the canonical
// Factorio main-bus growth pattern.
//
// Algorithm:
//   1. Compute "stage" = longest path of recipe-edges from any
//      source/raw-input node. Stages partition recipes.
//   2. For each stage s, compute items entering its left bus: every
//      item consumed by stage-s cells whose producer sits in an
//      earlier stage (or is raw).
//   3. Pack each stage's bus column at its x origin.
//   4. Stack each stage's cells vertically between its bus and the
//      next bus's x origin.
//   5. Emit cell ports: INPUTS on W edge tap left bus, OUTPUTS on
//      E edge feed right bus. The renderer already handles E-edge
//      side-belts going east — no renderer changes needed.

import type { Catalog } from "../../factorio"
import type { FlowGraph, FlowNode } from "../../solver/expand"
import type { LayoutConfig } from "../../views/schematic/SchematicConfig"
import type {
  Blueprint,
  BusBelt,
  BusNode,
  Cell,
  CellPort,
  Edge,
  InserterPlacement,
  MachinePlacement,
} from "../types"
import { tileStrip } from "./manifold"
import { packBeltsAt } from "./packing"

const DEFAULT_OPTS: LayoutConfig = {
  cellGapY: 2,
  beltGroupSize: 4,
  beltSpacing: 1,
  beltWidth: 2,
  groupGapY: 3,
  trunkMinConsumers: 2,
  maxNestingDepth: 4,
  beltAssignments: {},
  heavyConsumerThreshold: 6,
  layoutEffort: 0,
}

const STAGE_GUTTER_TILES = 2
const TOP_MARGIN = 1
const LEFT_MARGIN = 1

/**
 * Compute the stage (= longest path of recipe-edges from any non-recipe
 * source) for every recipe node. Source / input / output nodes have no
 * stage (they're not laid out as cells).
 */
export function computeStages(flow: FlowGraph): Map<string, number> {
  const isRecipe = new Set<string>()
  for (const n of flow.nodes) {
    if (n.recipe) isRecipe.add(n.id)
  }
  // Build upstream adjacency restricted to recipe→recipe edges. Edges
  // from source: or input: contribute 0 to depth; edges to output:
  // are ignored entirely.
  const upstream = new Map<string, string[]>()
  for (const e of flow.edges) {
    if (!isRecipe.has(e.target)) continue
    if (!isRecipe.has(e.source)) continue
    if (!upstream.has(e.target)) upstream.set(e.target, [])
    upstream.get(e.target)!.push(e.source)
  }
  const depth = new Map<string, number>()
  const visiting = new Set<string>()
  function compute(id: string): number {
    if (depth.has(id)) return depth.get(id)!
    if (visiting.has(id)) {
      // Cycle (shouldn't happen in a sane recipe DAG, but be safe).
      depth.set(id, 0)
      return 0
    }
    visiting.add(id)
    const ups = upstream.get(id) ?? []
    let max = 0
    for (const u of ups) max = Math.max(max, compute(u) + 1)
    visiting.delete(id)
    depth.set(id, max)
    return max
  }
  for (const id of isRecipe) compute(id)
  return depth
}

interface ResolvedOpts extends LayoutConfig {}

function resolveOpts(opts: Partial<LayoutConfig>): ResolvedOpts {
  return { ...DEFAULT_OPTS, ...opts }
}

interface StagePlan {
  index: number
  /** Items entering this stage's left bus (from prior stages + raw). */
  inputs: Array<[item: string, rate: number]>
  /** Recipe nodes living in this stage. */
  cells: FlowNode[]
}

/**
 * Build per-stage plans: which items feed each stage and which
 * recipes live there. Items going to output: sinks are deferred —
 * they get their own final bus column to the right of the last
 * stage.
 */
function planStages(flow: FlowGraph, stages: Map<string, number>): {
  plans: StagePlan[]
  finalOutputs: Array<[item: string, rate: number]>
} {
  const maxStage = stages.size === 0 ? -1 : Math.max(...stages.values())
  const plans: StagePlan[] = []
  for (let s = 0; s <= maxStage; s++) {
    plans.push({ index: s, inputs: [], cells: [] })
  }
  // Assign cells to their stage.
  for (const n of flow.nodes) {
    if (!n.recipe) continue
    const s = stages.get(n.id) ?? 0
    plans[s]?.cells.push(n)
  }
  // Compute input bus content per stage by inspecting incoming edges.
  // Per-stage rate aggregation lets two consumers of iron-plate share
  // one bus belt without double-counting.
  const stageInputRates: Array<Map<string, number>> = plans.map(
    () => new Map<string, number>(),
  )
  const finalRates = new Map<string, number>()
  for (const e of flow.edges) {
    const item = e.item
    const rate = e.rate
    if (e.target.startsWith("output:")) {
      finalRates.set(item, (finalRates.get(item) ?? 0) + rate)
      continue
    }
    const tStage = stages.get(e.target)
    if (tStage == null) continue
    const m = stageInputRates[tStage]
    if (!m) continue
    m.set(item, (m.get(item) ?? 0) + rate)
  }
  for (let s = 0; s < plans.length; s++) {
    plans[s].inputs = [...stageInputRates[s].entries()].sort((a, b) => b[1] - a[1])
  }
  const finalOutputs = [...finalRates.entries()].sort((a, b) => b[1] - a[1])
  return { plans, finalOutputs }
}

/**
 * Run the interleaved layout. Pipeline-compatible with the existing
 * algorithm registry — same (catalog, flow, opts) → Blueprint shape.
 */
export function interleavedLayout(
  catalog: Catalog,
  flow: FlowGraph,
  opts: Partial<LayoutConfig> = {},
): Blueprint {
  const o = resolveOpts(opts)
  const stages = computeStages(flow)
  const { plans, finalOutputs } = planStages(flow, stages)

  const isFluid = (item: string) => catalog.fluidItems.has(item)

  const allBelts: BusBelt[] = []
  const beltXByItem = new Map<string, number>()
  const cells: Cell[] = []
  const inserters: InserterPlacement[] = []
  const unsupported: Blueprint["unsupported"] = []

  // The "next bus" lookup: for an output item from stage s, the bus
  // it lands on is the LEFT-input bus of the EARLIEST stage that
  // consumes it (typically s+1, but a stage-3 input from stage-1
  // would still appear in stage-2's bus if any stage-2 cell needs it.
  // To keep things simple, we route every output to its primary
  // consumer stage's bus — already encoded in beltXByItem after we
  // pack each stage).

  let cursorX = LEFT_MARGIN
  let maxY = TOP_MARGIN
  let totalMachines = 0
  let totalPowerW = 0

  for (const plan of plans) {
    // 1. Pack this stage's input bus column.
    const packed = packBeltsAt(
      plan.inputs,
      o.beltGroupSize,
      o.beltSpacing,
      o.beltWidth,
      cursorX,
      isFluid,
    )
    allBelts.push(...packed.belts)
    for (const [item, x] of packed.beltXByItem) {
      // Don't overwrite: earlier stages own their bus belts. A later
      // stage that ALSO needs the same item will get its own belt
      // (since we re-pack per stage), but cells in stage s should tap
      // the stage-s bus closest to them. Update the lookup so each
      // cell uses ITS stage's belt.
      beltXByItem.set(item, x)
    }
    const stageCellX = packed.gutterX + 1

    // 2. Stack cells vertically in this stage's cell column.
    let cursorY = TOP_MARGIN
    let stageRightEdge = stageCellX
    for (const node of plan.cells) {
      const cell = emitCell(
        node,
        stageCellX,
        cursorY,
        beltXByItem,
        inserters,
        unsupported,
        o,
      )
      cells.push(cell)
      cursorY += cell.h + o.cellGapY
      stageRightEdge = Math.max(stageRightEdge, cell.x + cell.w)
      totalMachines += node.count
      totalPowerW += node.powerW
    }
    maxY = Math.max(maxY, cursorY)

    // Next stage starts past this stage's rightmost cell + gutter.
    cursorX = stageRightEdge + STAGE_GUTTER_TILES
  }

  // 3. Final output bus — packed to the right of the last stage.
  const finalBeltXByItem = new Map<string, number>()
  if (finalOutputs.length > 0) {
    const packed = packBeltsAt(
      finalOutputs,
      o.beltGroupSize,
      o.beltSpacing,
      o.beltWidth,
      cursorX,
      isFluid,
    )
    allBelts.push(...packed.belts)
    for (const [item, x] of packed.beltXByItem) {
      finalBeltXByItem.set(item, x)
    }
    cursorX = packed.gutterX + 1
  }

  // 4. Patch every cell's output ports now that all stage buses +
  // the final bus are packed. Output items either land in a later
  // stage's input bus (intermediates) or in the final bus (sinks).
  // beltXByItem holds the latest stage that consumed each item, so
  // intermediates resolve there; finals come from finalBeltXByItem.
  for (const cell of cells) {
    for (const port of cell.outputs) {
      if (port.edge !== "E") continue
      const finalX = finalBeltXByItem.get(port.item)
      const intermediateX = beltXByItem.get(port.item)
      const resolved = finalX ?? intermediateX
      if (resolved != null) {
        port.beltX = resolved
      }
    }
  }
  // Inserters also reference beltX. Patch those that target output
  // items so the renderer can draw the side-belt going east.
  for (const ins of inserters) {
    if (ins.direction !== "output") continue
    const finalX = finalBeltXByItem.get(ins.item)
    const intermediateX = beltXByItem.get(ins.item)
    const resolved = finalX ?? intermediateX
    if (resolved != null) {
      ins.beltX = resolved
    }
  }

  // 4. Wrap everything in a single root BusNode so the renderer can
  // walk belts via its existing tree walkers. Stages share one root
  // since interleaved doesn't NEST — it just lays them out side by
  // side.
  const root: BusNode = {
    id: "root",
    depth: 0,
    x: 0,
    y: 0,
    w: cursorX,
    h: maxY,
    belts: allBelts,
    gutterX: -1, // no single gutter for interleaved
    scopeItems: [...new Set(allBelts.flatMap((b) => [b.laneA?.item, b.laneB?.item].filter(Boolean) as string[]))],
    children: [],
    cellKeys: cells.map((c) => c.recipeKey),
    totalMachines,
    totalPowerW,
  }

  return {
    width: cursorX,
    height: maxY,
    beltWidth: o.beltWidth,
    busWidth: 0,
    gutterX: -1,
    root,
    cells,
    inserters,
    directConnections: [],
    unsupported,
  }
}

/**
 * Emit a single cell at (xStart, yStart). INPUTS go on the W edge
 * (tap the left bus). OUTPUTS go on the E edge (feed the right bus).
 * Uses tileStrip for proper manifold rendering when demanded > 1.
 */
function emitCell(
  node: FlowNode,
  xStart: number,
  yStart: number,
  beltXByItem: Map<string, number>,
  inserters: InserterPlacement[],
  unsupported: Blueprint["unsupported"],
  _o: ResolvedOpts,
): Cell {
  const recipe = node.recipe!
  const machine = node.machine
  const demanded = Math.max(1, Math.ceil(node.count))
  const size: readonly [number, number] = machine?.size ?? [3, 3]
  if (!machine?.size) {
    unsupported.push({
      recipeKey: node.id,
      reason: `no footprint for ${machine?.key ?? "unknown"}; using ${size[0]}×${size[1]}`,
    })
  }
  const [mw, mh] = size

  // Only ingredients with a belt entering this stage count. Outputs
  // always go E (next stage's bus or final bus).
  const inIngs = recipe.ingredients.filter((ing) => beltXByItem.has(ing.item))
  const outs = recipe.products

  const strip = tileStrip(node.id, machine?.key ?? "unknown", demanded, mw, mh, xStart, yStart)
  const isManifold = strip.machines.length > 1
  // For multi-machine cells, allocate input rails at top + output rails
  // at bottom. For single-machine cells, ports distribute down the
  // edges as before.
  const inputBelts = isManifold ? Math.ceil(inIngs.length / 2) : inIngs.length
  const outputRails = isManifold ? outs.length : 0
  const cellW = Math.max(strip.w, mw)
  const cellH = isManifold
    ? Math.max(strip.h + inputBelts + outputRails, 1)
    : Math.max(strip.h, Math.max(inIngs.length, outs.length) + 1)
  const stripDY = isManifold ? inputBelts : Math.floor((cellH - strip.h) / 2)
  const machines: MachinePlacement[] = strip.machines.map((m) => ({
    ...m,
    y: m.y + stripDY,
  }))

  let inputSlots: number[]
  let inputLanes: Array<"A" | "B" | undefined>
  let outputSlots: number[]
  if (isManifold) {
    inputSlots = inIngs.map((_, i) => yStart + Math.floor(i / 2))
    const pairedLane = (i: number): "A" | "B" | undefined => {
      const isPaired = i % 2 === 1 || i + 1 < inIngs.length
      if (!isPaired) return undefined
      return i % 2 === 0 ? "A" : "B"
    }
    inputLanes = inIngs.map((_, i) => pairedLane(i))
    outputSlots = outs.map((_, i) => yStart + cellH - outputRails + i)
  } else {
    const inSlots = inIngs.map((_, i) =>
      yStart + Math.floor(((i + 1) * cellH) / (inIngs.length + 1)),
    )
    inputSlots = inSlots
    inputLanes = inIngs.map(() => undefined)
    outputSlots = outs.map((_, i) =>
      yStart + Math.floor(((i + 1) * cellH) / (outs.length + 1)),
    )
  }

  const wPerimeterX = xStart - 1
  const ePerimeterX = xStart + cellW

  const inputs: CellPort[] = []
  const outputsArr: CellPort[] = []

  for (let i = 0; i < inIngs.length; i++) {
    const ing = inIngs[i]
    const beltX = beltXByItem.get(ing.item)!
    const dropY = inputSlots[i]
    const rate = ing.amount * node.rate
    inserters.push({
      x: wPerimeterX,
      y: dropY,
      facing: "east",
      direction: "input",
      beltX,
      cellKey: node.id,
      item: ing.item,
      rate,
      scope: "trunk",
    })
    inputs.push({
      item: ing.item,
      rate,
      beltX,
      dropY,
      direction: "input",
      scope: { kind: "trunk" },
      edge: "W",
      slot: dropY - yStart,
      lane: inputLanes[i],
    })
  }

  for (let i = 0; i < outs.length; i++) {
    const p = outs[i]
    const dropY = outputSlots[i]
    const rate = p.amount * node.rate
    // beltX gets PATCHED after all stages are packed (we don't know
    // the final bus x yet when emitting). Set to sentinel for now;
    // interleavedLayout's final-output pass updates it.
    const provisionalBeltX = beltXByItem.get(`__final:${p.item}`) ?? -1
    inserters.push({
      x: ePerimeterX,
      y: dropY,
      facing: "east", // E-edge output: cell → belt to its right
      direction: "output",
      beltX: provisionalBeltX,
      cellKey: node.id,
      item: p.item,
      rate,
      scope: "trunk",
    })
    outputsArr.push({
      item: p.item,
      rate,
      beltX: provisionalBeltX,
      dropY,
      direction: "output",
      scope: { kind: "trunk" },
      edge: "E",
      slot: dropY - yStart,
    })
  }

  const portsByEdge: Record<Edge, CellPort[]> = {
    N: [],
    E: outputsArr,
    S: [],
    W: inputs,
  }

  return {
    recipeKey: node.id,
    recipeName: recipe.name,
    demanded,
    x: xStart,
    y: yStart,
    w: cellW,
    h: cellH,
    machines,
    inputs,
    outputs: outputsArr,
    portsByEdge,
  }
}
