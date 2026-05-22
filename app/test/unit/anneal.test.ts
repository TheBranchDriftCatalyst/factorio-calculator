import { describe, it, expect } from "vitest"
import { loadCatalog } from "../../src/factorio"
import { expand } from "../../src/solver/expand"
import {
  scoreBlueprint,
  annealAssignments,
} from "../../src/blueprint/layout/anneal"
import {
  computeAutoBusAssignments,
  autoBusLayout,
} from "../../src/blueprint/layout/autoBus"
import { busLayout } from "../../src/blueprint/layout/busLayout"
import { miniDataset } from "../fixtures/mini-dataset"

const catalog = loadCatalog(miniDataset)

describe("anneal · scoreBlueprint", () => {
  it("returns 0 for a blueprint with no cells", () => {
    // A flow with no recipe nodes — empty blueprint, zero cost.
    const flow = expand({ catalog, targets: [] })
    const bp = busLayout(catalog, flow, {})
    expect(scoreBlueprint(bp)).toBe(0)
  })

  it("scores roughly proportional to total tap distance", () => {
    // Simple smoke: a real factory has cells with ports tapping belts
    // at non-zero distances → score > 0.
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = busLayout(catalog, flow, {})
    const score = scoreBlueprint(bp)
    expect(score).toBeGreaterThan(0)
    // Sanity: it should be on the order of (cell count × belt width).
    expect(score).toBeLessThan(bp.cells.length * 100)
  })
})

describe("anneal · annealAssignments", () => {
  it("returns an unchanged blueprint when assignableItems is empty", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const baseline = busLayout(catalog, flow, {})
    const result = annealAssignments(catalog, flow, {}, new Set(), {})
    expect(result.iterations).toBe(0)
    expect(result.blueprint.cells.length).toBe(baseline.cells.length)
  })

  it("never returns a worse score than the starting state", () => {
    // The annealer always tracks best-found; even if every iteration
    // makes things worse, the returned score must be ≤ initial.
    const flow = expand({
      catalog,
      targets: [
        { item: "electronic-circuit", rate: 1 },
        { item: "copper-cable", rate: 6 },
        { item: "iron-plate", rate: 2 },
      ],
    })
    const v0 = computeAutoBusAssignments(flow, 3) // low threshold → flag items
    const initialBp = busLayout(catalog, flow, { beltAssignments: v0 })
    const initialScore = scoreBlueprint(initialBp)
    const result = annealAssignments(
      catalog,
      flow,
      { beltAssignments: v0 },
      new Set(Object.keys(v0)),
      { iterations: 20 },
    )
    expect(result.score).toBeLessThanOrEqual(initialScore)
  })

  it("is deterministic across runs with the same flow", () => {
    // Same input → same assignments (seeded RNG).
    const flow = expand({
      catalog,
      targets: [
        { item: "electronic-circuit", rate: 1 },
        { item: "copper-cable", rate: 6 },
        { item: "iron-plate", rate: 2 },
      ],
    })
    const v0 = computeAutoBusAssignments(flow, 3)
    const assignable = new Set(Object.keys(v0))
    const r1 = annealAssignments(catalog, flow, { beltAssignments: v0 }, assignable, {
      iterations: 30,
    })
    const r2 = annealAssignments(catalog, flow, { beltAssignments: v0 }, assignable, {
      iterations: 30,
    })
    expect(r1.score).toBe(r2.score)
    expect(r1.assignments).toEqual(r2.assignments)
  })

  it("only uses valid side identifiers (left/right/L#/R#)", () => {
    // Whatever the annealer produces, the side strings must be
    // recognizable by busLayout's column allocator. No garbage strings.
    const flow = expand({
      catalog,
      targets: [
        { item: "electronic-circuit", rate: 5 },
        { item: "copper-cable", rate: 30 },
      ],
    })
    // Force assignable items to include some explicit candidates even
    // when v0 wouldn't flag them on this small fixture.
    const seedAssignments = { "iron-plate": "left", "copper-plate": "left" }
    const result = annealAssignments(
      catalog,
      flow,
      { beltAssignments: seedAssignments },
      new Set(Object.keys(seedAssignments)),
      { iterations: 50 },
    )
    const validPattern = /^(left|right|L\d+|R\d+)$/
    for (const side of Object.values(result.assignments)) {
      expect(side).toMatch(validPattern)
    }
  })

  it("respects iteration budget", () => {
    const flow = expand({
      catalog,
      targets: [
        { item: "electronic-circuit", rate: 1 },
        { item: "copper-cable", rate: 6 },
      ],
    })
    const v0 = computeAutoBusAssignments(flow, 3)
    const result = annealAssignments(
      catalog,
      flow,
      { beltAssignments: v0 },
      new Set(Object.keys(v0)),
      { iterations: 5, patience: 100 }, // patience high so we don't early-stop
    )
    // Either we used all 5 iterations OR the algorithm short-circuited
    // (no improvement room left). Both are correct behavior.
    expect(result.iterations).toBeLessThanOrEqual(5)
  })
})

describe("autoBusLayout · v1 (annealing) integration", () => {
  it("returns a valid Blueprint with effort > 0", () => {
    const flow = expand({
      catalog,
      targets: [
        { item: "electronic-circuit", rate: 1 },
        { item: "copper-cable", rate: 6 },
      ],
    })
    const bp = autoBusLayout(catalog, flow, {
      heavyConsumerThreshold: 3,
      layoutEffort: 20,
    })
    expect(bp.cells.length).toBeGreaterThan(0)
    expect(bp.width).toBeGreaterThan(0)
    expect(bp.height).toBeGreaterThan(0)
  })

  it("falls back to v0 when effort = 0", () => {
    // Effort 0 = no annealing, deterministic v0 heuristic.
    const flow = expand({
      catalog,
      targets: [{ item: "electronic-circuit", rate: 1 }],
    })
    const bp = autoBusLayout(catalog, flow, { layoutEffort: 0 })
    expect(bp.cells.length).toBeGreaterThan(0)
  })
})
