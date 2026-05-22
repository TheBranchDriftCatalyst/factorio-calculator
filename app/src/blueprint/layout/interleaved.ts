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
  // Interleaved cells get a bigger gap than bus-tree's default (2) —
  // each cell here is a manifold strip with feed/collect rails, so
  // visually they need more breathing room to read cleanly. Bumped
  // from 2 → 4 alongside the wider STAGE_GUTTER_TILES.
  cellGapY: 4,
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

// Inter-stage gutter — wider than bus-tree's 1-tile gutter because
// it has to fit BOTH direct-connection mini-buses AND the next
// stage's bus column. 5 tiles = 1 for direct routing margin + 2 for
// direct mini-bus belts + 1 spacing + 1 buffer before bus.
const STAGE_GUTTER_TILES = 5
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

/**
 * Compute the LATEST stage each recipe can be assigned to without
 * violating producer-before-consumer ordering. Mirror of computeStages
 * walking the DAG backward from sinks.
 *
 * Used by the CSP solver to enumerate alternative stage assignments —
 * cells where `latest > earliest` have flexibility that the solver
 * can exploit to balance bus density across columns.
 */
export function computeLatestStages(flow: FlowGraph): Map<string, number> {
  const isRecipe = new Set<string>()
  for (const n of flow.nodes) {
    if (n.recipe) isRecipe.add(n.id)
  }
  const downstream = new Map<string, string[]>()
  for (const e of flow.edges) {
    if (!isRecipe.has(e.source)) continue
    if (!isRecipe.has(e.target)) continue
    if (!downstream.has(e.source)) downstream.set(e.source, [])
    downstream.get(e.source)!.push(e.target)
  }
  const earliest = computeStages(flow)
  const maxDepth = earliest.size === 0 ? 0 : Math.max(...earliest.values())
  // distToDeepestSink[id] = longest path from id to any sink (recipe with
  // no recipe consumers). For a sink itself, the distance is 0.
  const distToSink = new Map<string, number>()
  const visiting = new Set<string>()
  function compute(id: string): number {
    if (distToSink.has(id)) return distToSink.get(id)!
    if (visiting.has(id)) {
      distToSink.set(id, 0)
      return 0
    }
    visiting.add(id)
    const downs = downstream.get(id) ?? []
    let max = 0
    for (const d of downs) max = Math.max(max, compute(d) + 1)
    visiting.delete(id)
    distToSink.set(id, max)
    return max
  }
  for (const id of isRecipe) compute(id)
  const latest = new Map<string, number>()
  for (const id of isRecipe) {
    latest.set(id, maxDepth - compute(id))
  }
  return latest
}

/**
 * Enumerate a small set of stage-assignment variations to feed the
 * CSP solver. Each variation is a complete map of recipeId → stage
 * that satisfies producer-before-consumer.
 *
 * We yield (at most):
 *   1. earliest — the default longest-path-from-source assignment
 *   2. latest   — every cell pulled as late as possible
 *   3. mixed    — flexible cells shifted by 1 from earliest (if any)
 *
 * Identical variants are deduplicated by their JSON serialization.
 */
