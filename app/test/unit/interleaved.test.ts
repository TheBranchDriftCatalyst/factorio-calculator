import { describe, it, expect } from "vitest"
import { loadCatalog } from "../../src/factorio"
import { expand } from "../../src/solver/expand"
import {
  computeStages,
  interleavedLayout,
} from "../../src/blueprint/layout/interleaved"
import { miniDataset } from "../fixtures/mini-dataset"

const catalog = loadCatalog(miniDataset)

describe("interleaved · computeStages", () => {
  it("assigns stage 0 to recipes that only consume raw items", () => {
    // iron-plate has only iron-ore (raw) input → stage 0
    const flow = expand({ catalog, targets: [{ item: "iron-plate", rate: 1 }] })
    const stages = computeStages(flow)
    expect(stages.get("iron-plate")).toBe(0)
  })

  it("assigns increasing stages along a recipe chain", () => {
    // electronic-circuit recipe: needs iron-plate + copper-cable (which
    // needs copper-plate (which needs copper-ore raw)). So:
    //   iron-plate → stage 0
    //   copper-plate → stage 0
    //   copper-cable → stage 1
    //   electronic-circuit → stage 2
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const stages = computeStages(flow)
    expect(stages.get("iron-plate")).toBe(0)
    expect(stages.get("copper-plate")).toBe(0)
    expect(stages.get("copper-cable")).toBe(1)
    expect(stages.get("electronic-circuit")).toBe(2)
  })

  it("only emits stages for recipe nodes (not source: / output: / input:)", () => {
    const flow = expand({ catalog, targets: [{ item: "iron-plate", rate: 1 }] })
    const stages = computeStages(flow)
    for (const id of stages.keys()) {
      expect(id.startsWith("source:")).toBe(false)
      expect(id.startsWith("input:")).toBe(false)
      expect(id.startsWith("output:")).toBe(false)
    }
  })
})

describe("interleaved · interleavedLayout", () => {
  it("emits a valid Blueprint shape", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = interleavedLayout(catalog, flow, {})
    expect(bp.cells.length).toBeGreaterThan(0)
    expect(bp.width).toBeGreaterThan(0)
    expect(bp.height).toBeGreaterThan(0)
    expect(bp.root).not.toBeNull()
  })

  it("places later-stage cells to the RIGHT of earlier-stage cells", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = interleavedLayout(catalog, flow, {})
    const cellByKey = new Map(bp.cells.map((c) => [c.recipeKey, c]))
    const ironPlate = cellByKey.get("iron-plate")!
    const copperCable = cellByKey.get("copper-cable")!
    const ec = cellByKey.get("electronic-circuit")!
    expect(ironPlate.x).toBeLessThan(copperCable.x)
    expect(copperCable.x).toBeLessThan(ec.x)
  })

  it("cells in the same stage share a y-stack (same x), different y", () => {
    // iron-plate + copper-plate both stage 0 → same x column.
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = interleavedLayout(catalog, flow, {})
    const cellByKey = new Map(bp.cells.map((c) => [c.recipeKey, c]))
    const ironPlate = cellByKey.get("iron-plate")!
    const copperPlate = cellByKey.get("copper-plate")!
    expect(ironPlate.x).toBe(copperPlate.x)
    expect(ironPlate.y).not.toBe(copperPlate.y)
  })

  it("inputs tap belts in the bus column IMMEDIATELY to the cell's left", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = interleavedLayout(catalog, flow, {})
    const ec = bp.cells.find((c) => c.recipeKey === "electronic-circuit")!
    for (const port of ec.inputs) {
      // Belt sits left of the cell.
      expect(port.beltX).toBeLessThan(ec.x)
      expect(port.edge).toBe("W")
    }
  })

  it("outputs go EAST (E edge), targeting a belt to the right of the cell", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = interleavedLayout(catalog, flow, {})
    for (const cell of bp.cells) {
      for (const port of cell.outputs) {
        expect(port.edge).toBe("E")
        expect(port.beltX).toBeGreaterThan(cell.x)
      }
    }
  })

  it("emits at least one bus belt per stage", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = interleavedLayout(catalog, flow, {})
    const belts = bp.root?.belts ?? []
    // Min 3 stages worth of belts for electronic-circuit chain (raw bus + 1 intermediate + final).
    expect(belts.length).toBeGreaterThanOrEqual(3)
    // Belts at distinct x positions confirm interleaving.
    const distinctX = new Set(belts.map((b) => b.x))
    expect(distinctX.size).toBeGreaterThanOrEqual(2)
  })

  it("final-output belt sits to the right of the rightmost cell", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = interleavedLayout(catalog, flow, {})
    const ec = bp.cells.find((c) => c.recipeKey === "electronic-circuit")!
    const ecOutput = ec.outputs.find((p) => p.item === "electronic-circuit")!
    expect(ecOutput.beltX).toBeGreaterThan(ec.x + ec.w - 1)
  })

  it("doesn't crash on a flow with only raw-feed recipes", () => {
    // iron-plate alone — 1 stage.
    const flow = expand({ catalog, targets: [{ item: "iron-plate", rate: 1 }] })
    const bp = interleavedLayout(catalog, flow, {})
    expect(bp.cells).toHaveLength(1)
    expect(bp.cells[0].recipeKey).toBe("iron-plate")
  })
})
