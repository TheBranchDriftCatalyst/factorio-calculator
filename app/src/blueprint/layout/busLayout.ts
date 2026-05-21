// Main-bus layout v6 (recursive nested bus). Each scope is a `BusNode`:
//
//   - At every scope, items with ≥2 consumers IN SCOPE become the scope's
//     own belts (vertical columns at the scope's left edge).
//   - Items with exactly 1 consumer in scope bind their producer+consumer
//     into the same sub-cluster via union-find.
//   - Sub-clusters with >1 member recurse into nested `BusNode` children;
//     singleton clusters become leaf cells.
//   - Clusters at every scope are placed in topological order so a
//     producer is ALWAYS rendered above its consumers (fixes the
//     "items at end appear used at upper levels" bug).
//
// The tree is the source of truth. Flat `cells[]` / `inserters[]` /
// `groups[]` arrays are derived from it so existing flat-data consumers
// (renderer, tests, etc.) keep working without modification.

import type { Catalog } from "../../factorio"
import type { FlowGraph } from "../../solver/expand"
import type {
  Blueprint,
  BusBelt,
  BusLane,
  BusNode,
  Cell,
  CellGroup,
  CellPort,
  DirectConnection,
  Edge,
  InserterPlacement,
  MachinePlacement,
} from "../types"

interface Opts {
  cellGapY?: number
  groupLeftOffset?: number
  cellLeftOffset?: number
  beltGroupSize?: number
  beltSpacing?: number
  /** Tiles per belt (each carries 2 sub-lanes). Default 2 for legible labels. */
  beltWidth?: number
  defaultMachineSize?: readonly [number, number]
  groupGapY?: number
  groupPadY?: number
  trunkMinConsumers?: number
  /** Cap on nested sub-bus recursion. Defaults to 4. */
  maxNestingDepth?: number
  /** Where final-output belts live: same bus, separate bus on right, or split. */
  outputBusSide?: "left" | "right" | "split"
  /**
   * Per-item bus assignment. Maps item key → busId. BusIds:
   *   - "left", "right": default buses (legacy 2-bus split)
   *   - "L2", "L3", ...: additional left-side buses (further from cells)
   *   - "R2", "R3", ...: additional right-side buses
   * Unassigned items fall through to "left" (non-output) or "right" (output in split).
   */
  beltAssignments?: Record<string, string>
}

const DEFAULTS: Required<Opts> = {
  cellGapY: 2,
  groupLeftOffset: 1,
  cellLeftOffset: 1,
  beltGroupSize: 4,
  beltSpacing: 1,
  beltWidth: 2,
  defaultMachineSize: [3, 3],
  groupGapY: 3,
  groupPadY: 1,
  trunkMinConsumers: 2,
  maxNestingDepth: 4,
  outputBusSide: "split",
  beltAssignments: {},
}

/** Pack items into 2-lane vertical belt columns starting at `startX`. */
function packBeltsAt(
  items: Array<[string, number]>,
  beltGroupSize: number,
  beltSpacing: number,
  beltWidth: number,
  startX: number,
  isFluid: (item: string) => boolean = () => false,
): { belts: BusBelt[]; gutterX: number; beltXByItem: Map<string, number> } {
  const belts: BusBelt[] = []
  const beltXByItem = new Map<string, number>()
  let cursorX = startX
  let beltsInGroup = 0
  // Sort: solid items first (they can pair up), then fluids (single-lane).
  // Within each group, preserve rate-descending order.
  const solids: Array<[string, number]> = []
  const fluids: Array<[string, number]> = []
  for (const it of items) (isFluid(it[0]) ? fluids : solids).push(it)
  const placeBelt = (laneA: BusLane, laneB?: BusLane) => {
    if (beltsInGroup > 0 && beltsInGroup % beltGroupSize === 0) {
      cursorX += 1
      beltsInGroup = 0
    }
    belts.push({ x: cursorX, laneA, laneB })
    beltXByItem.set(laneA.item, cursorX)
    if (laneB) beltXByItem.set(laneB.item, cursorX)
    cursorX += beltWidth + beltSpacing
    beltsInGroup += 1
  }
  // Solid items: pair up 2 per belt.
  for (let i = 0; i < solids.length; ) {
    const laneA: BusLane = { item: solids[i][0], rate: solids[i][1] }
    const laneB: BusLane | undefined =
      i + 1 < solids.length ? { item: solids[i + 1][0], rate: solids[i + 1][1] } : undefined
    placeBelt(laneA, laneB)
    i += laneB ? 2 : 1
  }
  // Fluids: one per "pipe" (no pairing — fluids can't share a pipe).
  for (const f of fluids) {
    placeBelt({ item: f[0], rate: f[1], isFluid: true })
  }
  return { belts, gutterX: cursorX, beltXByItem }
}

/** Topological sort over arbitrary string-keyed nodes given a directed edge list. */
function topoSort<T extends string>(
  nodes: ReadonlyArray<T>,
  edges: ReadonlyArray<{ from: T; to: T }>,
): T[] {
  const indeg = new Map<T, number>()
  const adj = new Map<T, T[]>()
  for (const n of nodes) {
    indeg.set(n, 0)
    adj.set(n, [])
  }
  for (const e of edges) {
    if (!indeg.has(e.from) || !indeg.has(e.to)) continue
    if (e.from === e.to) continue
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
    adj.get(e.from)?.push(e.to)
  }
  const q: T[] = []
  for (const [id, d] of indeg) if (d === 0) q.push(id)
  const out: T[] = []
  while (q.length) {
    const id = q.shift()!
    out.push(id)
    for (const next of adj.get(id) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 0) - 1)
      if (indeg.get(next) === 0) q.push(next)
    }
  }
  // Cycle remainder — append in insertion order to keep determinism.
  for (const n of nodes) if (!out.includes(n)) out.push(n)
  return out
}

