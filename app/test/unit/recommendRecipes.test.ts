import { describe, it, expect } from "vitest"
import { loadCatalog } from "../../src/factorio"
import { expand } from "../../src/solver/expand"
import { recommendRecipes } from "../../src/views/schematic/recommendRecipes"
import { miniDataset } from "../fixtures/mini-dataset"

const catalog = loadCatalog(miniDataset)

describe("recommendRecipes", () => {
  it("suggests recipes whose ingredients are on the current bus", () => {
    // Flow building copper-cable produces copper-plate intermediates +
    // raw copper-ore. Electronic-circuit needs iron-plate + copper-cable
    // — only copper-cable is on the bus, so coverage is 1/2.
    const flow = expand({ catalog, targets: [{ item: "copper-cable", rate: 1 }] })
    const suggestions = recommendRecipes(catalog, flow, { minCoverage: 0 })
    // electronic-circuit should appear with partial coverage.
    const ec = suggestions.find((s) => s.item === "electronic-circuit")
    expect(ec).toBeDefined()
    if (ec) {
      expect(ec.matched).toContain("copper-cable")
      expect(ec.missing).toContain("iron-plate")
      expect(ec.coverage).toBeCloseTo(0.5, 1)
    }
  })

  it("filters out recipes whose products are already in the flow", () => {
    // copper-cable is the target — it shouldn't suggest making more
    // copper-cable.
    const flow = expand({ catalog, targets: [{ item: "copper-cable", rate: 1 }] })
    const suggestions = recommendRecipes(catalog, flow, { minCoverage: 0 })
    expect(suggestions.find((s) => s.item === "copper-cable")).toBeUndefined()
    // copper-plate is an intermediate — also already in flow.
    expect(suggestions.find((s) => s.item === "copper-plate")).toBeUndefined()
  })

  it("ranks higher coverage first", () => {
    const flow = expand({
      catalog,
      targets: [
        { item: "iron-plate", rate: 1 },
        { item: "copper-cable", rate: 1 },
      ],
    })
    const suggestions = recommendRecipes(catalog, flow, { minCoverage: 0 })
    // With iron-plate + copper-cable on the bus, electronic-circuit has
    // BOTH inputs available (coverage = 1.0). It should be first.
    if (suggestions.length > 0) {
      expect(suggestions[0].coverage).toBe(1)
      expect(suggestions[0].item).toBe("electronic-circuit")
    }
  })

  it("respects minCoverage filter", () => {
    const flow = expand({ catalog, targets: [{ item: "iron-plate", rate: 1 }] })
    // High floor — only suggestions with >= 90% coverage.
    const strict = recommendRecipes(catalog, flow, { minCoverage: 0.9 })
    for (const s of strict) {
      expect(s.coverage).toBeGreaterThanOrEqual(0.9)
    }
  })

  it("respects limit", () => {
    const flow = expand({ catalog, targets: [{ item: "iron-plate", rate: 1 }] })
    const limited = recommendRecipes(catalog, flow, { minCoverage: 0, limit: 1 })
    expect(limited.length).toBeLessThanOrEqual(1)
  })
})