export function* generateStageVariations(
  flow: FlowGraph,
): Generator<Map<string, number>> {
  const earliest = computeStages(flow)
  const latest = computeLatestStages(flow)
  const seen = new Set<string>()
  const yieldUnique = function* (m: Map<string, number>) {
    const key = JSON.stringify([...m.entries()].sort())
    if (seen.has(key)) return
    seen.add(key)
    yield m
  }
  yield* yieldUnique(earliest)
  yield* yieldUnique(latest)
  // Mixed: shift each cell whose [earliest, latest] range is > 0 by
  // +1 from its earliest position (clamped to latest). Keeps cells
  // with no flexibility at their original stage.
  const mixed = new Map<string, number>()
  for (const [id, e] of earliest) {
    const l = latest.get(id) ?? e
    mixed.set(id, Math.min(e + 1, l))
  }
  yield* yieldUnique(mixed)
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
 * Build per-stage plans with ITEM PROPAGATION (fbp-tj6 Phase 4).
 *
 * Items now appear in EVERY transit stage's bus column — from the
 * earliest stage they could come from (producer + 1, or 0 for raw)
 * through the latest stage that consumes them (or the final bus).
 * This is the canonical Factorio "main bus that grows" pattern:
 *   bus[0] carries raw items
 *   bus[1] carries items consumed by stage 1 cells (could be raw +
 *          stage-0-products) — items physically continue through
 *   bus[2] carries items needed by stage 2 + still-in-transit items
 *   …
 *
 * Why propagation matters: WITHOUT it, an item produced at stage 0
 * and consumed at stage 3 lives only on bus[3]. The producer at
 * stage 0 has to drop east via a long side-belt that crosses
 * stages 1 + 2's cell columns. With propagation, the producer drops
 * onto bus[1] (one stage away — short), and the bus continuity
 * carries the item through bus[2], bus[3] to its consumer.
 *
 * Items going to output: sinks also flow through to the final bus.
 *
 * Items with exactly one (producer, consumer) pair become direct
 * links instead of bus belts (chain detection downstream).
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

  // Per-item analysis. Track BOTH earliest producer (-1 if from raw)
  // AND latest consumer (maxStage+1 if final). Propagation range is
  // [earliestProducer + 1, lastConsumer].
  type ItemStats = {
    producers: Set<string>
    consumers: Set<string>
    earliestProducerStage: number // -1 = raw / source
    lastConsumerStage: number     // maxStage+1 = goes to final bus
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
        earliestProducerStage: Number.POSITIVE_INFINITY,
        lastConsumerStage: Number.NEGATIVE_INFINITY,
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
    const fromRaw = e.source.startsWith("source:") || e.source.startsWith("input:")
    if (fromRaw) {
      // Raw source: producer stage is "before stage 0".
      if (-1 < s.earliestProducerStage) s.earliestProducerStage = -1
    } else {
      s.producers.add(e.source)
      const ps = stages.get(e.source)
      if (ps != null && ps < s.earliestProducerStage) s.earliestProducerStage = ps
    }
    if (e.target.startsWith("output:")) {
      s.finalRate += e.rate
      const finalIdx = maxStage + 1
      if (finalIdx > s.lastConsumerStage) s.lastConsumerStage = finalIdx
      continue
    }
    s.consumers.add(e.target)
    const stage = stages.get(e.target)
    if (stage != null && stage > s.lastConsumerStage) s.lastConsumerStage = stage
  }

  // Direct links: exactly one producer + one consumer, both recipes,
  // AND producer/consumer in ADJACENT stages.
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
    if (toStage - fromStage !== 1) continue
    directLinks.set(item, { from, to, rate: stat.rate })
  }

  // Bus items per stage with PROPAGATION. Item I is on bus[s] iff:
  //   earliestProducerStage(I) < s <= lastConsumerStage(I)
  // Final outputs route to a separate maxStage+1 bus, NOT to per-
  // stage buses (the rightmost column holds them).
  for (const [item, stat] of items) {
    if (directLinks.has(item)) continue
    if (stat.consumers.size === 0 && stat.finalRate === 0) continue
    const startStage = Math.max(0, stat.earliestProducerStage + 1)
    // Only propagate up to the last RECIPE consumer's stage. Final
    // outputs live on the dedicated final bus.
    const endStage =
      stat.consumers.size > 0
        ? Math.min(maxStage, stat.lastConsumerStage)
        : -1
    if (endStage < startStage) continue
    const rate = stat.rate - stat.finalRate
    for (let s = startStage; s <= endStage; s++) {
      const plan = plans[s]
      if (!plan) continue
      plan.inputs.push([item, rate])
    }
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
 * Returns each chain as a list of recipeKeys in flow order.
 */
function buildChainsFromLinks(
  directLinks: Map<string, { from: string; to: string; rate: number }>,
): string[][] {
  const successor = new Map<string, string>()
  const predecessor = new Map<string, string>()
  const allNodes = new Set<string>()
  for (const link of directLinks.values()) {
    if (!successor.has(link.from)) successor.set(link.from, link.to)
    if (!predecessor.has(link.to)) predecessor.set(link.to, link.from)
    allNodes.add(link.from)
    allNodes.add(link.to)
  }
  const visited = new Set<string>()
  const chains: string[][] = []
  for (const id of allNodes) {
    if (visited.has(id)) continue
    let head = id
    while (predecessor.has(head) && !visited.has(predecessor.get(head)!)) {
      head = predecessor.get(head)!
    }
    const chain: string[] = []
    let cur: string | undefined = head
    while (cur && !visited.has(cur)) {
      chain.push(cur)
      visited.add(cur)
      cur = successor.get(cur)
    }
    if (chain.length >= 2) chains.push(chain)
  }
  return chains
}

/** Legacy adapter — kept for the existing post-cells frame pass. */
function buildChains(
  cells: Cell[],
  directLinks: Map<string, { from: string; to: string; rate: number }>,
): string[][] {
  const chainsFromLinks = buildChainsFromLinks(directLinks)
  const inSome = new Set<string>()
  for (const c of chainsFromLinks) for (const k of c) inSome.add(k)
  const result: string[][] = [...chainsFromLinks]
  for (const cell of cells) {
    if (!inSome.has(cell.recipeKey)) result.push([cell.recipeKey])
  }
  return result
}

/**
 * Run the interleaved layout. Pipeline-compatible with the existing
 * algorithm registry — same (catalog, flow, opts) → Blueprint shape.
 */
export function interleavedLayout(
  catalog: Catalog,
  flow: FlowGraph,
  opts: Partial<LayoutConfig> & { _stagesOverride?: Map<string, number> } = {},
): Blueprint {
  const o = resolveOpts(opts)
  // _stagesOverride is the CSP solver's hook to swap in an alternative
  // stage assignment. When absent, fall back to the default longest-
  // path computation.
  const stages = opts._stagesOverride ?? computeStages(flow)
  const { plans, finalOutputs, directLinks } = planStages(flow, stages)

  // Chain compaction: stack multi-cell chains vertically at the
  // chain's FIRST cell's stage column. Internal direct connections
  // become short vertical mini-bus segments adjacent to the chain
  // block.
  //
  // With item propagation (above), most chains are now safe to
  // compact: items consumed by chain members appear in every
  // transit bus including the chain head's stage column, so the
  // side-belt from bus[head.stage] east to a compacted member is
  // SHORT (one stage at most).
  //
  // Remaining unsafe case: chain member consumes an item produced
  // AT OR AFTER the chain head's stage. The producer's output
  // can't be on bus[head.stage] (you can't drop onto a bus that's
  // east of the producer). Filter those out.
  const allChains = buildChainsFromLinks(directLinks)
  const isCompactionSafe = (chain: string[]): boolean => {
    const chainSet = new Set(chain)
    const headStage = stages.get(chain[0])
    if (headStage == null) return false
    for (const e of flow.edges) {
      if (!chainSet.has(e.target)) continue
      if (e.source.startsWith("source:") || e.source.startsWith("input:")) continue
      if (chainSet.has(e.source)) continue
      const producerStage = stages.get(e.source)
      // External producer must be at a stage STRICTLY BEFORE the
      // chain head — otherwise propagation can't make the item
      // available on bus[head.stage].
      if (producerStage == null || producerStage >= headStage) return false
    }
    return true
  }
  const compactionChains = allChains.filter(isCompactionSafe)
  const chainHead = new Map<string, string[]>() // headCellId → chain order
  const chainMemberSkip = new Set<string>() // cellIds to skip in their original stage
  for (const chain of compactionChains) {
    chainHead.set(chain[0], chain)
    for (let i = 1; i < chain.length; i++) chainMemberSkip.add(chain[i])
  }

  const isFluid = (item: string) => catalog.fluidItems.has(item)

  const allBelts: BusBelt[] = []
  // Per-stage beltX lookups: beltXByItemPerStage[s] = Map<item, x>.
  // With propagation, an item can appear in MULTIPLE stage buses;
  // each cell looks up the bus for its own stage. The legacy
  // beltXByItem (global, "last writer wins") is kept as a fallback
  // for code paths that don't yet know about per-stage lookups.
  const beltXByItemPerStage: Array<Map<string, number>> = []
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
  // Track each stage's bus origin so the direct-connection pass can
  // route connectors through the PRE-BUS gutter (not through the bus
  // belts themselves). Indexed by stage number.
  const stageBusOriginX: number[] = []

  for (const plan of plans) {
    // 1. Pack this stage's input bus column with items first appearing here.
    stageBusOriginX[plan.index] = cursorX
    const packed = packBeltsAt(
      plan.inputs,
      o.beltGroupSize,
      o.beltSpacing,
      o.beltWidth,
      cursorX,
      isFluid,
    )
    allBelts.push(...packed.belts)
    beltXByItemPerStage[plan.index] = packed.beltXByItem
    for (const [item, x] of packed.beltXByItem) {
      // Global fallback: last-writer-wins (latest stage's bus). Used
      // by emitCell's input lookup as a coarse "anywhere on the bus"
      // signal. emitCell's port.beltX gets patched to per-stage values
      // in the post-cell pass below.
      beltXByItem.set(item, x)
    }
    const stageCellX = packed.gutterX + 1

    // 2. Stack cells vertically in this stage's cell column. Chain
    //    members beyond the head are SKIPPED here — they'll be emitted
    //    when their head's stage is processed (which is THIS stage if
    //    head's stage == plan.index).
    let cursorY = TOP_MARGIN
    let stageRightEdge = stageCellX
    for (const node of plan.cells) {
      if (chainMemberSkip.has(node.id)) continue
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
      // If this cell is a chain head, emit the rest of the chain
      // stacked directly below at the SAME x. The chain becomes a
      // visual block; direct connections between adjacent members
      // become vertical segments handled by the renderer.
      const chain = chainHead.get(node.id)
      if (chain && chain.length > 1) {
        for (let i = 1; i < chain.length; i++) {
          const memberNode = flow.nodes.find((n) => n.id === chain[i])
          if (!memberNode || !memberNode.recipe) continue
          const memberCell = emitCell(
            memberNode,
            stageCellX,
            cursorY,
            beltXByItem,
            inserters,
            unsupported,
            directLinks,
            o,
          )
          cells.push(memberCell)
          cursorY += memberCell.h + o.cellGapY
          stageRightEdge = Math.max(stageRightEdge, memberCell.x + memberCell.w)
          totalMachines += memberNode.count
          totalPowerW += memberNode.powerW
        }
      }
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

  // 4. Patch cell ports per propagation rules.
  //   • INPUTS: resolve from bus[cell.stage].x of the item. With
  //     propagation the item is on bus[cell.stage] for every consumer
  //     stage in [producer+1, lastConsumer].
  //   • OUTPUTS (E-edge): resolve from bus[cell.stage + 1].x — the
  //     adjacent next-stage bus. Falls back to final bus for
  //     items going only to output: sinks, OR the global beltXByItem
  //     when the per-stage lookup misses (e.g. for items only in
  //     final bus).
  // Direct ports keep the beltX their connector emission assigns.
  const cellStageOf = (cell: Cell): number => stages.get(cell.recipeKey) ?? 0
  for (const cell of cells) {
    const cellStage = cellStageOf(cell)
    for (const port of cell.inputs) {
      if (port.scope.kind === "direct") continue
      const stageMap = beltXByItemPerStage[cellStage]
      const resolved = stageMap?.get(port.item) ?? beltXByItem.get(port.item)
      if (resolved != null) port.beltX = resolved
    }
    for (const port of cell.outputs) {
      if (port.edge !== "E") continue
      if (port.scope.kind === "direct") continue
      // Output drops on the NEXT stage's bus (item moves forward).
      const nextStageMap = beltXByItemPerStage[cellStage + 1]
      const finalX = finalBeltXByItem.get(port.item)
      const resolved =
        nextStageMap?.get(port.item) ?? finalX ?? beltXByItem.get(port.item)
      if (resolved != null) port.beltX = resolved
    }
  }
  // Mirror the patching for inserters so the renderer's side-belts
  // align with the ports.
  const inserterCellStage = new Map<string, number>()
  for (const cell of cells) inserterCellStage.set(cell.recipeKey, cellStageOf(cell))
  for (const ins of inserters) {
    if (ins.scope === "direct") continue
    const cellStage = inserterCellStage.get(ins.cellKey) ?? 0
    if (ins.direction === "input") {
      const stageMap = beltXByItemPerStage[cellStage]
      const resolved = stageMap?.get(ins.item) ?? beltXByItem.get(ins.item)
      if (resolved != null) ins.beltX = resolved
    } else {
      const nextStageMap = beltXByItemPerStage[cellStage + 1]
      const finalX = finalBeltXByItem.get(ins.item)
      const resolved =
        nextStageMap?.get(ins.item) ?? finalX ?? beltXByItem.get(ins.item)
      if (resolved != null) ins.beltX = resolved
    }
  }

  // 5. Emit DirectConnection entries — chains' producer→consumer links
  // become a short vertical mini-bus in the inter-stage gutter BEFORE
  // the consumer's bus column. Previously segX landed midway between
  // producer right-edge and consumer left-edge, which often put the
  // vertical segment ON TOP of the consumer stage's bus belts. Now we
  // anchor segX to one tile before the consumer's bus origin so the
  // connector lives in the pre-bus gutter, well clear of any belt
  // column.
  const cellByKey = new Map(cells.map((c) => [c.recipeKey, c]))
  for (const [item, link] of directLinks) {
    const from = cellByKey.get(link.from)
    const to = cellByKey.get(link.to)
    if (!from || !to) continue
    const prodPort = from.outputs.find(
      (p) => p.item === item && p.scope.kind === "direct",
    )
    const consPort = to.inputs.find(
      (p) => p.item === item && p.scope.kind === "direct",
    )
    if (!prodPort || !consPort) continue
    // Consumer stage = producer stage + 1 (the only stage gap allowed).
    const toStage = stages.get(link.to)
    const consumerBusX = toStage != null ? stageBusOriginX[toStage] : undefined
    // Slot the connector 2 tiles before the consumer's bus column
    // (leaving the bus 2 clear tiles for its own gutter). Clamp to
    // > from.x + from.w so we never run BEHIND the producer.
    const segX =
      consumerBusX != null
        ? Math.max(from.x + from.w + 1, consumerBusX - 2)
        : Math.max(from.x + from.w, Math.floor((from.x + from.w + to.x) / 2))
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

  // 6. RECURSIVE NESTING: chains gain a nested BusNode with their
  //    internal direct-link items represented as proper BusBelts.
  //
  // The chain's BusNode (added under root.children) holds belts for
  // every item connecting adjacent chain members. Cells' direct
  // port.beltX values are re-pointed to these nested belts so the
  // renderer treats them like any other bus tap. The point-to-point
  // DirectConnection entries are dropped — the nested belts subsume
  // them.
  //
  // Belt positioning: nested belts sit JUST WEST of the chain's
  // leftmost cell so chain members' W-edge direct ports still satisfy
  // the universal "input belt < cell.x" invariant. Width: one belt
  // per direct link, packed using the same beltWidth + beltSpacing.
  const chains = buildChains(cells, directLinks)
  const groupNodes: BusNode[] = []
  const linkItemByPair = new Map<string, string>() // "from|to" → item
  for (const [item, link] of directLinks) {
    linkItemByPair.set(`${link.from}|${link.to}`, item)
  }
  const absorbedDirectItems = new Set<string>()
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
    // Allocate nested belts WEST of the chain. The first belt sits
    // 1 tile west of minX; each subsequent belt further west.
    const nestedBelts: BusBelt[] = []
    const nestedItems: string[] = []
    const beltStride = o.beltWidth + o.beltSpacing
    let beltIdx = 0
    for (let j = 0; j < chain.length - 1; j++) {
      const fromId = chain[j]
      const toId = chain[j + 1]
      const item = linkItemByPair.get(`${fromId}|${toId}`)
      if (!item) continue
      const fromCell = cellByKey.get(fromId)
      const toCell = cellByKey.get(toId)
      if (!fromCell || !toCell) continue
      const prodPort = fromCell.outputs.find(
        (p) => p.item === item && p.scope.kind === "direct",
      )
      const consPort = toCell.inputs.find(
        (p) => p.item === item && p.scope.kind === "direct",
      )
      if (!prodPort || !consPort) continue
      const beltX = minX - 1 - beltIdx * beltStride - o.beltWidth
      beltIdx++
      const beltY0 = Math.min(prodPort.dropY, consPort.dropY)
      const beltY1 = Math.max(prodPort.dropY, consPort.dropY) + 1
      nestedBelts.push({
        x: beltX,
        laneA: { item, rate: directLinks.get(item)?.rate ?? 0 },
        y0: beltY0,
        y1: beltY1,
      })
      nestedItems.push(item)
      prodPort.beltX = beltX
      consPort.beltX = beltX
      for (const ins of inserters) {
        if (ins.item !== item) continue
        if (ins.cellKey !== fromId && ins.cellKey !== toId) continue
        ins.beltX = beltX
      }
      absorbedDirectItems.add(item)
    }
    // Frame extends to cover the leftmost nested belt.
    const effectiveMinX = nestedBelts.length > 0
      ? Math.min(minX - 1, minX - 1 - (beltIdx) * beltStride)
      : minX
    groupNodes.push({
      id: `chain-${i}`,
      depth: 1,
      x: effectiveMinX - 1,
      y: minY - 1,
      w: maxX - effectiveMinX + 2,
      h: maxYY - minY + 2,
      belts: nestedBelts,
      gutterX: -1,
      scopeItems: nestedItems,
      children: [],
      cellKeys: chain,
      totalMachines: cMachines,
      totalPowerW: cPowerW,
    })
  }
  // Drop the absorbed point-to-point connectors — the nested belts
  // visually replace them.
  const filteredDirectConnections = directConnections.filter(
    (dc) => !absorbedDirectItems.has(dc.item),
  )
  directConnections.length = 0
  directConnections.push(...filteredDirectConnections)

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
  // For multi-machine cells, allocate input rails at top. NO bottom
  // rails — interleaved always sends outputs on the E edge (no
  // horizontal collect rail through the cell). Earlier the bottom
  // rails were allocated but produced double-drawing with the E-side-
  // belts → "lanes overlapping coming off manifolds".
  const inputBelts = isManifold ? Math.ceil(inIngs.length / 2) : inIngs.length
  const cellW = Math.max(strip.w, mw)
  const cellH = isManifold
    ? Math.max(strip.h + inputBelts, Math.max(inIngs.length, outs.length) + 1)
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
    // Outputs distribute along the E edge in the strip's y range so
    // each output's side-belt exits at its own row.
    outputSlots = outs.map(
      (_, i) => yStart + stripDY + Math.floor(((i + 1) * strip.h) / (outs.length + 1)),
    )
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
    // DIRECT outputs land on a chain-nested belt that sits WEST of
    // the chain block, so the producer's perimeter inserter must
    // face WEST and the port must live on the W edge. Non-direct
    // outputs go E to the next-stage main bus as usual.
    inserters.push({
      x: direct ? wPerimeterX : ePerimeterX,
      y: dropY,
      facing: direct ? "west" : "east",
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
      edge: direct ? "W" : "E",
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
