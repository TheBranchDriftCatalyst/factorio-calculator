// Iterative annealing over bus-side assignments.
//
// The auto-bus algorithm picks which bus column each item rides on
// (left, right, L2, R2). v0 used a static heuristic (heavy → L2,
// everything else default). v1 (this module) iteratively refines the
// assignment by running the real busLayout pipeline, scoring the
// result, and perturbing one item at a time — accepting moves that
// improve the score and occasionally accepting worse moves to escape
// local minima (classic simulated annealing).
//
// Score: total HORIZONTAL distance from every cell port to the belt
// column it taps. Lower = tighter taps, fewer crossings, more readable
// layout. The cost function lives here (not cost.ts) because cost.ts
// scores cell ORDER along Y; this scores bus PLACEMENT along X.
//
// Determinism: a seeded LCG RNG produces the same trajectory for the
// same input every time. Tests and replays don't drift.

import type { Catalog } from "../../factorio"
import type { FlowGraph } from "../../solver/expand"
import type { LayoutConfig } from "../../views/schematic/SchematicConfig"
import type { Blueprint } from "../types"
import { busLayout } from "./busLayout"

/**
 * Maximum bus columns per direction the annealer will EVER consider.
 * Caps the search space so a runaway sim can't propose absurd column
 * counts. 5 is plenty — even a huge factory rarely benefits from more
 * than 3-4 parallel buses per direction.
 */
const MAX_COLUMNS_PER_DIRECTION = 5

/**
 * Build the candidate side list at this iteration. The algorithm is
 * FREE to invent new buses (L3, L4, R3, R4, …) — they just exist in the
 * assignment dict and busLayout's column allocator handles them.
 *
 * Strategy: include every side currently in use, plus ONE new column
 * in each direction (the next unused L# and R#). Capped at MAX.
 */
function candidateSides(current: Record<string, string>): string[] {
  const inUse = new Set<string>(["left", "right"])
  for (const side of Object.values(current)) inUse.add(side)
  // Find the next unused L# / R# to make available.
  const nextLeft = nextUnused("L", inUse)
  const nextRight = nextUnused("R", inUse)
  const result = [...inUse]
  if (nextLeft) result.push(nextLeft)
  if (nextRight) result.push(nextRight)
  return result
}

/**
 * `prefix` is "L" or "R". Walks L2/L3/L4 (or R2/R3/…) and returns the
 * first unused id, or null if we've hit the cap.
 */
function nextUnused(prefix: "L" | "R", inUse: ReadonlySet<string>): string | null {
  for (let n = 2; n <= MAX_COLUMNS_PER_DIRECTION; n++) {
    const id = `${prefix}${n}`
    if (!inUse.has(id)) return id
  }
  return null
}

/**
 * Sum of |port.beltX − cell.x_center| across every cell port in the
 * blueprint. The smaller, the tighter — long horizontal stubs cost
 * more than short ones.
 *
 * Pure function over a finished Blueprint — call after running
 * busLayout.
 */
export function scoreBlueprint(bp: Blueprint): number {
  let total = 0
  for (const cell of bp.cells) {
    const cellCenter = cell.x + cell.w / 2
    for (const port of cell.inputs) total += Math.abs(port.beltX - cellCenter)
    for (const port of cell.outputs) total += Math.abs(port.beltX - cellCenter)
  }
  return total
}

/**
 * Cheap seedable LCG RNG. Deterministic across runs so the annealing
 * trajectory is reproducible — critical for tests and for the user
 * not seeing a different layout every refresh.
 */
function makeRng(seed: number): () => number {
  let s = seed | 0 || 1
  return () => {
    // Numerical Recipes LCG — small, fast, plenty good for picking
    // perturbation targets.
    s = (s * 1664525 + 1013904223) | 0
    return ((s >>> 0) % 0x7fffffff) / 0x7fffffff
  }
}

/**
 * Seed derived from the flow's structure — same targets+inputs+overrides
 * always produce the same RNG sequence. String-hashed to a 32-bit int.
 */
function seedFromFlow(flow: FlowGraph): number {
  let h = 2166136261
  // Use the recipe node ids — stable across runs for the same flow.
  for (const n of flow.nodes) {
    if (!n.recipe) continue
    for (const c of n.id) h = ((h ^ c.charCodeAt(0)) * 16777619) | 0
  }
  return h | 0
}

