// Pure cost-function module for layout ordering.
//
// The flow graph is a DAG. Within a scope, cells are stacked vertically
// inside one column; each cell's input belt extends from the scope's top
// down to the cell that reads it. The longer that belt's vertical span,
// the more belt tiles, more crossings, more visual noise. So a "good"
// ordering of cells minimizes the total vertical span of every shared
// input across its consumers.
//
// This module is purposely UI- and busLayout-agnostic — it operates on
// abstract cell nodes (id + inputs + in-scope producers). The same cost
// function will later be used at a higher level by fbp-haq (auto bus
// splitting) — where it measures global tap distance over candidate
// per-item bus partitions, not per-cluster cell ordering.

/**
 * One node in the cost-function world. Just enough to compute tap
 * distance and respect topological constraints.
 */
export interface CostNode {
  /** Stable id (recipeKey in busLayout's usage). */
  id: string
  /** Items this cell consumes. */
  inputs: ReadonlySet<string>
  /**
   * IDs of OTHER cells IN THIS SCOPE that produce something this cell
   * consumes. The reorder algorithm guarantees these appear earlier in
   * the output. Producers OUTSIDE the scope (raw items, ancestor-scope
   * sources) are not listed — they don't constrain ordering here.
   */
  producers: ReadonlySet<string>
}

/**
 * Total vertical span of every shared input across an ordering. For each
 * item consumed by ≥2 cells, span = (last position − first position).
 * Items consumed by ≤1 cell contribute 0 (one consumer = no span).
 *
 * Lower is better. The algorithm minimizes this number; the metric is
 * also exposed so regression tests can assert the heuristic does in
 * fact reduce it.
 */
export function tapDistanceCost(
  order: ReadonlyArray<string>,
  nodes: ReadonlyMap<string, CostNode>,
): number {
  // positionsByItem: item key → ordered indices where it's consumed.
  const positionsByItem = new Map<string, number[]>()
  for (let i = 0; i < order.length; i++) {
    const node = nodes.get(order[i])
    if (!node) continue
    for (const item of node.inputs) {
      let arr = positionsByItem.get(item)
      if (!arr) {
        arr = []
        positionsByItem.set(item, arr)
      }
      arr.push(i)
    }
  }
  let total = 0
  for (const positions of positionsByItem.values()) {
    if (positions.length < 2) continue
    // positions[] is built in increasing-i order, so last - first works.
    total += positions[positions.length - 1] - positions[0]
  }
  return total
}

/**
 * Jaccard similarity of two input sets — 0 when disjoint, 1 when equal.
 * The greedy nearest-neighbor heuristic uses this to pick the next cell
 * most "like" the just-placed one.
 */
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersect = 0
  // Iterate the smaller set to do fewer lookups.
  const [small, large] = a.size < b.size ? [a, b] : [b, a]
  for (const x of small) if (large.has(x)) intersect++
  const union = a.size + b.size - intersect
  return union === 0 ? 0 : intersect / union
}

/**
 * Greedy nearest-neighbor ordering respecting topological constraints:
 *   1. Compute "available" = nodes with no remaining in-scope producer.
 *   2. First pick = topologically-first available node (tiebreak: input order).
 *   3. Every subsequent pick = the available node with highest Jaccard
 *      similarity to the previously-placed one.
 *   4. Tiebreak again by input order so the output is deterministic.
 *
 * Worst case O(n²) — fine for typical scope sizes (< 100 cells).
 */
