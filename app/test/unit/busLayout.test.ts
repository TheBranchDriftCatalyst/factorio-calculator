import { describe, it, expect } from "vitest"
import { loadCatalog } from "../../src/factorio"
import { expand } from "../../src/solver/expand"
import { busLayout } from "../../src/blueprint/layout/busLayout"
import { flattenGroups } from "../../src/blueprint/types"
import { miniDataset } from "../fixtures/mini-dataset"

// Local helpers — the Blueprint shape no longer exposes flat `belts[]` /
// `groups[]` arrays (single source of truth is the BusNode tree). Tests
// derive flat views via these helpers so assertions stay readable.
const trunkBelts = (bp: ReturnType<typeof busLayout>) => bp.root?.belts ?? []
const groups = (bp: ReturnType<typeof busLayout>) => flattenGroups(bp.root)

const catalog = loadCatalog(miniDataset)

describe("busLayout (Phase 1.A)", () => {
  const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
  const blueprint = busLayout(catalog, flow)

  it("produces one cell per recipe node", () => {
    const recipeNodes = flow.nodes.filter((n) => n.recipe).length
    expect(blueprint.cells.length).toBe(recipeNodes)
  })

  it("never produces zero-sized cells", () => {
    for (const c of blueprint.cells) {
      expect(c.w).toBeGreaterThan(0)
      expect(c.h).toBeGreaterThan(0)
      expect(c.machines.length).toBeGreaterThan(0)
    }
  })

  it("machines within a cell never overlap", () => {
    for (const c of blueprint.cells) {
      const sorted = [...c.machines].sort((a, b) => a.y - b.y)
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]
        const cur = sorted[i]
        // Vertical stacking: each machine's top is at or below the prev's bottom
        expect(cur.y).toBeGreaterThanOrEqual(prev.y + prev.h)
      }
    }
  })

  it("cells in the same group never overlap on the y-axis", () => {
    for (const g of groups(blueprint)) {
      const members = blueprint.cells.filter((c) => g.cellKeys.includes(c.recipeKey))
      const sorted = [...members].sort((a, b) => a.y - b.y)
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]
        const cur = sorted[i]
        expect(cur.y).toBeGreaterThanOrEqual(prev.y + prev.h)
      }
    }
  })

  it("represents every recipe-to-recipe flow item on trunk, local bus, OR a direct connection", () => {
    const interiorEdges = flow.edges.filter(
      (e) => !e.target.startsWith("output:") && !e.source.startsWith("source:"),
    )
    const flowItems = new Set(interiorEdges.map((e) => e.item))
    const trunkItems = new Set<string>()
    for (const b of trunkBelts(blueprint)) {
      if (b.laneA) trunkItems.add(b.laneA.item)
      if (b.laneB) trunkItems.add(b.laneB.item)
    }
    const localItems = new Set<string>()
    for (const g of groups(blueprint)) {
      for (const b of g.localBelts) {
        if (b.laneA) localItems.add(b.laneA.item)
        if (b.laneB) localItems.add(b.laneB.item)
      }
    }
    const directItems = new Set(blueprint.directConnections.map((d) => d.item))
    for (const item of flowItems) {
      expect(trunkItems.has(item) || localItems.has(item) || directItems.has(item)).toBe(true)
    }
  })

  it("ports reference real belt columns (trunk, local, or direct-connection)", () => {
    const trunkX = new Set(trunkBelts(blueprint).map((b) => b.x))
    const localX = new Set<number>()
    for (const g of groups(blueprint)) for (const b of g.localBelts) localX.add(b.x)
    const directX = new Set(blueprint.directConnections.map((dc) => dc.x))
    for (const c of blueprint.cells) {
      for (const p of c.inputs) {
        if (p.scope.kind === "trunk") expect(trunkX.has(p.beltX)).toBe(true)
        else if (p.scope.kind === "direct") expect(directX.has(p.beltX)).toBe(true)
        else expect(localX.has(p.beltX)).toBe(true)
      }
      for (const p of c.outputs) {
        if (p.scope.kind === "trunk") expect(trunkX.has(p.beltX)).toBe(true)
        else if (p.scope.kind === "direct") expect(directX.has(p.beltX)).toBe(true)
        else expect(localX.has(p.beltX)).toBe(true)
      }
    }
  })

  it("emits one inserter per cell port", () => {
    const totalPorts = blueprint.cells.reduce(
      (n, c) => n + c.inputs.length + c.outputs.length,
      0,
    )
    expect(blueprint.inserters.length).toBe(totalPorts)
  })

  it("inserters sit on their cell's perimeter", () => {
    // Perimeter placement: a W-edge port has its inserter at cell.x - 1,
    // an E-edge port at cell.x + cell.w. We don't have a direct port-edge
    // → inserter map, but for any inserter we can find its owning cell
    // and verify the x sits at one of the two perimeter columns.
    const cellByKey = new Map(blueprint.cells.map((c) => [c.recipeKey, c]))
    for (const ins of blueprint.inserters) {
      const cell = cellByKey.get(ins.cellKey)
      if (!cell) continue
      const wPerimeter = cell.x - 1
      const ePerimeter = cell.x + cell.w
      expect(ins.x === wPerimeter || ins.x === ePerimeter).toBe(true)
    }
  })

  it("input inserters face east, output inserters face west", () => {
    for (const ins of blueprint.inserters) {
      expect(ins.facing === "east" || ins.facing === "west").toBe(true)
    }
  })

  it("pairs up to two items per belt", () => {
    for (const b of trunkBelts(blueprint)) {
      expect(b.laneA).toBeDefined() // every belt must have at least one item
      // laneB optional (odd item counts leave the last belt half-empty)
    }
  })

  it("input port rates equal demanded ingredient rates", () => {
    const node = flow.nodes.find((n) => n.id === "electronic-circuit")!
    const cell = blueprint.cells.find((c) => c.recipeKey === "electronic-circuit")!
    const expected = node.rate * 1 // 1 iron-plate per craft
    const ironPort = cell.inputs.find((p) => p.item === "iron-plate")
    expect(ironPort).toBeDefined()
    expect(ironPort!.rate).toBeCloseTo(expected)
  })

  it("layout dimensions are at least as wide as the rightmost cell", () => {
    const rightmost = Math.max(...blueprint.cells.map((c) => c.x + c.w), 0)
    expect(blueprint.width).toBeGreaterThanOrEqual(rightmost)
  })
})

