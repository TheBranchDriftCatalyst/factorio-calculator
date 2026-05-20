import { useCallback, useEffect, useMemo, useState } from "react"
import type { Catalog } from "../factorio"
import type { FlowGraph } from "../solver/expand"
import { busLayout } from "../blueprint/layout/busLayout"
import { CanvasTiles } from "../blueprint/render/CanvasTiles"
import type { Blueprint, Cell } from "../blueprint/types"
import { useCamera } from "../hooks/useCamera"
import { useSelection } from "../hooks/useSelection"
import { useKeymap } from "../hooks/useKeymap"
import { fmt, fmtPct, fmtRateUnit, type RateUnit } from "../util/format"
import { laneUtilization, type BeltTier } from "../blueprint/util/utilization"
import { TopologyPanel } from "./schematic/TopologyPanel"
import {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  type SchematicConfig,
} from "./schematic/SchematicConfig"

interface Props {
  catalog: Catalog
  flow: FlowGraph
  rateUnit?: RateUnit
}

export function SchematicView({ catalog, flow, rateUnit = "sec" }: Props) {
  const [config, setConfig] = useState<SchematicConfig>(() => {
    // SSR-safe lazy init from localStorage.
    if (typeof window === "undefined") return DEFAULT_CONFIG
    return loadConfig()
  })
  // Single update function — TopologyPanel + keyboard shortcuts both call this.
  const updateConfig = useCallback(
    <K extends keyof SchematicConfig>(key: K, value: SchematicConfig[K]) => {
      setConfig((c) => ({ ...c, [key]: value }))
    },
    [],
  )
  // Persist any change to localStorage so prefs survive reload.
  useEffect(() => {
    saveConfig(config)
  }, [config])
  const { zoom, bottleneckMode, beltTier } = config

  const blueprint = useMemo(
    () =>
      busLayout(catalog, flow, {
        beltSpacing: config.beltSpacing,
        beltGroupSize: config.beltGroupSize,
        beltWidth: config.beltWidth,
        cellGapY: config.cellGapY,
        groupGapY: config.groupGapY,
        trunkMinConsumers: config.trunkMinConsumers,
        maxNestingDepth: config.maxNestingDepth,
      }),
    [
      catalog,
      flow,
      config.beltSpacing,
      config.beltGroupSize,
      config.beltWidth,
      config.cellGapY,
      config.groupGapY,
      config.trunkMinConsumers,
      config.maxNestingDepth,
    ],
  )
  const [hoveredCell, setHoveredCell] = useState<Cell | null>(null)
  const [selectedLane, setSelectedLane] = useState<{
    beltX: number
    lane: "A" | "B"
    item: string
    rate: number
  } | null>(null)

  const {
    transform,
    isPanning,
    viewportRef,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    reset,
    fit,
  } = useCamera()
  const { selected, onClickCell, clear: clearSelection } = useSelection()

  const clear = useCallback(() => {
    clearSelection()
    setHoveredCell(null)
    setSelectedLane(null)
  }, [clearSelection])

  // Map from recipeKey → Cell for fast lookup in the inspector.
  const cellByKey = useMemo(() => {
    const m = new Map<string, Cell>()
    for (const c of blueprint.cells) m.set(c.recipeKey, c)
    return m
  }, [blueprint])

  const handleClickCell = useCallback(
    (key: string, e: React.MouseEvent<HTMLCanvasElement>) => {
      // Pinning a cell clears any lane selection (one selection at a time).
      setSelectedLane(null)
      onClickCell(key, { shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey })
    },
    [onClickCell],
  )

  const handleClickLane = useCallback(
    (
      hit: { beltX: number; lane: "A" | "B"; item: string; rate: number },
      _e: React.MouseEvent<HTMLCanvasElement>,
    ) => {
      // Clicking a lane pins it and clears any cell selection.
      clearSelection()
      setSelectedLane(hit)
    },
    [clearSelection],
  )

  // Fit to selection if any, otherwise fit to whole blueprint.
  const fitToContent = useCallback(() => {
    const vp = viewportRef.current
    if (!vp) return
    const vw = vp.clientWidth
    const vh = vp.clientHeight
    if (vw === 0 || vh === 0) return
    if (selected.size === 0) {
      fit(blueprint.width * zoom, blueprint.height * zoom, vw, vh)
      return
    }
    // Compute bbox over selected cells in tile units, then convert to px.
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const key of selected) {
      const c = cellByKey.get(key)
      if (!c) continue
      if (c.x < minX) minX = c.x
      if (c.y < minY) minY = c.y
      if (c.x + c.w > maxX) maxX = c.x + c.w
      if (c.y + c.h > maxY) maxY = c.y + c.h
    }
    if (!Number.isFinite(minX)) {
      fit(blueprint.width * zoom, blueprint.height * zoom, vw, vh)
      return
    }
    const w = (maxX - minX) * zoom
    const h = (maxY - minY) * zoom
    fit(w, h, vw, vh)
  }, [blueprint, cellByKey, fit, selected, viewportRef, zoom])

  // Global F / 0 / B — work without needing the viewport to be focused first.
  // useKeymap already skips events that target form inputs.
  useKeymap({
    f: fitToContent,
    "0": reset,
    b: () => updateConfig("bottleneckMode", !config.bottleneckMode),
  })

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0" data-testid="schematic-view">
      <div className="flex items-center gap-3 text-xs flex-wrap flex-shrink-0">
        <span className="opacity-60">
          {blueprint.cells.length} cells · {blueprint.groups.length} group
          {blueprint.groups.length === 1 ? "" : "s"} · {blueprint.belts.length} trunk belts ·{" "}
          {blueprint.inserters.length} inserters · {blueprint.width}×{blueprint.height} tiles
        </span>
        {blueprint.unsupported.length > 0 && (
          <span className="text-amber-400">
            {blueprint.unsupported.length} recipes used fallback footprints
          </span>
        )}
        <Legend />
      </div>
      <div className="flex gap-3 flex-1 min-h-0">
        <div
          ref={viewportRef}
          className="flex-1 overflow-hidden bg-card rounded border border-border relative"
          style={{
            height: "100%",
            cursor: isPanning ? "grabbing" : "default",
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          data-testid="schematic-viewport"
        >
          <div style={{ transform, transformOrigin: "0 0", willChange: "transform" }}>
            <CanvasTiles
              catalog={catalog}
              blueprint={blueprint}
              onHover={setHoveredCell}
              onClickCell={handleClickCell}
              onClickLane={handleClickLane}
              highlightCellKey={hoveredCell?.recipeKey ?? null}
              highlightCellKeys={selected}
              highlightLane={selectedLane}
              tilePx={zoom}
              bottleneckMode={bottleneckMode}
              beltTier={beltTier}
              rateUnit={rateUnit}
            />
          </div>
          <CameraHint />
          {bottleneckMode && <BottleneckBadge />}
          {bottleneckMode && <BottleneckLegend />}
        </div>
        <aside
          className="w-80 shrink-0 flex flex-col gap-2 overflow-auto"
          data-testid="inspector"
          style={{ height: "100%" }}
        >
          <TopologyPanel config={config} update={updateConfig} />
          <InspectorPanel
            catalog={catalog}
            blueprint={blueprint}
            hovered={hoveredCell}
            selectedKeys={selected}
            selectedLane={selectedLane}
            cellByKey={cellByKey}
            onClear={clear}
            beltTier={beltTier}
            rateUnit={rateUnit}
          />
        </aside>
      </div>
    </div>
  )
}

