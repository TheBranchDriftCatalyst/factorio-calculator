import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@thebranchdriftcatalyst/catalyst-ui/ui/tabs"
import { Card, CardContent } from "@thebranchdriftcatalyst/catalyst-ui/ui/card"
import { loadDataset } from "./data/loader"
import { loadCatalog, type Catalog } from "./factorio"
import { CatalogProvider } from "./factorio/CatalogContext"
import { RateUnitProvider } from "./util/RateUnitContext"
import { type FlowGraph, type Input, type Target } from "./solver/expand"
import { solveExpand } from "./solver/expandClient"
import { TargetPicker } from "./views/TargetPicker"
import { InputPicker } from "./views/InputPicker"
// Tab views are code-split — only the active view's bundle loads, so the
// initial page paint doesn't carry sankey/boxline/schematic dependencies.
const SankeyView = lazy(() => import("./views/SankeyView").then((m) => ({ default: m.SankeyView })))
const BoxLineView = lazy(() =>
  import("./views/BoxLineView").then((m) => ({ default: m.BoxLineView })),
)
const SchematicView = lazy(() =>
  import("./views/SchematicView").then((m) => ({ default: m.SchematicView })),
)
import { HudStrip } from "./components/HudStrip"
import { CommandPalette, type Command } from "./components/CommandPalette"
import { useKeymap } from "./hooks/useKeymap"
import { ProfileSidebar } from "./views/profiles/ProfileSidebar"
import type { RateUnit } from "./util/format"
// Legacy SchematicConfig loader is read ONCE during state init to migrate
// any previously-persisted machineOverrides / recipeChoices /
// machineCategoryDefaults into their dedicated keys. After that, App owns
// these maps directly and no longer needs to subscribe to schematic
// config events — view-only knobs (zoom, beltSpacing) are encapsulated in
// SchematicView and don't bleed up.
import { loadConfig as loadSchematicConfig } from "./views/schematic/SchematicConfig"

const DEFAULT_DATASET = "space-age-2.0.55.json"
const DEFAULT_TARGETS: Target[] = [{ item: "electronic-circuit", rate: 1 }]
const DEFAULT_INPUTS: Input[] = []
const TARGETS_STORAGE_KEY = "fbp.targets.v1"
const INPUTS_STORAGE_KEY = "fbp.inputs.v1"
// Solver-relevant choices live at the App level — they directly feed
// `expand()` and shouldn't churn whenever the user tweaks a view-only
// knob in the schematic config (zoom, bottleneck, belt spacing, etc.).
const MACHINE_OVERRIDES_KEY = "fbp.machineOverrides.v1"
const RECIPE_CHOICES_KEY = "fbp.recipeChoices.v1"
const MACHINE_CATEGORY_DEFAULTS_KEY = "fbp.machineCategoryDefaults.v1"

type Tab = "sankey" | "boxline" | "schematic" | "catalog"

const TABS: ReadonlyArray<Tab> = ["sankey", "boxline", "schematic", "catalog"]

// Tab ↔ URL hash mirror. We use the hash so the app stays a static asset
// (no router lib, no server rewrites needed).
function tabFromHash(): Tab {
  if (typeof window === "undefined") return "sankey"
  const m = window.location.hash.match(/^#\/(\w+)/)
  const candidate = m?.[1] as Tab | undefined
  return candidate && TABS.includes(candidate) ? candidate : "sankey"
}

// Lazy-init reader for the persisted targets array. Defensive parse so a
// hand-edited / stale localStorage entry can't break first render.
function loadTargets(): Target[] {
  if (typeof window === "undefined") return DEFAULT_TARGETS
  try {
    const raw = window.localStorage.getItem(TARGETS_STORAGE_KEY)
    if (!raw) return DEFAULT_TARGETS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_TARGETS
    const cleaned = parsed
      .filter(
        (t): t is Target =>
          t && typeof t === "object" && typeof t.item === "string" && typeof t.rate === "number",
      )
      .map((t) => ({ item: t.item, rate: t.rate }))
    return cleaned.length > 0 ? cleaned : DEFAULT_TARGETS
  } catch {
    return DEFAULT_TARGETS
  }
}

function loadInputs(): Input[] {
  if (typeof window === "undefined") return DEFAULT_INPUTS
  try {
    const raw = window.localStorage.getItem(INPUTS_STORAGE_KEY)
    if (!raw) return DEFAULT_INPUTS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_INPUTS
    return parsed
      .filter(
        (t): t is Input =>
          t && typeof t === "object" && typeof t.item === "string" && typeof t.rate === "number",
      )
      .map((t) => ({ item: t.item, rate: t.rate }))
  } catch {
    return DEFAULT_INPUTS
  }
}

/**
 * Read a string-map from localStorage. Returns the empty object on miss
 * or malformed payload. Used for the per-item / per-recipe override maps.
 * One-time migration: if the dedicated key is empty, fall back to the
 * matching field on the legacy SchematicConfig blob so prior persisted
 * overrides survive this refactor.
 */
function loadStringMap(
  key: string,
  legacyFallback?: Record<string, string>,
): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
    }
  } catch {
    /* fall through to legacy */
  }
  return legacyFallback ?? {}
}

