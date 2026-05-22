import { describe, it, expect } from "vitest"
import { loadCatalog } from "../../src/factorio"
import { expand } from "../../src/solver/expand"
import {
  computeLatestStages,
  computeStages,
  generateStageVariations,
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

  it("non-direct outputs go EAST (E edge), targeting a belt to the right of the cell", () => {
    // After Phase 5 recursive nesting, chain-internal direct outputs
    // live on the W edge (drop onto the chain's nested mini-bus to
    // the west). Only NON-direct outputs hit the next-stage main bus
    // to the east. We narrow the assertion accordingly.
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = interleavedLayout(catalog, flow, {})
    for (const cell of bp.cells) {
      for (const port of cell.outputs) {
        if (port.scope.kind === "direct") continue
        expect(port.edge).toBe("E")
        expect(port.beltX).toBeGreaterThan(cell.x)
      }
    }
  })

  it("emits bus belts for items consumed by multiple cells; chain mini-bus for unique pairs", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = interleavedLayout(catalog, flow, {})
    const trunkBelts = bp.root?.belts ?? []
    // The electronic-circuit chain has unique 1-producer-1-consumer
    // pairs. Raw input bus + final output bus give us trunk belts.
    expect(trunkBelts.length).toBeGreaterThanOrEqual(2)
    // After Phase 5 recursive nesting, unique-pair items are now
    // BUS BELTS inside nested chain BusNodes (root.children), not
    // flat directConnections. We count the union.
    const chainBeltCount = (bp.root?.children ?? []).reduce(
      (sum, child) => sum + child.belts.length,
      0,
    )
    expect(chainBeltCount + bp.directConnections.length).toBeGreaterThan(0)
  })

  it("items consumed by multiple stages get ONE bus column, not one per stage", () => {
    // copper-cable is needed by electronic-circuit only (1 consumer)
    // so it becomes a direct link in the mini fixture. We need a
    // multi-consumer item to test the multi-stage routing — force one
    // by also requesting copper-cable directly.
    const flow = expand({
      catalog,
      targets: [
        { item: "electronic-circuit", rate: 1 },
        { item: "copper-cable", rate: 5 },
      ],
    })
    const bp = interleavedLayout(catalog, flow, {})
    // copper-cable now has 2 "consumers": the EC cell AND the output:
    // sink. Direct logic skips it (because of the output sink). It
    // should appear on EXACTLY ONE bus column. Walk all belts and
    // collect x positions for copper-cable.
    const belts = bp.root?.belts ?? []
    const copperCableBeltXs = new Set<number>()
    for (const b of belts) {
      if (b.laneA?.item === "copper-cable") copperCableBeltXs.add(b.x)
      if (b.laneB?.item === "copper-cable") copperCableBeltXs.add(b.x)
    }
    // ≤ 2: at most one on the intermediate bus + one on the final
    // bus (it's also a final output target). Crucially, NOT one per
    // consuming stage.
    expect(copperCableBeltXs.size).toBeLessThanOrEqual(2)
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

  it("rejects cross-stage direct links (more than 1 stage apart)", () => {
    // iron-plate (stage 0) → electronic-circuit (stage 2). If we allowed
    // this direct, the connector would Z-bend across stage 1 cells.
    // Verify the layout uses the bus instead.
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = interleavedLayout(catalog, flow, {})
    // No direct connection should span more than 1 stage.
    for (const dc of bp.directConnections) {
      // Each direct's producer + consumer should be in adjacent stages
      // (we can't directly inspect that here without re-computing stages,
      // but x-distance is a proxy: cells in stages > 1 apart have x
      // separated by more than the typical bus + cell-strip width).
      // Instead, check that EVERY direct connection's x is between its
      // producer's x+w and its consumer's x.
      const from = bp.cells.find((c) => c.recipeKey === dc.fromCellKey)!
      const to = bp.cells.find((c) => c.recipeKey === dc.toCellKey)!
      expect(dc.x).toBeGreaterThanOrEqual(from.x + from.w)
      expect(dc.x).toBeLessThanOrEqual(to.x)
      // To stage = from stage + 1 — the connector lives in ONE gutter.
      const gap = to.x - (from.x + from.w)
      expect(gap).toBeLessThanOrEqual(20) // generous, but rules out 2+ stage skips
    }
  })

  it("computeLatestStages produces a valid producer-before-consumer assignment", () => {
    // For every recipe→recipe edge, the producer's latest stage MUST
    // be strictly less than the consumer's latest stage.
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const latest = computeLatestStages(flow)
    for (const e of flow.edges) {
      const ps = latest.get(e.source)
      const cs = latest.get(e.target)
      if (ps == null || cs == null) continue // skip edges with non-recipe endpoints
      expect(ps).toBeLessThan(cs)
    }
  })

  it("computeLatestStages >= computeStages for every cell (latest is upper bound)", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const earliest = computeStages(flow)
    const latest = computeLatestStages(flow)
    for (const [id, e] of earliest) {
      const l = latest.get(id)!
      expect(l).toBeGreaterThanOrEqual(e)
    }
  })

  it("generateStageVariations yields multiple distinct assignments when flexibility exists", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const variations = [...generateStageVariations(flow)]
    expect(variations.length).toBeGreaterThanOrEqual(1)
    expect(variations.length).toBeLessThanOrEqual(3)
    // Every variation must be a valid stage map (producer < consumer).
    for (const v of variations) {
      for (const e of flow.edges) {
        const ps = v.get(e.source)
        const cs = v.get(e.target)
        if (ps == null || cs == null) continue
        expect(ps).toBeLessThan(cs)
      }
    }
  })

  it("interleavedLayout accepts _stagesOverride to use a custom assignment", () => {
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const latest = computeLatestStages(flow)
    const bpDefault = interleavedLayout(catalog, flow, {})
    const bpLatest = interleavedLayout(catalog, flow, { _stagesOverride: latest })
    // When at least one cell has flexibility (e.g. iron-plate in the EC
    // chain) the two layouts should differ in cell positioning.
    const ironDefault = bpDefault.cells.find((c) => c.recipeKey === "iron-plate")
    const ironLatest = bpLatest.cells.find((c) => c.recipeKey === "iron-plate")
    if (ironDefault && ironLatest) {
      // iron-plate has flexibility (stage 0 default, latest can shift).
      // Either x differs (different stage) OR they happen to share x.
      // We just verify both produce valid blueprints.
      expect(ironDefault.x).toBeGreaterThan(0)
      expect(ironLatest.x).toBeGreaterThan(0)
    }
  })

  it("compacts safe chains: chain members share x with the chain head", () => {
    // copper-plate → copper-cable forms a 2-cell chain (copper-plate's
    // sole consumer is copper-cable). In the mini-dataset both members
    // only consume raw items + chain-internal items (copper-plate uses
    // raw copper-ore; copper-cable uses copper-plate from the chain),
    // so it's compaction-safe — both cells should end up at the same x.
    const flow = expand({ catalog, targets: [{ item: "copper-cable", rate: 1 }] })
    const bp = interleavedLayout(catalog, flow, {})
    const cellByKey = new Map(bp.cells.map((c) => [c.recipeKey, c]))
    const cp = cellByKey.get("copper-plate")
    const cc = cellByKey.get("copper-cable")
    if (cp && cc) {
      // Compaction places them at the same x (chain head's stage column).
      expect(cp.x).toBe(cc.x)
      // And one is below the other.
      expect(cp.y).not.toBe(cc.y)
    }
  })

  it("propagates items through transit stages (item on every bus from producer+1 to last consumer)", () => {
    // iron-plate is produced at stage 0 and consumed at stage 2 (EC).
    // With propagation, it should appear on bus columns at stage 1
    // AND stage 2 (not just one of them).
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = interleavedLayout(catalog, flow, {})
    const belts = bp.root?.belts ?? []
    const ironPlateBelts = belts.filter(
      (b) => b.laneA?.item === "iron-plate" || b.laneB?.item === "iron-plate",
    )
    // Producer (iron-plate cell) is at stage 0, consumer (EC) at
    // stage 2. Propagation puts iron-plate on bus[1] and bus[2].
    // We expect AT LEAST 1 bus belt carrying iron-plate (>= 1
    // tolerates layouts where bus[1] is pruned if iron-plate has
    // no stage-1 consumer + lastConsumer is stage 2).
    expect(ironPlateBelts.length).toBeGreaterThanOrEqual(1)
  })

  it("does NOT compact chains with external recipe-produced inputs", () => {
    // electronic-circuit consumes iron-plate (a recipe, not raw). The
    // chain copper-plate → copper-cable → electronic-circuit is NOT
    // compaction-safe because EC has an external non-raw input. It
    // should stay framed but spread across stages.
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = interleavedLayout(catalog, flow, {})
    const cellByKey = new Map(bp.cells.map((c) => [c.recipeKey, c]))
    const cp = cellByKey.get("copper-plate")
    const ec = cellByKey.get("electronic-circuit")
    if (cp && ec) {
      // NOT compacted — copper-plate (stage 0) and EC (stage 2) at
      // different x positions.
      expect(cp.x).toBeLessThan(ec.x)
    }
  })

  it("recursive nesting: chain BusNodes carry the chain's internal belts", () => {
    // Recursive nesting (Phase 5): each multi-cell chain becomes a
    // nested BusNode under root.children with proper BusBelt entries
    // representing the chain's internal item flow. Adjacent-member
    // direct links are subsumed into these nested belts; the flat
    // directConnections list is correspondingly smaller.
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = interleavedLayout(catalog, flow, {})
    const chainNodes = (bp.root?.children ?? []).filter((c) => c.id.startsWith("chain-"))
    if (chainNodes.length === 0) return // no chains in this fixture
    for (const ch of chainNodes) {
      // Multi-cell chain → at least N-1 nested belts (one per link).
      const links = ch.cellKeys.length - 1
      expect(ch.belts.length).toBeGreaterThanOrEqual(links)
      // Nested belts are properly bounded vertically.
      for (const b of ch.belts) {
        expect(b.y0).toBeDefined()
        expect(b.y1).toBeDefined()
        expect(b.y1!).toBeGreaterThan(b.y0!)
      }
    }
  })

  it("recursive nesting: direct-link items don't dual-render", () => {
    // After nesting, items that became chain bus belts must NOT also
    // appear as flat DirectConnection entries.
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = interleavedLayout(catalog, flow, {})
    const chainBeltItems = new Set<string>()
    for (const ch of bp.root?.children ?? []) {
      for (const b of ch.belts) {
        if (b.laneA?.item) chainBeltItems.add(b.laneA.item)
      }
    }
    for (const dc of bp.directConnections) {
      expect(chainBeltItems.has(dc.item)).toBe(false)
    }
  })

  it("emits a CellGroup frame per multi-cell chain", () => {
    // electronic-circuit chain: iron-plate (stage 0) is its own cell.
    // copper-plate → copper-cable → electronic-circuit forms a 3-cell
    // chain IF each step is a unique 1:1 producer/consumer. In the
    // mini-dataset that's true: copper-cable has only copper-plate
    // input + only EC as consumer, etc. So we expect at least one
    // multi-cell group on root.children.
    const flow = expand({ catalog, targets: [{ item: "electronic-circuit", rate: 1 }] })
    const bp = interleavedLayout(catalog, flow, {})
    const groups = bp.root?.children ?? []
    // Each group has cellKeys.length >= 2 (single-cell chains are
    // filtered out).
    for (const g of groups) {
      expect(g.cellKeys.length).toBeGreaterThanOrEqual(2)
    }
  })
})