interface LayoutContext {
  flow: FlowGraph
  o: Required<Opts>
  cells: Cell[]
  inserters: InserterPlacement[]
  unsupported: Array<{ recipeKey: string; reason: string }>
  /** beltX lookup across ALL ancestor nodes — a cell can tap any ancestor's belt */
  beltXByItem: Map<string, number>
  /** items that live at the ROOT scope — used to tag ports as "trunk" vs "local" */
  rootBeltItems: Set<string>
  /** items destined for `output:*` sinks. In split mode they live on the right bus. */
  finalOutputItems: Set<string>
  /** every belt at every level — used for crossing detection later */
  allBelts: Array<{ x: number; y0: number; y1: number; item: string }>
  nodeById: Map<string, FlowGraph["nodes"][number]>
  /** predicate: is this item a fluid? Drives single-lane "pipe" packing. */
  isFluid: (item: string) => boolean
  /**
   * Output ports whose belts haven't been packed yet (split mode: final
   * outputs go on the right bus which is sized AFTER cells are placed).
   * Walked post-cells to patch in beltX + emit the inserter.
   */
  deferredOutputPorts: Array<{
    cell: Cell
    port: CellPort
    rate: number
    item: string
  }>
  /**
   * Items with exactly 1 producer + 1 consumer in their enclosing scope
   * get a direct connection instead of a bus column. Map item → { from, to }.
   * Set by partition() before emitting leaf cells; consumed inside emitLeafCell
   * to route ports along the cell perimeter and emit a DirectConnection record.
   */
  directLinks: Map<string, { from: string; to: string; rate: number }>
  /** Emitted direct-connection records, walked by the renderer. */
  directConnections: DirectConnection[]
  /**
   * Track which slot Y each direct port lives at so we can backfill the
   * DirectConnection record's y0/y1 once both endpoints are placed.
   */
  directEndpoints: Map<string, { producerY?: number; consumerY?: number; x?: number }>
  /** beltX for each direct item — populated by partition() before recursion. */
  directBeltXByItem?: Map<string, number>
}

interface PartitionResult {
  node: BusNode
  contentBottom: number
  contentRight: number
}

const TOP_MARGIN = 2
const LEFT_MARGIN = 2

/**
 * Sort key for a bus id. Plain "left"/"right" sort to 0; suffixed ones
 * (L2, R3, …) sort by their numeric suffix. Used to order multi-bus
 * columns left-to-right.
 */
function busSortKey(id: string): number {
  if (id === "left" || id === "right") return 0
  const m = id.match(/^[LR](\d+)$/)
  return m ? Number(m[1]) : 0
}

