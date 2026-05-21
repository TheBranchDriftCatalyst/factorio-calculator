import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@thebranchdriftcatalyst/catalyst-ui/ui/tabs"
import { Card, CardContent } from "@thebranchdriftcatalyst/catalyst-ui/ui/card"
import { loadDataset } from "./data/loader"
import { loadCatalog, type Catalog } from "./factorio"
import { expand, type FlowGraph, type Input, type Target } from "./solver/expand"
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
import {
  loadConfig as loadSchematicConfig,
  saveConfig as saveSchematicConfig,
  SCHEMATIC_CONFIG_EVENT,
  STORAGE_KEY as SCHEMATIC_STORAGE_KEY,
} from "./views/schematic/SchematicConfig"

const DEFAULT_DATASET = "space-age-2.0.55.json"
const DEFAULT_TARGETS: Target[] = [{ item: "electronic-circuit", rate: 1 }]
const DEFAULT_INPUTS: Input[] = []
const TARGETS_STORAGE_KEY = "fbp.targets.v1"
const INPUTS_STORAGE_KEY = "fbp.inputs.v1"

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
  // Per-recipe machine overrides + per-item recipe choices live in
  // SchematicConfig (localStorage). We mirror them here so the solver
  // re-runs whenever the user pins a different choice via the schematic.
  const [machineOverrides, setMachineOverrides] = useState<Record<string, string>>(
    () => (typeof window === "undefined" ? {} : loadSchematicConfig().machineOverrides ?? {}),
  )
  const [recipeChoices, setRecipeChoices] = useState<Record<string, string>>(
    () => (typeof window === "undefined" ? {} : loadSchematicConfig().recipeChoices ?? {}),
  )
  const [machineCategoryDefaults, setMachineCategoryDefaults] = useState<
    Record<string, string>
  >(() =>
    typeof window === "undefined"
      ? {}
      : loadSchematicConfig().machineCategoryDefaults ?? {},
  )

  useEffect(() => {
    if (typeof window === "undefined") return
    const sync = () => {
      const cfg = loadSchematicConfig()
      setMachineOverrides(cfg.machineOverrides ?? {})
      setRecipeChoices(cfg.recipeChoices ?? {})
      setMachineCategoryDefaults(cfg.machineCategoryDefaults ?? {})
    }
    window.addEventListener(SCHEMATIC_CONFIG_EVENT, sync)
    const onStorage = (e: StorageEvent) => {
      if (e.key === SCHEMATIC_STORAGE_KEY) sync()
    }
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(SCHEMATIC_CONFIG_EVENT, sync)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

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

  const flow: FlowGraph | null = useMemo(() => {
    if (!catalog) return null
    return expand(
      catalog,
      targets,
      inputs,
      machineOverrides,
      recipeChoices,
      machineCategoryDefaults,
    )
  }, [catalog, targets, inputs, machineOverrides, recipeChoices, machineCategoryDefaults])

  return (
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
                  const cfg = loadSchematicConfig()
                  const next = { ...(cfg.recipeChoices ?? {}) }
                  if (recipeKey === "") delete next[item]
                  else next[item] = recipeKey
                  saveSchematicConfig({ ...cfg, recipeChoices: next })
                  setRecipeChoices(next)
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
              data-testid="sidebar-resize-handle"
              onMouseDown={onResizeMouseDown}
              style={{
                width: 6,
                flexShrink: 0,
                cursor: "col-resize",
                background: "transparent",
              }}
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
