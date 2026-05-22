// Phase-0 solver: recursively expand one-or-more target item+rate demands
// into a directed graph of recipes. Shared intermediates merge.
//
// Out of scope (phase 1+): recipe choice (oil/coal liquefaction),
// modules, productivity/quality, beacons.

import type { Catalog, Machine, Recipe } from "../factorio"

export interface Target {
  item: string
  rate: number // items/sec
}

/**
 * Pre-supplied item that prunes the recipe tree downstream. When the solver
 * encounters demand for an input's item, it satisfies as much as possible
 * from the input's pool BEFORE recursing into a recipe — so a fully-covered
 * demand never invokes the producer.
 */
export interface Input {
  item: string
  rate: number // items/sec available
}

export interface FlowNode {
  id: string // recipe key (or "source:<item>" for un-craftable inputs)
  recipe?: Recipe
  machine?: Machine
  rate: number // crafts/sec (for recipes) or items/sec (for sources)
  count: number // # machines required
  powerW: number // total power draw (watts)
}

export interface FlowEdge {
  source: string // node id
  target: string // node id ("output:<item>" for final outputs)
  item: string
  rate: number // items/sec
}

export interface FlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
  /** Totals keyed by item for raw inputs (source: nodes). */
  rawInputs: Map<string, number>
  /** Totals keyed by item that came from user-supplied Inputs (input: nodes). */
  suppliedInputs: Map<string, number>
  /** Totals keyed by item for final outputs (matches the input targets). */
  outputs: Map<string, number>
  /** Sum of node powerW. */
  totalPowerW: number
}

const RAW_ITEMS = new Set([
  "iron-ore",
  "copper-ore",
  "coal",
  "stone",
  "uranium-ore",
  "crude-oil",
  "water",
  "wood",
  "raw-fish",
  "calcite",
  "tungsten-ore",
  "lithium-brine",
  "fluorine",
  "scrap",
  "holmium-ore",
])

/**
 * Recycling recipes (Space Age) destroy items for partial component
 * recovery. They shouldn't be picked as a producer for normal item
 * demand. Filter them by category or key suffix.
 */
export function isRecyclingRecipe(r: Recipe): boolean {
  return r.category === "recycling" || r.key.endsWith("-recycling")
}

export function pickRecipe(
  catalog: Catalog,
  item: string,
  choices: Record<string, string> = {},
): Recipe | undefined {
  const all = catalog.recipesByProduct.get(item) ?? []
  // User-pinned choice wins (even if it's a recycling recipe — user knows
  // what they're doing).
  const chosenKey = choices[item]
  if (chosenKey) {
    const chosen = all.find((r) => r.key === chosenKey)
    if (chosen) return chosen
  }
  // Filter out recycling recipes from default selection.
  const candidates = all.filter((r) => !isRecyclingRecipe(r))
  return candidates.find((r) => r.key === item) ?? candidates[0] ?? all[0]
}

export function pickMachine(
  catalog: Catalog,
  recipe: Recipe,
  overrides: Record<string, string> = {},
  categoryDefaults: Record<string, string> = {},
): Machine | undefined {
  // 1. Per-recipe override always wins.
  const overrideKey = overrides[recipe.key]
  if (overrideKey) {
    const m = catalog.machines.get(overrideKey)
    if (m) return m
  }
  // 2. Per-category default (so "use Assembler 1 for everything crafting"
  //    works without pinning each recipe).
  const categoryKey = categoryDefaults[recipe.category]
  if (categoryKey) {
    const m = catalog.machines.get(categoryKey)
    if (m && m.craftingCategories.has(recipe.category)) return m
  }
  // 3. Fallback: fastest machine in the category.
  const candidates = catalog.machinesByCategory.get(recipe.category) ?? []
  if (candidates.length === 0) return undefined
  return [...candidates].sort((a, b) => b.craftingSpeed - a.craftingSpeed)[0]
}

/**
 * Full sorted candidate list for a UI machine picker. Mirrors `pickMachine`'s
 * precedence so the "selected" element is always index 0:
 *   1. Per-recipe override (if present and known to the catalog) goes first.
 *   2. Per-category default (if present) goes next.
 *   3. Remaining category machines sorted by craftingSpeed descending.
 * No duplicates: a machine that's already been promoted to the head isn't
 * repeated in the tail.
 */
export function pickMachineCandidates(
  catalog: Catalog,
  recipe: Recipe,
  overrides: Record<string, string> = {},
  categoryDefaults: Record<string, string> = {},
): Machine[] {
  const all = catalog.machinesByCategory.get(recipe.category) ?? []
  const sorted = [...all].sort((a, b) => b.craftingSpeed - a.craftingSpeed)
  const result: Machine[] = []
  const seen = new Set<string>()
  const push = (m: Machine | undefined) => {
    if (!m || seen.has(m.key)) return
    seen.add(m.key)
    result.push(m)
  }
  const overrideKey = overrides[recipe.key]
  if (overrideKey) {
    const m = catalog.machines.get(overrideKey)
    if (m) push(m)
  }
  const categoryKey = categoryDefaults[recipe.category]
  if (categoryKey) {
    const m = catalog.machines.get(categoryKey)
    if (m && m.craftingCategories.has(recipe.category)) push(m)
  }
  for (const m of sorted) push(m)
  return result
}

