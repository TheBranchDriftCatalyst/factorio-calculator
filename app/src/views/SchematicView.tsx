import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import type { Catalog } from "../factorio"
import type { FlowGraph } from "../solver/expand"
import { busLayout } from "../blueprint/layout/busLayout"
import { CanvasTiles } from "../blueprint/render/CanvasTiles"
import type { Cell } from "../blueprint/types"
import { flattenGroups, walkBusNodes } from "../blueprint/types"
import { useCamera } from "../hooks/useCamera"
import { useSelection } from "../hooks/useSelection"
import { useKeymap } from "../hooks/useKeymap"
import { type RateUnit } from "../util/format"
import { TopologyPanel } from "./schematic/TopologyPanel"
import { MachineCategoryPicker } from "./schematic/MachineCategoryPicker"
import { IntermediatesPanel } from "./schematic/IntermediatesPanel"
import { FuelsPanel } from "./schematic/FuelsPanel"
import { BomPanel } from "./schematic/BomPanel"
import { InspectorPanel } from "./schematic/inspector/InspectorPanel"
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
  /**
   * DOM node to portal the per-view right-sidebar JSX into. Lives at App
   * level so the rail width persists across tab switches. When null,
   * SchematicView simply doesn't render its rail content (e.g. during
   * first render before the ref attaches).
   */
  rightRailEl?: HTMLElement | null
  // Solver-relevant overrides live in App so view-only schematic config
  // changes don't churn the solver. SchematicView consumes them read-only
  // and dispatches edits via the setters.
  machineOverrides: Record<string, string>
  setMachineOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>>
  machineCategoryDefaults: Record<string, string>
  setMachineCategoryDefaults: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >
}

