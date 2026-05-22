import { describe, it, expect } from "vitest"
import { loadCatalog } from "../../src/factorio"
import { miniDataset } from "../fixtures/mini-dataset"

describe("loadCatalog", () => {
  const catalog = loadCatalog(miniDataset)

  it("indexes items by key with localized names", () => {
    expect(catalog.items.get("iron-plate")?.name).toBe("Iron plate")
    expect(catalog.items.size).toBe(9)
  })

  it("translates ingredients/results to normalized shape", () => {
    const r = catalog.recipes.get("electronic-circuit")!
    expect(r.ingredients).toEqual([
      { item: "iron-plate", amount: 1, probability: undefined },
      { item: "copper-cable", amount: 3, probability: undefined },
    ])
    expect(r.products[0].amount).toBe(1)
  })

  it("indexes recipes by output item", () => {
    expect(catalog.recipesByProduct.get("electronic-circuit")?.[0].key).toBe("electronic-circuit")
    expect(catalog.recipesByProduct.get("copper-cable")?.length).toBe(1)
  })

  it("groups machines by crafting category", () => {
    expect(catalog.machinesByCategory.get("smelting")?.map((m) => m.key)).toContain("stone-furnace")
    expect(catalog.machinesByCategory.get("crafting")?.map((m) => m.key)).toContain("assembling-machine-1")
  })

  it("attaches sizes when present in sizes.json", () => {
    // stone-furnace IS in our vendored sizes.json; assembling-machine-1 also is.
    expect(catalog.machines.get("stone-furnace")?.size).toEqual([2, 2])
    expect(catalog.machines.get("assembling-machine-1")?.size).toEqual([3, 3])
  })

  it("computes belt throughput in items/sec", () => {
    // 0.03125 lane-tiles/tick * 480 = 15 items/sec for vanilla transport belt
    expect(catalog.belts.get("transport-belt")?.itemsPerSecond).toBeCloseTo(15, 5)
  })

  it("includes hand-authored inserters with reach", () => {
    const inserter = catalog.inserters.get("inserter")
    expect(inserter?.reach.pickup).toEqual([1, 0])
    expect(inserter?.reach.drop).toEqual([-1, 0])
  })

  it("exposes fluid connections for machines that have them", () => {
    expect(catalog.fluidConnections.get("chemical-plant")?.length).toBe(4)
    expect(catalog.fluidConnections.get("oil-refinery")?.length).toBe(5)
  })

  it("populates rawItems from items without a non-recycling recipe", () => {
    // miniDataset has no explicit `resources` or `planets` tagging, so the
    // set falls back to the heuristic: ores have no producing recipe and
    // surface as raw inputs to the solver.
    expect(catalog.rawItems.has("iron-ore")).toBe(true)
    expect(catalog.rawItems.has("copper-ore")).toBe(true)
    // Craftable items must NOT be in the raw set or the solver would
    // refuse to expand their recipes.
    expect(catalog.rawItems.has("iron-plate")).toBe(false)
    expect(catalog.rawItems.has("electronic-circuit")).toBe(false)
  })
})