export interface AnnealResult {
  /** The best assignments found in the search. */
  assignments: Record<string, string>
  /** The blueprint that produced them. */
  blueprint: Blueprint
  /** Total tap-distance score of the best blueprint. */
  score: number
  /** Number of iterations actually run before convergence / budget. */
  iterations: number
  /** Score history for debugging / visualization (per accepted move). */
  history: number[]
}

interface AnnealOptions {
  /** Maximum iterations. Defaults to 50. */
  iterations?: number
  /** Initial temperature. Defaults to a fraction of the initial score. */
  initialTemperature?: number
  /** Cooling factor per iteration. Defaults to 0.95. */
  cooling?: number
  /**
   * Stop if no improvement for this many consecutive iterations.
   * Default: 15. Smaller = faster, more risk of leaving cycles short.
   */
  patience?: number
}

/**
 * Annealing search. Runs `busLayout` repeatedly with perturbed
 * assignments and returns the best-found.
 *
 * `assignableItems` is the set of items the algorithm is allowed to
 * place. Items not in this set keep their default placement (the
 * busLayout's own choice). Restricting which items are subject to the
 * search keeps the state space small for big factories.
 */
export function annealAssignments(
  catalog: Catalog,
  flow: FlowGraph,
  baseOpts: Partial<LayoutConfig>,
  assignableItems: ReadonlySet<string>,
  annealOpts: AnnealOptions = {},
): AnnealResult {
  const iterations = annealOpts.iterations ?? 50
  const cooling = annealOpts.cooling ?? 0.95
  const patience = annealOpts.patience ?? 15
  const rng = makeRng(seedFromFlow(flow))

  const items = [...assignableItems]
  if (items.length === 0) {
    // Nothing to assign — return the layout as-is.
    const bp = busLayout(catalog, flow, baseOpts)
    return {
      assignments: { ...(baseOpts.beltAssignments ?? {}) },
      blueprint: bp,
      score: scoreBlueprint(bp),
      iterations: 0,
      history: [scoreBlueprint(bp)],
    }
  }

  // Start with whatever the caller pinned (commonly empty).
  let current: Record<string, string> = { ...(baseOpts.beltAssignments ?? {}) }
  let currentBp = busLayout(catalog, flow, { ...baseOpts, beltAssignments: current })
  let currentScore = scoreBlueprint(currentBp)

  let best = current
  let bestBp = currentBp
  let bestScore = currentScore
  const history: number[] = [currentScore]

  // Initial temperature scaled to the starting score so it's relative
  // to factory size — small factories use small temperatures, big use big.
  let temp = annealOpts.initialTemperature ?? Math.max(1, currentScore * 0.05)
  let sinceImprovement = 0
  let i = 0

  for (; i < iterations; i++) {
    // Perturb: pick one item, flip to a random different side.
    // Candidate side list is REGENERATED each iteration — that lets the
    // algorithm spawn entirely new buses (L3, L4, R3, …) as it sees fit.
    // The cost function naturally penalizes too many columns (wider
    // blueprint = larger horizontal taps for unrelated items), so the
    // search self-limits without a hardcoded column cap on assignments.
    const item = items[Math.floor(rng() * items.length)]
    const currentSide = current[item] ?? "left"
    const candidates = candidateSides(current).filter((s) => s !== currentSide)
    if (candidates.length === 0) break // nothing to flip to (rare)
    const nextSide = candidates[Math.floor(rng() * candidates.length)]

    const candidate: Record<string, string> = { ...current, [item]: nextSide }
    const candidateBp = busLayout(catalog, flow, {
      ...baseOpts,
      beltAssignments: candidate,
    })
    const candidateScore = scoreBlueprint(candidateBp)

    const delta = candidateScore - currentScore
    const accept = delta < 0 || rng() < Math.exp(-delta / temp)

    if (accept) {
      current = candidate
      currentBp = candidateBp
      currentScore = candidateScore
      history.push(currentScore)
      if (currentScore < bestScore) {
        best = current
        bestBp = currentBp
        bestScore = currentScore
        sinceImprovement = 0
      } else {
        sinceImprovement++
      }
    } else {
      sinceImprovement++
    }

    if (sinceImprovement >= patience) break
    temp *= cooling
  }

  return {
    assignments: best,
    blueprint: bestBp,
    score: bestScore,
    iterations: i,
    history,
  }
}