export function expand(
  catalog: Catalog,
  targets: Target[],
  inputs: Input[] = [],
  machineOverrides: Record<string, string> = {},
  recipeChoices: Record<string, string> = {},
  machineCategoryDefaults: Record<string, string> = {},
): FlowGraph {
  const nodes = new Map<string, FlowNode>()
  const edges: FlowEdge[] = []
  // Each unique (source, target, item) triple maps to ONE edge in `edges`.
  // Without dedup, a producer reached multiple times pushes a fresh edge per
  // visit; balanceCeil then sums those as separate demands and over-builds
  // upstream by 2-5×. Keying lets us accumulate rate onto a single edge.
  const edgeKey = (src: string, tgt: string, item: string) => `${src}|${tgt}|${item}`
  const edgeByKey = new Map<string, FlowEdge>()
  const addEdge = (source: string, target: string, item: string, rate: number) => {
    const key = edgeKey(source, target, item)
    const ex = edgeByKey.get(key)
    if (ex) {
      ex.rate += rate
    } else {
      const e: FlowEdge = { source, target, item, rate }
      edgeByKey.set(key, e)
      edges.push(e)
    }
  }
  const outputs = new Map<string, number>()
  const rawInputs = new Map<string, number>()
  const suppliedInputs = new Map<string, number>()

  // Supply pool — drained as demand is satisfied. When fully drained for
  // an item, demand falls through to the producer recipe.
  const supply = new Map<string, number>()
  for (const inp of inputs) {
    if (inp.rate <= 0) continue
    supply.set(inp.item, (supply.get(inp.item) ?? 0) + inp.rate)
  }

  type Demand = {
    item: string
    rate: number
    parent: string | null
    // Ancestor recipe IDs on the chain from a target down to this demand.
    // Used to detect cycles (e.g. spoilage feedback loops in Space Age).
    path: ReadonlyArray<string>
  }
  const queue: Demand[] = []
  for (const t of targets) {
    if (t.rate <= 0) continue
    outputs.set(t.item, (outputs.get(t.item) ?? 0) + t.rate)
    const outId = `output:${t.item}`
    // Synthetic sink node so sankey layout has a valid target for output edges.
    const existing = nodes.get(outId)
    if (existing) existing.rate += t.rate
    else nodes.set(outId, { id: outId, rate: t.rate, count: 0, powerW: 0 })
    queue.push({ item: t.item, rate: t.rate, parent: outId, path: [] })
  }

  // Safety bound on total work — well above realistic factory sizes; protects
  // against pathological dataset bugs without truncating legitimate graphs.
  let safety = 0
  const MAX_ITER = 100_000

  while (queue.length && safety++ < MAX_ITER) {
    const d = queue.shift()!

    // 0. Supply-pool: satisfy as much as we can from user-supplied inputs.
    // Whatever's left after deduction continues to the recipe expansion.
    let remaining = d.rate
    const available = supply.get(d.item) ?? 0
    if (available > 0) {
      const used = Math.min(available, remaining)
      supply.set(d.item, available - used)
      remaining -= used
      // Emit an input: leaf node + edge for the supplied portion so the
      // graph still has a valid source for sankey/schematic rendering.
      const inId = `input:${d.item}`
      const inNode = nodes.get(inId) ?? { id: inId, rate: 0, count: 0, powerW: 0 }
      inNode.rate += used
      nodes.set(inId, inNode)
      suppliedInputs.set(d.item, (suppliedInputs.get(d.item) ?? 0) + used)
      if (d.parent) addEdge(inId, d.parent, d.item, used)
      if (remaining <= 1e-9) continue
    }

    // Shadow the demand with the residual so the rest of the loop treats
    // `d.rate` as the unmet portion. We don't mutate `d` directly — keep
    // the original safe in case we ever need it for debugging.
    const residualRate = remaining
    const recipe = RAW_ITEMS.has(d.item) ? undefined : pickRecipe(catalog, d.item, recipeChoices)

    if (!recipe) {
      const id = `source:${d.item}`
      const node = nodes.get(id) ?? { id, rate: 0, count: 0, powerW: 0 }
      node.rate += residualRate
      nodes.set(id, node)
      rawInputs.set(d.item, (rawInputs.get(d.item) ?? 0) + residualRate)
      if (d.parent) addEdge(id, d.parent, d.item, residualRate)
      continue
    }

    const id = recipe.key
    const product = recipe.products.find((p) => p.item === d.item)
    if (!product || product.amount === 0) continue
    const machine = pickMachine(catalog, recipe, machineOverrides, machineCategoryDefaults)
    // Productivity: built-in prodBonus on machines (electromagnetic-plant
    // = +50%, foundry = +50%) multiplies effective output per craft.
    // Ingredients are NOT consumed at a higher rate, only outputs go up.
    const existingNode = nodes.get(id)
    const prodMult = (existingNode?.machine ?? machine)
      ? 1 + ((existingNode?.machine ?? machine)!.prodBonus ?? 0)
      : 1
    const craftsPerSec = residualRate / (product.amount * prodMult)

    if (existingNode) {
      existingNode.rate += craftsPerSec
      if (existingNode.machine) {
        existingNode.count = (existingNode.rate * recipe.time) / existingNode.machine.craftingSpeed
        existingNode.powerW = existingNode.count * existingNode.machine.power
      }
    } else {
      const count = machine ? (craftsPerSec * recipe.time) / machine.craftingSpeed : 0
      const powerW = machine ? count * machine.power : 0
      nodes.set(id, { id, recipe, machine, rate: craftsPerSec, count, powerW })
    }
    if (d.parent) addEdge(id, d.parent, d.item, residualRate)

    // Cycle detection: if this recipe already appears on the ancestor chain
    // (e.g. spoilage → bioflux → spoilage), record the node/edge but do not
    // recurse — propagating ingredients further would multiply demand
    // unboundedly. A full fix requires linear-system solving (future work).
    if (d.path.includes(id)) continue
    const nextPath = [...d.path, id]
    for (const ing of recipe.ingredients) {
      queue.push({ item: ing.item, rate: craftsPerSec * ing.amount, parent: id, path: nextPath })
    }
  }

  // Ceil-balance pass: the solve above is mathematically exact in
  // fractional crafts/sec, but the schematic builds REAL factories with
  // whole machines (each producer rounded UP to the next integer). When a
  // consumer rounds up, its actual demand exceeds the producer's
  // fractional supply — creating a deficit in the built factory. We patch
  // this by iterating: ceil every recipe's count, recompute its
  // crafts/sec, propagate up the chain. Always round UP, never DOWN, so
  // the result is "surplus allowed, deficits never".
  const flowNodes = [...nodes.values()]
  balanceCeil(flowNodes, edges)

  let totalPowerW = 0
  for (const n of flowNodes) totalPowerW += n.powerW

  return { nodes: flowNodes, edges, rawInputs, suppliedInputs, outputs, totalPowerW }
}

