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
  DirectConnection,
  Edge,
  InserterPlacement,
  MachinePlacement,
  PortScope,
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
  /** Items first appearing on this stage's left bus (from prior stages + raw). */
  inputs: Array<[item: string, rate: number]>
  /** Recipe nodes living in this stage. */
  cells: FlowNode[]
}

interface StagePlanning {
  plans: StagePlan[]
  finalOutputs: Array<[item: string, rate: number]>
  /**
   * Items with exactly ONE producer and ONE consumer (across all stages)
   * get a direct producer → consumer link instead of joining the bus.
   * Reduces visual clutter on the main bus for tightly-coupled chains.
   */
  directLinks: Map<string, { from: string; to: string; rate: number }>
}

/**
 * Build per-stage plans. Key invariant for fbp-tj6 Phase 2:
 *   Every bus item appears in EXACTLY ONE stage column — the EARLIEST
 *   stage that consumes it. Cells in later stages tap that same column
 *   via long horizontal side-belts. This avoids the prior bug where
 *   an item used by stages 1 AND 3 got TWO disconnected belt columns
 *   and the producer dropped on the wrong one.
 *
 * Items going to output: sinks become final-bus items (rightmost column).
 *
 * Items with exactly one (producer, consumer) pair become direct links
 * instead of bus belts — see fbp-tj6 sub-task 2.
 */
function planStages(flow: FlowGraph, stages: Map<string, number>): StagePlanning {
  const maxStage = stages.size === 0 ? -1 : Math.max(...stages.values())
  const plans: StagePlan[] = []
  for (let s = 0; s <= maxStage; s++) {
    plans.push({ index: s, inputs: [], cells: [] })
  }
  for (const n of flow.nodes) {
    if (!n.recipe) continue
    const s = stages.get(n.id) ?? 0
    plans[s]?.cells.push(n)
  }

  // Per-item analysis: producers, consumers, earliest consumer stage,
  // total rate, final-sink rate.
  type ItemStats = {
    producers: Set<string>
    consumers: Set<string>
    earliestConsumerStage: number
    rate: number
    finalRate: number
  }
  const items = new Map<string, ItemStats>()
  const upsert = (item: string): ItemStats => {
    let s = items.get(item)
    if (!s) {
      s = {
        producers: new Set(),
        consumers: new Set(),
        earliestConsumerStage: Number.POSITIVE_INFINITY,
        rate: 0,
        finalRate: 0,
      }
      items.set(item, s)
    }
    return s
  }
  for (const e of flow.edges) {
    const s = upsert(e.item)
    s.rate += e.rate
    if (e.source && !e.source.startsWith("source:") && !e.source.startsWith("input:")) {
      s.producers.add(e.source)
    }
    if (e.target.startsWith("output:")) {
      s.finalRate += e.rate
      continue
    }
    s.consumers.add(e.target)
    const stage = stages.get(e.target)
    if (stage != null && stage < s.earliestConsumerStage) {
      s.earliestConsumerStage = stage
    }
  }

  // Direct links: exactly one producer + one consumer, both recipes,
  // AND producer/consumer in ADJACENT stages. Cross-stage directs
  // (e.g. stage 0 → stage 3) route through intermediate cells and
  // produce visually wonky Z-bend belts — they should go via the
  // bus instead. Same-stage directs aren't useful here either (cells
  // in the same stage share an x column; a direct connector would
  // just zig-zag along the column).
  const directLinks = new Map<string, { from: string; to: string; rate: number }>()
  for (const [item, stat] of items) {
    if (stat.finalRate > 0) continue
    if (stat.producers.size !== 1 || stat.consumers.size !== 1) continue
    const from = [...stat.producers][0]
    const to = [...stat.consumers][0]
    if (from === to) continue
    const fromStage = stages.get(from)
    const toStage = stages.get(to)
    if (fromStage == null || toStage == null) continue
    // ONLY adjacent stages — keeps the connector confined to the
    // inter-stage gutter so it doesn't cross other cells' x ranges.
    if (toStage - fromStage !== 1) continue
    directLinks.set(item, { from, to, rate: stat.rate })
  }

  // Bus items per stage: each item appears once, in its earliest
  // consumer's stage column.
  for (const [item, stat] of items) {
    if (directLinks.has(item)) continue
    // Items going only to output: sinks aren't bus items — they go on
    // the final bus.
    if (stat.consumers.size === 0) continue
    const stage = stat.earliestConsumerStage
    if (!Number.isFinite(stage)) continue
    const plan = plans[stage]
    if (!plan) continue
    plan.inputs.push([item, stat.rate - stat.finalRate])
  }
  for (const plan of plans) {
    plan.inputs.sort((a, b) => b[1] - a[1])
  }

  // Final outputs = items with finalRate > 0.
  const finalOutputs: Array<[string, number]> = []
  for (const [item, stat] of items) {
    if (stat.finalRate > 0) finalOutputs.push([item, stat.finalRate])
  }
  finalOutputs.sort((a, b) => b[1] - a[1])

  return { plans, finalOutputs, directLinks }
}

