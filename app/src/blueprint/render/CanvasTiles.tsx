// Layered-canvas renderer for the bus schematic.
// One canvas, tile = TILE_PX.
// Bus belts are 1 tile WIDE columns that run the full canvas height, with
// two colored sublanes (left half = laneA, right half = laneB). Items flow
// top-to-bottom. Inserters live in a gutter COLUMN to the right of the
// belts and face east (input) or west (output). Each sub-bus group is a
// horizontal band stacked top-to-bottom; cells inside a group stack
// vertically, one per row, so the inserter glyphs never collide.

import { useEffect, useRef } from "react"
import * as d3 from "d3"
import type { Catalog } from "../../factorio"
import type { Blueprint, Cell } from "../types"
import { fmt, fmtRateUnit, type RateUnit } from "../../util/format"
import { laneUtilization, type BeltTier } from "../util/utilization"

const DEFAULT_TILE_PX = 18

export interface LaneHit {
  beltX: number
  /** "A" = left sub-lane, "B" = right sub-lane */
  lane: "A" | "B"
  item: string
  rate: number
}

interface Props {
  catalog: Catalog
  blueprint: Blueprint
  onHover?: (cell: Cell | null) => void
  /** click on a cell — caller gets the native event so it can read shift/meta */
  onClickCell?: (recipeKey: string, e: React.MouseEvent<HTMLCanvasElement>) => void
  /** click on a bus lane (gives the lane info + native event) */
  onClickLane?: (hit: LaneHit, e: React.MouseEvent<HTMLCanvasElement>) => void
  /** when set, highlight the cell + its belt taps + its inserters */
  highlightCellKey?: string | null
  /** additional cells (by recipeKey) to render as highlighted/pinned */
  highlightCellKeys?: ReadonlySet<string>
  /** highlight a specific lane (drawn with a glow) */
  highlightLane?: { beltX: number; lane: "A" | "B" } | null
  /**
   * When set, EVERY lane (sub-lane on a belt, direct connection, etc.)
   * carrying this item glows. Used by the Intermediates panel to let the
   * user follow an item across the whole schematic at a glance.
   */
  highlightItem?: string | null
  /** px per tile. Default 18; usually driven by a zoom slider. */
  tilePx?: number
  /** when on, belts colored by utilization (green/amber/red) instead of by item */
  bottleneckMode?: boolean
  /** belt tier baseline for utilization math; default "yellow" (15/s/lane) */
  beltTier?: BeltTier
  /**
   * Per-item belt-tier override. When a lane's item key is present here,
   * utilization math for that lane uses the overridden tier — letting one
   * lane be "turbo" while the global tier remains yellow.
   */
  beltOverrides?: Record<string, BeltTier>
  /** rate display unit for badges + labels; default "sec" */
  rateUnit?: RateUnit
  /** Draw the underground-belt "crossing" chevron markers. Default true. */
  showCrossings?: boolean
}

/**
 * Deterministic per-item color. Hash the item key to one of the Tableau10
 * slots so the same item always shows up the same color across views.
 */
function itemColorFor(item: string, opacity = 0.65): string {
  let h = 0
  for (let i = 0; i < item.length; i++) h = (h * 31 + item.charCodeAt(i)) >>> 0
  const c = d3.color(d3.schemeTableau10[h % 10])!
  c.opacity = opacity
  return c.toString()
}

