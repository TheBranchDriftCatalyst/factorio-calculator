// Sprite-sheet drawing helper for the canvas renderer.
//
// Encapsulates the (iconCol, iconRow) → pixel-offset math so canvas drawing
// code doesn't have to know the cell size or repeat the multiplication at
// every call site. The class also owns the loaded HTMLImageElement; callers
// just hand it items/machines and a destination rect.

import { useEffect, useState } from "react"
import type { Catalog, Item, Machine } from "../../factorio"

/**
 * Wraps a loaded sprite sheet + the catalog's sprite metadata. Encapsulates
 * the (iconCol, iconRow) → pixel-offset math so canvas drawing code doesn't
 * have to know the cell size or repeat the multiplication everywhere.
 */
export class SpriteAtlas {
  constructor(
    private readonly image: HTMLImageElement,
    private readonly cell: number,
  ) {}

  /** Draw the sprite for `item` into the target rect. No-op if item lacks coords. */
  drawItem(
    ctx: CanvasRenderingContext2D,
    item: Item | undefined,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    if (!item) return
    this.drawAt(ctx, item.iconCol, item.iconRow, x, y, w, h)
  }

  /**
   * Draw the sprite for `machine` (item-keyed in the catalog). Machines in
   * Factorio are also items, so we look up the icon coords via the items map
   * by machine.key.
   */
  drawMachine(
    ctx: CanvasRenderingContext2D,
    machine: Machine | undefined,
    catalog: Catalog,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    if (!machine) return
    const item = catalog.items.get(machine.key)
    if (!item) return
    this.drawAt(ctx, item.iconCol, item.iconRow, x, y, w, h)
  }

  /** Draw by raw (col, row). Escape hatch for cases that have explicit coords. */
  drawAt(
    ctx: CanvasRenderingContext2D,
    col: number,
    row: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const c = this.cell
    ctx.drawImage(this.image, col * c, row * c, c, c, x, y, w, h)
  }
}

/**
 * Custom hook: loads the sprite sheet on `catalog.sprites.hash` change and
 * returns a `{ atlas }` object. `atlas` is `null` while the image is loading
 * (or if the hash is empty/load failed), so callers should null-check before
 * drawing. The returned atlas instance is stable for a given loaded image.
 */
export function useSpriteAtlas(catalog: Catalog): { atlas: SpriteAtlas | null } {
  const [atlas, setAtlas] = useState<SpriteAtlas | null>(null)
  const hash = catalog.sprites.hash
  const cell = catalog.sprites.cell

  useEffect(() => {
    if (!hash) {
      setAtlas(null)
      return
    }
    const url = `${import.meta.env.BASE_URL}images/sprite-sheet-${hash}.png`
    const img = new Image()
    let cancelled = false
    img.src = url
    img.onload = () => {
      if (cancelled) return
      setAtlas(new SpriteAtlas(img, cell))
    }
    img.onerror = () => {
      if (cancelled) return
      setAtlas(null)
    }
    return () => {
      cancelled = true
      setAtlas(null)
    }
  }, [hash, cell])

  return { atlas }
}
