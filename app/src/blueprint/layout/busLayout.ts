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
  /** every belt at every level — used for crossing detection later */
  allBelts: Array<{ x: number; y0: number; y1: number; item: string }>
  nodeById: Map<string, FlowGraph["nodes"][number]>
  /** predicate: is this item a fluid? Drives single-lane "pipe" packing. */
  isFluid: (item: string) => boolean
}

interface PartitionResult {
  node: BusNode
  contentBottom: number
  contentRight: number
}

const TOP_MARGIN = 2
const LEFT_MARGIN = 2

export function busLayout(catalog: Catalog, flow: FlowGraph, opts: Opts = {}): Blueprint {
  const o = { ...DEFAULTS, ...opts }
  const nodeById = new Map(flow.nodes.map((n) => [n.id, n]))
  const allRecipeIds = flow.nodes.filter((n) => n.recipe).map((n) => n.id)
  const isFluid = (item: string) => catalog.fluidItems.has(item)

  const ctx: LayoutContext = {
    flow,
    o,
    cells: [],
    inserters: [],
    unsupported: [],
    isFluid,
    beltXByItem: new Map(),
    rootBeltItems: new Set(),
    allBelts: [],
    nodeById,
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
      unsupported: [],
    }
  }

  const result = partition(allRecipeIds, 0, LEFT_MARGIN, TOP_MARGIN, ctx, "root")
  const root = result.node

  // Crossings pass — for every cell port, scan the columns strictly
  // between the belt and the cell's left edge; any column that's another
  // belt is a crossing point (needs an underground belt in real Factorio).
  computeCrossings(ctx.cells, ctx.allBelts)

  // Derive backwards-compat flat arrays from the tree.
  const flatGroups: CellGroup[] = root.children.map(busNodeToCellGroup)

  const width = Math.max(result.contentRight + 1, 32)
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
  const scopeTrunkItems = new Set<string>()
  const scopeLocalItems = new Set<string>()
  const trunkThreshold = o.trunkMinConsumers
  for (const [item, set] of consumers) {
    const producerInScope = (producers.get(item)?.size ?? 0) >= 1
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
    for (const e of flow.edges) {
      const fromSource = e.source.startsWith("source:") || e.source.startsWith("input:")
      const toOutput = e.target.startsWith("output:")
      if (fromSource && scopeSet.has(e.target)) {
        scopeTrunkItems.add(e.item)
        rawInputRates.set(e.item, (rawInputRates.get(e.item) ?? 0) + e.rate)
      } else if (toOutput && scopeSet.has(e.source)) {
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
    if (scopeLocalItems.has(e.item)) union(e.source, e.target)
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
  const belts = packBeltsAt(
    beltsSorted,
    o.beltGroupSize,
    o.beltSpacing,
    o.beltWidth,
    originX,
    ctx.isFluid,
  )
  const scopeGutterX = belts.belts.length === 0 ? -1 : belts.gutterX
  // gutterX already points to the column AFTER the last belt's full width.
  // Cells start one extra tile beyond to leave breathing room.
  const beltsRight = belts.belts.length === 0 ? originX : belts.gutterX + 1
  // Make the latest belts visible to descendants so a deep cell can tap from us.
  for (const [item, x] of belts.beltXByItem) ctx.beltXByItem.set(item, x)
  // At depth 0, mark these items as "root belts" so leaf ports can tag
  // themselves as trunk-vs-local (legacy field; the renderer derives
  // ownership from this).
  if (depth === 0) {
    for (const item of belts.beltXByItem.keys()) ctx.rootBeltItems.add(item)
  }

  // 6. Recurse / place children top-to-bottom inside this node.
  const childContentX = beltsRight + (belts.belts.length === 0 ? 0 : o.groupLeftOffset)
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

  // Inputs/outputs that can be served by some bus belt (any ancestor's).
  // For ingredients/products not present in `beltXByItem`, we skip the
  // port — they'd be served by raw-source belts we don't yet render.
  const inIngs = recipe.ingredients.filter((ing) => ctx.beltXByItem.has(ing.item))
  const outProds = recipe.products.filter((p) => ctx.beltXByItem.has(p.item))
  const portCount = inIngs.length + outProds.length

  const cellW = mw
  const cellH = Math.max(mh, portCount + 1)

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

  const slots = Array.from({ length: portCount }, (_, i) =>
    yStart + Math.floor(((i + 1) * cellH) / (portCount + 1)),
  )
  const inputs: CellPort[] = []
  const outputs: CellPort[] = []
  let slotIdx = 0

  // A port is "trunk-scope" if its belt is an ancestor's belt — for now we
  // can't distinguish "this scope vs ancestor" from beltXByItem alone, so
  // we tag everything as "trunk" except when we explicitly know the cell's
  // OWN scope produced it. Renderer doesn't currently care; downstream
  // tests just check item↔belt linkage.
  for (const ing of inIngs) {
    const beltX = ctx.beltXByItem.get(ing.item)!
    const dropY = slots[slotIdx++]
    const rate = ing.amount * node.rate
    const portScope: "trunk" | "local" = ctx.rootBeltItems.has(ing.item) ? "trunk" : "local"
    ctx.inserters.push({
      x: beltX + o.beltWidth,
      y: dropY,
      facing: "east",
      beltX,
      cellKey: recipeId,
      item: ing.item,
      rate,
      scope: portScope,
    })
    inputs.push({ item: ing.item, rate, beltX, dropY, direction: "input", scope: portScope })
  }
  for (const p of outProds) {
    const beltX = ctx.beltXByItem.get(p.item)!
    const dropY = slots[slotIdx++]
    const rate = p.amount * node.rate
    const portScope: "trunk" | "local" = ctx.rootBeltItems.has(p.item) ? "trunk" : "local"
    ctx.inserters.push({
      x: beltX + o.beltWidth,
      y: dropY,
      facing: "west",
      beltX,
      cellKey: recipeId,
      item: p.item,
      rate,
      scope: portScope,
    })
    outputs.push({ item: p.item, rate, beltX, dropY, direction: "output", scope: portScope })
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
  }
  ctx.cells.push(cell)
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
