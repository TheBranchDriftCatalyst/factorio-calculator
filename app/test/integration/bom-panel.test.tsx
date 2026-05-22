import { describe, it, expect } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { BomPanel } from "../../src/views/schematic/BomPanel"
import { CatalogProvider } from "../../src/factorio/CatalogContext"
import { RateUnitProvider } from "../../src/util/RateUnitContext"
import { loadCatalog, type Machine, type Recipe } from "../../src/factorio"
import type { FlowGraph, FlowNode } from "../../src/solver/expand"
import type {
  Blueprint,
  BusNode,
  BusBelt,
  InserterPlacement,
} from "../../src/blueprint/types"
import { miniDataset } from "../fixtures/mini-dataset"

const catalog = loadCatalog(miniDataset)

// Convenience: build a FlowNode the BomPanel will consume. Only the
// fields BomPanel reads need to be populated.
function makeNode(recipeKey: string, machineKey: string, count: number): FlowNode {
  const recipe = catalog.recipes.get(recipeKey) as Recipe
  const machine = catalog.machines.get(machineKey) as Machine
  return {
    id: recipeKey,
    recipe,
    machine,
    rate: 1,
    count,
    powerW: count * (machine?.power ?? 0),
  }
}

function makeBelt(x: number, item: string, rate: number): BusBelt {
  return {
    x,
    laneA: { item, rate },
  }
}

function makeBusNode(belts: BusBelt[]): BusNode {
  return {
    id: "root",
    depth: 0,
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    belts,
    gutterX: -1,
    scopeItems: belts.map((b) => b.laneA?.item ?? ""),
    children: [],
    cellKeys: [],
    totalMachines: 0,
    totalPowerW: 0,
  }
}

function makeBlueprint(opts: {
  belts?: BusBelt[]
  inserters?: InserterPlacement[]
}): Blueprint {
  return {
    width: 10,
    height: 10,
    beltWidth: 2,
    busWidth: 0,
    gutterX: -1,
    root: opts.belts ? makeBusNode(opts.belts) : null,
    cells: [],
    inserters: opts.inserters ?? [],
    directConnections: [],
    unsupported: [],
  }
}

function makeFlow(nodes: FlowNode[]): FlowGraph {
  return {
    nodes,
    edges: [],
    rawInputs: new Map(),
    suppliedInputs: new Map(),
    outputs: new Map(),
    totalPowerW: nodes.reduce((s, n) => s + n.powerW, 0),
  }
}

function renderPanel(flow: FlowGraph, blueprint: Blueprint, opts: {
  beltTier?: "yellow" | "red" | "blue" | "turbo"
  beltOverrides?: Record<string, "yellow" | "red" | "blue" | "turbo">
} = {}) {
  return render(
    <CatalogProvider value={catalog}>
      <RateUnitProvider value="sec">
        <BomPanel
          flow={flow}
          blueprint={blueprint}
          beltTier={opts.beltTier}
          beltOverrides={opts.beltOverrides}
          defaultCollapsed={false}
        />
      </RateUnitProvider>
    </CatalogProvider>,
  )
}

describe("<BomPanel />", () => {
  it("sums ceil-counts grouped by machine.key", () => {
    // 3 recipe nodes: two stone-furnace (counts 2 + 3) and one EM-plant (count 1).
    // After ceil → 2 + 3 = 5 furnaces, 1 EM-plant.
    const flow = makeFlow([
      makeNode("iron-plate", "stone-furnace", 2),
      makeNode("copper-plate", "stone-furnace", 3),
      makeNode("electronic-circuit", "electromagnetic-plant", 1),
    ])
    renderPanel(flow, makeBlueprint({}))
    const furnaceRow = screen.getByTestId("bom-machine-stone-furnace")
    expect(furnaceRow).toHaveTextContent("×5")
    const emRow = screen.getByTestId("bom-machine-electromagnetic-plant")
    expect(emRow).toHaveTextContent("×1")
  })

  it("splits belt rows by effective tier with overrides taking precedence", () => {
    // Two belts at known x positions. Global tier=blue, but iron-plate is
    // pinned to turbo via override.
    const flow = makeFlow([makeNode("iron-plate", "stone-furnace", 1)])
    const blueprint = makeBlueprint({
      belts: [
        makeBelt(0, "iron-plate", 5),
        makeBelt(2, "copper-plate", 5),
      ],
    })
    renderPanel(flow, blueprint, {
      beltTier: "blue",
      beltOverrides: { "iron-plate": "turbo" },
    })
    // iron-plate belt → turbo. copper-plate belt → blue (global default).
    expect(screen.getByTestId("bom-belts-turbo")).toBeInTheDocument()
    expect(screen.getByTestId("bom-belts-blue")).toBeInTheDocument()
    // No yellow / red rows should appear since neither tier is in use.
    expect(screen.queryByTestId("bom-belts-yellow")).toBeNull()
    expect(screen.queryByTestId("bom-belts-red")).toBeNull()
  })

  it("inserter count matches blueprint.inserters.length", () => {
    const flow = makeFlow([makeNode("iron-plate", "stone-furnace", 1)])
    const inserters: InserterPlacement[] = [
      {
        x: 0, y: 0, facing: "east", direction: "input",
        beltX: 0, cellKey: "c1", item: "iron-ore", rate: 1, scope: "trunk",
      },
      {
        x: 0, y: 1, facing: "west", direction: "output",
        beltX: 0, cellKey: "c1", item: "iron-plate", rate: 1, scope: "trunk",
      },
      {
        x: 0, y: 2, facing: "east", direction: "input",
        beltX: 0, cellKey: "c2", item: "iron-ore", rate: 1, scope: "trunk",
      },
    ]
    const blueprint = makeBlueprint({
      belts: [makeBelt(0, "iron-plate", 5)],
      inserters,
    })
    renderPanel(flow, blueprint)
    const inserterRow = screen.getByTestId("bom-inserters")
    expect(inserterRow).toHaveTextContent("×3")
  })

  it("renders the totals badge in NM · NB · NI format", () => {
    // 2 furnaces (count 2) + 1 EM-plant (count 1) → 3 machines.
    const flow = makeFlow([
      makeNode("iron-plate", "stone-furnace", 2),
      makeNode("electronic-circuit", "electromagnetic-plant", 1),
    ])
    const blueprint = makeBlueprint({
      belts: [
        // y0=0, y1=4 → extent = 4 tiles.
        { x: 0, laneA: { item: "iron-plate", rate: 1 }, y0: 0, y1: 4 },
      ],
      inserters: [
        {
          x: 0, y: 0, facing: "east", direction: "input",
          beltX: 0, cellKey: "c1", item: "iron-ore", rate: 1, scope: "trunk",
        },
        {
          x: 0, y: 1, facing: "east", direction: "input",
          beltX: 0, cellKey: "c1", item: "iron-ore", rate: 1, scope: "trunk",
        },
      ],
    })
    renderPanel(flow, blueprint)
    const panel = screen.getByTestId("bom-panel")
    // Badge — 3M · 4B · 2I
    expect(within(panel).getByText(/3M\s*·\s*4B\s*·\s*2I/)).toBeInTheDocument()
  })
})