function greedyOrder(nodes: ReadonlyArray<CostNode>): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const inputIndex = new Map(nodes.map((n, i) => [n.id, i]))
  const placed: string[] = []
  const placedSet = new Set<string>()
  const remaining = new Set(nodes.map((n) => n.id))

  while (remaining.size > 0) {
    // Available: all in-scope producers already placed (or out-of-scope).
    const available: string[] = []
    for (const id of remaining) {
      const node = byId.get(id)!
      let ok = true
      for (const p of node.producers) {
        if (remaining.has(p)) {
          ok = false
          break
        }
      }
      if (ok) available.push(id)
    }
    if (available.length === 0) {
      // Cycle in the in-scope graph — shouldn't happen post-solver, but
      // bail gracefully by emitting remaining in input order.
      for (const id of nodes.map((n) => n.id)) {
        if (remaining.has(id)) {
          placed.push(id)
          placedSet.add(id)
          remaining.delete(id)
        }
      }
      break
    }

    let next: string
    if (placed.length === 0) {
      // Tiebreak by input order for determinism.
      next = available.reduce((best, id) =>
        (inputIndex.get(id) ?? Infinity) < (inputIndex.get(best) ?? Infinity) ? id : best,
      )
    } else {
      const prev = byId.get(placed[placed.length - 1])!
      let bestSim = -Infinity
      let bestId = available[0]
      let bestIdx = inputIndex.get(bestId) ?? Infinity
      for (const id of available) {
        const cand = byId.get(id)!
        const sim = jaccard(prev.inputs, cand.inputs)
        const idx = inputIndex.get(id) ?? Infinity
        // Higher similarity wins; on tie, earlier input position wins.
        if (sim > bestSim || (sim === bestSim && idx < bestIdx)) {
          bestSim = sim
          bestId = id
          bestIdx = idx
        }
      }
      next = bestId
    }
    placed.push(next)
    placedSet.add(next)
    remaining.delete(next)
  }
  return placed
}

/**
 * 2-opt local polish: for every (i, j) pair, try swapping order[i] and
 * order[j]. Accept the swap if it's topologically valid AND reduces
 * total cost. Repeat until no swap improves. Capped at a small number
 * of full passes — converges fast in practice for the < 100-cell scopes
 * we see.
 */
function twoOptPolish(
  initial: ReadonlyArray<string>,
  nodes: ReadonlyMap<string, CostNode>,
): string[] {
  let current: string[] = [...initial]
  let bestCost = tapDistanceCost(current, nodes)
  const maxPasses = 5
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false
    for (let i = 0; i < current.length - 1; i++) {
      for (let j = i + 1; j < current.length; j++) {
        if (!swapPreservesTopology(current, i, j, nodes)) continue
        const next = current.slice()
        const tmp = next[i]
        next[i] = next[j]
        next[j] = tmp
        const cost = tapDistanceCost(next, nodes)
        if (cost < bestCost) {
          current = next
          bestCost = cost
          improved = true
        }
      }
    }
    if (!improved) break
  }
  return current
}

/**
 * Check whether swapping positions i and j in `order` would still leave
 * a topologically valid sequence: every node's in-scope producers must
 * still appear before it.
 */
function swapPreservesTopology(
  order: ReadonlyArray<string>,
  i: number,
  j: number,
  nodes: ReadonlyMap<string, CostNode>,
): boolean {
  // Build the swapped sequence and walk it; cheap for the scope sizes
  // we deal with. Could be optimized to only inspect the slice [i..j],
  // but the full walk keeps the check obviously correct.
  const swapped: string[] = order.slice()
  const tmp = swapped[i]
  swapped[i] = swapped[j]
  swapped[j] = tmp
  const seen = new Set<string>()
  for (const id of swapped) {
    const node = nodes.get(id)
    if (!node) continue
    for (const p of node.producers) {
      // Only in-scope producers constrain ordering. If `p` exists in
      // `nodes`, it must already be seen.
      if (nodes.has(p) && !seen.has(p)) return false
    }
    seen.add(id)
  }
  return true
}

/**
 * Public entry point: order a scope's nodes to minimize tap distance,
 * preserving topological constraints. Greedy seed + 2-opt polish.
 */
export function orderByTapDistance(nodes: ReadonlyArray<CostNode>): string[] {
  if (nodes.length <= 1) return nodes.map((n) => n.id)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const seed = greedyOrder(nodes)
  return twoOptPolish(seed, byId)
}