/**
 * Bump every recipe's machine count up to the next integer and propagate
 * the resulting extra demand back through the chain until stable. Touches
 * `node.rate`, `node.count`, `node.powerW`, and `edge.rate` in place.
 *
 * Converges quickly in practice (a few passes for most factories), but we
 * cap at 25 iterations to defend against pathological loops.
 */
function balanceCeil(
  nodes: ReadonlyArray<FlowNode>,
  edges: FlowEdge[],
): void {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  for (let iter = 0; iter < 25; iter++) {
    let changed = false

    // Step 1 — ceil each recipe's machine count to the next whole machine,
    // then sync the node's rate from the new count.
    for (const node of nodes) {
      if (!node.recipe || !node.machine) continue
      const ceiled = Math.max(1, Math.ceil(node.count - 1e-9))
      if (ceiled > node.count + 1e-9) {
        node.count = ceiled
        node.rate = (ceiled * node.machine.craftingSpeed) / node.recipe.time
        node.powerW = ceiled * node.machine.power
        changed = true
      }
    }

    // Step 2 — recompute every edge's rate based on its CONSUMER's new
    // (possibly higher) crafts/sec. The edge's `rate` is the consumer's
    // demand for the edge's item.
    for (const edge of edges) {
      const consumer = nodeById.get(edge.target)
      if (!consumer || !consumer.recipe) continue
      const ing = consumer.recipe.ingredients.find((i) => i.item === edge.item)
      if (!ing) continue
      const newDemand = ing.amount * consumer.rate
      if (newDemand > edge.rate + 1e-9) {
        edge.rate = newDemand
        changed = true
      }
    }

    // Step 3 — for each item, total the edges' demands and bump the
    // producer's rate UP if the demand now exceeds what its current
    // (fractional) rate produces. This propagates extra demand upstream
    // through the chain.
    const demandByItem = new Map<string, number>()
    for (const e of edges) {
      demandByItem.set(e.item, (demandByItem.get(e.item) ?? 0) + e.rate)
    }
    for (const node of nodes) {
      if (!node.recipe || !node.machine) continue
      const prodMult = 1 + (node.machine.prodBonus ?? 0)
      for (const product of node.recipe.products) {
        if (product.amount <= 0) continue
        const demand = demandByItem.get(product.item) ?? 0
        if (demand <= 0) continue
        // Effective per-craft output = amount × (1 + prodBonus). Without
        // this, prod-bonus machines (EM-plant, foundry) get sized as if
        // they had vanilla output and end up ×1.5 over-built.
        const requiredCrafts = demand / (product.amount * prodMult)
        // Monotonic — never let an iteration lower the rate. Belt-and-suspenders
        // with the > guard above, but explicit so future edits don't break it.
        const newRate = Math.max(node.rate, requiredCrafts)
        if (newRate > node.rate + 1e-9) {
          node.rate = newRate
          node.count = (newRate * node.recipe.time) / node.machine.craftingSpeed
          node.powerW = node.count * node.machine.power
          changed = true
        }
      }
    }

    if (!changed) break
  }
}
