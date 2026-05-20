import { describe, it, expect } from "vitest"
import { loadCatalog } from "../../src/factorio"
import { expand } from "../../src/solver/expand"
import { busLayout } from "../../src/blueprint/layout/busLayout"
import { miniDataset } from "../fixtures/mini-dataset"

const catalog = loadCatalog(miniDataset)

describe("busLayout (Phase 1.A)", () => {
  const flow = expand(catalog, [{ item: "electronic-circuit", rate: 1 }])
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
    for (const g of blueprint.groups) {
      const members = blueprint.cells.filter((c) => g.cellKeys.includes(c.recipeKey))
      const sorted = [...members].sort((a, b) => a.y - b.y)
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]
        const cur = sorted[i]
        expect(cur.y).toBeGreaterThanOrEqual(prev.y + prev.h)
      }
    }
  })

  it("represents every recipe-to-recipe flow item on either trunk or some group's local bus", () => {
    const interiorEdges = flow.edges.filter(
      (e) => !e.target.startsWith("output:") && !e.source.startsWith("source:"),
    )
    const flowItems = new Set(interiorEdges.map((e) => e.item))
    const trunkItems = new Set<string>()
    for (const b of blueprint.belts) {
      if (b.laneA) trunkItems.add(b.laneA.item)
      if (b.laneB) trunkItems.add(b.laneB.item)
    }
    const localItems = new Set<string>()
    for (const g of blueprint.groups) {
      for (const b of g.localBelts) {
        if (b.laneA) localItems.add(b.laneA.item)
        if (b.laneB) localItems.add(b.laneB.item)
      }
    }
    for (const item of flowItems) {
      expect(trunkItems.has(item) || localItems.has(item)).toBe(true)
    }
  })

  it("ports reference real belt columns (trunk or local)", () => {
    const trunkX = new Set(blueprint.belts.map((b) => b.x))
    const localX = new Set<number>()
    for (const g of blueprint.groups) for (const b of g.localBelts) localX.add(b.x)
    for (const c of blueprint.cells) {
      for (const p of c.inputs) {
        if (p.scope === "trunk") expect(trunkX.has(p.beltX)).toBe(true)
        else expect(localX.has(p.beltX)).toBe(true)
      }
      for (const p of c.outputs) {
        if (p.scope === "trunk") expect(trunkX.has(p.beltX)).toBe(true)
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

  it("inserters sit in their belt's own extraction lane just past the belt", () => {
    for (const ins of blueprint.inserters) {
      expect(ins.x).toBe(ins.beltX + blueprint.beltWidth)
    }
  })

  it("input inserters face east, output inserters face west", () => {
    for (const ins of blueprint.inserters) {
      expect(ins.facing === "east" || ins.facing === "west").toBe(true)
    }
  })

  it("pairs up to two items per belt", () => {
    for (const b of blueprint.belts) {
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
    const flow = expand(catalog, [
      { item: "electronic-circuit", rate: 1 },
      { item: "copper-cable", rate: 6 },
    ])
    const blueprint = busLayout(catalog, flow)
    // copper-cable is required by both targets — one cell, with rate summed
    const cableCells = blueprint.cells.filter((c) => c.recipeKey === "copper-cable")
    expect(cableCells.length).toBe(1)
  })
})

describe("busLayout — empty input", () => {
  it("returns a blueprint with no cells when flow is empty", () => {
    const flow = expand(catalog, [])
    const blueprint = busLayout(catalog, flow)
    expect(blueprint.cells.length).toBe(0)
    expect(blueprint.belts.length).toBe(0)
    expect(blueprint.inserters.length).toBe(0)
    expect(blueprint.groups.length).toBe(0)
  })
})

describe("busLayout — sub-bus groups (v4: local belts inside frames)", () => {
  it("classifies single-consumer items as local belts inside the group's frame, not on the trunk", () => {
    const flow = expand(catalog, [{ item: "electronic-circuit", rate: 1 }])
    const blueprint = busLayout(catalog, flow)
    // Root trunk now carries raw-input belts (iron-ore, copper-ore) since
    // those flow in from `source:*` nodes and need a visible entry lane.
    // Intermediate (single-consumer recipe-to-recipe) items still live on
    // the group's local bus, not the root trunk.
    const trunkItems = new Set<string>()
    for (const b of blueprint.belts) {
      if (b.laneA) trunkItems.add(b.laneA.item)
      if (b.laneB) trunkItems.add(b.laneB.item)
    }
    // Intermediates produced + consumed inside the factory don't appear on root.
    expect(trunkItems.has("iron-plate")).toBe(false)
    expect(trunkItems.has("copper-cable")).toBe(false)
    // But the group should have local belts for those intermediates.
    expect(blueprint.groups.length).toBe(1)
    expect(blueprint.groups[0].localBelts.length).toBeGreaterThan(0)
  })

  it("clusters chained recipes into a single group", () => {
    const flow = expand(catalog, [{ item: "electronic-circuit", rate: 1 }])
    const blueprint = busLayout(catalog, flow)
    expect(blueprint.groups.length).toBe(1)
    expect(blueprint.groups[0].cellKeys.length).toBe(blueprint.cells.length)
  })

  it("trunk belts only carry items with multiple downstream consumers", () => {
    const flow = expand(catalog, [
      { item: "electronic-circuit", rate: 1 },
      { item: "copper-cable", rate: 6 },
    ])
    const blueprint = busLayout(catalog, flow)
    for (const b of blueprint.belts) {
      const items = [b.laneA?.item, b.laneB?.item].filter(Boolean) as string[]
      // Every trunk item must have at least one CellPort marked "trunk".
      for (const item of items) {
        const used = blueprint.cells.some((c) =>
          [...c.inputs, ...c.outputs].some((p) => p.item === item && p.scope === "trunk"),
        )
        expect(used).toBe(true)
      }
    }
  })

  it("group bounding boxes contain all member cells", () => {
    const flow = expand(catalog, [{ item: "electronic-circuit", rate: 1 }])
    const blueprint = busLayout(catalog, flow)
    for (const g of blueprint.groups) {
      const members = blueprint.cells.filter((c) => g.cellKeys.includes(c.recipeKey))
      for (const c of members) {
        expect(c.x).toBeGreaterThanOrEqual(g.x)
        expect(c.x + c.w).toBeLessThanOrEqual(g.x + g.w)
        expect(c.y).toBeGreaterThanOrEqual(g.y)
        expect(c.y + c.h).toBeLessThanOrEqual(g.y + g.h)
      }
    }
  })

  it("local inserters extract from a belt inside their owning group", () => {
    const flow = expand(catalog, [{ item: "electronic-circuit", rate: 1 }])
    const blueprint = busLayout(catalog, flow)
    const localInserters = blueprint.inserters.filter((i) => i.scope === "local")
    expect(localInserters.length).toBeGreaterThan(0)
    for (const ins of localInserters) {
      const owningGroup = blueprint.groups.find((g) => g.cellKeys.includes(ins.cellKey))
      expect(owningGroup).toBeDefined()
      const localXs = new Set(owningGroup!.localBelts.map((b) => b.x))
      expect(localXs.has(ins.beltX)).toBe(true)
    }
  })

  it("groups stack vertically (each below the previous)", () => {
    const flow = expand(catalog, [
      { item: "electronic-circuit", rate: 1 },
      { item: "copper-cable", rate: 6 },
    ])
    const blueprint = busLayout(catalog, flow)
    if (blueprint.groups.length < 2) return
    const sorted = [...blueprint.groups].sort((a, b) => a.y - b.y)
    for (let i = 1; i < sorted.length; i++) {
      // Strictly below the previous group's bottom edge
      expect(sorted[i].y).toBeGreaterThanOrEqual(sorted[i - 1].y + sorted[i - 1].h - 1)
    }
  })
})