export function busLayout(catalog: Catalog, flow: FlowGraph, opts: Opts = {}): Blueprint {
  const o = { ...DEFAULTS, ...opts }
  const nodeById = new Map(flow.nodes.map((n) => [n.id, n]))
  const allRecipeIds = flow.nodes.filter((n) => n.recipe).map((n) => n.id)
  const isFluid = (item: string) => catalog.fluidItems.has(item)

  // Items that flow to an `output:*` sink (i.e. user-requested targets).
  // Computed once up-front so emitLeafCell can decide which edge to place
  // each output port on.
  const finalOutputItems = new Set<string>()
  for (const e of flow.edges) {
    if (e.target.startsWith("output:")) finalOutputItems.add(e.item)
  }

  const ctx: LayoutContext = {
    flow,
    o,
    cells: [],
    inserters: [],
    unsupported: [],
    isFluid,
    beltXByItem: new Map(),
    rootBeltItems: new Set(),
    finalOutputItems,
    allBelts: [],
    nodeById,
    deferredOutputPorts: [],
    directLinks: new Map(),
    directConnections: [],
    directEndpoints: new Map(),
  }

  if (allRecipeIds.length === 0) {
    return {
      width: 32,
      height: 16,
      beltWidth: o.beltWidth,
      busWidth: 0,
      gutterX: -1,
      belts: [],
      groups: [],
      root: null,
      cells: [],
      inserters: [],
      directConnections: [],
      unsupported: [],
    }
  }

  const result = partition(allRecipeIds, 0, LEFT_MARGIN, TOP_MARGIN, ctx, "root")
  const root = result.node

  // Right-bus pass (split mode + multi-bus): now that cells are placed
  // and we know the rightmost cell edge, pack each deferred output port's
  // target bus as a separate column to the right of cells. R-suffixed
  // buses go further right; the default "right" bus is closest to cells.
  if (o.outputBusSide === "split" && ctx.deferredOutputPorts.length > 0) {
    const assignments = o.beltAssignments
    // Group deferred ports by their assigned right-side busId.
    const rightBuckets = new Map<string, typeof ctx.deferredOutputPorts>()
    const itemBusFor = (item: string): string => {
      const a = assignments[item]
      if (a && (a === "right" || a.startsWith("R"))) return a
      return "right"
    }
    for (const dp of ctx.deferredOutputPorts) {
      const bid = itemBusFor(dp.item)
      if (!rightBuckets.has(bid)) rightBuckets.set(bid, [] as typeof ctx.deferredOutputPorts)
      rightBuckets.get(bid)!.push(dp)
    }
    // Sort right buses: "right" first (closest to cells), then ascending suffix.
    const rightBuses = [...rightBuckets.keys()].sort(
      (a, b) => busSortKey(a) - busSortKey(b),
    )
    let cursorX = result.contentRight + o.groupLeftOffset + 1
    let rightmostExtent = cursorX
    for (const busId of rightBuses) {
      const ports = rightBuckets.get(busId)!
      const rates = new Map<string, number>()
      for (const dp of ports) {
        rates.set(dp.item, (rates.get(dp.item) ?? 0) + dp.rate)
      }
      const items = [...rates.entries()].sort((a, b) => b[1] - a[1])
      const packed = packBeltsAt(
        items,
        o.beltGroupSize,
        o.beltSpacing,
        o.beltWidth,
        cursorX,
        ctx.isFluid,
      )
      root.belts = [...root.belts, ...packed.belts]
      root.scopeItems = [...root.scopeItems, ...items.map(([i]) => i)]
      for (const [item, x] of packed.beltXByItem) ctx.beltXByItem.set(item, x)
      // Patch each port belonging to this bus + emit its inserter.
      for (const dp of ports) {
        const beltX = packed.beltXByItem.get(dp.item)
        if (beltX == null) continue
        dp.port.beltX = beltX
        const cell = dp.cell
        const ePerimeterX = cell ? cell.x + cell.w : beltX - 1
        ctx.inserters.push({
          x: ePerimeterX,
          y: dp.port.dropY,
          facing: "east",
          direction: "output",
          beltX,
          cellKey: cell?.recipeKey ?? "",
          item: dp.item,
          rate: dp.rate,
          scope: "trunk",
        })
        ctx.allBelts.push({
          x: beltX,
          y0: root.y,
          y1: root.y + root.h,
          item: dp.item,
        })
      }
      cursorX = packed.gutterX + 1 + o.groupLeftOffset
      rightmostExtent = Math.max(rightmostExtent, packed.gutterX + 1)
    }
    root.w = Math.max(root.w, rightmostExtent - root.x)
  }

  // Crossings pass — for every cell port, scan the columns strictly
  // between the belt and the cell's left edge; any column that's another
  // belt is a crossing point (needs an underground belt in real Factorio).
  computeCrossings(ctx.cells, ctx.allBelts)

  // Truncate each belt to its actual produce/consume span. A belt running
  // the full scope height when its last consumer is high up wastes visual
  // space and makes the schematic look messier than it is.
  truncateBelts(root, ctx, finalOutputItems)

  // Derive backwards-compat flat arrays from the tree.
  const flatGroups: CellGroup[] = root.children.map(busNodeToCellGroup)

  // Blueprint width must include EVERYTHING — cell extents, direct
  // connection columns, AND the right-bus columns packed after cells.
  // Without this, right-bus belts at x > contentRight get clipped by the
  // canvas grid and disappear visually.
  let maxBeltRight = 0
  for (const b of root.belts) {
    maxBeltRight = Math.max(maxBeltRight, b.x + o.beltWidth)
  }
  const width = Math.max(result.contentRight + 1, maxBeltRight + 1, 32)
  const height = Math.max(result.contentBottom + 1, 16)

  return {
    width,
    height,
    beltWidth: o.beltWidth,
    busWidth: root.gutterX >= 0 ? root.gutterX + 1 : 0,
    gutterX: root.gutterX,
    belts: root.belts,
    groups: flatGroups,
    root,
    cells: ctx.cells,
    inserters: ctx.inserters,
    directConnections: ctx.directConnections,
    unsupported: ctx.unsupported,
  }
}

/**
 * Recursively partition a set of recipes into a BusNode subtree starting at
 * (originX, originY). Returns the node + its content extents so the caller
 * can stack siblings.
 */
