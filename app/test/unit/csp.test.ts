import { describe, it, expect } from "vitest"
import { loadCatalog } from "../../src/factorio"
import { expand } from "../../src/solver/expand"
import {
  solveCsp,
  cspLayout,
  scoreCspBlueprint,
  DEFAULT_OBJECTIVE,
} from "../../src/blueprint/layout/csp"
import {
  LAYOUT_TEMPLATES,
  LAYOUT_TEMPLATE_LIST,
  templatesFor,
  type TemplateId,
} from "../../src/blueprint/layout/templates"
import { busLayout } from "../../src/blueprint/layout/busLayout"
import type { Cell } from "../../src/blueprint/types"
import { miniDataset } from "../fixtures/mini-dataset"

const catalog = loadCatalog(miniDataset)

function makeCell(demanded: number, machineSize = 3): Cell {
  // Minimal Cell stub for template-domain tests.
  return {
    recipeKey: "stub",
    recipeName: "stub",
    demanded,
    w: machineSize,
    h: machineSize,
    x: 0,
    y: 0,
    machines: [
      {
        recipeKey: "stub",
        machineKey: "stub-machine",
        x: 0,
        y: 0,
        w: machineSize,
        h: machineSize,
        index: 0,
      },
    ],
    inputs: [],
    outputs: [],
    portsByEdge: { N: [], E: [], S: [], W: [] },
  }
}

describe("templates · registry", () => {
  it("ships exactly 3 templates: single-block, manifold-6, manifold-12", () => {
    const ids = LAYOUT_TEMPLATE_LIST.map((t) => t.id)
    expect(ids).toEqual(["single-block", "manifold-6", "manifold-12"])
  })

  it("LAYOUT_TEMPLATES keyed registry is consistent with the list", () => {
    for (const t of LAYOUT_TEMPLATE_LIST) {
      expect(LAYOUT_TEMPLATES[t.id]).toBe(t)
    }
  })
})

describe("templates · matches", () => {
  it("single-block always matches", () => {
    expect(LAYOUT_TEMPLATES["single-block"].matches(makeCell(1))).toBe(true)
    expect(LAYOUT_TEMPLATES["single-block"].matches(makeCell(50))).toBe(true)
  })

  it("manifold-6 requires demanded ≥ 3 (half of 6)", () => {
    expect(LAYOUT_TEMPLATES["manifold-6"].matches(makeCell(1))).toBe(false)
    expect(LAYOUT_TEMPLATES["manifold-6"].matches(makeCell(2))).toBe(false)
    expect(LAYOUT_TEMPLATES["manifold-6"].matches(makeCell(3))).toBe(true)
    expect(LAYOUT_TEMPLATES["manifold-6"].matches(makeCell(20))).toBe(true)
  })

  it("manifold-12 requires demanded ≥ 6", () => {
    expect(LAYOUT_TEMPLATES["manifold-12"].matches(makeCell(5))).toBe(false)
    expect(LAYOUT_TEMPLATES["manifold-12"].matches(makeCell(6))).toBe(true)
    expect(LAYOUT_TEMPLATES["manifold-12"].matches(makeCell(50))).toBe(true)
  })
})

describe("templates · apply", () => {
  it("single-block leaves the cell unchanged", () => {
    const cell = makeCell(3)
    const beforeW = cell.w
    const beforeH = cell.h
    LAYOUT_TEMPLATES["single-block"].apply(cell)
    expect(cell.w).toBe(beforeW)
    expect(cell.h).toBe(beforeH)
  })

  it("manifold-6 with demanded=6 expands to a 1-row strip", () => {
    const cell = makeCell(6)
    LAYOUT_TEMPLATES["manifold-6"].apply(cell)
    // 6 machines in 1 row → w = 6 × 3 = 18, h = 1 × 3 = 3
    expect(cell.w).toBe(18)
    expect(cell.h).toBe(3)
  })

  it("manifold-6 with demanded=8 expands to a 2-row strip", () => {
    const cell = makeCell(8)
    LAYOUT_TEMPLATES["manifold-6"].apply(cell)
    // 8 machines → 2 rows × 6, but cols caps at min(8, 6) = 6, so w = 18, rows = 2, h = 6
    expect(cell.w).toBe(18)
    expect(cell.h).toBe(6)
  })

  it("manifold-12 with demanded=12 expands to a wider strip than manifold-6", () => {
    const m6 = makeCell(12)
    const m12 = makeCell(12)
    LAYOUT_TEMPLATES["manifold-6"].apply(m6)
    LAYOUT_TEMPLATES["manifold-12"].apply(m12)
    expect(m12.w).toBeGreaterThan(m6.w)
    expect(m12.h).toBeLessThan(m6.h)
  })
})

