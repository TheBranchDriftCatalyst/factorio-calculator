import { describe, it, expect } from "vitest"
import { loadCatalog } from "../../src/factorio"
import type { Recipe } from "../../src/factorio"
import { computeIOShape, ioShapeLabel, type IOShape } from "../../src/solver/ioShape"
import { expand } from "../../src/solver/expand"
import { miniDataset } from "../fixtures/mini-dataset"

const catalog = loadCatalog(miniDataset)

describe("computeIOShape", () => {
  it("smelting iron-plate is 1:1 with no fluids", () => {
    const recipe = catalog.recipes.get("iron-plate")!
    const shape = computeIOShape(recipe, catalog.fluidItems)
    expect(shape).toEqual<IOShape>({
      solidsIn: 1,
      fluidsIn: 0,
      solidsOut: 1,
      fluidsOut: 0,
    })
  })

  it("electronic-circuit is 2:1 (2 solid inputs → 1 solid output)", () => {
    const recipe = catalog.recipes.get("electronic-circuit")!
    const shape = computeIOShape(recipe, catalog.fluidItems)
    expect(shape).toEqual<IOShape>({
      solidsIn: 2,
      fluidsIn: 0,
      solidsOut: 1,
      fluidsOut: 0,
    })
  })

  it("copper-cable counts STREAMS not units (amount=2 still 1:1)", () => {
    // Recipe: 1 copper-plate → 2 copper-cable. Stack size doesn't matter;
    // we count distinct streams, so shape is 1:1.
    const recipe = catalog.recipes.get("copper-cable")!
    const shape = computeIOShape(recipe, catalog.fluidItems)
    expect(shape).toEqual<IOShape>({
      solidsIn: 1,
      fluidsIn: 0,
      solidsOut: 1,
      fluidsOut: 0,
    })
  })

  it("buckets fluid ingredients/products via fluidItems set", () => {
    // Synthetic recipe with mixed solid/fluid I/O — exercises both branches.
    const recipe: Recipe = {
      key: "synthetic-chemplant",
      name: "Synthetic chem-plant recipe",
      category: "chemistry",
      time: 1,
      ingredients: [
        { item: "iron-plate", amount: 1 },
        { item: "water", amount: 50 },
      ],
      products: [
        { item: "sulfuric-acid", amount: 50 },
      ],
    }
    const fluids = new Set(["water", "sulfuric-acid"])
    const shape = computeIOShape(recipe, fluids)
    expect(shape).toEqual<IOShape>({
      solidsIn: 1,
      fluidsIn: 1,
      solidsOut: 0,
      fluidsOut: 1,
    })
  })

  it("all-fluid recipe (oil refinery-style) buckets entirely into fluid counters", () => {
    const recipe: Recipe = {
      key: "synthetic-refinery",
      name: "Synthetic refinery recipe",
      category: "oil-processing",
      time: 5,
      ingredients: [
        { item: "crude-oil", amount: 100 },
        { item: "water", amount: 50 },
      ],
      products: [
        { item: "heavy-oil", amount: 25 },
        { item: "light-oil", amount: 45 },
        { item: "petroleum-gas", amount: 55 },
      ],
    }
    const fluids = new Set([
      "crude-oil",
      "water",
      "heavy-oil",
      "light-oil",
      "petroleum-gas",
    ])
    expect(computeIOShape(recipe, fluids)).toEqual<IOShape>({
      solidsIn: 0,
      fluidsIn: 2,
      solidsOut: 0,
      fluidsOut: 3,
    })
  })
})

describe("ioShapeLabel", () => {
  it("formats pure-solid shapes without fluid suffix", () => {
    expect(ioShapeLabel({ solidsIn: 1, fluidsIn: 0, solidsOut: 1, fluidsOut: 0 })).toBe("1:1")
    expect(ioShapeLabel({ solidsIn: 2, fluidsIn: 0, solidsOut: 1, fluidsOut: 0 })).toBe("2:1")
    expect(ioShapeLabel({ solidsIn: 5, fluidsIn: 0, solidsOut: 1, fluidsOut: 0 })).toBe("5:1")
  })

  it("annotates shapes that involve fluids with the fluids suffix", () => {
    expect(
      ioShapeLabel({ solidsIn: 1, fluidsIn: 1, solidsOut: 0, fluidsOut: 1 }),
    ).toBe("2:1 (fluids: 1→1)")
    expect(
      ioShapeLabel({ solidsIn: 0, fluidsIn: 2, solidsOut: 0, fluidsOut: 3 }),
    ).toBe("2:3 (fluids: 2→3)")
  })

  it("annotates lopsided fluid shapes (only one side has fluids)", () => {
    expect(
      ioShapeLabel({ solidsIn: 1, fluidsIn: 0, solidsOut: 0, fluidsOut: 3 }),
    ).toBe("1:3 (fluids: 0→3)")
    expect(
      ioShapeLabel({ solidsIn: 0, fluidsIn: 2, solidsOut: 1, fluidsOut: 0 }),
    ).toBe("2:1 (fluids: 2→0)")
  })
})

describe("expand surfaces ioShape on recipe nodes", () => {
  it("attaches ioShape to recipe FlowNodes (and not to source nodes)", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const chip = flow.nodes.find((n) => n.id === "electronic-circuit")!
    expect(chip.ioShape).toEqual<IOShape>({
      solidsIn: 2,
      fluidsIn: 0,
      solidsOut: 1,
      fluidsOut: 0,
    })
    // source: and output: nodes carry no shape.
    const source = flow.nodes.find((n) => n.id.startsWith("source:"))!
    expect(source.ioShape).toBeUndefined()
    const output = flow.nodes.find((n) => n.id.startsWith("output:"))!
    expect(output.ioShape).toBeUndefined()
  })

  it("smelting node carries the 1:1 shape", () => {
    const flow = expand({ catalog, targets: [{ item: "iron-plate", rate: 1 }] })
    const ironPlate = flow.nodes.find((n) => n.id === "iron-plate")!
    expect(ironPlate.ioShape).toEqual<IOShape>({
      solidsIn: 1,
      fluidsIn: 0,
      solidsOut: 1,
      fluidsOut: 0,
    })
    expect(ioShapeLabel(ironPlate.ioShape!)).toBe("1:1")
  })
})