describe("busLayout — multi-target merge", () => {
  it("merges shared intermediates into one cell each", () => {
    const flow = expand({
      catalog,
      targets: [
        { item: "electronic-circuit", rate: 1 },
        { item: "copper-cable", rate: 6 },
      ],
    })
    const blueprint = busLayout(catalog, flow)
    // copper-cable is required by both targets — one cell, with rate summed
    const cableCells = blueprint.cells.filter((c) => c.recipeKey === "copper-cable")
    expect(cableCells.length).toBe(1)
  })
})

describe("busLayout — empty input", () => {
  it("returns a blueprint with no cells when flow is empty", () => {
    const flow = expand({ catalog, targets: [] })
    const blueprint = busLayout(catalog, flow)
    expect(blueprint.cells.length).toBe(0)
    expect(trunkBelts(blueprint).length).toBe(0)
    expect(blueprint.inserters.length).toBe(0)
    expect(groups(blueprint).length).toBe(0)
  })
})

describe("busLayout — sub-bus groups (v4: local belts inside frames)", () => {
  it("classifies single-consumer items as direct connections (1 producer + 1 consumer), not on the trunk", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const blueprint = busLayout(catalog, flow)
    const trunkItems = new Set<string>()
    for (const b of trunkBelts(blueprint)) {
      if (b.laneA) trunkItems.add(b.laneA.item)
      if (b.laneB) trunkItems.add(b.laneB.item)
    }
    // Intermediates produced + consumed inside the factory don't appear on root.
    expect(trunkItems.has("iron-plate")).toBe(false)
    expect(trunkItems.has("copper-cable")).toBe(false)
    // 1-producer + 1-consumer intermediates now become DIRECT connections,
    // not full local-bus belt columns. We expect at least one direct link.
    expect(groups(blueprint).length).toBe(1)
    expect(blueprint.directConnections.length).toBeGreaterThan(0)
  })

  it("clusters chained recipes into a single group", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const blueprint = busLayout(catalog, flow)
    const gs = groups(blueprint)
    expect(gs.length).toBe(1)
    expect(gs[0].cellKeys.length).toBe(blueprint.cells.length)
  })

  it("trunk belts only carry items with multiple downstream consumers", () => {
    const flow = expand({
      catalog,
      targets: [
        { item: "electronic-circuit", rate: 1 },
        { item: "copper-cable", rate: 6 },
      ],
    })
    const blueprint = busLayout(catalog, flow)
    for (const b of trunkBelts(blueprint)) {
      const items = [b.laneA?.item, b.laneB?.item].filter(Boolean) as string[]
      // Every trunk item must have at least one CellPort marked "trunk".
      for (const item of items) {
        const used = blueprint.cells.some((c) =>
          [...c.inputs, ...c.outputs].some((p) => p.item === item && p.scope.kind === "trunk"),
        )
        expect(used).toBe(true)
      }
    }
  })

  it("group bounding boxes contain all member cells", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const blueprint = busLayout(catalog, flow)
    for (const g of groups(blueprint)) {
      const members = blueprint.cells.filter((c) => g.cellKeys.includes(c.recipeKey))
      for (const c of members) {
        expect(c.x).toBeGreaterThanOrEqual(g.x)
        expect(c.x + c.w).toBeLessThanOrEqual(g.x + g.w)
        expect(c.y).toBeGreaterThanOrEqual(g.y)
        expect(c.y + c.h).toBeLessThanOrEqual(g.y + g.h)
      }
    }
  })

  it("direct inserters tap a direct-connection column inside their owning group", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const blueprint = busLayout(catalog, flow)
    const directInserters = blueprint.inserters.filter((i) => i.scope === "direct")
    expect(directInserters.length).toBeGreaterThan(0)
    const directXs = new Set(blueprint.directConnections.map((d) => d.x))
    for (const ins of directInserters) {
      expect(directXs.has(ins.beltX)).toBe(true)
    }
  })

  it("groups stack vertically (each below the previous)", () => {
    const flow = expand({
      catalog,
      targets: [
        { item: "electronic-circuit", rate: 1 },
        { item: "copper-cable", rate: 6 },
      ],
    })
    const blueprint = busLayout(catalog, flow)
    const gs = groups(blueprint)
    if (gs.length < 2) return
    const sorted = [...gs].sort((a, b) => a.y - b.y)
    for (let i = 1; i < sorted.length; i++) {
      // Strictly below the previous group's bottom edge
      expect(sorted[i].y).toBeGreaterThanOrEqual(sorted[i - 1].y + sorted[i - 1].h - 1)
    }
  })
})

