import { describe, it, expect } from "vitest"
import { loadCatalog } from "../../src/factorio"
import { expand } from "../../src/solver/expand"
import { miniDataset } from "../fixtures/mini-dataset"

const catalog = loadCatalog(miniDataset)

describe("expand (single target)", () => {
  it("produces a source node for each raw input", () => {
    const flow = expand(catalog, [{ item: "iron-plate", rate: 1 }])
    const sources = flow.nodes.filter((n) => n.id.startsWith("source:"))
    expect(sources.map((s) => s.id)).toEqual(["source:iron-ore"])
    expect(flow.rawInputs.get("iron-ore")).toBeCloseTo(1)
  })

  it("computes machine count from recipe time / crafting speed", () => {
    // electronic-circuit recipe: time=0.5, machine assembling-machine-1 speed=0.5
    // For 1 chip/sec → 1 craft/sec → count = (1 * 0.5) / 0.5 = 1.0 machines
    const flow = expand(catalog, [{ item: "electronic-circuit", rate: 1 }])
    const node = flow.nodes.find((n) => n.id === "electronic-circuit")!
    expect(node.count).toBeCloseTo(1.0, 5)
    expect(node.machine?.key).toBe("assembling-machine-1")
  })

  it("propagates demand through the chain", () => {
    // 1 chip/sec needs: 1 iron-plate/sec + 3 copper-cable/sec
    // copper-cable recipe yields 2/craft → 1.5 crafts/sec
    // 1.5 crafts × 1 copper-plate/craft = 1.5 copper-plate/sec
    const flow = expand(catalog, [{ item: "electronic-circuit", rate: 1 }])
    expect(flow.rawInputs.get("iron-ore")).toBeCloseTo(1)
    expect(flow.rawInputs.get("copper-ore")).toBeCloseTo(1.5)
  })

  it("sums power across all machines", () => {
    const flow = expand(catalog, [{ item: "electronic-circuit", rate: 1 }])
    // 1 assembler-1 (75 kW) for chips, 1.5 assemblers for cables, 1 furnace (smelt iron-plate)
    // = 90 kW iron furnace + 1.5*90 kW copper furnace + (1.0 + 0.375) assembler-1 @ 75kW
    expect(flow.totalPowerW).toBeGreaterThan(0)
  })
})

describe("expand (multi-target)", () => {
  it("merges shared intermediates instead of double-counting", () => {
    // Both chip and cable need copper-cable / copper-plate / copper-ore.
    // Demanding both should produce ONE copper-cable node, ONE copper-plate node.
    const flow = expand(catalog, [
      { item: "electronic-circuit", rate: 1 },
      { item: "copper-cable", rate: 6 },
    ])
    const recipeNodes = flow.nodes.filter((n) => !n.id.startsWith("source:"))
    const cableNode = recipeNodes.filter((n) => n.id === "copper-cable")
    expect(cableNode.length).toBe(1)
    // Total cable rate = 3 (from chip) + 6 (direct) = 9 cables/sec
    // copper-cable recipe yields 2 → 4.5 crafts/sec
    expect(cableNode[0].rate).toBeCloseTo(4.5, 5)
  })

  it("records each target as a distinct output", () => {
    const flow = expand(catalog, [
      { item: "iron-plate", rate: 2 },
      { item: "copper-plate", rate: 3 },
    ])
    expect(flow.outputs.get("iron-plate")).toBeCloseTo(2)
    expect(flow.outputs.get("copper-plate")).toBeCloseTo(3)
  })

  it("aggregates raw inputs across targets", () => {
    const flow = expand(catalog, [
      { item: "iron-plate", rate: 1 },
      { item: "iron-plate", rate: 2 }, // same target twice — should sum
    ])
    expect(flow.rawInputs.get("iron-ore")).toBeCloseTo(3)
  })

  it("ignores zero-rate targets", () => {
    const flow = expand(catalog, [
      { item: "iron-plate", rate: 1 },
      { item: "copper-plate", rate: 0 },
    ])
    expect(flow.outputs.has("copper-plate")).toBe(false)
    expect(flow.rawInputs.has("copper-ore")).toBe(false)
  })
})

describe("expand (edge cases)", () => {
  it("handles raw items requested directly (no recipe needed)", () => {
    const flow = expand(catalog, [{ item: "iron-ore", rate: 5 }])
    expect(flow.rawInputs.get("iron-ore")).toBeCloseTo(5)
    expect(flow.nodes.find((n) => n.id === "source:iron-ore")?.rate).toBeCloseTo(5)
  })

  it("returns empty graph when given empty target list", () => {
    const flow = expand(catalog, [])
    expect(flow.nodes).toHaveLength(0)
    expect(flow.edges).toHaveLength(0)
    expect(flow.totalPowerW).toBe(0)
  })
})
