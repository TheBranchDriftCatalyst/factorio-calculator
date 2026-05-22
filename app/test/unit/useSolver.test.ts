import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { loadCatalog } from "../../src/factorio"
import { miniDataset } from "../fixtures/mini-dataset"
import type { FlowGraph, SolveRequest } from "../../src/solver/expand"
import { expand } from "../../src/solver/expand"

// We mock the worker shim so we can control resolution order in the
// staleness test. The real production path runs the worker; in the test
// environment vitest's jsdom doesn't ship a Worker constructor that can
// resolve Vite's `?worker` import, so we'd hit the main-thread fallback
// anyway. Mocking makes the contract explicit and gives us deferred
// resolution for the stale-response test.
vi.mock("../../src/solver/expandClient", async () => {
  const actual = await vi.importActual<typeof import("../../src/solver/expand")>(
    "../../src/solver/expand",
  )
  return {
    solveExpand: vi.fn((args: SolveRequest) => Promise.resolve(actual.expand(args))),
    hydrateCatalog: vi.fn(),
    _resetExpandWorker: vi.fn(),
  }
})

// Import the hook + mocked module AFTER vi.mock so the hook sees the mock.
import { useSolver } from "../../src/solver/useSolver"
import { solveExpand } from "../../src/solver/expandClient"

const catalog = loadCatalog(miniDataset)
const mockedSolveExpand = solveExpand as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockedSolveExpand.mockReset()
  // Default behavior: synchronous-ish real expand() through a Promise.
  mockedSolveExpand.mockImplementation((args: SolveRequest) =>
    Promise.resolve(expand(args)),
  )
})

afterEach(() => {
  vi.useRealTimers()
})

describe("useSolver", () => {
  it("returns flow: null when catalog is null", () => {
    const { result } = renderHook(() =>
      useSolver({
        catalog: null,
        targets: [],
        inputs: [],
        machineOverrides: {},
        recipeChoices: {},
        machineCategoryDefaults: {},
      }),
    )
    expect(result.current.flow).toBeNull()
    // No catalog → not "initial solving" either; isInitialSolve requires a catalog.
    expect(result.current.isInitialSolve).toBe(false)
  })

  it("returns a FlowGraph after catalog + targets resolve", async () => {
    const { result } = renderHook(() =>
      useSolver({
        catalog,
        targets: [{ item: "electronic-circuit", rate: 1 }],
        inputs: [],
        machineOverrides: {},
        recipeChoices: {},
        machineCategoryDefaults: {},
      }),
    )

    await waitFor(() => {
      expect(result.current.flow).not.toBeNull()
    })

    const flow = result.current.flow as FlowGraph
    // Should have a node for electronic-circuit itself.
    expect(flow.nodes.some((n) => n.id === "electronic-circuit")).toBe(true)
  })

  it("isInitialSolve is true on first render, false after flow resolves", async () => {
    const { result } = renderHook(() =>
      useSolver({
        catalog,
        targets: [{ item: "iron-plate", rate: 1 }],
        inputs: [],
        machineOverrides: {},
        recipeChoices: {},
        machineCategoryDefaults: {},
      }),
    )

    // Before the promise resolves: flow is null but catalog is present, so initial-solve is true.
    expect(result.current.isInitialSolve).toBe(true)

    await waitFor(() => {
      expect(result.current.flow).not.toBeNull()
    })

    expect(result.current.isInitialSolve).toBe(false)
  })

  it("discards stale responses: an older in-flight solve never clobbers a newer one", async () => {
    // First call returns ONLY when we release it manually; second call
    // resolves immediately. If the hook is correctly tracking request IDs,
    // the final state should reflect the SECOND call's result even though
    // the first call resolves later.
    let releaseFirst: (g: FlowGraph) => void = () => {}
    const firstPromise = new Promise<FlowGraph>((resolve) => {
      releaseFirst = resolve
    })

    mockedSolveExpand.mockImplementationOnce(() => firstPromise)
    // Subsequent calls use the default mock (synchronous real expand).

    const initialProps = {
      catalog,
      targets: [{ item: "iron-plate", rate: 1 }],
      inputs: [],
      machineOverrides: {},
      recipeChoices: {},
      machineCategoryDefaults: {},
    } as const

    const { result, rerender } = renderHook(
      (props: Parameters<typeof useSolver>[0]) => useSolver(props),
      { initialProps },
    )

    // Trigger a SECOND solve by changing the targets prop reference.
    rerender({
      ...initialProps,
      targets: [{ item: "copper-cable", rate: 1 }],
    })

    // Wait for the second solve to land (it resolves synchronously via the
    // default mock implementation, after a microtask).
    await waitFor(() => {
      expect(result.current.flow).not.toBeNull()
    })

    const flowAfterSecond = result.current.flow as FlowGraph
    // Capture which node ids the second solve produced.
    const secondNodeIds = new Set(flowAfterSecond.nodes.map((n) => n.id))
    expect(secondNodeIds.has("copper-cable")).toBe(true)

    // Now release the FIRST (stale) promise with a sentinel flow that has
    // a unique node id we can check did NOT overwrite the live result.
    const staleFlow: FlowGraph = {
      nodes: [
        {
          id: "stale-sentinel",
          rate: 0,
          count: 0,
          powerW: 0,
        },
      ],
      edges: [],
      rawInputs: new Map(),
      suppliedInputs: new Map(),
      outputs: new Map(),
    }
    await act(async () => {
      releaseFirst(staleFlow)
      // Yield microtasks so the late .then() runs.
      await Promise.resolve()
    })

    // The stale resolution must be discarded — flow should still be the
    // second solve's result, not the sentinel.
    const finalIds = new Set((result.current.flow as FlowGraph).nodes.map((n) => n.id))
    expect(finalIds.has("stale-sentinel")).toBe(false)
    expect(finalIds.has("copper-cable")).toBe(true)
  })
})
