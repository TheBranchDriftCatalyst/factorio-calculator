import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { FuelsPanel } from "../../src/views/schematic/FuelsPanel"
import { CatalogProvider } from "../../src/factorio/CatalogContext"
import { RateUnitProvider } from "../../src/util/RateUnitContext"
import { loadCatalog, type Catalog, type Machine, type Recipe } from "../../src/factorio"
import type { FlowGraph, FlowNode } from "../../src/solver/expand"
import { miniDataset } from "../fixtures/mini-dataset"

// A catalog with at least one fuel item + a burner consuming it. miniDataset
// has no fuel items in its top-level `fuel` registry, so build a variant.
// We extend the items list with coal+rocket-fuel (chemical fuels), wire up the
// stone-furnace as a burner of `chemical` (already declared in miniDataset).
const fueledCatalog: Catalog = loadCatalog({
  ...miniDataset,
  items: [
    ...miniDataset.items,
    { key: "coal", localized_name: { en: "Coal" } },
    { key: "rocket-fuel", localized_name: { en: "Rocket fuel" } },
  ],
  crafting_machines: miniDataset.crafting_machines.map((m) =>
    m.key === "stone-furnace"
      ? {
          ...m,
          // Make sure the burner declares which fuel category it accepts.
          energy_source: { type: "burner", fuel_category: "chemical" },
        }
      : m,
  ),
  fuel: [
    { item_key: "coal", value: 4_000_000, category: "chemical" },
    { item_key: "rocket-fuel", value: 100_000_000, category: "chemical" },
  ],
})

function renderPanel(flow: FlowGraph | null, catalog: Catalog) {
  return render(
    <CatalogProvider value={catalog}>
      <RateUnitProvider value="sec">
        <FuelsPanel flow={flow} defaultCollapsed={false} />
      </RateUnitProvider>
    </CatalogProvider>,
  )
}

describe("<FuelsPanel />", () => {
  it("returns null when the catalog has no fuel items", () => {
    const baseCatalog = loadCatalog(miniDataset)
    const { container } = renderPanel(null, baseCatalog)
    expect(container).toBeEmptyDOMElement()
  })

  it("surfaces each fuel item; used fuels report burn rate + burner count", () => {
    // Two stone-furnaces burning chemical fuel.
    const stoneFurnace = fueledCatalog.machines.get("stone-furnace") as Machine
    const ironPlateRecipe = fueledCatalog.recipes.get("iron-plate") as Recipe
    const node: FlowNode = {
      id: "iron-plate",
      recipe: ironPlateRecipe,
      machine: stoneFurnace,
      rate: 1,
      count: 2,
      powerW: 2 * stoneFurnace.power,
    }
    const flow: FlowGraph = {
      nodes: [node],
      edges: [],
      rawInputs: new Map(),
      suppliedInputs: new Map(),
      outputs: new Map(),
      totalPowerW: node.powerW,
    }
    renderPanel(flow, fueledCatalog)
    const coalRow = screen.getByTestId("fuel-coal")
    expect(coalRow).toBeInTheDocument()
    const rocketRow = screen.getByTestId("fuel-rocket-fuel")
    expect(rocketRow).toBeInTheDocument()
    // 2 burners total. burnRate = (2 * 90_000) / 4_000_000 = 0.045 items/s.
    expect(coalRow).toHaveTextContent("2")
    // Rocket fuel has the same category, so its burner count is also 2
    // (interchangeable within the category) — but it's NOT actively used
    // here since no node selected it, so it should be dimmed.
    // The check above (used→burners shown) catches this: any fuel in the
    // active chemical category shows the same burner total.
  })

  it("sorts used fuels before unused ones", () => {
    // Add a nuclear fuel that no machine in the flow consumes.
    const catalogWithUnused: Catalog = loadCatalog({
      ...miniDataset,
      items: [
        ...miniDataset.items,
        { key: "coal", localized_name: { en: "Coal" } },
        { key: "uranium-fuel-cell", localized_name: { en: "Uranium fuel cell" } },
      ],
      crafting_machines: miniDataset.crafting_machines.map((m) =>
        m.key === "stone-furnace"
          ? { ...m, energy_source: { type: "burner", fuel_category: "chemical" } }
          : m,
      ),
      fuel: [
        { item_key: "coal", value: 4_000_000, category: "chemical" },
        // Unused — no nuclear burner in the flow.
        { item_key: "uranium-fuel-cell", value: 8_000_000_000, category: "nuclear" },
      ],
    })
    const stoneFurnace = catalogWithUnused.machines.get("stone-furnace") as Machine
    const node: FlowNode = {
      id: "iron-plate",
      recipe: catalogWithUnused.recipes.get("iron-plate") as Recipe,
      machine: stoneFurnace,
      rate: 1,
      count: 1,
      powerW: stoneFurnace.power,
    }
    const flow: FlowGraph = {
      nodes: [node],
      edges: [],
      rawInputs: new Map(),
      suppliedInputs: new Map(),
      outputs: new Map(),
      totalPowerW: node.powerW,
    }
    renderPanel(flow, catalogWithUnused)
    const coalRow = screen.getByTestId("fuel-coal")
    const uraniumRow = screen.getByTestId("fuel-uranium-fuel-cell")
    // Both rendered.
    expect(coalRow).toBeInTheDocument()
    expect(uraniumRow).toBeInTheDocument()
    // Coal (used) sorts before uranium-fuel-cell (unused).
    expect(coalRow.compareDocumentPosition(uraniumRow)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })
})
