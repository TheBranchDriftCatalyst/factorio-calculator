// Web Worker entry — runs the heavy expand() solver off the main thread
// so input typing / canvas painting stay smooth on big factories. The
// worker is pure: catalog + plain config in, FlowGraph out. Maps and
// Sets in the Catalog survive structured-clone postMessage natively, so
// no manual serialization is needed.
//
// The Catalog is sent ONCE at init via a `hydrate` message and stashed
// at module scope. Subsequent `solve` messages carry only the per-call
// inputs (targets / overrides / etc.) — avoiding a re-clone of the
// (sizeable) Catalog across the postMessage boundary on every solve.

import { expand, type Input, type Target, type FlowGraph } from "./expand"
import type { Catalog } from "../factorio"

interface HydrateMessage {
  type: "hydrate"
  catalog: Catalog
}

interface SolveMessage {
  type: "solve"
  requestId: number
  targets: Target[]
  inputs: Input[]
  machineOverrides: Record<string, string>
  recipeChoices: Record<string, string>
  machineCategoryDefaults: Record<string, string>
}

type IncomingMessage = HydrateMessage | SolveMessage

interface SolveResponse {
  type: "result"
  requestId: number
  flow: FlowGraph
}

interface ErrorResponse {
  type: "error"
  requestId: number
  message: string
}

// Stashed at hydrate time — reused across every subsequent `solve`.
let catalog: Catalog | null = null

self.addEventListener("message", (e: MessageEvent<IncomingMessage>) => {
  const m = e.data
  if (!m) return

  if (m.type === "hydrate") {
    catalog = m.catalog
    return
  }

  if (m.type === "solve") {
    if (!catalog) {
      // Client expected to hydrate before solving — surface the bug
      // back to the main thread instead of throwing into the void.
      const err: ErrorResponse = {
        type: "error",
        requestId: m.requestId,
        message: "expand.worker: solve received before hydrate (catalog is null)",
      }
      ;(self as unknown as Worker).postMessage(err)
      return
    }
    const flow = expand({
      catalog,
      targets: m.targets,
      inputs: m.inputs,
      machineOverrides: m.machineOverrides,
      recipeChoices: m.recipeChoices,
      machineCategoryDefaults: m.machineCategoryDefaults,
    })
    const reply: SolveResponse = { type: "result", requestId: m.requestId, flow }
    ;(self as unknown as Worker).postMessage(reply)
    return
  }
})

// Make TypeScript happy that this module has side effects.
export {}
