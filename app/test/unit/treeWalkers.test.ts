import { describe, it, expect } from "vitest"
import {
  walkBelts,
  walkBusNodes,
  flattenGroups,
  type BusBelt,
  type BusNode,
} from "../../src/blueprint/types"

// Build a synthetic BusNode tree directly (no busLayout / catalog needed).
// Structure (3 belts spread across nodes, 2+ levels of nesting):
//
//   root (belt: iron-plate)
//   ├─ childA (belt: copper-cable)
//   │   └─ grandchildA1 (no belts)
//   └─ childB (belt: electronic-circuit)
//
function makeBelt(item: string, x: number): BusBelt {
  return { x, laneA: { item, rate: 1 } }
}

function makeNode(
  id: string,
  belts: BusBelt[],
  children: BusNode[],
  cellKeys: string[] = [],
  depth = 0,
): BusNode {
  return {
    id,
    depth,
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    belts,
    gutterX: belts.length ? belts.length : -1,
    scopeItems: belts.flatMap((b) => [b.laneA?.item, b.laneB?.item].filter(Boolean) as string[]),
    children,
    cellKeys,
    totalMachines: 0,
    totalPowerW: 0,
  }
}

function buildTree(): BusNode {
  const grandchildA1 = makeNode("gA1", [], [], ["cell-gA1"], 2)
  const childA = makeNode("A", [makeBelt("copper-cable", 1)], [grandchildA1], ["cell-A"], 1)
  const childB = makeNode("B", [makeBelt("electronic-circuit", 3)], [], ["cell-B"], 1)
  return makeNode("root", [makeBelt("iron-plate", 0)], [childA, childB], ["cell-root"], 0)
}

describe("walkBusNodes", () => {
  it("visits root first, then DFS pre-order through children", () => {
    const root = buildTree()
    const ids = [...walkBusNodes(root)].map((n) => n.id)
    expect(ids).toEqual(["root", "A", "gA1", "B"])
  })

  it("returns no nodes for a null root", () => {
    expect([...walkBusNodes(null)]).toEqual([])
  })
})

describe("walkBelts", () => {
  it("yields every belt across the whole tree (no duplicates)", () => {
    const root = buildTree()
    const belts = [...walkBelts(root)]
    const items = belts.map((b) => b.laneA?.item).sort()
    expect(belts).toHaveLength(3)
    expect(items).toEqual(["copper-cable", "electronic-circuit", "iron-plate"])
    // No duplicates: belts are distinct objects.
    const unique = new Set(belts)
    expect(unique.size).toBe(belts.length)
  })

  it("returns nothing for a null root", () => {
    expect([...walkBelts(null)]).toEqual([])
  })
})

describe("flattenGroups", () => {
  it("returns one CellGroup per child of root (root's belts are the trunk, not a group)", () => {
    const root = buildTree()
    const groups = flattenGroups(root)
    expect(groups).toHaveLength(2)
    const ids = groups.map((g) => g.id).sort()
    expect(ids).toEqual(["A", "B"])
    // Root itself never appears as a group.
    expect(groups.find((g) => g.id === "root")).toBeUndefined()
  })

  it("recursively collects cellKeys from descendants into each group", () => {
    const root = buildTree()
    const groups = flattenGroups(root)
    const groupA = groups.find((g) => g.id === "A")!
    // childA's cell + grandchildA1's cell
    expect(groupA.cellKeys.sort()).toEqual(["cell-A", "cell-gA1"])
    const groupB = groups.find((g) => g.id === "B")!
    expect(groupB.cellKeys).toEqual(["cell-B"])
  })

  it("returns an empty array for a null root", () => {
    expect(flattenGroups(null)).toEqual([])
  })
})