// Bottom-left affordance: the camera shortcuts aren't discoverable otherwise.
function CameraHint() {
  return (
    <div
      data-testid="camera-hint"
      className="absolute bottom-2 left-2 text-[10px] font-mono pointer-events-none select-none"
      style={{
        color: "rgba(255,255,255,0.55)",
        background: "rgba(0,0,0,0.55)",
        border: "1px solid rgba(255,176,0,0.18)",
        padding: "3px 6px",
        letterSpacing: "0.04em",
      }}
    >
      <span style={{ color: "#FFC940" }}>F</span> fit ·{" "}
      <span style={{ color: "#FFC940" }}>0</span> reset ·{" "}
      <span style={{ color: "#FFC940" }}>Space</span>+drag pan ·{" "}
      <span style={{ color: "#FFC940" }}>⌘+wheel</span> zoom ·{" "}
      <span style={{ color: "#FFC940" }}>B</span> bottleneck ·{" "}
      <span style={{ color: "#FFC940" }}>⌘K</span> palette
    </div>
  )
}

// Top-right pill, visible only while bottleneck mode is active, so the user
// is never confused about why belt colors look different.
function BottleneckBadge() {
  return (
    <div
      data-testid="bottleneck-badge"
      className="absolute top-2 right-2 text-[10px] font-mono pointer-events-none select-none"
      style={{
        background: "rgba(255, 46, 99, 0.18)",
        color: "#ff6b8b",
        border: "1px solid rgba(255, 46, 99, 0.55)",
        padding: "3px 8px",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      ◆ Bottleneck Mode
    </div>
  )
}

// Compact key-with-swatches, bottom-right. Matches `laneUtilization` buckets.
function BottleneckLegend() {
  const swatch = (color: string, label: string) => (
    <span className="inline-flex items-center gap-1">
      <span style={{ background: color, width: 10, height: 10, display: "inline-block" }} />
      <span style={{ color: "rgba(255,255,255,0.7)" }}>{label}</span>
    </span>
  )
  return (
    <div
      data-testid="bottleneck-legend"
      className="absolute bottom-2 right-2 text-[10px] font-mono pointer-events-none select-none flex gap-2"
      style={{
        background: "rgba(0,0,0,0.6)",
        border: "1px solid rgba(255,176,0,0.18)",
        padding: "4px 8px",
      }}
    >
      {swatch("rgba(16, 185, 129, 0.78)", "<50%")}
      {swatch("rgba(245, 158, 11, 0.85)", "<85%")}
      {swatch("rgba(255, 46, 99, 0.85)", "saturated")}
      {swatch("rgba(255, 46, 99, 1)", "over")}
    </div>
  )
}

function Legend() {
  return (
    <div className="flex items-center gap-3 opacity-80">
      <LegendItem
        label="trunk belt"
        swatch={
          <div className="w-4 h-3 rounded-sm bg-gradient-to-b from-sky-500/70 to-amber-500/70 border border-black/60" />
        }
      />
      <LegendItem
        label="input"
        swatch={
          <svg width={16} height={16}>
            <circle cx={8} cy={8} r={6} fill="#1c1c24" stroke="#7dd3fc" strokeWidth={1.5} />
            <polygon points="12,8 5.5,4.5 5.5,11.5" fill="#7dd3fc" />
          </svg>
        }
      />
      <LegendItem
        label="output"
        swatch={
          <svg width={16} height={16}>
            <circle cx={8} cy={8} r={6} fill="#1c1c24" stroke="#f59e0b" strokeWidth={1.5} />
            <polygon points="4,8 10.5,4.5 10.5,11.5" fill="#f59e0b" />
          </svg>
        }
      />
      <LegendItem
        label="sub-bus group"
        swatch={
          <div
            className="w-4 h-3 rounded-sm border-2 border-dashed"
            style={{ borderColor: "rgba(168, 85, 247, 0.7)", background: "rgba(168, 85, 247, 0.1)" }}
          />
        }
      />
      <LegendItem
        label="cell"
        swatch={
          <div className="w-4 h-3 rounded-sm bg-cyan-500/15 border border-cyan-300/60" />
        }
      />
    </div>
  )
}

function LegendItem({ label, swatch }: { label: string; swatch: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {swatch}
      <span>{label}</span>
    </span>
  )
}

interface InspectorPanelProps {
  catalog: Catalog
  blueprint: Blueprint
  hovered: Cell | null
  selectedKeys: Set<string>
  selectedLane: { beltX: number; lane: "A" | "B"; item: string; rate: number } | null
  cellByKey: Map<string, Cell>
  onClear: () => void
  beltTier: BeltTier
  rateUnit: RateUnit
}

function InspectorPanel({
  catalog,
  blueprint,
  hovered,
  selectedKeys,
  selectedLane,
  cellByKey,
  onClear,
  beltTier,
  rateUnit,
}: InspectorPanelProps) {
  // Lane selected — show its details + consumers/producers list.
  if (selectedLane) {
    return (
      <LaneDetails
        catalog={catalog}
        blueprint={blueprint}
        lane={selectedLane}
        beltTier={beltTier}
        rateUnit={rateUnit}
        onClear={onClear}
      />
    )
  }
  // State 0: no selection AND no hover — pure empty state.
  if (selectedKeys.size === 0 && !hovered) {
    return (
      <div
        className="text-xs opacity-60 px-3 py-3 border border-dashed border-border rounded h-full"
        data-testid="cell-inspector-empty"
      >
        <div className="font-medium opacity-80 mb-1">Inspector</div>
        <div>
          Click any cell to pin its details. <kbd className="px-1 rounded bg-muted">⇧</kbd> click
          adds, <kbd className="px-1 rounded bg-muted">⌘</kbd> click toggles,{" "}
          <kbd className="px-1 rounded bg-muted">⎋</kbd> clears.
        </div>
      </div>
    )
  }

  // State 1: only hovered (ephemeral preview).
  if (selectedKeys.size === 0 && hovered) {
    return (
      <div
        className="text-xs bg-card border border-border rounded p-3 h-full"
        data-testid="cell-inspector"
      >
        <div className="opacity-50 mb-2 uppercase tracking-wide text-[10px]">
          hovering (click to pin)
        </div>
        <CellDetails cell={hovered} beltTier={beltTier} rateUnit={rateUnit} />
      </div>
    )
  }

  // State 2: exactly one selected (pinned detail panel).
  if (selectedKeys.size === 1) {
    const [key] = selectedKeys
    const cell = cellByKey.get(key)
    if (!cell) {
      return (
        <div
          className="text-xs opacity-60 px-3 py-3 border border-dashed border-border rounded h-full"
          data-testid="cell-inspector"
        >
          Selected cell not found in current blueprint.
          <button className="ml-2 underline" onClick={onClear}>
            clear
          </button>
        </div>
      )
    }
    return (
      <div
        className="text-xs bg-card border border-border rounded p-3 h-full"
        data-testid="cell-inspector"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="opacity-50 uppercase tracking-wide text-[10px]">pinned</div>
          <button className="opacity-60 hover:opacity-100 underline" onClick={onClear}>
            clear
          </button>
        </div>
        <CellDetails cell={cell} expanded beltTier={beltTier} rateUnit={rateUnit} />
      </div>
    )
  }

  // State N: multi-select aggregate.
  const cells = [...selectedKeys]
    .map((k) => cellByKey.get(k))
    .filter((c): c is Cell => c !== undefined)
  const totalMachines = cells.reduce((s, c) => s + c.demanded, 0)
  const recipes = cells.map((c) => ({ key: c.recipeKey, name: c.recipeName, demanded: c.demanded }))

  return (
    <div
      className="text-xs bg-card border border-border rounded p-3 h-full"
      data-testid="cell-inspector"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="opacity-50 uppercase tracking-wide text-[10px]">
          {cells.length} selected
        </div>
        <button className="opacity-60 hover:opacity-100 underline" onClick={onClear}>
          clear
        </button>
      </div>
      <div className="space-y-1 mb-3">
        <div>
          <span className="opacity-60">Total machines: </span>
          <span className="font-mono">{fmt(totalMachines)}</span>
        </div>
        <div>
          <span className="opacity-60">Distinct recipes: </span>
          <span className="font-mono">{cells.length}</span>
        </div>
      </div>
      <div className="opacity-60 mb-1">Recipes</div>
      <ul className="space-y-0.5 max-h-[40vh] overflow-auto">
        {recipes.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-2">
            <span className="truncate">{r.name}</span>
            <span className="font-mono opacity-70 shrink-0">×{fmt(r.demanded)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Inspector panel rendered when the user pins a bus lane. Shows the lane's
// item, the rate it carries, current utilization vs the configured belt
// tier, and the list of cells that produce / consume from that lane.
function LaneDetails({
  catalog,
  blueprint,
  lane,
  beltTier,
  rateUnit,
  onClear,
}: {
  catalog: Catalog
  blueprint: Blueprint
  lane: { beltX: number; lane: "A" | "B"; item: string; rate: number }
  beltTier: BeltTier
  rateUnit: RateUnit
  onClear: () => void
}) {
  const itemName = catalog.items.get(lane.item)?.name ?? lane.item
  const util = laneUtilization(lane.rate, beltTier)

  // Aggregate producers + consumers by walking the flat cell list and
  // looking at ports that match (beltX, item).
  const producers: Array<{ key: string; name: string; rate: number }> = []
  const consumers: Array<{ key: string; name: string; rate: number }> = []
  for (const cell of blueprint.cells) {
    for (const p of cell.outputs) {
      if (p.beltX === lane.beltX && p.item === lane.item) {
        producers.push({ key: cell.recipeKey, name: cell.recipeName, rate: p.rate })
      }
    }
    for (const p of cell.inputs) {
      if (p.beltX === lane.beltX && p.item === lane.item) {
        consumers.push({ key: cell.recipeKey, name: cell.recipeName, rate: p.rate })
      }
    }
  }

  return (
    <div
      className="text-xs bg-card border border-border rounded p-3 h-full"
      data-testid="lane-inspector"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="opacity-50 uppercase tracking-wide text-[10px]">
          Lane · {lane.lane === "A" ? "Left" : "Right"} sub-lane
        </div>
        <button className="opacity-60 hover:opacity-100 underline" onClick={onClear}>
          clear
        </button>
      </div>
      <div className="space-y-1 mb-3">
        <div className="font-medium">{itemName}</div>
        <div>
          <span className="opacity-60">Rate: </span>
          <span className="font-mono">{fmtRateUnit(lane.rate, rateUnit)}</span>
          <span
            className="font-mono ml-2 px-1 rounded"
            style={{ background: util.color, color: "rgba(0,0,0,0.92)", fontSize: 9 }}
          >
            {fmtPct(util.ratio)}
          </span>
        </div>
        <div className="opacity-50 text-[10px]">
          @ {beltTier} belt · {util.label}
        </div>
      </div>

      <div>
        <div className="opacity-60 mb-1">Producers</div>
        <ul className="space-y-0.5 mb-3">
          {producers.length === 0 && <li className="opacity-50">—</li>}
          {producers.map((p, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="truncate">{p.name}</span>
              <span className="font-mono opacity-70 shrink-0">{fmtRateUnit(p.rate, rateUnit)}</span>
            </li>
          ))}
        </ul>

        <div className="opacity-60 mb-1">Consumers</div>
        <ul className="space-y-0.5">
          {consumers.length === 0 && <li className="opacity-50">—</li>}
          {consumers.map((c, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="truncate">{c.name}</span>
              <span className="font-mono opacity-70 shrink-0">{fmtRateUnit(c.rate, rateUnit)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function CellDetails({
  cell,
  expanded,
  beltTier,
  rateUnit,
}: {
  cell: Cell
  expanded?: boolean
  beltTier: BeltTier
  rateUnit: RateUnit
}) {
  const util = (rate: number) => {
    const u = laneUtilization(rate, beltTier)
    return (
      <span
        className="font-mono ml-1 px-1 rounded"
        style={{
          background: u.color,
          color: u.label === "ok" || u.label === "idle" ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0.92)",
          fontSize: 9,
        }}
      >
        {fmtPct(u.ratio)}
      </span>
    )
  }
  return (
    <div className={expanded ? "space-y-3" : "space-y-2"}>
      <div>
        <div className="opacity-60 mb-1">Recipe</div>
        <div className="font-medium">{cell.recipeName}</div>
        <div className="opacity-70">
          {cell.demanded} machine{cell.demanded === 1 ? "" : "s"}
        </div>
        <div className="opacity-50 mt-1">
          {cell.w}×{cell.h} tiles
        </div>
      </div>
      <div>
        <div className="opacity-60 mb-1">
          Inputs <span className="text-sky-400">▶ from bus</span>
        </div>
        <ul className="space-y-0.5">
          {cell.inputs.length === 0 && <li className="opacity-50">—</li>}
          {cell.inputs.map((p, i) => (
            <li key={i}>
              <span className="font-mono">{fmtRateUnit(p.rate, rateUnit)}</span>
              {util(p.rate)} {p.item}{" "}
              <span className="opacity-50">(belt col {p.beltX})</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="opacity-60 mb-1">
          Outputs <span className="text-amber-400">◀ to bus</span>
        </div>
        <ul className="space-y-0.5">
          {cell.outputs.length === 0 && <li className="opacity-50">—</li>}
          {cell.outputs.map((p, i) => (
            <li key={i}>
              <span className="font-mono">{fmtRateUnit(p.rate, rateUnit)}</span>
              {util(p.rate)} {p.item}{" "}
              <span className="opacity-50">(belt col {p.beltX})</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
