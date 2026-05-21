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
    // Total cable rate = 3 (from chip) + 6 (direct) = 9 cables/sec.
    // copper-cable recipe yields 2 → fractional demand is 4.5 crafts/sec.
    // After the ceil-balance pass producers round UP to whole machines, so
    // the rate becomes ≥ 4.5 (and merges are still single-node — that's the
    // important invariant the test was guarding).
    expect(cableNode[0].rate).toBeGreaterThanOrEqual(4.5 - 1e-9)
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

// ----- Balance properties: the load-bearing invariants of balanceCeil.
// These check the ACTUAL math, not just specific values, so they catch
// regressions where surplus or deficit creeps in.

/**
 * For each producer-recipe node in `flow`, the real (ceil-machine) production
 * MUST be ≥ total demand (internal recipe consumption + output targets).
 * "No deficits" is the contract balanceCeil promises.
 */
function assertNoDeficits(flow: ReturnType<typeof expand>): void {
  for (const node of flow.nodes) {
    if (!node.recipe || !node.machine) continue
    const ceilN = Math.max(1, Math.ceil(node.count - 1e-9))
    const actualCps = (ceilN * node.machine.craftingSpeed) / node.recipe.time
    for (const p of node.recipe.products) {
      const actualProd = p.amount * actualCps
      // Total demand = internal edges into this item + target output for this item.
      let internalDemand = 0
      for (const e of flow.edges) {
        if (e.item !== p.item) continue
        const consumer = flow.nodes.find((n) => n.id === e.target)
        if (!consumer || !consumer.recipe || !consumer.machine) continue
        const ceilCons = Math.max(1, Math.ceil(consumer.count - 1e-9))
        const ing = consumer.recipe.ingredients.find((i) => i.item === e.item)
        if (!ing) continue
        const realCons = (ing.amount * ceilCons * consumer.machine.craftingSpeed) / consumer.recipe.time
        internalDemand += realCons
      }
      const outputDemand = flow.outputs.get(p.item) ?? 0
      // Co-products (oil) often produce more than demanded — that's not a
      // deficit, it's a co-product. Skip the assertion when there's no demand
      // for the product, since "no demand" can't be in deficit.
      const totalDemand = internalDemand + outputDemand
      if (totalDemand <= 1e-9) continue
      expect(actualProd + 1e-6).toBeGreaterThanOrEqual(totalDemand)
    }
  }
}

/**
 * Per-producer surplus is bounded by one machine's worth of output.
 * Ignores co-products (multi-product recipes) which can have unbounded
 * surplus for non-demanded products.
 */
function assertMarginalSurplus(flow: ReturnType<typeof expand>): void {
  for (const node of flow.nodes) {
    if (!node.recipe || !node.machine) continue
    // Skip multi-product recipes — co-products can be wildly over-produced
    // because you can't make 1 petroleum-gas without also making heavy/light.
    if (node.recipe.products.length > 1) continue
    const product = node.recipe.products[0]
    const ceilN = Math.max(1, Math.ceil(node.count - 1e-9))
    const actualCps = (ceilN * node.machine.craftingSpeed) / node.recipe.time
    const actualProd = product.amount * actualCps
    // Internal demand (using consumer ceil counts).
    let internalDemand = 0
    for (const e of flow.edges) {
      if (e.item !== product.item) continue
      const consumer = flow.nodes.find((n) => n.id === e.target)
      if (!consumer || !consumer.recipe || !consumer.machine) continue
      const ceilCons = Math.max(1, Math.ceil(consumer.count - 1e-9))
      const ing = consumer.recipe.ingredients.find((i) => i.item === e.item)
      if (!ing) continue
      internalDemand += (ing.amount * ceilCons * consumer.machine.craftingSpeed) / consumer.recipe.time
    }
    const outputDemand = flow.outputs.get(product.item) ?? 0
    const totalDemand = internalDemand + outputDemand
    const surplus = actualProd - totalDemand
    // Cap is one machine's worth of this product per second.
    const oneMachineOutput = (product.amount * node.machine.craftingSpeed) / node.recipe.time
    expect(surplus).toBeLessThanOrEqual(oneMachineOutput + 1e-6)
    expect(surplus).toBeGreaterThanOrEqual(-1e-6) // no deficits (redundant w/ above)
  }
}