function partition(
  scope: ReadonlyArray<string>,
  depth: number,
  originX: number,
  originY: number,
  ctx: LayoutContext,
  nodeId: string,
): PartitionResult {
  const { flow, o } = ctx
  const scopeSet = new Set(scope)

  // 1. Within-scope edges (only between recipes in scope).
  const scopeEdges = flow.edges.filter((e) => scopeSet.has(e.source) && scopeSet.has(e.target))

  // 2. Count consumers per item IN SCOPE.
  const consumers = new Map<string, Set<string>>()
  const producers = new Map<string, Set<string>>()
  for (const e of scopeEdges) {
    if (!consumers.has(e.item)) consumers.set(e.item, new Set())
    consumers.get(e.item)!.add(e.target)
    if (!producers.has(e.item)) producers.set(e.item, new Set())
    producers.get(e.item)!.add(e.source)
  }
  // Belt rule:
  //   - At depth 0 (root), only "trunk" items (≥ 2 consumers in scope) get
  //     a belt. Single-consumer items push down into a sub-cluster.
  //   - At depth ≥ 1, ANY item whose producer + ≥ 1 consumer are both in
  //     scope becomes a belt — that's how a sub-bus visualizes its own
  //     internal chain even when each intermediate has just one consumer.
  // Union-find still uses single-consumer-in-scope edges to bind clusters.
  //
  // Exception — DIRECT items: when an item has exactly 1 producer AND 1
  // consumer both in scope, skip the belt column and emit a direct link
  // (registered in ctx.directLinks). Producer + consumer cells will use
  // perimeter-adjacent ports instead.
  const scopeTrunkItems = new Set<string>()
  const scopeLocalItems = new Set<string>()
  const scopeDirectItems = new Set<string>()
  const trunkThreshold = o.trunkMinConsumers
  for (const [item, set] of consumers) {
    const pset = producers.get(item) ?? new Set<string>()
    const producerInScope = pset.size >= 1
    // 1 producer + 1 consumer in scope → direct connection (any depth).
    if (set.size === 1 && pset.size === 1) {
      scopeDirectItems.add(item)
      const from = [...pset][0]
      const to = [...set][0]
      // Sum edge rates for this item between from and to.
      let rate = 0
      for (const e of scopeEdges) {
        if (e.item === item && e.source === from && e.target === to) rate += e.rate
      }
      ctx.directLinks.set(item, { from, to, rate })
      continue
    }
    if (depth === 0) {
      // Configurable: items with ≥ trunkMinConsumers consumers in scope
      // get promoted to root trunk; anything under that count is pushed
      // into a sub-cluster (binding the producer+consumer together).
      if (set.size >= trunkThreshold) scopeTrunkItems.add(item)
      else if (set.size >= 1) scopeLocalItems.add(item)
    } else {
      if (producerInScope && set.size >= 1) scopeTrunkItems.add(item)
      if (set.size === 1) scopeLocalItems.add(item)
    }
  }

  // Factory-boundary belts at depth 0:
  //   • Raw inputs (source:*) — items coming in from the world. Promoted
  //     to trunk so the user sees what's entering the factory.
  //   • Final products (target → output:*) — items going OUT of the factory.
  //     Promoted to trunk so the producer cell can drop them onto a
  //     visible belt heading to the (off-schematic) container/output rail.
  //   • Supplied inputs (input:*) — items pre-supplied by the user.
  // These items would otherwise have 0 consumers in scope (their
  // consumer is a synthetic `output:` sink, NOT a recipe), so we must
  // promote them explicitly.
  const rawInputRates = new Map<string, number>()
  if (depth === 0) {
    // In split mode the final outputs go on the RIGHT bus (packed after
    // cells), so we MUST NOT promote them to the left scope-trunk here —
    // doing so would duplicate them on both buses.
    const splitMode = o.outputBusSide === "split"
    for (const e of flow.edges) {
      const fromSource = e.source.startsWith("source:") || e.source.startsWith("input:")
      const toOutput = e.target.startsWith("output:")
      if (fromSource && scopeSet.has(e.target)) {
        scopeTrunkItems.add(e.item)
        rawInputRates.set(e.item, (rawInputRates.get(e.item) ?? 0) + e.rate)
      } else if (toOutput && scopeSet.has(e.source) && !splitMode) {
        scopeTrunkItems.add(e.item)
        rawInputRates.set(e.item, (rawInputRates.get(e.item) ?? 0) + e.rate)
      }
    }
  }

  // 3. Cluster via union-find on scope-local items.
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let p = parent.get(x) ?? x
    if (p !== x) {
      p = find(p)
      parent.set(x, p)
    }
    return p
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const r of scope) parent.set(r, r)
  for (const e of scopeEdges) {
    // Union both single-consumer-belt items and direct-link items: both
    // bind producer + consumer into the same sub-cluster so the recursion
    // tree mirrors the data flow.
    if (scopeLocalItems.has(e.item) || scopeDirectItems.has(e.item)) {
      union(e.source, e.target)
    }
  }
  const clusterOf = new Map<string, string>()
  for (const r of scope) clusterOf.set(r, find(r))
  const clusterMembers = new Map<string, string[]>()
  for (const r of scope) {
    const c = clusterOf.get(r)!
    if (!clusterMembers.has(c)) clusterMembers.set(c, [])
    clusterMembers.get(c)!.push(r)
  }

  // 4. Topo-sort clusters by inter-cluster dependencies (any edge whose
  //    endpoints are in different clusters within this scope contributes).
  const clusterIds = [...clusterMembers.keys()]
  const interEdges: { from: string; to: string }[] = []
  for (const e of scopeEdges) {
    const a = clusterOf.get(e.source)!
    const b = clusterOf.get(e.target)!
    if (a !== b) interEdges.push({ from: a, to: b })
  }
  const clusterOrder = topoSort(clusterIds, interEdges)

  // 5. Pack THIS scope's belts.
  const beltRateTotals = new Map<string, number>()
  for (const e of scopeEdges) {
    if (scopeTrunkItems.has(e.item)) {
      beltRateTotals.set(e.item, (beltRateTotals.get(e.item) ?? 0) + e.rate)
    }
  }
  // Merge raw-input rates (collected above when depth === 0).
  for (const [item, rate] of rawInputRates) {
    beltRateTotals.set(item, (beltRateTotals.get(item) ?? 0) + rate)
  }
  const beltsSorted = [...beltRateTotals.entries()].sort((a, b) => b[1] - a[1])

  // At root with multi-bus support: classify each item by its busId, then
  // pack each LEFT-side bus as a separate column. RIGHT-side buses are
  // packed later (after cells) so unused for now.
  // At deeper depths just pack a single bus (no multi-bus support nested).
  let belts: { belts: BusBelt[]; gutterX: number; beltXByItem: Map<string, number> }
  if (depth === 0) {
    // Classify items by bus.
    // Constraint: only FINAL-OUTPUT items can live on a right-side bus
    // (right / R*) — moving an intermediate to the right would orphan
    // its downstream consumers since cells read inputs from their west
    // side. If the user assigned a non-output item to a right bus we
    // silently fall back to "left" so it still appears somewhere.
    const assignments = o.beltAssignments
    const splitMode = o.outputBusSide === "split"
    const busBuckets = new Map<string, Array<[string, number]>>()
    for (const [item, rate] of beltsSorted) {
      let busId = assignments[item]
      const isOutput = ctx.finalOutputItems.has(item)
      if (busId && (busId === "right" || busId.startsWith("R")) && !isOutput) {
        busId = "left" // fall back so the item stays visible
      }
      if (!busId) {
        busId = splitMode && isOutput ? "right" : "left"
      }
      if (!busBuckets.has(busId)) busBuckets.set(busId, [])
      busBuckets.get(busId)!.push([item, rate])
    }
    // Order LEFT-side buses from leftmost (highest suffix) to rightmost ("left").
    const leftBuses = [...busBuckets.keys()]
      .filter((b) => b === "left" || b.startsWith("L"))
      .sort((a, b) => busSortKey(b) - busSortKey(a)) // descending: L9..L2 then left

    // Pack left buses sequentially, each in its own column.
    const aggregated: BusBelt[] = []
    const aggregatedXByItem = new Map<string, number>()
    let cursorX = originX
    let lastGutterX = -1
    for (const busId of leftBuses) {
      const items = busBuckets.get(busId)!
      const packed = packBeltsAt(
        items,
        o.beltGroupSize,
        o.beltSpacing,
        o.beltWidth,
        cursorX,
        ctx.isFluid,
      )
      aggregated.push(...packed.belts)
      for (const [item, x] of packed.beltXByItem) {
        ctx.beltXByItem.set(item, x)
        aggregatedXByItem.set(item, x)
      }
      lastGutterX = packed.gutterX
      // Gap between adjacent buses on the same side.
      cursorX = packed.gutterX + 1 + o.groupLeftOffset
    }
    belts = {
      belts: aggregated,
      gutterX: lastGutterX,
      beltXByItem: aggregatedXByItem,
    }
  } else {
    belts = packBeltsAt(
      beltsSorted,
      o.beltGroupSize,
      o.beltSpacing,
      o.beltWidth,
      originX,
      ctx.isFluid,
    )
    for (const [item, x] of belts.beltXByItem) ctx.beltXByItem.set(item, x)
  }
  const scopeGutterX = belts.belts.length === 0 ? -1 : belts.gutterX
  const beltsRight = belts.belts.length === 0 ? originX : belts.gutterX + 1
  // At depth 0, mark these items as "root belts" so leaf ports can tag
  // themselves as trunk-vs-local (legacy field; the renderer derives
  // ownership from this).
  if (depth === 0) {
    for (const item of belts.beltXByItem.keys()) ctx.rootBeltItems.add(item)
  }

  // 6. Allocate columns for direct-connection segments.
  // Each unique (from, to) producer-consumer pair gets ONE 1-tile-wide
  // column (a "skinny belt" — second item with the same pair piggybacks
  // on the same column).  We use 1 tile (not beltWidth) because direct
  // links are short and shouldn't push cells far from the main bus.
  const directColByPair = new Map<string, number>()
  const directBeltItemsByX = new Map<number, string[]>()
  const directColStartX = beltsRight + (belts.belts.length === 0 ? 0 : o.groupLeftOffset)
  let directColCursor = directColStartX
  for (const item of scopeDirectItems) {
    const dl = ctx.directLinks.get(item)!
    const pairKey = `${dl.from}->${dl.to}`
    if (!directColByPair.has(pairKey)) {
      directColByPair.set(pairKey, directColCursor)
      directBeltItemsByX.set(directColCursor, [item])
      directColCursor += 1
    } else {
      const x = directColByPair.get(pairKey)!
      const arr = directBeltItemsByX.get(x)!
      if (arr.length < 2) arr.push(item)
      else {
        directColByPair.set(`${pairKey}#${arr.length}`, directColCursor)
        directBeltItemsByX.set(directColCursor, [item])
        directColCursor += 1
      }
    }
  }
  const hasDirect = scopeDirectItems.size > 0
  ctx.directBeltXByItem = ctx.directBeltXByItem ?? new Map<string, number>()
  for (const [x, items] of directBeltItemsByX) {
    for (const item of items) ctx.directBeltXByItem.set(item, x)
  }

  // 7. Recurse / place children top-to-bottom inside this node. Direct
  // columns sit between bus and cells, plus 1 tile clearance for the
  // perimeter inserter row.
  const childContentX = hasDirect
    ? directColCursor + 1
    : beltsRight + (belts.belts.length === 0 ? 0 : o.groupLeftOffset)
  let cursorY = originY + o.groupPadY
  const childNodes: BusNode[] = []
  const leafCellKeys: string[] = []
  let maxRight = childContentX

  // Termination: if union-find produced a SINGLE cluster equal to the
  // whole scope, recursion wouldn't divide further and would loop. At
  // depth 0 we wrap the chain in ONE child node (so the schematic has
  // a visible "group" frame around it, matching the legacy semantics);
  // at deeper depths the cluster's cells are emitted as direct leaves.
  //
  // Also: if we've hit the configured maxNestingDepth, behave like the
  // indivisible case — emit cells as leaves of THIS node so the user's
  // chosen depth cap is honored.
  const singleClusterCoversScope =
    clusterOrder.length === 1 && (clusterMembers.get(clusterOrder[0])?.length ?? 0) === scope.length
  const depthCapHit = depth >= o.maxNestingDepth

  if ((singleClusterCoversScope && depth > 0) || depthCapHit) {
    // Indivisible scope at depth ≥ 1 — emit cells directly as leaves of
    // THIS node, ordered by topo (producer above consumer).
    const topoCells = topoSort(
      [...scope],
      scopeEdges.map((e) => ({ from: e.source, to: e.target })),
    )
    for (const id of topoCells) {
      const cell = emitLeafCell(id, childContentX, cursorY, ctx)
      leafCellKeys.push(cell.recipeKey)
      cursorY = cell.y + cell.h + o.cellGapY
      maxRight = Math.max(maxRight, cell.x + cell.w)
    }
  } else if (singleClusterCoversScope && depth === 0) {
    // Single chain at root — wrap in ONE child node so the schematic has
    // a visible "group" frame around the chain.
    const childRes = partition(
      scope,
      depth + 1,
      childContentX,
      cursorY,
      ctx,
      `${nodeId}.chain`,
    )
    childNodes.push(childRes.node)
    cursorY = childRes.contentBottom + o.groupGapY
    maxRight = Math.max(maxRight, childRes.contentRight)
  } else {
    for (const cId of clusterOrder) {
      const members = clusterMembers.get(cId)!
      if (members.length === 1) {
        const cell = emitLeafCell(members[0], childContentX, cursorY, ctx)
        leafCellKeys.push(cell.recipeKey)
        cursorY = cell.y + cell.h + o.cellGapY
        maxRight = Math.max(maxRight, cell.x + cell.w)
      } else {
        const childRes = partition(
          members,
          depth + 1,
          childContentX,
          cursorY,
          ctx,
          `${nodeId}.${cId}`,
        )
        childNodes.push(childRes.node)
        cursorY = childRes.contentBottom + o.groupGapY
        maxRight = Math.max(maxRight, childRes.contentRight)
      }
    }
  }

  // Emit DirectConnection records now that both endpoints of each direct
  // item in this scope are placed. The connection's vertical segment runs
  // from the producer's slot Y down to the consumer's slot Y at the
  // pre-allocated column.
  for (const item of scopeDirectItems) {
    const ep = ctx.directEndpoints.get(item)
    const dl = ctx.directLinks.get(item)
    if (!ep || ep.producerY == null || ep.consumerY == null || ep.x == null || !dl) continue
    const x = ep.x
    const y0 = Math.min(ep.producerY, ep.consumerY)
    const y1 = Math.max(ep.producerY, ep.consumerY)
    ctx.directConnections.push({
      item,
      rate: dl.rate,
      fromCellKey: dl.from,
      toCellKey: dl.to,
      x,
      y0,
      y1,
      isFluid: ctx.isFluid(item),
    })
    // Direct belts also participate in crossing detection so other side-belts
    // know to mark a crossing where they pass through.
    ctx.allBelts.push({ x, y0, y1: y1 + 1, item })
  }

  // Rollup: machines + power across ALL descendant recipes (including children).
  let totalMachines = 0
  let totalPowerW = 0
  for (const r of scope) {
    const n = ctx.nodeById.get(r)
    if (!n) continue
    totalMachines += Math.max(1, Math.ceil(n.count))
    totalPowerW += n.powerW
  }

  const nodeW = Math.max(maxRight - originX, 4)
  const nodeH = Math.max(cursorY - originY, 4)

  // Record belt y-extents at this node for crossing detection (later stage).
  for (const b of belts.belts) {
    ctx.allBelts.push({ x: b.x, y0: originY, y1: originY + nodeH, item: b.laneA?.item ?? "" })
  }

  return {
    node: {
      id: nodeId,
      depth,
      x: originX,
      y: originY,
      w: nodeW,
      h: nodeH,
      belts: belts.belts,
      gutterX: scopeGutterX,
      scopeItems: beltsSorted.map(([item]) => item),
      children: childNodes,
      cellKeys: leafCellKeys,
      totalMachines,
      totalPowerW,
    },
    contentBottom: cursorY,
    contentRight: maxRight,
  }
}

