import { describe, it, expect } from "vitest"
import { loadCatalog } from "../../src/factorio"
import { expand } from "../../src/solver/expand"
import { busLayout } from "../../src/blueprint/layout/busLayout"
import {
  LAYOUT_ALGORITHMS,
  LAYOUT_ALGORITHM_LIST,
  DEFAULT_LAYOUT_ALGORITHM,
  runLayout,
} from "../../src/blueprint/layout/algorithms"
import { miniDataset } from "../fixtures/mini-dataset"

const catalog = loadCatalog(miniDataset)
const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })

describe("layout algorithm registry", () => {
  it("ships at least the bus-tree algorithm as default", () => {
    expect(LAYOUT_ALGORITHMS[DEFAULT_LAYOUT_ALGORITHM]).toBeDefined()
    expect(DEFAULT_LAYOUT_ALGORITHM).toBe("bus-tree")
  })

  it("LAYOUT_ALGORITHM_LIST is consistent with the keyed registry", () => {
    for (const algo of LAYOUT_ALGORITHM_LIST) {
      expect(LAYOUT_ALGORITHMS[algo.id]).toBe(algo)
    }
    expect(LAYOUT_ALGORITHM_LIST.length).toBe(Object.keys(LAYOUT_ALGORITHMS).length)
  })

  it("every registered algorithm has a non-empty label + description", () => {
    for (const algo of LAYOUT_ALGORITHM_LIST) {
      expect(algo.label.length).toBeGreaterThan(0)
      expect(algo.description.length).toBeGreaterThan(0)
    }
  })

  it("the production-first ordering keeps non-experimental algorithms before experimental ones", () => {
    let sawExperimental = false
    for (const algo of LAYOUT_ALGORITHM_LIST) {
      if (algo.experimental) sawExperimental = true
      else if (sawExperimental) {
        throw new Error(`Non-experimental algorithm "${algo.id}" appears after an experimental one`)
      }
    }
  })

  it("runLayout dispatches to the named algorithm", () => {
    // The bus-tree id MUST produce the same Blueprint shape as calling
    // busLayout directly — the algorithm wraps it 1:1.
    const direct = busLayout(catalog, flow, {})
    const viaRegistry = runLayout("bus-tree", catalog, flow, {})
    expect(viaRegistry.cells.length).toBe(direct.cells.length)
    expect(viaRegistry.width).toBe(direct.width)
    expect(viaRegistry.height).toBe(direct.height)
  })

  it("runLayout falls back to default for an unknown id", () => {
    // Cast through `unknown` because an invalid id is exactly the
    // condition we're testing the runtime guard against.
    const out = runLayout(
      "this-doesnt-exist" as never,
      catalog,
      flow,
      {},
    )
    // Just needs to not throw and to return a valid blueprint.
    expect(out.cells.length).toBeGreaterThan(0)
  })

  it("auto-bus algorithm exists and is marked experimental", () => {
    const auto = LAYOUT_ALGORITHMS["auto-bus"]
    expect(auto).toBeDefined()
    expect(auto.experimental).toBe(true)
  })

  it("auto-bus produces a valid Blueprint on the default fixture", () => {
    // Mini-dataset is small (no heavy items above threshold), so auto-bus
    // behaves identically to bus-tree here. We just verify it doesn't
    // crash and produces a shaped Blueprint — the real visual divergence
    // shows on the larger space-age fixture covered in E2E.
    const out = runLayout("auto-bus", catalog, flow, {})
    expect(out.cells.length).toBeGreaterThan(0)
    expect(out.width).toBeGreaterThan(0)
    expect(out.height).toBeGreaterThan(0)
  })
})
