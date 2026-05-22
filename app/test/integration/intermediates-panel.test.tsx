import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { IntermediatesPanel } from "../../src/views/schematic/IntermediatesPanel"
import { CatalogProvider } from "../../src/factorio/CatalogContext"
import { RateUnitProvider } from "../../src/util/RateUnitContext"
import { loadCatalog, type Machine, type Recipe } from "../../src/factorio"
import { expand, type FlowGraph, type FlowNode } from "../../src/solver/expand"
import { miniDataset } from "../fixtures/mini-dataset"

const catalog = loadCatalog(miniDataset)

function renderPanel(flow: FlowGraph | null) {
  return render(
    <CatalogProvider value={catalog}>
      <RateUnitProvider value="sec">
        <IntermediatesPanel flow={flow} defaultCollapsed={false} />
      </RateUnitProvider>
    </CatalogProvider>,
  )
}

describe("<IntermediatesPanel />", () => {
  it("lists items that are both produced and consumed internally", () => {
    // Target electronic-circuit → iron-plate is both produced (by iron-plate
    // recipe) and consumed (by electronic-circuit recipe).
    const flow = expand({
      catalog,
      targets: [{ item: "electronic-circuit", rate: 1 }],
    })
    renderPanel(flow)
    const ironRow = screen.getByTestId("intermediate-iron-plate")
    expect(ironRow).toBeInTheDocument()
    // copper-cable is also internally consumed (by electronic-circuit) and
    // produced by its own recipe, so it should also surface.
    expect(screen.getByTestId("intermediate-copper-cable")).toBeInTheDocument()
  })

  it("flags the non-targeted product of a multi-product recipe as byproduct", () => {
    // Target light-oil → crude-oil-cracking runs. Its other product
    // (heavy-oil) isn't targeted and has no consumer → byproduct.
    const flow = expand({
      catalog,
      targets: [{ item: "light-oil", rate: 1 }],
    })
    renderPanel(flow)
    const heavyStatus = screen.getByTestId("intermediate-heavy-oil-status")
    expect(heavyStatus).toHaveAttribute("data-state", "byproduct")
  })

  it("does NOT flag a user-targeted product as byproduct", () => {
    // Synthetic flow: one crude-oil-cracking node produces both light + heavy.
    // Both are user-targeted outputs. light-oil also has SOME internal
    // consumption (1 unit) so it shows up in the panel; even though it
    // comes from a multi-product recipe, the target-output flag prevents
    // it from being labeled byproduct.
    const crackingRecipe = catalog.recipes.get("crude-oil-cracking") as Recipe
    const chemPlant = catalog.machines.get("chemical-plant") as Machine
    // 1 machine, 1 craft/sec: produces 3 light + 1 heavy per second.
    const crackingNode: FlowNode = {
      id: "crude-oil-cracking",
      recipe: crackingRecipe,
      machine: chemPlant,
      rate: 1,
      count: 1,
      powerW: chemPlant.power,
    }
    // Synthetic consumer node to provide internal consumption of light-oil.
    // Reuse the cracking recipe shape but mark it as a "consumer" by
    // crafting a fictional product. We fake this with a recipe whose
    // ingredients include light-oil. There isn't one in miniDataset, so
    // we hand-roll the consumer node with a synthetic recipe.
    const lightOilSinkRecipe: Recipe = {
      key: "light-oil-sink",
      name: "Light oil sink",
      category: "chemistry",
      time: 1,
      ingredients: [{ item: "light-oil", amount: 1 }],
      products: [{ item: "iron-plate", amount: 1 }], // unused product
    }
    const sinkNode: FlowNode = {
      id: "light-oil-sink",
      recipe: lightOilSinkRecipe,
      machine: chemPlant,
      rate: 1,
      count: 1,
      powerW: chemPlant.power,
    }
    const flow: FlowGraph = {
      nodes: [crackingNode, sinkNode],
      edges: [],
      rawInputs: new Map(),
      suppliedInputs: new Map(),
      // Both light-oil and heavy-oil are user-targeted outputs.
      outputs: new Map([["light-oil", 1], ["heavy-oil", 1]]),
      totalPowerW: 0,
    }
    renderPanel(flow)
    // light-oil is internally consumed by the sink AND a target output.
    // It should appear (internalCons > 0) but NOT be byproduct.
    const lightStatus = screen.getByTestId("intermediate-light-oil-status")
    expect(lightStatus).not.toHaveAttribute("data-state", "byproduct")
  })

  it("sorts byproducts ahead of non-byproduct intermediates", () => {
    // Construct a flow where iron-plate is a normal intermediate AND heavy-oil
    // is a byproduct from a multi-product recipe.
    const flow = expand({
      catalog,
      targets: [
        { item: "electronic-circuit", rate: 1 },
        { item: "light-oil", rate: 1 },
      ],
    })
    renderPanel(flow)
    const heavyRow = screen.getByTestId("intermediate-heavy-oil")
    const ironRow = screen.getByTestId("intermediate-iron-plate")
    // heavy-oil (byproduct) renders before iron-plate (normal intermediate).
    expect(heavyRow.compareDocumentPosition(ironRow)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })
})
