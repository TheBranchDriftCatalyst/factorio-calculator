// Factory-manifold strip layout — the single source of truth for how a
// cell's `machines[]` array is laid out across its rectangle.
//
// Before this module, busLayout.emitLeafCell emitted ONE MachinePlacement
// at the center of the cell regardless of demanded. A factory needing
// 50 foundries showed up as a single sprite + "×50" badge — visually
// indistinguishable from a 1-machine factory. Templates layered on top
// (manifold-6, manifold-12) resized the cell rectangle but never touched
// machines[] so the renderer still drew one sprite.
//
// The N+i pattern: we don't actually want 50 sprites for 50 foundries —
// at 18px/tile that'd be 200 tiles wide. We show a REPRESENTATIVE strip
// (typically 6 cols × 2 rows = 12 machines max) and badge the real count.
// The factory is "tiled" — read as "this strip repeats N times."

import type { MachinePlacement } from "../types"

export const DEFAULT_COLS_PER_ROW = 6
export const DEFAULT_MAX_ROWS_VISIBLE = 2

export interface ManifoldStrip {
  /** Machine placements actually drawn — at most colsPerRow × rowsVisible. */
  machines: MachinePlacement[]
  /** Strip width in tiles (= colsPerRow × machineW when demanded ≥ colsPerRow). */
  w: number
  /** Strip height in tiles (= rowsVisible × machineH). */
  h: number
  /** How many machines we drew (= machines.length). */
  visibleCount: number
  /** Cols per row used (clamped to demanded when demanded is small). */
  colsPerRow: number
  /** Rows actually drawn. */
  rowsVisible: number
  /** Rows the recipe would need un-tiled. */
  rowsTotal: number
  /**
   * Machines not drawn (= demanded − visibleCount). When > 0 the strip is
   * tiled; the renderer surfaces this via a "+N more" pill so the user
   * understands the factory repeats.
   */
  hiddenCount: number
}

export interface ManifoldOptions {
  /** Maximum machines per row. Default 6 (matches the manifold-6 template). */
  colsPerRow?: number
  /** Cap on rendered rows. Default 2 — above this we tile + badge. */
  maxRowsVisible?: number
}

/**
 * Compute the visible manifold strip for a recipe needing `demanded`
 * machines. Pure function — same inputs → same machines list, used by
 * busLayout AND template.apply() so they can't drift.
 *
 * Origin is the strip's top-left corner; machines are emitted in
 * row-major order (left-to-right, top-to-bottom).
 */
export function tileStrip(
  recipeKey: string,
  machineKey: string,
  demanded: number,
  machineW: number,
  machineH: number,
  originX: number,
  originY: number,
  opts: ManifoldOptions = {},
): ManifoldStrip {
  const colsPerRow = Math.max(
    1,
    Math.min(opts.colsPerRow ?? DEFAULT_COLS_PER_ROW, Math.max(1, demanded)),
  )
  const maxRowsVisible = Math.max(1, opts.maxRowsVisible ?? DEFAULT_MAX_ROWS_VISIBLE)
  const rowsTotal = Math.max(1, Math.ceil(demanded / colsPerRow))
  const rowsVisible = Math.min(rowsTotal, maxRowsVisible)
  const visibleCount = Math.min(demanded, colsPerRow * rowsVisible)

  const machines: MachinePlacement[] = []
  for (let i = 0; i < visibleCount; i++) {
    const row = Math.floor(i / colsPerRow)
    const col = i % colsPerRow
    machines.push({
      recipeKey,
      machineKey,
      x: originX + col * machineW,
      y: originY + row * machineH,
      w: machineW,
      h: machineH,
      index: i,
    })
  }
  return {
    machines,
    w: colsPerRow * machineW,
    h: rowsVisible * machineH,
    visibleCount,
    colsPerRow,
    rowsVisible,
    rowsTotal,
    hiddenCount: Math.max(0, demanded - visibleCount),
  }
}