/**
 * Emit a single cell at (xStart, yStart). Inputs/outputs tap belts via
 * `ctx.beltXByItem` (which is populated as ancestors lay down their belts
 * before recursing into descendants).
 */
function emitLeafCell(recipeId: string, xStart: number, yStart: number, ctx: LayoutContext): Cell {
  const { o } = ctx
  const node = ctx.nodeById.get(recipeId)!
  const recipe = node.recipe!
  const machine = node.machine
  const demanded = Math.max(1, Math.ceil(node.count))
  const size = machine?.size ?? (o.defaultMachineSize as readonly [number, number])
  if (!machine?.size) {
    ctx.unsupported.push({
      recipeKey: recipeId,
      reason: `no footprint for ${machine?.key ?? "unknown"}; using ${size[0]}×${size[1]}`,
    })
  }
  const [mw, mh] = size
  const splitMode = o.outputBusSide === "split"

  // Inputs (all go WEST). Output products are classified by destination:
  //   - Final outputs in split mode → EAST edge (belt sits on the right
  //     bus, packed AFTER cells are placed; ports DEFERRED until then).
  //   - All other outputs (intermediate, or non-split mode) → WEST edge.
  //   - Direct-connection items (1:1) → WEST edge, beltX = the direct
  //     column for this scope (not a shared bus column).
  // For ingredients/products without a belt in scope (raw-only items not
  // yet on a bus), we skip the port — they're served implicitly.
  const directBeltXByItem = ctx.directBeltXByItem ?? new Map<string, number>()
  const isDirectIn = (item: string) => {
    const dl = ctx.directLinks.get(item)
    return dl != null && dl.to === recipeId && directBeltXByItem.has(item)
  }
  const isDirectOut = (item: string) => {
    const dl = ctx.directLinks.get(item)
    return dl != null && dl.from === recipeId && directBeltXByItem.has(item)
  }
  const inIngs = recipe.ingredients.filter(
    (ing) => ctx.beltXByItem.has(ing.item) || isDirectIn(ing.item),
  )
  type Prod = typeof recipe.products[number]
  const finalOuts: Prod[] = []
  const localOuts: Prod[] = []
  for (const p of recipe.products) {
    if (splitMode && ctx.finalOutputItems.has(p.item)) {
      finalOuts.push(p)
    } else if (ctx.beltXByItem.has(p.item) || isDirectOut(p.item)) {
      localOuts.push(p)
    }
  }
  const westCount = inIngs.length + localOuts.length
  const eastCount = finalOuts.length

  const cellW = mw
  // Cell height grows to fit whichever edge has the most ports.
  const cellH = Math.max(mh, Math.max(westCount, eastCount) + 1)

  const machines: MachinePlacement[] = [
    {
      recipeKey: recipeId,
      machineKey: machine?.key ?? "unknown",
      x: xStart,
      y: yStart + Math.floor((cellH - mh) / 2),
      w: mw,
      h: mh,
      index: 0,
    },
  ]

  // Per-edge slot rows. Each edge distributes its ports evenly along the
  // cell's vertical extent.
  const westSlots = Array.from({ length: westCount }, (_, i) =>
    yStart + Math.floor(((i + 1) * cellH) / (westCount + 1)),
  )
  const eastSlots = Array.from({ length: eastCount }, (_, i) =>
    yStart + Math.floor(((i + 1) * cellH) / (eastCount + 1)),
  )
  const inputs: CellPort[] = []
  const outputs: CellPort[] = []
  let wIdx = 0
  let eIdx = 0

  // A port is "trunk-scope" if its belt is an ancestor's belt — for now we
  // can't distinguish "this scope vs ancestor" from beltXByItem alone, so
  // we tag everything as "trunk" except when we explicitly know the cell's
  // OWN scope produced it. Renderer doesn't currently care; downstream
  // tests just check item↔belt linkage.
  // West-side ports (inputs + intermediate outputs) — belt is to the
  // left of the cell, inserter sits immediately to the LEFT of the cell
  // (perimeter placement, matching real Factorio inserter positioning).
  const wPerimeterX = xStart - 1
  const portScopeFor = (item: string): "trunk" | "local" | "direct" => {
    if (directBeltXByItem.has(item)) {
      const dl = ctx.directLinks.get(item)
      if (dl && (dl.from === recipeId || dl.to === recipeId)) return "direct"
    }
    return ctx.rootBeltItems.has(item) ? "trunk" : "local"
  }
  for (const ing of inIngs) {
    const direct = isDirectIn(ing.item)
    const beltX = direct ? directBeltXByItem.get(ing.item)! : ctx.beltXByItem.get(ing.item)!
    const dropY = westSlots[wIdx++]
    const rate = ing.amount * node.rate
    const portScope = portScopeFor(ing.item)
    const partnerCellKey = direct ? ctx.directLinks.get(ing.item)!.from : undefined
    ctx.inserters.push({
      x: wPerimeterX,
      y: dropY,
      facing: "east", // takes from bus on its left, places on cell to its right
      direction: "input",
      beltX,
      cellKey: recipeId,
      item: ing.item,
      rate,
      scope: portScope,
    })
    inputs.push({
      item: ing.item,
      rate,
      beltX,
      dropY,
      direction: "input",
      scope: portScope,
      edge: "W",
      slot: dropY - yStart,
      ...(partnerCellKey ? { partnerCellKey } : {}),
    })
    if (direct) {
      const ep = ctx.directEndpoints.get(ing.item) ?? {}
      ep.consumerY = dropY
      ep.x = beltX
      ctx.directEndpoints.set(ing.item, ep)
    }
  }
  for (const p of localOuts) {
    const direct = isDirectOut(p.item)
    const beltX = direct ? directBeltXByItem.get(p.item)! : ctx.beltXByItem.get(p.item)!
    const dropY = westSlots[wIdx++]
    const rate = p.amount * node.rate
    const portScope = portScopeFor(p.item)
    const partnerCellKey = direct ? ctx.directLinks.get(p.item)!.to : undefined
    ctx.inserters.push({
      x: wPerimeterX,
      y: dropY,
      facing: "west", // takes from cell on its right, places on bus to its left
      direction: "output",
      beltX,
      cellKey: recipeId,
      item: p.item,
      rate,
      scope: portScope,
    })
    outputs.push({
      item: p.item,
      rate,
      beltX,
      dropY,
      direction: "output",
      scope: portScope,
      edge: "W",
      slot: dropY - yStart,
      ...(partnerCellKey ? { partnerCellKey } : {}),
    })
    if (direct) {
      const ep = ctx.directEndpoints.get(p.item) ?? {}
      ep.producerY = dropY
      ep.x = beltX
      ctx.directEndpoints.set(p.item, ep)
    }
  }

  // East-side ports — final-output products in split mode. The belt is
  // on the right bus which hasn't been packed yet (it sits AFTER all
  // cells), so we emit the port with a sentinel beltX = -1 and queue it
  // for the post-cells patch-up pass.
  for (const p of finalOuts) {
    const dropY = eastSlots[eIdx++]
    const rate = p.amount * node.rate
    const port: CellPort = {
      item: p.item,
      rate,
      beltX: -1, // patched after right bus is packed
      dropY,
      direction: "output",
      scope: "trunk",
      edge: "E",
      slot: dropY - yStart,
    }
    outputs.push(port)
    ctx.deferredOutputPorts.push({ cell: null as unknown as Cell, port, rate, item: p.item })
  }

  const portsByEdge: Record<Edge, CellPort[]> = {
    N: [],
    E: outputs.filter((p) => p.edge === "E"),
    S: [],
    W: [...inputs, ...outputs.filter((p) => p.edge === "W")],
  }

  const cell: Cell = {
    recipeKey: recipeId,
    recipeName: recipe.name,
    demanded,
    x: xStart,
    y: yStart,
    w: cellW,
    h: cellH,
    machines,
    inputs,
    outputs,
    portsByEdge,
  }
  ctx.cells.push(cell)
  // Patch the cell reference on any deferred output ports we just emitted.
  for (let i = ctx.deferredOutputPorts.length - 1; i >= 0; i--) {
    const dp = ctx.deferredOutputPorts[i]
    if (dp.cell === (null as unknown as Cell) && cell.outputs.includes(dp.port)) {
      dp.cell = cell
    }
  }
  return cell
}

