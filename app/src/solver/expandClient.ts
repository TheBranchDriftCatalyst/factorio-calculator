// Main-thread shim for the expand() Web Worker. Exposes a single
// `solveExpand()` Promise per call and tracks request IDs so stale
// responses (from older requests still in-flight when the user types
// fast) are discarded.
//
// The Catalog is sent to the worker ONCE via a `hydrate` message and
// reused across every subsequent `solve` — see `hydrateCatalog` below.
// This keeps the per-solve postMessage payload small (just the user's
// targets / overrides) and avoids re-cloning the (sizeable) Catalog,
// which contains Map<>/Set<> fields, on every keystroke.

import { expand, type FlowGraph, type SolveRequest } from "./expand"
import type { Catalog } from "../factorio"

// Vite-native worker import. The `?worker` suffix tells Vite to bundle
// the module as a Web Worker; module: "module" lets it use ES imports.
import ExpandWorker from "./expand.worker?worker"

let worker: Worker | null = null
let nextId = 1
const pending = new Map<
  number,
  { resolve: (flow: FlowGraph) => void; reject: (err: Error) => void }
>()

// The catalog identity currently hydrated into the worker. We compare by
// reference (===) — App.tsx only swaps the catalog on dataset change, so
// reference equality is enough and avoids any deep-compare cost.
let hydratedCatalog: Catalog | null = null

function getWorker(): Worker | null {
  if (typeof window === "undefined") return null
  if (!worker) {
    try {
      worker = new ExpandWorker()
      worker.addEventListener("message", (e: MessageEvent) => {
        const m = e.data as
          | { type?: string; requestId?: number; flow?: FlowGraph; message?: string }
          | null
        if (!m || typeof m.requestId !== "number") return
        const slot = pending.get(m.requestId)
        if (!slot) return
        if (m.type === "result" && m.flow) {
          pending.delete(m.requestId)
          slot.resolve(m.flow)
        } else if (m.type === "error") {
          pending.delete(m.requestId)
          slot.reject(new Error(m.message ?? "expand worker error"))
        }
      })
      worker.addEventListener("error", (e) => {
        // Worker crashed — drop the worker reference so we fall back to
        // the main thread on the next call. Reject anything still pending
        // so callers don't hang forever.
        console.error("[expand worker] error", e)
        for (const slot of pending.values()) {
          slot.reject(new Error("expand worker crashed"))
        }
        pending.clear()
        worker = null
        hydratedCatalog = null
      })
    } catch (err) {
      console.warn("[expand worker] init failed, will run on main thread", err)
      worker = null
    }
  }
  return worker
}

/**
 * Send the catalog to the worker. No-op if the same catalog reference is
 * already hydrated. Safe to call repeatedly — only the first call (or a
 * dataset-swap call) actually posts.
 */
export function hydrateCatalog(catalog: Catalog): void {
  const w = getWorker()
  if (!w) return
  if (hydratedCatalog === catalog) return
  w.postMessage({ type: "hydrate", catalog })
  hydratedCatalog = catalog
}

/**
 * Solve `expand()` off-thread. Falls back to main-thread when the worker
 * can't initialize (some test environments, very old browsers).
 */
export function solveExpand(args: SolveRequest): Promise<FlowGraph> {
  const w = getWorker()
  if (!w) {
    return Promise.resolve(expand(args))
  }
  // Ensure the worker is hydrated with this catalog. The worker handles
  // messages in order, so a hydrate posted now is guaranteed to be
  // processed before the solve we post immediately after.
  if (args.catalog !== hydratedCatalog) {
    hydrateCatalog(args.catalog)
  }
  const requestId = nextId++
  return new Promise<FlowGraph>((resolve, reject) => {
    pending.set(requestId, { resolve, reject })
    w.postMessage({
      type: "solve",
      requestId,
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
  hydratedCatalog = null
  nextId = 1
}
