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

function pickRecipe(catalog: Catalog, item: string): Recipe | undefined {
  const candidates = catalog.recipesByProduct.get(item) ?? []
  return candidates.find((r) => r.key === item) ?? candidates[0]
}

function pickMachine(catalog: Catalog, recipe: Recipe): Machine | undefined {
  const candidates = catalog.machinesByCategory.get(recipe.category) ?? []
  if (candidates.length === 0) return undefined
  return [...candidates].sort((a, b) => b.craftingSpeed - a.craftingSpeed)[0]
}

export function expand(
  catalog: Catalog,
  targets: Target[],
  inputs: Input[] = [],
): FlowGraph {
  const nodes = new Map<string, FlowNode>()
  const edges: FlowEdge[] = []
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
      if (d.parent) edges.push({ source: inId, target: d.parent, item: d.item, rate: used })
      if (remaining <= 1e-9) continue
    }

    // Shadow the demand with the residual so the rest of the loop treats
    // `d.rate` as the unmet portion. We don't mutate `d` directly — keep
    // the original safe in case we ever need it for debugging.
    const residualRate = remaining
    const recipe = RAW_ITEMS.has(d.item) ? undefined : pickRecipe(catalog, d.item)

    if (!recipe) {
      const id = `source:${d.item}`
      const node = nodes.get(id) ?? { id, rate: 0, count: 0, powerW: 0 }
      node.rate += residualRate
      nodes.set(id, node)
      rawInputs.set(d.item, (rawInputs.get(d.item) ?? 0) + residualRate)
      if (d.parent) edges.push({ source: id, target: d.parent, item: d.item, rate: residualRate })
      continue
    }

    const id = recipe.key
    const product = recipe.products.find((p) => p.item === d.item)
    if (!product || product.amount === 0) continue
    const craftsPerSec = residualRate / product.amount
    const machine = pickMachine(catalog, recipe)

    const existing = nodes.get(id)
    if (existing) {
      existing.rate += craftsPerSec
      if (existing.machine) {
        existing.count = (existing.rate * recipe.time) / existing.machine.craftingSpeed
        existing.powerW = existing.count * existing.machine.power
      }
      if (d.parent) edges.push({ source: id, target: d.parent, item: d.item, rate: residualRate })
    } else {
      const count = machine ? (craftsPerSec * recipe.time) / machine.craftingSpeed : 0
      const powerW = machine ? count * machine.power : 0
      nodes.set(id, { id, recipe, machine, rate: craftsPerSec, count, powerW })
      if (d.parent) edges.push({ source: id, target: d.parent, item: d.item, rate: residualRate })
    }

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

  let totalPowerW = 0
  for (const n of nodes.values()) totalPowerW += n.powerW

  return { nodes: [...nodes.values()], edges, rawInputs, suppliedInputs, outputs, totalPowerW }
}