/** Flatten a depth-1 BusNode child into the legacy CellGroup shape. */
function busNodeToCellGroup(n: BusNode): CellGroup {
  return {
    id: n.id,
    x: n.x,
    y: n.y,
    w: n.w,
    h: n.h,
    cellKeys: collectCellKeys(n),
    localBelts: n.belts,
    localGutterX: n.gutterX,
    localItems: n.scopeItems,
    totalMachines: n.totalMachines,
    totalPowerW: n.totalPowerW,
  }
}

function collectCellKeys(n: BusNode): string[] {
  const out: string[] = [...n.cellKeys]
  for (const child of n.children) out.push(...collectCellKeys(child))
  return out
}

/**
 * For each port, find columns strictly between (beltX, cellX) that are
 * occupied by a different belt whose vertical extent covers this port's
 * `dropY`. Those columns become crossings.
 */
function computeCrossings(
  cells: Cell[],
  allBelts: Array<{ x: number; y0: number; y1: number; item: string }>,
): void {
  for (const cell of cells) {
    for (const port of cell.inputs) {
      port.crossings = findCrossingsForPort(port.beltX, cell.x, port.dropY, allBelts)
    }
    for (const port of cell.outputs) {
      port.crossings = findCrossingsForPort(port.beltX, cell.x, port.dropY, allBelts)
    }
  }
}