// Page-level right-sidebar geometry. Lives in App so the rail width
// persists across tab switches and the rail itself stays mounted even on
// non-schematic tabs (active view portals its content into the outlet).
const SIDEBAR_WIDTH_KEY = "schematic.sidebarWidth.v1"
const SIDEBAR_MIN_WIDTH = 240
const SIDEBAR_MAX_WIDTH = 720
const SIDEBAR_DEFAULT_WIDTH = 320

export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [targets, setTargets] = useState<Target[]>(() => loadTargets())
  const [inputs, setInputs] = useState<Input[]>(() => loadInputs())
  const [tab, setTab] = useState<Tab>(() => tabFromHash())
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [rateUnit, setRateUnit] = useState<RateUnit>("sec")
  // Right-rail outlet — refs into the DOM node that views (schematic
  // primarily) portal their per-view sidebar JSX into. Stored as state so
  // SchematicView re-runs its portal effect once the element is attached.
  const [rightRailEl, setRightRailEl] = useState<HTMLElement | null>(null)
  // Sidebar width (persists across all tabs).
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH
    try {
      const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY)
      if (raw == null) return SIDEBAR_DEFAULT_WIDTH
      const n = Number(raw)
      if (!Number.isFinite(n)) return SIDEBAR_DEFAULT_WIDTH
      return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, n))
    } catch {
      return SIDEBAR_DEFAULT_WIDTH
    }
  })
  const rowRef = useRef<HTMLDivElement | null>(null)
  const onResizeMouseMove = useCallback((e: MouseEvent) => {
    const row = rowRef.current
    if (!row) return
    const rect = row.getBoundingClientRect()
    const next = rect.right - e.clientX
    const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, next))
    setSidebarWidth(clamped)
  }, [])
  const onResizeMouseUp = useCallback(() => {
    window.removeEventListener("mousemove", onResizeMouseMove)
    window.removeEventListener("mouseup", onResizeMouseUp)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
    try {
      setSidebarWidth((w) => {
        window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w))
        return w
      })
    } catch {
      /* private mode / quota */
    }
  }, [onResizeMouseMove])
  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      window.addEventListener("mousemove", onResizeMouseMove)
      window.addEventListener("mouseup", onResizeMouseUp)
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
    },
    [onResizeMouseMove, onResizeMouseUp],
  )
  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", onResizeMouseMove)
      window.removeEventListener("mouseup", onResizeMouseUp)
    }
  }, [onResizeMouseMove, onResizeMouseUp])
  // Solver-relevant per-recipe / per-item override maps live at App level
  // so changes to them re-run `expand()` exactly once, and changes to
  // view-only schematic knobs (zoom, beltSpacing, etc.) do NOT re-run the
  // solver. One-time migration falls back to the legacy SchematicConfig
  // blob so prior persisted choices survive this hoist.
  const [machineOverrides, setMachineOverrides] = useState<Record<string, string>>(() =>
    loadStringMap(
      MACHINE_OVERRIDES_KEY,
      typeof window === "undefined" ? undefined : loadSchematicConfig().machineOverrides,
    ),
  )
  const [recipeChoices, setRecipeChoices] = useState<Record<string, string>>(() =>
    loadStringMap(
      RECIPE_CHOICES_KEY,
      typeof window === "undefined" ? undefined : loadSchematicConfig().recipeChoices,
    ),
  )
  const [machineCategoryDefaults, setMachineCategoryDefaults] = useState<Record<string, string>>(
    () =>
      loadStringMap(
        MACHINE_CATEGORY_DEFAULTS_KEY,
        typeof window === "undefined" ? undefined : loadSchematicConfig().machineCategoryDefaults,
      ),
  )

  // Cross-tab sync only — same-tab updates already flow through setState.
  // We listen for `storage` events from OTHER tabs writing to the keys
  // and mirror the new value here.
  useEffect(() => {
    if (typeof window === "undefined") return
    const onStorage = (e: StorageEvent) => {
      if (e.key === MACHINE_OVERRIDES_KEY)
        setMachineOverrides(loadStringMap(MACHINE_OVERRIDES_KEY))
      else if (e.key === RECIPE_CHOICES_KEY)
        setRecipeChoices(loadStringMap(RECIPE_CHOICES_KEY))
      else if (e.key === MACHINE_CATEGORY_DEFAULTS_KEY)
        setMachineCategoryDefaults(loadStringMap(MACHINE_CATEGORY_DEFAULTS_KEY))
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  // Persist each map whenever it changes. Tiny payloads — write on every
  // change is fine.
  useEffect(() => {
    try {
      window.localStorage.setItem(MACHINE_OVERRIDES_KEY, JSON.stringify(machineOverrides))
    } catch {
      /* quota / private mode */
    }
  }, [machineOverrides])
  useEffect(() => {
    try {
      window.localStorage.setItem(RECIPE_CHOICES_KEY, JSON.stringify(recipeChoices))
    } catch {
      /* quota / private mode */
    }
  }, [recipeChoices])
  useEffect(() => {
    try {
      window.localStorage.setItem(
        MACHINE_CATEGORY_DEFAULTS_KEY,
        JSON.stringify(machineCategoryDefaults),
      )
    } catch {
      /* quota / private mode */
    }
  }, [machineCategoryDefaults])

  // Persist targets on every change. Cheap enough to do unconditionally; the
  // payload is tiny.
  useEffect(() => {
    try {
      window.localStorage.setItem(TARGETS_STORAGE_KEY, JSON.stringify(targets))
    } catch {
      // Private mode / quota — silently skip rather than crash the app.
    }
  }, [targets])

  useEffect(() => {
    try {
      window.localStorage.setItem(INPUTS_STORAGE_KEY, JSON.stringify(inputs))
    } catch {
      /* same as above */
    }
  }, [inputs])

  // Mirror the active tab into the URL hash so reloads (and bookmarks)
  // restore the user's last position. Replace history (not push) — tab
  // switches shouldn't pollute the back-button stack.
  useEffect(() => {
    const desired = `#/${tab}`
    if (window.location.hash !== desired) {
      window.history.replaceState(null, "", desired)
    }
  }, [tab])

  // Honor manual URL edits + browser back/forward.
  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  const commands: Command[] = useMemo(
    () => [
      { id: "tab:sankey", label: "Switch to Sankey", hint: "1", group: "Navigate", onSelect: () => setTab("sankey") },
      { id: "tab:boxline", label: "Switch to BoxLine", hint: "2", group: "Navigate", onSelect: () => setTab("boxline") },
      { id: "tab:schematic", label: "Switch to Schematic", hint: "3", group: "Navigate", onSelect: () => setTab("schematic") },
      { id: "tab:catalog", label: "Switch to Catalog", hint: "4", group: "Navigate", onSelect: () => setTab("catalog") },
      { id: "rate:sec", label: "Show rates per second", group: "Display", onSelect: () => setRateUnit("sec") },
      { id: "rate:min", label: "Show rates per minute", group: "Display", onSelect: () => setRateUnit("min") },
      { id: "rate:hr",  label: "Show rates per hour",   group: "Display", onSelect: () => setRateUnit("hr")  },
      {
        id: "targets:add",
        label: "Add target",
        group: "Targets",
        onSelect: () => setTargets((prev) => [...prev, { item: "iron-plate", rate: 1 }]),
      },
      {
        id: "help:keys",
        label: "Show keyboard shortcuts",
        hint: "?",
        group: "Help",
        onSelect: () =>
          alert(
            "1/2/3/4: switch tab · F: fit · 0: reset · B: bottleneck mode · Space+drag: pan · ⌘+wheel: zoom · ⌘K: palette · ⎋: dismiss"
          ),
      },
    ],
    []
  )

  useKeymap({
    "meta+k": () => setPaletteOpen(true),
    "ctrl+k": () => setPaletteOpen(true),
    "?": () => setPaletteOpen(true),
    "1": () => setTab("sankey"),
    "2": () => setTab("boxline"),
    "3": () => setTab("schematic"),
    "4": () => setTab("catalog"),
  })

  useEffect(() => {
    loadDataset(DEFAULT_DATASET)
      .then((raw) => setCatalog(loadCatalog(raw)))
      .catch((e) => setError(String(e)))
  }, [])

  // The solver now runs in a Web Worker so big factories don't block
  // input / paint. We keep the LAST computed flow around so consumers
  // (Sankey, Schematic) never see `null` after the first solve — a stale
  // render is far less disruptive than flicker-to-empty-then-flicker-back.
  // Request IDs prevent a stale response (e.g. user typed quickly and the
  // older solve finished after the newer one) from clobbering the result.
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

  // Render the main UI tree. Wrapped in CatalogProvider + RateUnitProvider
  // only when the catalog is loaded — descendants that call useCatalog()
  // can assume a non-null catalog, and the loading state stays trivial.
  const body = (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <ProfileSidebar
        currentTargets={targets}
        currentInputs={inputs}
        onLoad={(t, i) => {
          setTargets(t)
          setInputs(i)
        }}
      />
      <header className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-border flex flex-col gap-3">
        <div>
          <h1
            className="font-display font-bold text-2xl tracking-[0.06em] uppercase pb-1"
            style={{
              color: "var(--signature)",
              borderBottom: "1px solid rgba(255,176,0,0.35)",
              display: "inline-block",
            }}
          >
            Factorio Blueprint Calculator
          </h1>
        </div>
        {catalog && (
          <div className="grid grid-cols-2 gap-6">
            <section data-testid="inputs-section">
              <InputPicker
                catalog={catalog}
                inputs={inputs}
                onChange={setInputs}
              />
            </section>
            <section data-testid="outputs-section">
              <TargetPicker
                catalog={catalog}
                targets={targets}
                onChange={setTargets}
                recipeChoices={recipeChoices}
                onRecipeChoiceChange={(item, recipeKey) => {
                  setRecipeChoices((prev) => {
                    const next = { ...prev }
                    if (recipeKey === "") delete next[item]
                    else next[item] = recipeKey
                    return next
                  })
                }}
              />
            </section>
          </div>
        )}
      </header>

      {catalog && (
        <div className="flex-shrink-0">
          <HudStrip
            catalog={catalog}
            flow={flow}
            targets={targets}
            dataset={DEFAULT_DATASET}
            rateUnit={rateUnit}
            onRateUnitChange={setRateUnit}
          />
        </div>
      )}

      <div ref={rowRef} className="flex-1 min-h-0 flex flex-row px-6 pb-6 pt-4 gap-3">
        {error && <pre className="text-destructive text-sm">{error}</pre>}
        {!catalog && !error && <p>Loading catalog…</p>}

        {catalog && flow && (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          className="flex-1 min-h-0 flex flex-col"
        >
          <div className="flex items-center mb-3 flex-shrink-0">
            <TabsList>
              <TabsTrigger value="sankey" data-testid="tab-sankey">
                Sankey
              </TabsTrigger>
              <TabsTrigger value="boxline" data-testid="tab-boxline">
                BoxLine
              </TabsTrigger>
              <TabsTrigger value="schematic" data-testid="tab-schematic">
                Schematic
              </TabsTrigger>
              <TabsTrigger value="catalog" data-testid="tab-catalog">
                Catalog
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Each TabsContent fills the remaining height. min-h-0 is what
              lets flex-1 children actually shrink inside a flex column. */}
          <TabsContent value="sankey" className="flex-1 min-h-0 mt-0 data-[state=active]:flex">
            <Card interactive={false} className="flex-1 min-h-0 flex flex-col">
              <CardContent className="p-3 flex-1 min-h-0 flex flex-col">
                <Suspense fallback={<TabFallback />}>
                  <SankeyView flow={flow} catalog={catalog} rateUnit={rateUnit} />
                </Suspense>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="boxline" className="flex-1 min-h-0 mt-0 data-[state=active]:flex">
            <Card interactive={false} className="flex-1 min-h-0 flex flex-col">
              <CardContent className="p-3 flex-1 min-h-0 flex flex-col">
                <Suspense fallback={<TabFallback />}>
                  <BoxLineView flow={flow} catalog={catalog} rateUnit={rateUnit} />
                </Suspense>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="schematic" className="flex-1 min-h-0 mt-0 data-[state=active]:flex">
            <Card interactive={false} className="flex-1 min-h-0 flex flex-col">
              <CardContent className="p-3 flex-1 min-h-0 flex flex-col">
                <Suspense fallback={<TabFallback />}>
                  <SchematicView
                    catalog={catalog}
                    flow={flow}
                    rateUnit={rateUnit}
                    rightRailEl={rightRailEl}
                    machineOverrides={machineOverrides}
                    setMachineOverrides={setMachineOverrides}
                    machineCategoryDefaults={machineCategoryDefaults}
                    setMachineCategoryDefaults={setMachineCategoryDefaults}
                  />
                </Suspense>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="catalog" className="flex-1 min-h-0 mt-0 data-[state=active]:flex">
            <Card interactive={false} className="flex-1 min-h-0 flex flex-col">
              <CardContent className="p-3 flex-1 min-h-0 flex flex-col overflow-auto">
                <CatalogSummary catalog={catalog} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        )}

        {/* Right-rail: page-level container that views portal their
            per-view sidebar into. Always mounted so its width persists. */}
        {catalog && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-valuemin={SIDEBAR_MIN_WIDTH}
              aria-valuemax={SIDEBAR_MAX_WIDTH}
              aria-valuenow={Math.round(sidebarWidth)}
              aria-label="Resize right sidebar"
              tabIndex={0}
              data-testid="sidebar-resize-handle"
              onMouseDown={onResizeMouseDown}
              // Keyboard-operable per WAI-ARIA separator pattern.
              // Arrow keys nudge by 16px; Shift+arrow by 64px; Home/End
              // jump to the configured min/max widths.
              onKeyDown={(e) => {
                const step = e.shiftKey ? 64 : 16
                let next: number | null = null
                if (e.key === "ArrowLeft") next = sidebarWidth + step
                else if (e.key === "ArrowRight") next = sidebarWidth - step
                else if (e.key === "Home") next = SIDEBAR_MAX_WIDTH
                else if (e.key === "End") next = SIDEBAR_MIN_WIDTH
                if (next === null) return
                e.preventDefault()
                const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, next))
                setSidebarWidth(clamped)
                try {
                  window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped))
                } catch {
                  /* ignore quota */
                }
              }}
              style={{
                width: 6,
                flexShrink: 0,
                cursor: "col-resize",
                background: "transparent",
                outline: "none",
              }}
              onFocus={(e) => (e.currentTarget.style.background = "rgba(255, 176, 0, 0.45)")}
              onBlur={(e) => (e.currentTarget.style.background = "transparent")}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 176, 0, 0.18)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            />
            <aside
              ref={setRightRailEl}
              className="shrink-0 flex flex-col gap-2 overflow-auto"
              data-testid="right-rail"
              style={{ width: sidebarWidth }}
            />
          </>
        )}
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
    </div>
  )

  // Providers only mount once the catalog has finished loading — that
  // way `useCatalog()` is guaranteed to return a non-null value and the
  // pre-load splash stays a single trivially-rendered subtree.
  if (!catalog) return body
  return (
    <CatalogProvider value={catalog}>
      <RateUnitProvider value={rateUnit}>{body}</RateUnitProvider>
    </CatalogProvider>
  )
}

// Shown while a code-split tab view is loading. Cheap and styled to
// match the surrounding card so the swap is barely visible.
function TabFallback() {
  return (
    <div
      data-testid="tab-loading"
      className="flex-1 min-h-0 flex items-center justify-center opacity-60 text-xs"
    >
      Loading view…
    </div>
  )
}

function CatalogSummary({ catalog }: { catalog: Catalog }) {
  const rows: Array<[string, number]> = [
    ["items", catalog.items.size],
    ["recipes", catalog.recipes.size],
    ["machines", catalog.machines.size],
    ["machines w/ size", [...catalog.machines.values()].filter((m) => m.size).length],
    ["belts", catalog.belts.size],
    ["inserters", catalog.inserters.size],
    ["modules", catalog.modules.size],
    ["fluid connections", catalog.fluidConnections.size],
  ]
  return (
    <section data-testid="catalog-summary">
      <table className="text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="pr-4 opacity-70">{k}</td>
              <td className="font-mono">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
