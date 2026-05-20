import { useEffect, useMemo, useState } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@thebranchdriftcatalyst/catalyst-ui/ui/tabs"
import { Card, CardContent } from "@thebranchdriftcatalyst/catalyst-ui/ui/card"
import { loadDataset } from "./data/loader"
import { loadCatalog, type Catalog } from "./factorio"
import { expand, type FlowGraph, type Input, type Target } from "./solver/expand"
import { TargetPicker } from "./views/TargetPicker"
import { InputPicker } from "./views/InputPicker"
import { SankeyView } from "./views/SankeyView"
import { BoxLineView } from "./views/BoxLineView"
import { SchematicView } from "./views/SchematicView"
import { HudStrip } from "./components/HudStrip"
import { CommandPalette, type Command } from "./components/CommandPalette"
import { useKeymap } from "./hooks/useKeymap"
import { ProfileSidebar } from "./views/profiles/ProfileSidebar"
import type { RateUnit } from "./util/format"

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

export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [targets, setTargets] = useState<Target[]>(() => loadTargets())
  const [inputs, setInputs] = useState<Input[]>(() => loadInputs())
  const [tab, setTab] = useState<Tab>(() => tabFromHash())
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [rateUnit, setRateUnit] = useState<RateUnit>("sec")

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
    return expand(catalog, targets, inputs)
  }, [catalog, targets, inputs])

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

      <div className="flex-1 min-h-0 flex flex-col px-6 pb-6 pt-4">
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
                <SankeyView flow={flow} catalog={catalog} rateUnit={rateUnit} />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="boxline" className="flex-1 min-h-0 mt-0 data-[state=active]:flex">
            <Card interactive={false} className="flex-1 min-h-0 flex flex-col">
              <CardContent className="p-3 flex-1 min-h-0 flex flex-col">
                <BoxLineView flow={flow} catalog={catalog} rateUnit={rateUnit} />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="schematic" className="flex-1 min-h-0 mt-0 data-[state=active]:flex">
            <Card interactive={false} className="flex-1 min-h-0 flex flex-col">
              <CardContent className="p-3 flex-1 min-h-0 flex flex-col">
                <SchematicView catalog={catalog} flow={flow} rateUnit={rateUnit} />
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
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
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