/**
 * Walk the bus-node tree and tighten each belt's y0/y1 to the actual span
 * of producers + consumers tapping it. Trunk belts that supply a final
 * output keep extending to the bottom so the visual "exit" stays.
 */
function truncateBelts(
  root: import("../types").BusNode,
  ctx: LayoutContext,
  finalOutputItems: Set<string>,
): void {
  // Index inserters by beltX for fast lookup.
  const byBeltX = new Map<number, Array<{ y: number; dir: "input" | "output" }>>()
  for (const ins of ctx.inserters) {
    if (!byBeltX.has(ins.beltX)) byBeltX.set(ins.beltX, [])
    byBeltX.get(ins.beltX)!.push({ y: ins.y, dir: ins.direction })
  }
  const walk = (n: import("../types").BusNode) => {
    for (const belt of n.belts) {
      const taps = byBeltX.get(belt.x) ?? []
      // Only consider taps within this node's scope (a single belt can
      // appear at the same x in nested scopes — filter by y bounds).
      const inScope = taps.filter((t) => t.y >= n.y && t.y < n.y + n.h)
      if (inScope.length === 0) continue
      const ys = inScope.map((t) => t.y)
      const maxY = Math.max(...ys)
      // Final-output belts must visually exit downward, so extend y1 to
      // the bottom of the root scope.
      const carriesFinal =
        (belt.laneA && finalOutputItems.has(belt.laneA.item)) ||
        (belt.laneB && finalOutputItems.has(belt.laneB.item))
      // Always start belts at the top of the scope — keeps lanes uniform
      // and makes it easy to read which items are "available" up the bus.
      // Only the BOTTOM is truncated to the last consumer.
      belt.y0 = n.y
      belt.y1 = carriesFinal ? n.y + n.h : maxY + 1
    }
    for (const c of n.children) walk(c)
  }
  walk(root)
}

function findCrossingsForPort(
  beltX: number,
  cellX: number,
  dropY: number,
  allBelts: Array<{ x: number; y0: number; y1: number; item: string }>,
): number[] {
  const lo = Math.min(beltX, cellX)
  const hi = Math.max(beltX, cellX)
  const out: number[] = []
  for (const b of allBelts) {
    if (b.x === beltX) continue // the port's own belt — not a crossing
    if (b.x <= lo || b.x >= hi) continue
    if (b.y0 <= dropY && dropY < b.y1) out.push(b.x)
  }
  // Deduplicate (a single column can host multiple stacked belts).
  return [...new Set(out)].sort((a, b) => a - b)
}