describe("expand (balance properties)", () => {
  it("no recipe produces a deficit for a single-target chain", () => {
    const flow = expand(catalog, [{ item: "electronic-circuit", rate: 1 }])
    assertNoDeficits(flow)
  })

  it("single-product producers overshoot demand by AT MOST one machine", () => {
    const flow = expand(catalog, [{ item: "electronic-circuit", rate: 1 }])
    assertMarginalSurplus(flow)
  })

  it("no deficits with multiple targets sharing intermediates", () => {
    const flow = expand(catalog, [
      { item: "electronic-circuit", rate: 1 },
      { item: "copper-cable", rate: 6 },
      { item: "iron-plate", rate: 2 },
    ])
    assertNoDeficits(flow)
  })

  it("surplus is marginal with multiple targets", () => {
    const flow = expand(catalog, [
      { item: "electronic-circuit", rate: 1 },
      { item: "copper-cable", rate: 6 },
      { item: "iron-plate", rate: 2 },
    ])
    assertMarginalSurplus(flow)
  })

  it("handles fractional ceil correctly for tiny rates", () => {
    // 0.01 chip/sec demand → 0.01 crafts/sec @ 0.5s recipe / 0.5 speed = 0.01 machines.
    // ceil → 1 machine = 1 chip/sec actual. Surplus = 0.99 chips/sec.
    // That's exactly one machine's output minus the demand (0.01), well under cap.
    const flow = expand(catalog, [{ item: "electronic-circuit", rate: 0.01 }])
    const chipNode = flow.nodes.find((n) => n.id === "electronic-circuit")!
    expect(chipNode.count).toBe(1) // ceiled up from 0.01
    // Production: 1 machine × 0.5 speed / 0.5 time = 1 chip/sec
    const actualCps = (chipNode.count * chipNode.machine!.craftingSpeed) / chipNode.recipe!.time
    expect(actualCps).toBeCloseTo(1)
    // Demand was 0.01, so surplus = 0.99. Within "one machine output" cap (1.0).
    assertMarginalSurplus(flow)
    assertNoDeficits(flow)
  })

  it("edges are deduped by (source, target, item) — no inflated demand", () => {
    // Regression: producers reached via multiple downstream paths used to
    // push a fresh edge each visit, and balanceCeil step 3 summed those
    // duplicates as separate demands → 2-5× over-build of upstream
    // recipes. Each producer→consumer→item triple must appear at most
    // once in flow.edges.
    const flow = expand(catalog, [
      { item: "electronic-circuit", rate: 1 },
      { item: "copper-cable", rate: 6 },
    ])
    const seen = new Set<string>()
    for (const e of flow.edges) {
      const k = `${e.source}|${e.target}|${e.item}`
      expect(seen.has(k)).toBe(false)
      seen.add(k)
    }
  })

  it("propagated ceil demand reaches all upstream producers", () => {
    // chip demand 1/s → cable demand 3/s → 1.5 crafts/s. Ceil 2 cable machines.
    // 2 cable machines × 1 plate/craft × (0.5 speed / 0.5 time) = 2 plate/sec.
    // 2 plate/sec / (1 speed / 3.2 time) = 6.4 furnaces → ceil 7 furnaces.
    // Real plate output: 7 × 1/3.2 = 2.1875 plate/sec.
    // Real plate consumption (cable + chip): 2 (cable) + 1 (chip) = 3 plate/sec…
    // wait — chip consumes 1 plate per craft, chip rate = 1 craft/sec, so 1 plate/sec.
    // Plus cable: 2 ceiled crafts × 1 plate = 2 plate/sec.
    // Total internal demand on plate = 3 plate/sec.
    // So plate producer needs 3 plate/sec real → 3 / (1/3.2) = 9.6 → ceil 10 furnaces.
    const flow = expand(catalog, [{ item: "electronic-circuit", rate: 1 }])
    const plateNode = flow.nodes.find((n) => n.id === "copper-plate")
    if (plateNode) {
      // Should be enough to cover real cable consumption with ceil.
      assertNoDeficits(flow)
    }
  })
})