export function SchematicView({
  catalog,
  flow,
  rateUnit = "sec",
  rightRailEl,
  machineOverrides,
  setMachineOverrides,
  machineCategoryDefaults,
  setMachineCategoryDefaults,
}: Props) {
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
        outputBusSide: config.outputBusSide,
        beltAssignments: config.beltAssignments,
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
      config.outputBusSide,
      config.beltAssignments,
    ],
  )
  const [hoveredCell, setHoveredCell] = useState<Cell | null>(null)
  const [selectedLane, setSelectedLane] = useState<{
    beltX: number
    lane: "A" | "B"
    item: string
    rate: number
  } | null>(null)
  // Item-wide highlight (every lane carrying this item glows). Driven by
  // the Intermediates panel; nullable so clicking the same row toggles off.
  const [highlightedItem, setHighlightedItem] = useState<string | null>(null)

  const {
    camera,
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
    setHighlightedItem(null)
  }, [clearSelection])

  // Map from recipeKey → Cell for fast lookup in the inspector.
  const cellByKey = useMemo(() => {
    const m = new Map<string, Cell>()
    for (const c of blueprint.cells) m.set(c.recipeKey, c)
    return m
  }, [blueprint])

  // Top-of-view counters: groups (root-children) + trunk belts (root.belts).
  // Derived from the bus tree since the flat mirrors are gone.
  const groupCount = useMemo(() => flattenGroups(blueprint.root).length, [blueprint])
  const trunkBeltCount = useMemo(() => blueprint.root?.belts.length ?? 0, [blueprint])

  // Test hook (dev + test builds only). Lets E2E specs ask
  // window.__schematic.cellAt("electronic-circuit") for the page-space
  // center of a known cell, eliminating canvas-fuzz from selection tests.
  // Removed in production builds via import.meta.env.PROD gate.
  useEffect(() => {
    if (typeof window === "undefined") return
    if (import.meta.env.PROD) return
    // Read viewportRef.current LAZILY each call — at mount it may still be
    // null. The effect re-runs whenever blueprint/camera changes, but
    // computeCenter must reflect the live ref value.
    const computeCenter = (tileX: number, tileY: number, tileW: number, tileH: number) => {
      const vp = viewportRef.current
      if (!vp) return null
      const vRect = vp.getBoundingClientRect()
      // Tile pixel size on screen = zoom * camera.scale.
      const px = zoom * camera.scale
      const cx = vRect.left + camera.x + (tileX + tileW / 2) * px
      const cy = vRect.top + camera.y + (tileY + tileH / 2) * px
      return { x: cx, y: cy }
    }
    ;(window as unknown as { __schematic?: unknown }).__schematic = {
      cellAt(recipeKey: string) {
        const c = cellByKey.get(recipeKey)
        if (!c) return null
        return computeCenter(c.x, c.y, c.w, c.h)
      },
      beltAt(item: string) {
        // Walk EVERY belt across the whole bus tree (trunk + sub-buses) —
        // items used by only one consumer live in a sub-bus, so a single
        // root-belts pass would miss them.
        for (const n of walkBusNodes(blueprint.root)) {
          for (const b of n.belts) {
            if (b.laneA?.item !== item && b.laneB?.item !== item) continue
            const y0 = b.y0 ?? n.y
            const y1 = b.y1 ?? n.y + n.h
            return computeCenter(b.x, y0, blueprint.beltWidth, y1 - y0)
          }
        }
        return null
      },
      blueprint,
    }
    return () => {
      delete (window as unknown as { __schematic?: unknown }).__schematic
    }
  }, [blueprint, cellByKey, viewportRef, zoom, camera.x, camera.y, camera.scale])

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

  // Sidebar resize handle + width state live in App now (rail is page-level).

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0" data-testid="schematic-view">
      <div className="flex items-center gap-3 text-xs flex-wrap flex-shrink-0">
        <span className="opacity-60">
          {blueprint.cells.length} cells · {groupCount} group
          {groupCount === 1 ? "" : "s"} · {trunkBeltCount} trunk belts ·{" "}
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
          style={(() => {
            // CSS-painted background grid: matches the canvas grid (same color
            // & tile size) and tracks the camera transform via modulo offset,
            // so the grid extends across the WHOLE viewport — no more
            // partial-grid look when the blueprint is smaller than the
            // viewport or when zoomed out.
            const tileSizePx = Math.max(1, zoom * camera.scale)
            const offsetX = ((camera.x % tileSizePx) + tileSizePx) % tileSizePx
            const offsetY = ((camera.y % tileSizePx) + tileSizePx) % tileSizePx
            return {
              height: "100%",
              cursor: isPanning ? "grabbing" : "default",
              backgroundColor: "rgb(10, 10, 15)",
              backgroundImage: `
                linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)
              `,
              backgroundSize: `${tileSizePx}px ${tileSizePx}px`,
              backgroundPosition: `${offsetX}px ${offsetY}px`,
            }
          })()}
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
              highlightItem={highlightedItem}
              tilePx={zoom}
              bottleneckMode={bottleneckMode}
              beltTier={beltTier}
              beltOverrides={config.beltOverrides}
              rateUnit={rateUnit}
              showCrossings={config.showCrossings}
            />
          </div>
          <CameraHint />
          {bottleneckMode && <BottleneckBadge />}
          {bottleneckMode && <BottleneckLegend />}
        </div>
      </div>
      {/* Right-rail content portaled into App's page-level outlet. The
          Recipes panel was removed — recipe variations are now picked
          per-target inline (intermediates aren't user-editable here). */}
      {rightRailEl &&
        createPortal(
          <div
            className="flex flex-col gap-2"
            data-testid="inspector"
          >
            {/* Clicked / hovered details go FIRST so the user sees the
                cell or lane they just interacted with without scrolling
                past Topology + Default Machines + Intermediates. */}
            <InspectorPanel
              blueprint={blueprint}
              hovered={hoveredCell}
              selectedKeys={selected}
              selectedLane={selectedLane}
              cellByKey={cellByKey}
              onClear={clear}
              beltTier={beltTier}
              config={config}
              updateConfig={updateConfig}
              machineOverrides={machineOverrides}
              setMachineOverrides={setMachineOverrides}
            />
            <TopologyPanel config={config} update={updateConfig} />
            <MachineCategoryPicker
              flow={flow}
              defaults={machineCategoryDefaults}
              onChange={setMachineCategoryDefaults}
            />
            <BomPanel
              flow={flow}
              blueprint={blueprint}
              beltTier={config.beltTier}
              beltOverrides={config.beltOverrides}
            />
            <FuelsPanel flow={flow} />
            <IntermediatesPanel
              flow={flow}
              highlightedItem={highlightedItem}
              onItemClick={setHighlightedItem}
            />
          </div>,
          rightRailEl,
        )}
    </div>
  )
}

// SidebarResizeHandle moved to App.tsx (page-level rail).

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
