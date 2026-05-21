// Web Worker entry — runs the heavy expand() solver off the main thread
// so input typing / canvas painting stay smooth on big factories. The
// worker is pure: catalog + plain config in, FlowGraph out. Maps and
// Sets in the Catalog survive structured-clone postMessage natively, so
// no manual serialization is needed.

import { expand, type Input, type Target, type FlowGraph } from "./expand"
import type { Catalog } from "../factorio"

interface SolveRequest {
  type: "solve"
  requestId: number
  catalog: Catalog
  targets: Target[]
  inputs: Input[]
  machineOverrides: Record<string, string>
  recipeChoices: Record<string, string>
  machineCategoryDefaults: Record<string, string>
}

interface SolveResponse {
  type: "result"
  requestId: number
  flow: FlowGraph
}

self.addEventListener("message", (e: MessageEvent<SolveRequest>) => {
  const m = e.data
  if (m?.type !== "solve") return
  const flow = expand(
    m.catalog,
    m.targets,
    m.inputs,
    m.machineOverrides,
    m.recipeChoices,
    m.machineCategoryDefaults,
  )
  const reply: SolveResponse = { type: "result", requestId: m.requestId, flow }
  ;(self as unknown as Worker).postMessage(reply)
})

// Make TypeScript happy that this module has side effects.
export {}
