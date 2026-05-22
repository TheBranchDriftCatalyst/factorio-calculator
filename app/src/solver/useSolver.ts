// React hook that wraps the off-thread `expand()` solver. Returns the
// latest resolved FlowGraph and an `isInitialSolve` signal for first-paint
// loading shimmers. Internally tracks a monotonically-increasing request
// id so stale solves (older request finishing AFTER a newer one) never
// clobber the result. Cancellation via effect cleanup is belt-and-suspenders.
//
// Extracted from App.tsx so the solver-invocation pattern is reusable and
// the App component stays focused on layout / state wiring.

import { useEffect, useRef, useState } from "react"
import type { Catalog } from "../factorio"
import type { FlowGraph, Input, Target } from "./expand"
import { solveExpand } from "./expandClient"

export interface UseSolverInput {
  catalog: Catalog | null
  targets: ReadonlyArray<Target>
  inputs: ReadonlyArray<Input>
  machineOverrides: Record<string, string>
  recipeChoices: Record<string, string>
  machineCategoryDefaults: Record<string, string>
}

export interface UseSolverResult {
  flow: FlowGraph | null
  /** True while a solve is in flight AND no prior result exists yet (first solve). */
  isInitialSolve: boolean
}

export function useSolver(input: UseSolverInput): UseSolverResult {
  const {
    catalog,
    targets,
    inputs,
    machineOverrides,
    recipeChoices,
    machineCategoryDefaults,
  } = input

  const [flow, setFlow] = useState<FlowGraph | null>(null)
  const latestRequestRef = useRef(0)

  useEffect(() => {
    if (!catalog) {
      setFlow(null)
      return
    }
    const requestId = ++latestRequestRef.current
    let cancelled = false
    void solveExpand({
      catalog,
      targets,
      inputs,
      machineOverrides,
      recipeChoices,
      machineCategoryDefaults,
    }).then((next) => {
      // Bail if a newer solve has already been requested OR the effect
      // was torn down (catalog swap, unmount).
      if (cancelled) return
      if (latestRequestRef.current !== requestId) return
      setFlow(next)
    })
    return () => {
      cancelled = true
    }
  }, [catalog, targets, inputs, machineOverrides, recipeChoices, machineCategoryDefaults])

  // `isInitialSolve` is true ONLY when we have a catalog to solve against
  // and no resolved result yet — i.e. the very first solve is still in
  // flight. Consumers can use this to render a one-shot shimmer that
  // doesn't flicker on every parameter retoggle (subsequent solves keep
  // showing the stale-but-valid `flow`).
  const isInitialSolve = flow === null && catalog !== null

  return { flow, isInitialSolve }
}
