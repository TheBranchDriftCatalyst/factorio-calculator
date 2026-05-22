import { describe, it, expect } from "vitest"
import {
  tapDistanceCost,
  orderByTapDistance,
  type CostNode,
} from "../../src/blueprint/layout/cost"

function nodes(
  defs: Array<{ id: string; inputs: string[]; producers?: string[] }>,
): CostNode[] {
  return defs.map((d) => ({
    id: d.id,
    inputs: new Set(d.inputs),
    producers: new Set(d.producers ?? []),
  }))
}

function asMap(ns: CostNode[]): Map<string, CostNode> {
  return new Map(ns.map((n) => [n.id, n]))
}

describe("cost · tapDistanceCost", () => {
  it("is 0 for a single-cell scope", () => {
    const ns = nodes([{ id: "a", inputs: ["x"] }])
    expect(tapDistanceCost(["a"], asMap(ns))).toBe(0)
  })

  it("is 0 when no input is shared", () => {
    const ns = nodes([
      { id: "a", inputs: ["x"] },
      { id: "b", inputs: ["y"] },
      { id: "c", inputs: ["z"] },
    ])
    expect(tapDistanceCost(["a", "b", "c"], asMap(ns))).toBe(0)
  })

  it("counts span across shared inputs only", () => {
    // 'iron' consumed at positions 0, 2 → span 2.
    // 'copper' consumed at positions 1, 2 → span 1.
    // 'gold' consumed only at position 0 → 0.
    const ns = nodes([
      { id: "a", inputs: ["iron", "gold"] },
      { id: "b", inputs: ["copper"] },
      { id: "c", inputs: ["iron", "copper"] },
    ])
    expect(tapDistanceCost(["a", "b", "c"], asMap(ns))).toBe(3)
  })

  it("rewards clustering: closer placement shrinks cost", () => {
    const ns = nodes([
      { id: "a", inputs: ["iron"] },
      { id: "b", inputs: ["copper"] },
      { id: "c", inputs: ["iron"] },
    ])
    const m = asMap(ns)
    // 'iron' span: in [a,b,c] = 2; in [a,c,b] = 1; in [b,a,c] = 1.
    expect(tapDistanceCost(["a", "b", "c"], m)).toBe(2)
    expect(tapDistanceCost(["a", "c", "b"], m)).toBe(1)
  })
})

describe("cost · orderByTapDistance", () => {
  it("returns a single-element array unchanged", () => {
    expect(orderByTapDistance(nodes([{ id: "only", inputs: [] }]))).toEqual(["only"])
  })

  it("preserves topological constraints: producer always before consumer", () => {
    // 'b' consumes from 'a' (in-scope producer). Any valid ordering must
    // have 'a' before 'b' even if similarity would prefer otherwise.
    const ns = nodes([
      { id: "b", inputs: ["x"], producers: ["a"] },
      { id: "a", inputs: ["x"] },
    ])
    const out = orderByTapDistance(ns)
    expect(out.indexOf("a")).toBeLessThan(out.indexOf("b"))
  })

  it("clusters cells with shared inputs", () => {
    // Three cells: a + c share 'iron'; b is unrelated. The heuristic
    // should put a and c adjacent (cost 1) instead of separated (cost 2).
    const ns = nodes([
      { id: "a", inputs: ["iron"] },
      { id: "b", inputs: ["wood"] },
      { id: "c", inputs: ["iron"] },
    ])
    const out = orderByTapDistance(ns)
    const cost = tapDistanceCost(out, asMap(ns))
    expect(cost).toBe(1)
    // a and c must be neighbors in the result.
    expect(Math.abs(out.indexOf("a") - out.indexOf("c"))).toBe(1)
  })

  it("regression: never increases cost vs the input order", () => {
    // Throw a moderately tangled scope at it; the output must not be
    // WORSE than the original input ordering.
    const ns = nodes([
      { id: "x", inputs: ["iron", "copper"] },
      { id: "y", inputs: ["wood"] },
      { id: "z", inputs: ["iron"] },
      { id: "w", inputs: ["copper", "wood"] },
      { id: "v", inputs: ["iron", "copper", "wood"] },
    ])
    const inputCost = tapDistanceCost(
      ns.map((n) => n.id),
      asMap(ns),
    )
    const outCost = tapDistanceCost(orderByTapDistance(ns), asMap(ns))
    expect(outCost).toBeLessThanOrEqual(inputCost)
  })

  it("respects topology even when similarity wants to swap", () => {
    // a → b → c chain; all consume different items so similarity wouldn't
    // help. d shares input with a. Without topo respect, greedy could
    // place [a, d, b, c] (similarity prefers d next to a) — which is fine.
    // But it CANNOT emit b before a or c before b.
    const ns = nodes([
      { id: "a", inputs: ["iron"] },
      { id: "b", inputs: ["a_product"], producers: ["a"] },
      { id: "c", inputs: ["b_product"], producers: ["b"] },
      { id: "d", inputs: ["iron"] },
    ])
    const out = orderByTapDistance(ns)
    expect(out.indexOf("a")).toBeLessThan(out.indexOf("b"))
    expect(out.indexOf("b")).toBeLessThan(out.indexOf("c"))
  })

  it("handles disconnected groups deterministically", () => {
    // Two independent pairs: (a,b) share iron, (c,d) share copper.
    // Output should cluster each pair internally.
    const ns = nodes([
      { id: "a", inputs: ["iron"] },
      { id: "c", inputs: ["copper"] },
      { id: "b", inputs: ["iron"] },
      { id: "d", inputs: ["copper"] },
    ])
    const out = orderByTapDistance(ns)
    expect(Math.abs(out.indexOf("a") - out.indexOf("b"))).toBe(1)
    expect(Math.abs(out.indexOf("c") - out.indexOf("d"))).toBe(1)
  })
})
