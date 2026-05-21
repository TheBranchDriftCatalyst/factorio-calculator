// Main-thread shim for the expand() Web Worker. Exposes a single
// `solveExpand()` Promise per call and tracks request IDs so stale
// responses (from older requests still in-flight when the user types
// fast) are discarded.

import { expand, type FlowGraph, type Input, type Target } from "./expand"
import type { Catalog } from "../factorio"

// Vite-native worker import. The `?worker` suffix tells Vite to bundle
// the module as a Web Worker; module: "module" lets it use ES imports.
import ExpandWorker from "./expand.worker?worker"

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, (flow: FlowGraph) => void>()

function getWorker(): Worker | null {
  if (typeof window === "undefined") return null
  if (!worker) {
    try {
      worker = new ExpandWorker()
      worker.addEventListener("message", (e: MessageEvent) => {
        const m = e.data as { type?: string; requestId?: number; flow?: FlowGraph } | null
        if (m?.type !== "result" || typeof m.requestId !== "number" || !m.flow) return
        const resolver = pending.get(m.requestId)
        if (resolver) {
          pending.delete(m.requestId)
          resolver(m.flow)
        }
      })
      worker.addEventListener("error", (e) => {
        // Worker crashed — fall back to main-thread expand on the next
        // call. Drain pending promises with the synchronous result.
        console.error("[expand worker] error", e)
        worker = null
        pending.clear()
      })
    } catch (err) {
      console.warn("[expand worker] init failed, will run on main thread", err)
      worker = null
    }
  }
  return worker
}

interface SolveArgs {
  catalog: Catalog
  targets: Target[]
  inputs: Input[]
  machineOverrides: Record<string, string>
  recipeChoices: Record<string, string>
  machineCategoryDefaults: Record<string, string>
}

/**
 * Solve `expand()` off-thread. Falls back to main-thread when the worker
 * can't initialize (some test environments, very old browsers).
 */
export function solveExpand(args: SolveArgs): Promise<FlowGraph> {
  const w = getWorker()
  if (!w) {
    return Promise.resolve(
      expand(
        args.catalog,
        args.targets,
        args.inputs,
        args.machineOverrides,
        args.recipeChoices,
        args.machineCategoryDefaults,
      ),
    )
  }
  const requestId = nextId++
  return new Promise<FlowGraph>((resolve) => {
    pending.set(requestId, resolve)
    w.postMessage({
      type: "solve",
      requestId,
      catalog: args.catalog,
      targets: args.targets,
      inputs: args.inputs,
      machineOverrides: args.machineOverrides,
      recipeChoices: args.recipeChoices,
      machineCategoryDefaults: args.machineCategoryDefaults,
    })
  })
}

/** Test-only — reset internal state so tests don't bleed into each other. */
export function _resetExpandWorker(): void {
  if (worker) worker.terminate()
  worker = null
  pending.clear()
  nextId = 1
}