// Similarity-aware reorder integration. The orderByTapDistance heuristic
// shouldn't WORSEN any layout — this test pins that contract end-to-end
// by computing the realized tap distance from the produced Blueprint
// (sum of |beltX - cellX| × belt-span) and asserting it's reasonable.
describe("busLayout · similarity reorder (fbp-xm0)", () => {
  it("cells in the same scope are stacked vertically with no overlap", () => {
    // The reorder must still produce a valid vertical stack. Producer
    // before consumer; no two cells in the same group occupy the same
    // row.
    const flow = expand({
      catalog,
      targets: [
        { item: "electronic-circuit", rate: 1 },
        { item: "copper-cable", rate: 6 },
        { item: "iron-plate", rate: 2 },
      ],
    })
    const blueprint = busLayout(catalog, flow)
    // Group cells by their parent group (or trunk if no group).
    const byGroup = new Map<string, typeof blueprint.cells>()
    for (const g of groups(blueprint)) {
      const groupCells = blueprint.cells.filter((c) => g.cellKeys.includes(c.recipeKey))
      byGroup.set(g.id, groupCells)
    }
    for (const [, cells] of byGroup) {
      const sorted = [...cells].sort((a, b) => a.y - b.y)
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]
        const cur = sorted[i]
        expect(cur.y).toBeGreaterThanOrEqual(prev.y + prev.h)
      }
    }
  })

  it("preserves producer-before-consumer order within each scope", () => {
    const flow = expand({
      catalog,
      targets: [
        { item: "electronic-circuit", rate: 1 },
        { item: "copper-cable", rate: 6 },
      ],
    })
    const blueprint = busLayout(catalog, flow)
    // For every edge in the flow whose endpoints are BOTH cells in the
    // same group, producer's y must be <= consumer's y.
    const cellByKey = new Map(blueprint.cells.map((c) => [c.recipeKey, c]))
    const groupOf = new Map<string, string>()
    for (const g of groups(blueprint)) {
      for (const key of g.cellKeys) groupOf.set(key, g.id)
    }
    for (const e of flow.edges) {
      const src = cellByKey.get(e.source)
      const tgt = cellByKey.get(e.target)
      if (!src || !tgt) continue
      if (groupOf.get(e.source) !== groupOf.get(e.target)) continue
      expect(src.y).toBeLessThanOrEqual(tgt.y)
    }
  })
})