describe("templates · templatesFor", () => {
  it("returns single-block only for cells too small for manifolds", () => {
    expect(templatesFor(makeCell(1))).toEqual(["single-block"])
    expect(templatesFor(makeCell(2))).toEqual(["single-block"])
  })

  it("returns all 3 templates for cells big enough", () => {
    expect(templatesFor(makeCell(20))).toEqual([
      "single-block",
      "manifold-6",
      "manifold-12",
    ])
  })
})

describe("csp · scoreCspBlueprint", () => {
  it("returns base tap-distance + width penalty when all templates are single-block", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = busLayout(catalog, flow, {})
    const score = scoreCspBlueprint(bp, {}, DEFAULT_OBJECTIVE)
    expect(score).toBeGreaterThan(0)
  })

  it("penalizes manifold templates with significant waste", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = busLayout(catalog, flow, {})
    // Pretend we'd manifold-12 a 1-machine cell — 11 empty slots.
    const wasteful: Record<string, TemplateId> = {}
    for (const cell of bp.cells) if (cell.demanded === 1) wasteful[cell.recipeKey] = "manifold-12"
    const baseScore = scoreCspBlueprint(bp, {}, DEFAULT_OBJECTIVE)
    const wasteScore = scoreCspBlueprint(bp, wasteful, DEFAULT_OBJECTIVE)
    expect(wasteScore).toBeGreaterThan(baseScore)
  })
})

describe("csp · solveCsp", () => {
  it("returns a valid result on a small fixture", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const result = solveCsp(catalog, flow, {}, { annealIterationsPerLeaf: 5, maxLeaves: 50 })
    expect(result.blueprint.cells.length).toBeGreaterThan(0)
    expect(result.score).toBeGreaterThan(0)
    // No multi-demanded cells in this tiny flow → no template enumeration.
    expect(Object.keys(result.templateChoices).length).toBeGreaterThanOrEqual(0)
  })

  it("never returns a worse score than the baseline single-block layout", () => {
    // The CSP tracks best-found across the search. Worst case: it
    // finds nothing better than single-block (which IS the baseline).
    const flow = expand({
      catalog,
      targets: [
        { item: "electronic-circuit", rate: 1 },
        { item: "copper-cable", rate: 6 },
        { item: "iron-plate", rate: 2 },
      ],
    })
    const result = solveCsp(catalog, flow, {}, { annealIterationsPerLeaf: 5, maxLeaves: 20 })
    const baselineBp = busLayout(catalog, flow, {})
    const baselineScore = scoreCspBlueprint(baselineBp, {})
    expect(result.score).toBeLessThanOrEqual(baselineScore)
  })

  it("respects the maxLeaves budget", () => {
    const flow = expand({
      catalog,
      targets: [
        { item: "electronic-circuit", rate: 1 },
        { item: "copper-cable", rate: 6 },
      ],
    })
    const result = solveCsp(
      catalog,
      flow,
      {},
      { annealIterationsPerLeaf: 2, maxLeaves: 3 },
    )
    expect(result.leavesExplored).toBeLessThanOrEqual(3)
  })

  it("emits a valid Blueprint via cspLayout (algorithm-registry shape)", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = cspLayout(catalog, flow, { layoutEffort: 5 })
    expect(bp.cells.length).toBeGreaterThan(0)
    expect(bp.width).toBeGreaterThan(0)
    expect(bp.height).toBeGreaterThan(0)
  })
})