/**
 * Build maximal chains of direct-linked cells. A chain is a sequence
 * cell_0 → cell_1 → ... → cell_n where each arrow is a direct link
 * (single-producer, single-consumer item, adjacent stages). Chains
 * are detected by walking each cell's predecessor/successor via the
 * directLinks map.
 *
 * Returns each chain as a list of recipeKeys in flow order. Cells not
 * part of any chain appear as a single-element chain (filtered out by
 * the caller when only multi-cell chains matter).
 */
function buildChains(
  cells: Cell[],
  directLinks: Map<string, { from: string; to: string; rate: number }>,
): string[][] {
  // Build successor / predecessor maps from directLinks.
  const successor = new Map<string, string>()
  const predecessor = new Map<string, string>()
  for (const link of directLinks.values()) {
    // If a cell already has a successor (multi-output direct), keep
    // the FIRST; chains are tree-like in pathological cases but the
    // direct-link filter ensures 1:1 producer→consumer.
    if (!successor.has(link.from)) successor.set(link.from, link.to)
    if (!predecessor.has(link.to)) predecessor.set(link.to, link.from)
  }
  const visited = new Set<string>()
  const chains: string[][] = []
  for (const cell of cells) {
    if (visited.has(cell.recipeKey)) continue
    // Walk to the start (no predecessor).
    let head = cell.recipeKey
    while (predecessor.has(head) && !visited.has(predecessor.get(head)!)) {
      head = predecessor.get(head)!
    }
    // Walk forward from head, collecting the chain.
    const chain: string[] = []
    let cur: string | undefined = head
    while (cur && !visited.has(cur)) {
      chain.push(cur)
      visited.add(cur)
      cur = successor.get(cur)
    }
    chains.push(chain)
  }
  return chains
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
  const { plans, finalOutputs, directLinks } = planStages(flow, stages)

  const isFluid = (item: string) => catalog.fluidItems.has(item)

  const allBelts: BusBelt[] = []
  // ONE bus column per item, placed at its first-consuming stage.
  // Late-stage cells tap from this same column via long horizontal
  // side-belts. No overwrites — beltXByItem is set exactly once per
  // item during the stage-packing loop.
  const beltXByItem = new Map<string, number>()
  const cells: Cell[] = []
  const inserters: InserterPlacement[] = []
  const unsupported: Blueprint["unsupported"] = []

  // Direct link bookkeeping. For each item flagged as direct, we
  // need the producer's cellKey + consumer's cellKey + their cell
  // anchor points so the renderer can draw the connector. We can't
  // emit DirectConnection entries until cells are placed (we need
  // their final coordinates), so we accumulate the pairs here.
  const directConnections: DirectConnection[] = []

  let cursorX = LEFT_MARGIN
  let maxY = TOP_MARGIN
  let totalMachines = 0
  let totalPowerW = 0

  for (const plan of plans) {
    // 1. Pack this stage's input bus column with items first appearing here.
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
      // Set once — every item appears in exactly one stage.
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
        directLinks,
        o,
      )
      cells.push(cell)
      cursorY += cell.h + o.cellGapY
      stageRightEdge = Math.max(stageRightEdge, cell.x + cell.w)
      totalMachines += node.count
      totalPowerW += node.powerW
    }
    maxY = Math.max(maxY, cursorY)

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

  // 4. Patch every cell's E-edge output ports now that all bus columns
  // are settled. Direct ports were already emitted with the right
  // beltX (their producer→consumer connector x).
  for (const cell of cells) {
    for (const port of cell.outputs) {
      if (port.edge !== "E") continue
      if (port.scope.kind === "direct") continue
      const finalX = finalBeltXByItem.get(port.item)
      const intermediateX = beltXByItem.get(port.item)
      const resolved = finalX ?? intermediateX
      if (resolved != null) port.beltX = resolved
    }
  }
  for (const ins of inserters) {
    if (ins.direction !== "output") continue
    if (ins.scope === "direct") continue
    const finalX = finalBeltXByItem.get(ins.item)
    const intermediateX = beltXByItem.get(ins.item)
    const resolved = finalX ?? intermediateX
    if (resolved != null) ins.beltX = resolved
  }

  // 5. Emit DirectConnection entries for the producer→consumer links.
  // Each link gets a vertical segment between the producer (right
  // side, E perimeter) and consumer (left side, W perimeter). We
  // pick the connector's x as halfway between producer.x+w and
  // consumer.x so it sits in the inter-stage gutter.
  const cellByKey = new Map(cells.map((c) => [c.recipeKey, c]))
  for (const [item, link] of directLinks) {
    const from = cellByKey.get(link.from)
    const to = cellByKey.get(link.to)
    if (!from || !to) continue
    // Producer's E-edge slot: find the matching output port.
    const prodPort = from.outputs.find(
      (p) => p.item === item && p.scope.kind === "direct",
    )
    const consPort = to.inputs.find(
      (p) => p.item === item && p.scope.kind === "direct",
    )
    if (!prodPort || !consPort) continue
    const segX = Math.max(from.x + from.w, Math.floor((from.x + from.w + to.x) / 2))
    // Patch the port beltX values to the connector x.
    prodPort.beltX = segX
    consPort.beltX = segX
    directConnections.push({
      item,
      rate: link.rate,
      fromCellKey: link.from,
      toCellKey: link.to,
      x: segX,
      y0: prodPort.dropY,
      y1: consPort.dropY,
      isFluid: isFluid(item),
    })
    // Patch the inserter beltX values too so the renderer doesn't
    // dangle a side-belt off to -1.
    for (const ins of inserters) {
      if (ins.scope !== "direct") continue
      if (ins.item !== item) continue
      if (ins.cellKey !== link.from && ins.cellKey !== link.to) continue
      ins.beltX = segX
    }
  }

  // 6. Sub-bus groups via chain detection.
  //
  // A "sub-bus group" in the interleaved model is a chain of cells
  // linked by direct connections across adjacent stages: A → B → C.
  // Each pair (A, B), (B, C) is a directLink, so the items in the
  // chain never appear on the main bus — they're a self-contained
  // mini-factory. Visually framing the chain as a CellGroup lets the
  // user read "these N cells together produce X" at a glance.
  //
  // Single-cell groups (no chain) aren't framed — they're just leaf
  // cells like any other.
  const chains = buildChains(cells, directLinks)
  const groupNodes: BusNode[] = []
  for (let i = 0; i < chains.length; i++) {
    const chain = chains[i]
    if (chain.length < 2) continue
    const chainCells = chain.map((k) => cellByKey.get(k)!).filter(Boolean)
    if (chainCells.length < 2) continue
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxYY = -Infinity
    let cMachines = 0, cPowerW = 0
    for (const c of chainCells) {
      if (c.x < minX) minX = c.x
      if (c.y < minY) minY = c.y
      if (c.x + c.w > maxX) maxX = c.x + c.w
      if (c.y + c.h > maxYY) maxYY = c.y + c.h
      const node = flow.nodes.find((n) => n.id === c.recipeKey)
      if (node) {
        cMachines += node.count
        cPowerW += node.powerW
      }
    }
    groupNodes.push({
      id: `chain-${i}`,
      depth: 1,
      x: minX - 1,
      y: minY - 1,
      w: maxX - minX + 2,
      h: maxYY - minY + 2,
      belts: [],
      gutterX: -1,
      scopeItems: chain
        .map((_, idx) => chain[idx + 1])
        .filter((nextId): nextId is string => !!nextId)
        .map((nextId) => {
          // Pull the linked item from directLinks for whichever entry's
          // `to` === nextId. We just need a representative label.
          for (const [item, link] of directLinks) {
            if (link.to === nextId) return item
          }
          return ""
        })
        .filter(Boolean),
      children: [],
      cellKeys: chain,
      totalMachines: cMachines,
      totalPowerW: cPowerW,
    })
  }

  // 7. Wrap everything in a single root BusNode so the renderer can
  // walk belts via its existing tree walkers. Chains land in
  // root.children so flattenGroups() renders them as frames.
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
    children: groupNodes,
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
    directConnections,
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
  directLinks: Map<string, { from: string; to: string; rate: number }>,
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

  // Direct vs bus classification per ingredient/product:
  //   • direct  → ingredient where this cell is the unique consumer
  //               of a single-producer item. Renderer draws a
  //               connector instead of a bus side-belt.
  //   • bus     → ingredient with a belt entering this stage.
  // Outputs are always E-edge unless directLinks says the item is
  // produced HERE for a unique downstream consumer.
  const isDirectIn = (item: string) => {
    const dl = directLinks.get(item)
    return !!dl && dl.to === node.id
  }
  const isDirectOut = (item: string) => {
    const dl = directLinks.get(item)
    return !!dl && dl.from === node.id
  }
  const inIngs = recipe.ingredients.filter(
    (ing) => beltXByItem.has(ing.item) || isDirectIn(ing.item),
  )
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
    const direct = isDirectIn(ing.item)
    const dl = direct ? directLinks.get(ing.item)! : null
    // Direct ports: beltX will get patched after producer cell is
    // placed (interleavedLayout's directConnection pass). Set to
    // sentinel for now.
    const beltX = direct ? -1 : beltXByItem.get(ing.item)!
    const dropY = inputSlots[i]
    const rate = ing.amount * node.rate
    const scope: PortScope = direct
      ? { kind: "direct", partnerCellKey: dl!.from }
      : { kind: "trunk" }
    inserters.push({
      x: wPerimeterX,
      y: dropY,
      facing: "east",
      direction: "input",
      beltX,
      cellKey: node.id,
      item: ing.item,
      rate,
      scope: direct ? "direct" : "trunk",
    })
    inputs.push({
      item: ing.item,
      rate,
      beltX,
      dropY,
      direction: "input",
      scope,
      edge: "W",
      slot: dropY - yStart,
      lane: inputLanes[i],
    })
  }

  for (let i = 0; i < outs.length; i++) {
    const p = outs[i]
    const direct = isDirectOut(p.item)
    const dl = direct ? directLinks.get(p.item)! : null
    const dropY = outputSlots[i]
    const rate = p.amount * node.rate
    // beltX is provisional — patched after all stage buses are packed.
    const provisionalBeltX = direct ? -1 : beltXByItem.get(p.item) ?? -1
    const scope: PortScope = direct
      ? { kind: "direct", partnerCellKey: dl!.to }
      : { kind: "trunk" }
    inserters.push({
      x: ePerimeterX,
      y: dropY,
      facing: "east",
      direction: "output",
      beltX: provisionalBeltX,
      cellKey: node.id,
      item: p.item,
      rate,
      scope: direct ? "direct" : "trunk",
    })
    outputsArr.push({
      item: p.item,
      rate,
      beltX: provisionalBeltX,
      dropY,
      direction: "output",
      scope,
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