export function CanvasTiles({
  catalog,
  blueprint,
  onHover,
  onClickCell,
  onClickLane,
  highlightCellKey,
  highlightCellKeys,
  highlightLane,
  highlightItem,
  tilePx,
  bottleneckMode,
  beltTier = "yellow",
  beltOverrides,
  rateUnit = "sec",
  showCrossings = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spriteRef = useRef<HTMLImageElement | null>(null)
  const TILE_PX = tilePx ?? DEFAULT_TILE_PX

  useEffect(() => {
    const hash = catalog.sprites.hash
    if (!hash) return
    const base = import.meta.env.DEV ? import.meta.env.BASE_URL : "/"
    const url = `${base}images/sprite-sheet-${hash}.png`
    const img = new Image()
    img.src = url
    img.onload = () => {
      spriteRef.current = img
      draw()
    }
    return () => {
      spriteRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.sprites.hash])

  useEffect(() => {
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    blueprint,
    highlightCellKey,
    highlightCellKeys,
    highlightLane,
    highlightItem,
    TILE_PX,
    bottleneckMode,
    beltTier,
    beltOverrides,
    rateUnit,
    showCrossings,
  ])

  function draw() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")!
    const dpr = window.devicePixelRatio || 1

    const px = (n: number) => n * TILE_PX
    const W = px(blueprint.width)
    const H = px(blueprint.height)

    canvas.width = W * dpr
    canvas.height = H * dpr
    canvas.style.width = `${W}px`
    canvas.style.height = `${H}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = false

    // No background / grid drawn here — the SchematicView viewport paints
    // the grid via CSS background-image so it extends across the WHOLE
    // viewport (not just the blueprint bounds). The CSS grid tracks the
    // camera transform, so panning/zooming the canvas keeps grid lines in
    // sync with content.
    ctx.clearRect(0, 0, W, H)

    // Lane fill picker — by item normally, by utilization in bottleneck mode.
    // A per-item entry in `beltOverrides` swaps the tier for that lane only,
    // so the user can pin (e.g.) turbo on one item while the global stays yellow.
    const tierForLane = (item: string): BeltTier =>
      (beltOverrides && beltOverrides[item]) ?? beltTier
    const laneFill = (lane: {
      item: string
      rate: number
      isFluid?: boolean
    }): string =>
      bottleneckMode
        ? laneUtilization(lane.rate, tierForLane(lane.item), lane.isFluid === true).color
        : // Bump to 0.92 so lane colors stay saturated against the dark
          // background — at 0.7 the muted tableau10 tones (gray, brown,
          // teal) washed out and made sub-bus lanes look dim.
          itemColorFor(lane.item, 0.92)

    const BELT_W_TILES = blueprint.beltWidth
    const BELT_W_PX = BELT_W_TILES * TILE_PX
    const LANE_W_PX = BELT_W_PX / 2

    /**
     * Draw a single belt at column `belt.x` from y0..y1. Handles both:
     *   - solid belts: 2 lanes (laneA on left half, laneB on right half),
     *     center divider line, hard borders.
     *   - pipes (laneA.isFluid): a single rounded "pipe" filling the full
     *     belt width — no center divider, softer inner highlight, dashed
     *     border to read as plumbing rather than belt.
     */
    const drawBeltColumn = (
      belt: import("../types").BusBelt,
      y0Px: number,
      y1Px: number,
    ) => {
      const x = px(belt.x)
      const hgt = y1Px - y0Px
      const isPipe = belt.laneA?.isFluid === true
      if (isPipe && belt.laneA) {
        // PIPE rendering: cylindrical look via horizontal gradient (edges
        // darker, middle lighter) + periodic horizontal "joints" every
        // few tiles, mimicking real Factorio pipe segments. Borderless on
        // the long axis — joints take the place of borders to communicate
        // "this is plumbing, not belting".
        const fillColor = laneFill(belt.laneA) // base item / util tint
        // Inset slightly so the pipe doesn't fill the full tile width —
        // gives it a noticeable round shoulder against the dark canvas.
        const INSET = Math.max(1, Math.floor(TILE_PX * 0.18))
        const px0 = x + INSET
        const pxw = BELT_W_PX - INSET * 2
        // Cylindrical gradient: dim edges → bright middle → dim edges.
        const grad = ctx.createLinearGradient(px0, 0, px0 + pxw, 0)
        grad.addColorStop(0, "rgba(0,0,0,0.65)")
        grad.addColorStop(0.18, fillColor)
        grad.addColorStop(0.5, "rgba(255,255,255,0.18)")
        grad.addColorStop(0.82, fillColor)
        grad.addColorStop(1, "rgba(0,0,0,0.65)")
        ctx.fillStyle = fillColor
        ctx.fillRect(px0, y0Px, pxw, hgt)
        ctx.fillStyle = grad
        ctx.fillRect(px0, y0Px, pxw, hgt)
        // Outer rim — thin, sky-blue, no dash. Looks like a pipe outline.
        ctx.strokeStyle = "rgba(125, 211, 252, 0.7)"
        ctx.lineWidth = 1
        ctx.strokeRect(px0 + 0.5, y0Px + 0.5, pxw - 1, hgt - 1)
        // Joints every ~4 tiles — small horizontal bands across the pipe
        // that suggest pipe segments. Use a soft dark band + a hairline
        // highlight above it.
        const JOINT_EVERY = Math.max(48, TILE_PX * 4)
        for (let yy = y0Px + JOINT_EVERY; yy < y0Px + hgt - 4; yy += JOINT_EVERY) {
          ctx.fillStyle = "rgba(0,0,0,0.45)"
          ctx.fillRect(px0, yy, pxw, 2)
          ctx.fillStyle = "rgba(255,255,255,0.18)"
          ctx.fillRect(px0, yy - 1, pxw, 1)
        }
        return
      }
      // Solid belt
      if (belt.laneA) {
        ctx.fillStyle = laneFill(belt.laneA)
        ctx.fillRect(x, y0Px, LANE_W_PX, hgt)
      }
      if (belt.laneB) {
        ctx.fillStyle = laneFill(belt.laneB)
        ctx.fillRect(x + LANE_W_PX, y0Px, LANE_W_PX, hgt)
      }
      // Center divider (solid belts only)
      ctx.strokeStyle = "rgba(0,0,0,0.45)"
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x + LANE_W_PX + 0.5, y0Px)
      ctx.lineTo(x + LANE_W_PX + 0.5, y1Px)
      ctx.stroke()
      // Belt borders (hard)
      ctx.strokeStyle = "rgba(0,0,0,0.6)"
      ctx.strokeRect(x + 0.5, y0Px + 0.5, BELT_W_PX - 1, hgt - 1)
    }

    // Draw downward-pointing flow arrows along each solid belt's two lanes.
    // Pipes (fluid belts) skip arrows — joints already convey direction.
    const drawFlowArrows = (
      belt: import("../types").BusBelt,
      yStartTile: number,
      yEndTile: number,
      arrowStartOffset = 3,
    ) => {
      if (belt.laneA?.isFluid) return
      const x = px(belt.x)
      ctx.fillStyle = "rgba(0,0,0,0.55)"
      const arrowEvery = 6
      const tipSize = LANE_W_PX * 0.4
      const drawTriangle = (cx: number, cy: number) => {
        ctx.beginPath()
        ctx.moveTo(cx, cy + tipSize)
        ctx.lineTo(cx - tipSize * 0.7, cy - tipSize * 0.6)
        ctx.lineTo(cx + tipSize * 0.7, cy - tipSize * 0.6)
        ctx.closePath()
        ctx.fill()
      }
      for (let y = yStartTile + arrowStartOffset; y < yEndTile; y += arrowEvery) {
        const cy = px(y) + TILE_PX / 2
        if (belt.laneA) drawTriangle(x + LANE_W_PX / 2, cy)
        if (belt.laneB) drawTriangle(x + LANE_W_PX + LANE_W_PX / 2, cy)
      }
    }

    // Vertical text label for each sub-lane, centered horizontally inside
    // the lane and repeated down the belt's y-range.
    const drawBeltLaneLabels = (
      belt: import("../types").BusBelt,
      yTopTile: number,
      yBotTile: number,
    ) => {
      ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace'
      ctx.textBaseline = "middle"
      ctx.textAlign = "left"
      const repeat = Math.max(20, Math.ceil(blueprint.height / 4))
      const x = px(belt.x)
      const drawLabel = (lane: { item: string; rate: number }, side: "A" | "B") => {
        const name = catalog.items.get(lane.item)?.name ?? lane.item
        const text = `${name} ${fmtRateUnit(lane.rate, rateUnit)}`
        const cx = x + (side === "A" ? LANE_W_PX / 2 : LANE_W_PX + LANE_W_PX / 2)
        ctx.strokeStyle = "rgba(0,0,0,0.85)"
        ctx.lineWidth = 3
        ctx.fillStyle = "rgba(255,255,255,0.92)"
        for (let tileY = yTopTile; tileY < yBotTile; tileY += repeat) {
          ctx.save()
          ctx.translate(cx, px(tileY) + 4)
          ctx.rotate(Math.PI / 2)
          ctx.strokeText(text, 0, 0)
          ctx.fillText(text, 0, 0)
          ctx.restore()
        }
      }
      if (belt.laneA) drawLabel(belt.laneA, "A")
      if (belt.laneB) drawLabel(belt.laneB, "B")
      ctx.textBaseline = "alphabetic"
    }

    // --- Belts: beltWidth tiles wide vertical columns.
    //     drawBeltColumn() handles solid (2-lane) vs pipe (single-fluid)
    //     styling.
    for (const belt of blueprint.belts) {
      const yStart = belt.y0 != null ? px(belt.y0) : 0
      const yEnd = belt.y1 != null ? px(belt.y1) : H
      drawBeltColumn(belt, yStart, yEnd)
      drawFlowArrows(belt, belt.y0 ?? 0, belt.y1 ?? blueprint.height)
    }

    // (Lane icons drawn LATER, after group frames + sub-bus belts are
    // filled — otherwise the local belt fill overwrites the icons.)
    const sprite = spriteRef.current

    // --- Lane highlight overlay — drawn over the belt fill so the user
    //     can see which lane the inspector is showing details for. ---
    if (highlightLane) {
      // Find the belt at any depth that matches highlightLane.beltX.
      const findBeltY = (): { y0: number; y1: number } | null => {
        let found: { y0: number; y1: number } | null = null
        const walk = (n: import("../types").BusNode) => {
          for (const b of n.belts) {
            if (b.x === highlightLane.beltX) {
              found = { y0: n.y, y1: n.y + n.h }
              return
            }
          }
          for (const c of n.children) {
            if (!found) walk(c)
          }
        }
        if (blueprint.root) walk(blueprint.root)
        return found
      }
      const range = findBeltY()
      if (range) {
        const x = px(highlightLane.beltX) + (highlightLane.lane === "A" ? 0 : LANE_W_PX)
        const y = px(range.y0)
        const w = LANE_W_PX
        const h = px(range.y1 - range.y0)
        ctx.strokeStyle = "rgba(0, 252, 214, 1)"
        ctx.lineWidth = 2
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
        ctx.fillStyle = "rgba(0, 252, 214, 0.12)"
        ctx.fillRect(x, y, w, h)
      }
    }

    // --- Item-wide highlight overlay — driven by Intermediates panel.
    //     Glows every sub-lane (across all bus depths) AND every direct
    //     connection that carries the named item. Drawn over the belt fill
    //     so a single click can trace an item end-to-end. ---
    if (highlightItem) {
      const stroke = "rgba(0, 252, 214, 0.9)"
      const fill = "rgba(0, 252, 214, 0.18)"
      const walk = (n: import("../types").BusNode) => {
        for (const b of n.belts) {
          const beltTop = b.y0 ?? n.y
          const beltBot = b.y1 ?? n.y + n.h
          const y = px(beltTop)
          const h = px(beltBot - beltTop)
          if (b.laneA?.item === highlightItem) {
            const x = px(b.x)
            ctx.fillStyle = fill
            ctx.fillRect(x, y, LANE_W_PX, h)
            ctx.strokeStyle = stroke
            ctx.lineWidth = 1.5
            ctx.strokeRect(x + 0.5, y + 0.5, LANE_W_PX - 1, h - 1)
          }
          if (b.laneB?.item === highlightItem) {
            const x = px(b.x) + LANE_W_PX
            ctx.fillStyle = fill
            ctx.fillRect(x, y, LANE_W_PX, h)
            ctx.strokeStyle = stroke
            ctx.lineWidth = 1.5
            ctx.strokeRect(x + 0.5, y + 0.5, LANE_W_PX - 1, h - 1)
          }
        }
        for (const c of n.children) walk(c)
      }
      if (blueprint.root) walk(blueprint.root)
      // Direct connections carrying this item.
      for (const dc of blueprint.directConnections ?? []) {
        if (dc.item !== highlightItem) continue
        const segX = dc.x * TILE_PX
        const segYTop = dc.y0 * TILE_PX + TILE_PX / 2
        const segYBot = (dc.y1 + 1) * TILE_PX - TILE_PX / 2
        ctx.fillStyle = fill
        ctx.fillRect(segX, segYTop, TILE_PX, segYBot - segYTop)
        ctx.strokeStyle = stroke
        ctx.lineWidth = 1.5
        ctx.strokeRect(segX + 0.5, segYTop + 0.5, TILE_PX - 1, segYBot - segYTop - 1)
      }
    }

    // --- Trunk gutter column: visually distinct dark strip ---
    if (blueprint.gutterX >= 0) {
      const x = px(blueprint.gutterX)
      ctx.fillStyle = "rgba(0,0,0,0.55)"
      ctx.fillRect(x, 0, TILE_PX, H)
      // tiny "rail" marks so it doesn't look empty
      ctx.fillStyle = "rgba(255,255,255,0.08)"
      for (let y = 0; y < blueprint.height; y++) {
        ctx.fillRect(x + TILE_PX / 2 - 1, px(y) + TILE_PX / 2 - 1, 2, 2)
      }
    }

    // --- Belt labels (per-lane, vertical, repeated down the belt). ---
    for (const belt of blueprint.belts) {
      drawBeltLaneLabels(belt, belt.y0 ?? 0, belt.y1 ?? blueprint.height)
    }

    // --- Side-belts: belt ↔ inserter ↔ cell ---
    // Each cell port is drawn as a real 1-tile-tall belt track running
    // east-west between the trunk/local bus and the cell. This makes
    // the physical extraction point obvious: the inserter sits at the
    // belt edge and the side-belt carries the item to the machine.
    //
    // Input belts run east (solid lane fill + east arrows); outputs run
    // west (lighter fill + west arrows, sharp dashed border to differentiate).
    //
    // Selection-aware: when any cell is hovered or pinned, non-matching
    // side-belts fade to ~0.18 alpha; matching ones stay bright so the
    // user can trace a recipe's flows visually.
    const hasFocus =
      highlightCellKey != null || (highlightCellKeys?.size ?? 0) > 0

    /**
     * Render a horizontal side-belt between bus-edge column and cell edge.
     * Direction "east": flows from xStart (bus side) to xEnd (cell side).
     * Direction "west": flows from xStart (cell side) to xEnd (bus side).
     */
    const drawSideBelt = (
      yTile: number,
      xStart: number,
      xEnd: number,
      itemKey: string,
      direction: "east" | "west",
      focused: boolean,
    ) => {
      const dim = hasFocus && !focused
      const alpha = focused ? 0.9 : dim ? 0.18 : 0.62
      const yPx = px(yTile)
      const x0 = Math.min(xStart, xEnd) * TILE_PX
      const x1 = Math.max(xStart, xEnd) * TILE_PX
      if (x1 <= x0) return
      // belt fill
      ctx.fillStyle = itemColorFor(itemKey, alpha)
      ctx.fillRect(x0, yPx + 2, x1 - x0, TILE_PX - 4)
      // belt borders top/bottom
      ctx.strokeStyle = `rgba(0,0,0,${dim ? 0.4 : 0.7})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x0, yPx + 2 + 0.5)
      ctx.lineTo(x1, yPx + 2 + 0.5)
      ctx.moveTo(x0, yPx + TILE_PX - 2 - 0.5)
      ctx.lineTo(x1, yPx + TILE_PX - 2 - 0.5)
      ctx.stroke()
      // small directional triangle in the middle so the user can see
      // which way items move on the side-belt
      const arrowAlpha = dim ? 0.35 : 0.75
      ctx.fillStyle = `rgba(0,0,0,${arrowAlpha})`
      const cx = (x0 + x1) / 2
      const cy = yPx + TILE_PX / 2
      const tip = TILE_PX * 0.22
      ctx.beginPath()
      if (direction === "east") {
        ctx.moveTo(cx + tip, cy)
        ctx.lineTo(cx - tip * 0.5, cy - tip * 0.7)
        ctx.lineTo(cx - tip * 0.5, cy + tip * 0.7)
      } else {
        ctx.moveTo(cx - tip, cy)
        ctx.lineTo(cx + tip * 0.5, cy - tip * 0.7)
        ctx.lineTo(cx + tip * 0.5, cy + tip * 0.7)
      }
      ctx.closePath()
      ctx.fill()
    }

    /**
     * Render an underground-belt marker — a small chevron at each crossing
     * column. Signals "this side-belt has to go under another belt here."
     */
    const drawCrossings = (yTile: number, crossings: number[] | undefined, focused: boolean) => {
      if (!crossings || crossings.length === 0) return
      const dim = hasFocus && !focused
      const a = focused ? 0.95 : dim ? 0.35 : 0.7
      ctx.font = '700 9px "JetBrains Mono", ui-monospace, monospace'
      ctx.textBaseline = "middle"
      ctx.textAlign = "center"
      for (const c of crossings) {
        const cx = c * TILE_PX + TILE_PX / 2
        const cy = yTile * TILE_PX + TILE_PX / 2
        // Dark backdrop diamond
        ctx.fillStyle = `rgba(0,0,0,${a * 0.85})`
        ctx.beginPath()
        ctx.moveTo(cx, cy - 5)
        ctx.lineTo(cx + 5, cy)
        ctx.lineTo(cx, cy + 5)
        ctx.lineTo(cx - 5, cy)
        ctx.closePath()
        ctx.fill()
        // Amber chevron
        ctx.strokeStyle = `rgba(255, 201, 64, ${a})`
        ctx.lineWidth = 1.25
        ctx.beginPath()
        ctx.moveTo(cx - 2.5, cy - 2)
        ctx.lineTo(cx, cy)
        ctx.lineTo(cx + 2.5, cy - 2)
        ctx.moveTo(cx - 2.5, cy + 2)
        ctx.lineTo(cx, cy)
        ctx.lineTo(cx + 2.5, cy + 2)
        ctx.stroke()
      }
    }

    for (const cell of blueprint.cells) {
      const focused =
        highlightCellKey === cell.recipeKey ||
        (highlightCellKeys?.has(cell.recipeKey) ?? false)
      const cellLeftCol = cell.x
      const cellRightCol = cell.x + cell.w
      for (const port of cell.inputs) {
        // Direct ports are handled by the direct-connection pass below.
        if (port.scope === "direct") continue
        const beltExitX = port.beltX + BELT_W_TILES
        drawSideBelt(port.dropY, beltExitX, cellLeftCol, port.item, "east", focused)
        if (showCrossings) drawCrossings(port.dropY, port.crossings, focused)
      }
      for (const port of cell.outputs) {
        if (port.scope === "direct") continue
        if (port.edge === "E") {
          // Right-bus output — side-belt flows east from cell to belt.
          drawSideBelt(port.dropY, cellRightCol, port.beltX, port.item, "east", focused)
        } else {
          const beltEntryX = port.beltX + BELT_W_TILES
          drawSideBelt(port.dropY, cellLeftCol, beltEntryX, port.item, "west", focused)
        }
        if (showCrossings) drawCrossings(port.dropY, port.crossings, focused)
      }
    }

    // --- Direct connections: 1-tile-wide vertical segment + 2 side stubs.
    // For each direct link, draw:
    //   • A vertical segment at column `dc.x` from y0..y1 (the connector).
    //   • A short horizontal stub at producer.y connecting to producer's
    //     W perimeter (cell.x - 1), and another at consumer.y.
    //   • Inserters at (cell.x - 1, slotY) — they're already pushed onto
    //     ctx.inserters by busLayout, so the existing inserter pass renders
    //     them. We just need the belt segment + horizontal stubs here.
    const directConnections = blueprint.directConnections ?? []
    for (const dc of directConnections) {
      const fromCell = blueprint.cells.find((c) => c.recipeKey === dc.fromCellKey)
      const toCell = blueprint.cells.find((c) => c.recipeKey === dc.toCellKey)
      if (!fromCell || !toCell) continue
      const focused =
        highlightCellKey === fromCell.recipeKey ||
        highlightCellKey === toCell.recipeKey ||
        (highlightCellKeys?.has(fromCell.recipeKey) ?? false) ||
        (highlightCellKeys?.has(toCell.recipeKey) ?? false)
      const dim = hasFocus && !focused
      const alpha = focused ? 0.9 : dim ? 0.22 : 0.7
      const segX = dc.x * TILE_PX
      const segXMid = segX + TILE_PX / 2
      const segYTop = dc.y0 * TILE_PX + TILE_PX / 2
      const segYBot = (dc.y1 + 1) * TILE_PX - TILE_PX / 2
      const w = Math.max(3, Math.floor(TILE_PX * 0.55))
      const fillColor = itemColorFor(dc.item, alpha)
      ctx.fillStyle = fillColor
      ctx.fillRect(segXMid - w / 2, segYTop, w, segYBot - segYTop)
      ctx.strokeStyle = `rgba(0,0,0,${dim ? 0.4 : 0.7})`
      ctx.lineWidth = 1
      ctx.strokeRect(segXMid - w / 2 + 0.5, segYTop + 0.5, w - 1, segYBot - segYTop - 1)
      const prodStubY = dc.y0 * TILE_PX + TILE_PX / 2 - w / 2
      const consStubY = dc.y1 * TILE_PX + TILE_PX / 2 - w / 2
      const prodCellLeft = fromCell.x * TILE_PX
      const consCellLeft = toCell.x * TILE_PX
      ctx.fillStyle = fillColor
      ctx.fillRect(segXMid, prodStubY, prodCellLeft - segXMid, w)
      ctx.fillRect(segXMid, consStubY, consCellLeft - segXMid, w)

      // Label: item icon + rate at the midpoint of the vertical segment.
      // Skip if the segment is too short to read.
      const segHeight = segYBot - segYTop
      if (segHeight >= TILE_PX * 1.5) {
        const labelCy = (segYTop + segYBot) / 2
        const iconSize = Math.max(10, Math.floor(TILE_PX * 0.9))
        // Backdrop pill so the label reads against the colored segment
        const text = fmtRateUnit(dc.rate, rateUnit)
        ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace'
        const textW = ctx.measureText(text).width
        const pillPad = 4
        const pillW = iconSize + 2 + textW + pillPad * 2
        const pillH = Math.max(iconSize, 14) + 2
        const pillX = segXMid - pillW / 2
        const pillY = labelCy - pillH / 2
        ctx.fillStyle = `rgba(10, 10, 15, ${focused ? 0.95 : 0.85})`
        ctx.beginPath()
        const r = 3
        ctx.moveTo(pillX + r, pillY)
        ctx.lineTo(pillX + pillW - r, pillY)
        ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + r)
        ctx.lineTo(pillX + pillW, pillY + pillH - r)
        ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - r, pillY + pillH)
        ctx.lineTo(pillX + r, pillY + pillH)
        ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - r)
        ctx.lineTo(pillX, pillY + r)
        ctx.quadraticCurveTo(pillX, pillY, pillX + r, pillY)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = `rgba(255,255,255,${focused ? 0.45 : 0.2})`
        ctx.lineWidth = 1
        ctx.stroke()
        // Item icon (left of text)
        if (sprite) {
          const it = catalog.items.get(dc.item)
          if (it) {
            const c = catalog.sprites.cell
            ctx.imageSmoothingEnabled = true
            ctx.drawImage(
              sprite,
              it.iconCol * c,
              it.iconRow * c,
              c,
              c,
              pillX + pillPad,
              labelCy - iconSize / 2,
              iconSize,
              iconSize,
            )
            ctx.imageSmoothingEnabled = false
          }
        }
        // Rate text
        ctx.fillStyle = focused ? "rgb(255, 255, 255)" : "rgba(255, 255, 255, 0.85)"
        ctx.textBaseline = "middle"
        ctx.textAlign = "left"
        ctx.fillText(text, pillX + pillPad + iconSize + 2, labelCy)
      }
    }

    // --- Group frames: outline + local sub-bus inside each ---
    drawGroupsAndLocalBuses()

    // --- Lane icons: render the item sprite at intervals down EVERY belt
    //     (root + nested). Drawn LAST among belt visuals so the local
    //     sub-bus belt fill (rendered just above) doesn't cover them.
    if (sprite) {
      const ICON_EVERY = 6 // tiles between repeats down the belt
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"
      const drawLaneIcon = (item: string, cx: number, cy: number, size: number) => {
        const it = catalog.items.get(item)
        if (!it) return
        const c = catalog.sprites.cell
        // Dark circular backdrop so the icon reads against any belt color.
        const bgR = size * 0.6
        ctx.fillStyle = "rgba(10, 10, 15, 0.85)"
        ctx.beginPath()
        ctx.arc(cx, cy, bgR, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)"
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.drawImage(
          sprite,
          it.iconCol * c,
          it.iconRow * c,
          c,
          c,
          cx - size / 2,
          cy - size / 2,
          size,
          size,
        )
      }
      const drawBeltLanesIn = (
        belts: ReadonlyArray<import("../types").BusBelt>,
        y0: number,
        y1: number,
      ) => {
        const iconSize = Math.max(10, LANE_W_PX * 0.85)
        for (const belt of belts) {
          const xL = px(belt.x) + LANE_W_PX / 2
          const xR = px(belt.x) + LANE_W_PX + LANE_W_PX / 2
          const beltTop = belt.y0 ?? y0
          const beltBot = belt.y1 ?? y1
          for (let row = beltTop + 3; row < beltBot; row += ICON_EVERY) {
            const cy = px(row) + TILE_PX / 2
            if (belt.laneA) drawLaneIcon(belt.laneA.item, xL, cy, iconSize)
            if (belt.laneB) drawLaneIcon(belt.laneB.item, xR, cy, iconSize)
          }
        }
      }
      const walkForIcons = (n: import("../types").BusNode) => {
        drawBeltLanesIn(n.belts, n.y, n.y + n.h)
        for (const c of n.children) walkForIcons(c)
      }
      if (blueprint.root) walkForIcons(blueprint.root)
      ctx.imageSmoothingEnabled = false
    }
    function drawGroupsAndLocalBuses() {
      for (const g of blueprint.groups) {
        // Group frame
        ctx.strokeStyle = "rgba(168, 85, 247, 0.6)"
        ctx.fillStyle = "rgba(168, 85, 247, 0.04)"
        ctx.lineWidth = 1.5
        ctx.setLineDash([5, 4])
        const gx = px(g.x)
        const gy = px(g.y)
        const gw = px(g.w)
        const gh = px(g.h)
        ctx.fillRect(gx, gy, gw, gh)
        ctx.strokeRect(gx + 0.5, gy + 0.5, gw - 1, gh - 1)
        ctx.setLineDash([])

        // Local belts INSIDE this group — vertical columns spanning the
        // group's full height (or the truncated y0..y1 span if set).
        for (const belt of g.localBelts) {
          const beltTop = belt.y0 != null ? px(belt.y0) : gy
          const beltBot = belt.y1 != null ? px(belt.y1) : gy + gh
          drawBeltColumn(belt, beltTop, beltBot)
          drawFlowArrows(belt, belt.y0 ?? g.y, belt.y1 ?? g.y + g.h, 2)
          drawBeltLaneLabels(belt, g.y, g.y + 1)
        }

        // Local gutter — dark column inside the group
        if (g.localBelts.length > 0) {
          const x = px(g.localGutterX)
          ctx.fillStyle = "rgba(0,0,0,0.55)"
          ctx.fillRect(x, gy, TILE_PX, gh)
          ctx.fillStyle = "rgba(255,255,255,0.08)"
          for (let yt = g.y; yt < g.y + g.h; yt++) {
            ctx.fillRect(x + TILE_PX / 2 - 1, px(yt) + TILE_PX / 2 - 1, 2, 2)
          }
        }

        // Per-group rollup chip — Bloomberg-style: dim labels + bright values,
        // sits as a single-line strip above the group frame. Tells you at a
        // glance how big this group is without needing the inspector.
        const chipH = 14
        const chipY = gy - chipH - 2
        const cellsLabel = `${g.cellKeys.length} CELL${g.cellKeys.length === 1 ? "" : "S"}`
        const machinesLabel = `${fmt(g.totalMachines)} MACH`
        const mwLabel = `${fmt(g.totalPowerW / 1e6)} MW`
        const localLabel =
          g.localItems.length > 0
            ? `${g.localItems.length} LOCAL`
            : ""
        const segs = [cellsLabel, machinesLabel, mwLabel, localLabel].filter(Boolean)

        ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace'
        ctx.textBaseline = "middle"
        ctx.textAlign = "left"
        const sepW = 10
        let totalW = 0
        const widths = segs.map((s) => {
          const w = ctx.measureText(s).width
          totalW += w
          return w
        })
        totalW += sepW * (segs.length - 1) + 12 // padding
        // chip background
        ctx.fillStyle = "rgba(0,0,0,0.85)"
        ctx.fillRect(gx, chipY, totalW, chipH)
        ctx.strokeStyle = "rgba(255,176,0,0.32)"
        ctx.lineWidth = 1
        ctx.strokeRect(gx + 0.5, chipY + 0.5, totalW - 1, chipH - 1)
        // amber value text
        ctx.fillStyle = "#FFC940"
        let cur = gx + 6
        for (let i = 0; i < segs.length; i++) {
          ctx.fillText(segs[i], cur, chipY + chipH / 2)
          cur += widths[i]
          if (i < segs.length - 1) {
            ctx.fillStyle = "rgba(255,176,0,0.32)"
            ctx.fillText("│", cur + sepW / 2 - 2, chipY + chipH / 2)
            ctx.fillStyle = "#FFC940"
            cur += sepW
          }
        }
      }
    }

    // --- Cells (machine ribbons) ---
    for (const cell of blueprint.cells) {
      const highlighted =
        highlightCellKey === cell.recipeKey ||
        (highlightCellKeys?.has(cell.recipeKey) ?? false)
      // Cell footprint shadow
      ctx.fillStyle = "rgba(0,0,0,0.4)"
      ctx.fillRect(px(cell.x) - 1, px(cell.y) + 3, px(cell.w) + 2, px(cell.h) + 2)
      // Cell background
      ctx.fillStyle = highlighted ? "rgba(0, 252, 214, 0.15)" : "rgba(125, 211, 252, 0.06)"
      ctx.fillRect(px(cell.x), px(cell.y), px(cell.w), px(cell.h))
      // Cell border
      ctx.strokeStyle = highlighted ? "rgba(0, 252, 214, 1)" : "rgba(125, 211, 252, 0.45)"
      ctx.lineWidth = highlighted ? 2.5 : 1.5
      ctx.strokeRect(px(cell.x) + 0.5, px(cell.y) + 0.5, px(cell.w) - 1, px(cell.h) - 1)

      // Single sprite + ×N count badge (compact representation).
      for (const m of cell.machines) {
        ctx.fillStyle = "rgba(22, 22, 29, 0.95)"
        ctx.fillRect(px(m.x), px(m.y), px(m.w), px(m.h))
        ctx.strokeStyle = "rgba(0, 252, 214, 0.85)"
        ctx.lineWidth = 1
        ctx.strokeRect(px(m.x) + 0.5, px(m.y) + 0.5, px(m.w) - 1, px(m.h) - 1)

        const sprite = spriteRef.current
        if (sprite) {
          const item = catalog.items.get(m.machineKey)
          if (item) {
            const c = catalog.sprites.cell
            ctx.drawImage(
              sprite,
              item.iconCol * c,
              item.iconRow * c,
              c,
              c,
              px(m.x) + 2,
              px(m.y) + 2,
              px(m.w) - 4,
              px(m.h) - 4,
            )
          }
        }
      }

      // ×N machine-count badge, bottom-right of the sprite (skip when N=1).
      if (cell.demanded > 1) {
        const m = cell.machines[0]
        ctx.font = '700 11px "JetBrains Mono", ui-monospace, monospace'
        ctx.textBaseline = "alphabetic"
        const txt = `×${fmt(cell.demanded)}`
        const tw = ctx.measureText(txt).width + 6
        const bh = 14
        const bx = px(m.x + m.w) - tw - 1
        const by = px(m.y + m.h) - bh - 1
        ctx.fillStyle = "rgba(0,0,0,0.85)"
        ctx.fillRect(bx, by, tw, bh)
        ctx.strokeStyle = "rgba(0, 252, 214, 0.9)"
        ctx.lineWidth = 1
        ctx.strokeRect(bx + 0.5, by + 0.5, tw - 1, bh - 1)
        ctx.fillStyle = "rgba(0, 252, 214, 1)"
        ctx.fillText(txt, bx + 3, by + bh - 3)
      }

      // Cell label
      ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif"
      ctx.textBaseline = "top"
      ctx.textAlign = "left"
      ctx.strokeStyle = "rgba(0,0,0,0.85)"
      ctx.lineWidth = 3
      ctx.fillStyle = "rgba(255,255,255,0.92)"
      const labelY = px(cell.y + cell.h) + 2
      const txt = `${cell.recipeName}  ×${fmt(cell.demanded)}`
      ctx.strokeText(txt, px(cell.x), labelY)
      ctx.fillText(txt, px(cell.x), labelY)

      // Throughput badge: total output rate (if anything goes to the bus)
      const outRate = cell.outputs.reduce((s, p) => s + p.rate, 0)
      if (outRate > 0) {
        const badge = fmtRateUnit(outRate, rateUnit)
        ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace'
        const tw = ctx.measureText(badge).width + 6
        const bx = px(cell.x + cell.w) - tw - 2
        const by = px(cell.y) + 2
        ctx.fillStyle = "rgba(0, 252, 214, 0.85)"
        ctx.fillRect(bx, by, tw, 12)
        ctx.fillStyle = "rgba(0,0,0,0.95)"
        ctx.fillText(badge, bx + 3, by + 1.5)
      }
    }

    // --- Inserters (in the gutter row) ---
    drawInserters()

    function drawInserters() {
      // Two-tone ring: sky-blue = input (belt → cell, facing east ▶),
      // amber = output (cell → belt, facing west ◀). Inserters belonging
      // to a non-focused cell render at low alpha so the user's selection
      // visually pops out of the wider blueprint.
      const focusActive =
        highlightCellKey != null || (highlightCellKeys?.size ?? 0) > 0
      for (const ins of blueprint.inserters) {
        const focused =
          highlightCellKey === ins.cellKey ||
          (highlightCellKeys?.has(ins.cellKey) ?? false)
        const dim = focusActive && !focused
        const a = dim ? 0.3 : 1
        const INPUT_RING = `rgba(125, 211, 252, ${a})`
        const OUTPUT_RING = `rgba(245, 158, 11, ${a})`
        const cx = px(ins.x) + TILE_PX / 2
        const cy = px(ins.y) + TILE_PX / 2
        const r = TILE_PX * 0.4
        // Ring color follows port direction; triangle direction follows facing.
        // (Facing alone is ambiguous — an E-edge output points east, same as
        // a W-edge input.)
        const isInput = ins.direction === "input"
        const ringColor = isInput ? INPUT_RING : OUTPUT_RING
        const facingEast = ins.facing === "east"
        // body
        ctx.fillStyle = `rgba(28, 28, 36, ${dim ? 0.6 : 0.95})`
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()
        // item-colored inner dot — so you can see which item this inserter handles
        ctx.fillStyle = itemColorFor(ins.item, a)
        ctx.beginPath()
        ctx.arc(cx, cy, r * 0.35, 0, Math.PI * 2)
        ctx.fill()
        // role-colored ring
        ctx.strokeStyle = ringColor
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.stroke()
        // directional triangle: east ▶ (input) or west ◀ (output)
        ctx.fillStyle = ringColor
        ctx.beginPath()
        const tip = r * 0.7
        // Triangle points in the facing direction (east ▶ or west ◀).
        if (facingEast) {
          ctx.moveTo(cx + tip, cy)
          ctx.lineTo(cx - tip * 0.4, cy - tip * 0.7)
          ctx.lineTo(cx - tip * 0.4, cy + tip * 0.7)
        } else {
          ctx.moveTo(cx - tip, cy)
          ctx.lineTo(cx + tip * 0.4, cy - tip * 0.7)
          ctx.lineTo(cx + tip * 0.4, cy + tip * 0.7)
        }
        ctx.closePath()
        ctx.fill()
      }
    }
  }

  // Convert a mouse event to tile-space (x, y).
  function eventToTile(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    // The canvas may be CSS-scaled (e.g. inside a transformed parent). Compute
    // the world tile position by dividing by the rendered CSS size, not the
    // intrinsic canvas size.
    const sx = rect.width / (blueprint.width * TILE_PX || 1)
    const sy = rect.height / (blueprint.height * TILE_PX || 1)
    return {
      x: (e.clientX - rect.left) / (TILE_PX * sx),
      y: (e.clientY - rect.top) / (TILE_PX * sy),
    }
  }

  // Convert a mouse event to the cell under the cursor (or null).
  function hitTest(e: React.MouseEvent<HTMLCanvasElement>): Cell | null {
    const t = eventToTile(e)
    if (!t) return null
    return (
      blueprint.cells.find(
        (c) => t.x >= c.x && t.x <= c.x + c.w && t.y >= c.y && t.y <= c.y + c.h,
      ) ?? null
    )
  }

  // Belts at every level (root + nested). Walks the tree and returns each
  // belt with its absolute y-extent so we know whether a click row lands
  // on the belt at all.
  function collectAllBelts(): Array<{ x: number; y0: number; y1: number; laneA?: { item: string; rate: number }; laneB?: { item: string; rate: number } }> {
    const out: Array<{ x: number; y0: number; y1: number; laneA?: { item: string; rate: number }; laneB?: { item: string; rate: number } }> = []
    const walk = (n: import("../types").BusNode) => {
      for (const b of n.belts) out.push({ x: b.x, y0: n.y, y1: n.y + n.h, laneA: b.laneA, laneB: b.laneB })
      for (const c of n.children) walk(c)
    }
    if (blueprint.root) walk(blueprint.root)
    return out
  }

  function laneHitTest(e: React.MouseEvent<HTMLCanvasElement>): LaneHit | null {
    const t = eventToTile(e)
    if (!t) return null
    const beltW = blueprint.beltWidth
    const halfW = beltW / 2
    const allBelts = collectAllBelts()
    for (const b of allBelts) {
      if (t.x < b.x || t.x >= b.x + beltW) continue
      if (t.y < b.y0 || t.y >= b.y1) continue
      const lane: "A" | "B" = t.x - b.x < halfW ? "A" : "B"
      const cell = lane === "A" ? b.laneA : b.laneB
      if (!cell) continue
      return { beltX: b.x, lane, item: cell.item, rate: cell.rate }
    }
    return null
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!onHover) return
    onHover(hitTest(e))
  }

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    // Cell click takes priority — a cell is on top of any belt visually.
    const cellHit = hitTest(e)
    if (cellHit) {
      onClickCell?.(cellHit.recipeKey, e)
      return
    }
    const laneHit = laneHitTest(e)
    if (laneHit) {
      onClickLane?.(laneHit, e)
    }
  }

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={onMouseMove}
      onMouseLeave={() => onHover?.(null)}
      onClick={onClick}
      data-testid="schematic-canvas"
      className="rounded"
      style={{ display: "block" }}
    />
  )
}
