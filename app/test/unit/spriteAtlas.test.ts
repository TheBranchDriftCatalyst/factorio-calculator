import { describe, it, expect } from "vitest"
import { SpriteAtlas } from "../../src/blueprint/render/SpriteAtlas"
import type { Catalog, Item, Machine } from "../../src/factorio"

// Build a fake 2D context that captures drawImage() invocations. We only
// need drawImage for these tests, so we use a tiny stub rather than dragging
// in a full canvas polyfill.
function makeFakeCtx(): { ctx: CanvasRenderingContext2D; calls: unknown[][] } {
  const calls: unknown[][] = []
  const ctx = {
    drawImage: (...args: unknown[]) => {
      calls.push(args)
    },
  } as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

function makeFakeImage(): HTMLImageElement {
  // SpriteAtlas only ever uses this as the first arg to ctx.drawImage. Any
  // marker object is fine — we just want identity-equality on the captured
  // call payload.
  return { __isFakeImage: true } as unknown as HTMLImageElement
}

describe("SpriteAtlas.drawItem", () => {
  it("calls ctx.drawImage with (col*cell, row*cell, cell, cell) source rect and pixel dst", () => {
    const img = makeFakeImage()
    const atlas = new SpriteAtlas(img, 32)
    const { ctx, calls } = makeFakeCtx()
    const item: Item = { key: "iron-plate", name: "Iron plate", iconCol: 3, iconRow: 5 }
    atlas.drawItem(ctx, item, 100, 200, 16, 16)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual([img, 3 * 32, 5 * 32, 32, 32, 100, 200, 16, 16])
  })

  it("is a no-op when item is undefined", () => {
    const atlas = new SpriteAtlas(makeFakeImage(), 32)
    const { ctx, calls } = makeFakeCtx()
    atlas.drawItem(ctx, undefined, 0, 0, 16, 16)
    expect(calls).toHaveLength(0)
  })
})

describe("SpriteAtlas.drawMachine", () => {
  // Build a tiny catalog-shaped fixture that has a matching item for the
  // machine key under test. We don't need a fully-loaded Catalog — only the
  // `items` map is read by drawMachine.
  const machineKey = "assembling-machine-1"
  const machine: Machine = {
    key: machineKey,
    name: "Assembling machine 1",
    craftingCategories: new Set(["crafting"]),
    craftingSpeed: 0.5,
    prodBonus: 0,
    moduleSlots: 0,
    power: 75_000,
    energySource: "electric",
    fuelCategories: new Set(),
  }
  const machineItem: Item = { key: machineKey, name: "Assembling machine 1", iconCol: 4, iconRow: 7 }
  const fakeCatalog = {
    items: new Map<string, Item>([[machineKey, machineItem]]),
  } as unknown as Catalog

  it("looks up Machine.key in catalog.items and draws at its iconCol/iconRow", () => {
    const img = makeFakeImage()
    const atlas = new SpriteAtlas(img, 32)
    const { ctx, calls } = makeFakeCtx()
    atlas.drawMachine(ctx, machine, fakeCatalog, 10, 20, 32, 32)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual([img, 4 * 32, 7 * 32, 32, 32, 10, 20, 32, 32])
  })

  it("is a no-op when machine is undefined", () => {
    const atlas = new SpriteAtlas(makeFakeImage(), 32)
    const { ctx, calls } = makeFakeCtx()
    atlas.drawMachine(ctx, undefined, fakeCatalog, 0, 0, 32, 32)
    expect(calls).toHaveLength(0)
  })

  it("falls back to a no-op when the machine has no matching item in the catalog", () => {
    const atlas = new SpriteAtlas(makeFakeImage(), 32)
    const { ctx, calls } = makeFakeCtx()
    const ghostMachine: Machine = {
      key: "nonexistent-machine",
      name: "Ghost",
      craftingCategories: new Set(),
      craftingSpeed: 1,
      prodBonus: 0,
      moduleSlots: 0,
      power: 0,
      energySource: "electric",
      fuelCategories: new Set(),
    }
    atlas.drawMachine(ctx, ghostMachine, fakeCatalog, 0, 0, 32, 32)
    expect(calls).toHaveLength(0)
  })
})

describe("SpriteAtlas.drawAt", () => {
  it("draws at literal (col, row) regardless of catalog", () => {
    const img = makeFakeImage()
    const atlas = new SpriteAtlas(img, 32)
    const { ctx, calls } = makeFakeCtx()
    atlas.drawAt(ctx, 7, 9, 50, 60, 24, 24)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual([img, 7 * 32, 9 * 32, 32, 32, 50, 60, 24, 24])
  })

  it("uses the configured cell size when computing source coordinates", () => {
    const img = makeFakeImage()
    const atlas = new SpriteAtlas(img, 16) // non-default cell
    const { ctx, calls } = makeFakeCtx()
    atlas.drawAt(ctx, 2, 3, 0, 0, 16, 16)
    expect(calls[0]).toEqual([img, 2 * 16, 3 * 16, 16, 16, 0, 0, 16, 16])
  })
})
