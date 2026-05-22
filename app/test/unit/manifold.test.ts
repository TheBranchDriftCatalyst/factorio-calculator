import { describe, it, expect } from "vitest"
import {
  tileStrip,
  DEFAULT_COLS_PER_ROW,
  DEFAULT_MAX_ROWS_VISIBLE,
} from "../../src/blueprint/layout/manifold"

describe("manifold · tileStrip", () => {
  it("demanded=1 → single machine, single row, no hidden", () => {
    const s = tileStrip("r", "m", 1, 3, 3, 0, 0)
    expect(s.machines).toHaveLength(1)
    expect(s.colsPerRow).toBe(1)
    expect(s.rowsVisible).toBe(1)
    expect(s.rowsTotal).toBe(1)
    expect(s.visibleCount).toBe(1)
    expect(s.hiddenCount).toBe(0)
    expect(s.w).toBe(3)
    expect(s.h).toBe(3)
  })

  it("demanded=4 fits in one row of 6", () => {
    const s = tileStrip("r", "m", 4, 3, 3, 0, 0)
    expect(s.machines).toHaveLength(4)
    expect(s.colsPerRow).toBe(4) // clamped to demanded
    expect(s.rowsVisible).toBe(1)
    expect(s.w).toBe(12)
    expect(s.h).toBe(3)
    expect(s.hiddenCount).toBe(0)
    // All machines on same row
    expect(s.machines.every((m) => m.y === 0)).toBe(true)
  })

  it("demanded=6 fills exactly one row of default-6", () => {
    const s = tileStrip("r", "m", 6, 3, 3, 0, 0)
    expect(s.machines).toHaveLength(6)
    expect(s.rowsVisible).toBe(1)
    expect(s.rowsTotal).toBe(1)
    expect(s.w).toBe(18)
  })

  it("demanded=7 wraps to row 2", () => {
    const s = tileStrip("r", "m", 7, 3, 3, 0, 0)
    expect(s.machines).toHaveLength(7)
    expect(s.colsPerRow).toBe(6)
    expect(s.rowsVisible).toBe(2)
    expect(s.rowsTotal).toBe(2)
    expect(s.w).toBe(18)
    expect(s.h).toBe(6)
    expect(s.hiddenCount).toBe(0)
    // 7th machine on row 2
    expect(s.machines[6].y).toBe(3)
  })

  it("demanded=50 tiles down to a representative 12-machine strip", () => {
    const s = tileStrip("r", "m", 50, 3, 3, 0, 0)
    expect(s.machines).toHaveLength(12) // 6 cols × 2 rows visible
    expect(s.colsPerRow).toBe(6)
    expect(s.rowsVisible).toBe(2)
    expect(s.rowsTotal).toBe(Math.ceil(50 / 6))
    expect(s.visibleCount).toBe(12)
    expect(s.hiddenCount).toBe(38)
  })

  it("custom colsPerRow=12 widens the strip", () => {
    const s = tileStrip("r", "m", 12, 3, 3, 0, 0, { colsPerRow: 12 })
    expect(s.machines).toHaveLength(12)
    expect(s.colsPerRow).toBe(12)
    expect(s.rowsVisible).toBe(1)
    expect(s.w).toBe(36)
    expect(s.h).toBe(3)
  })

  it("machine x increases monotonically across a row", () => {
    const s = tileStrip("r", "m", 6, 3, 3, 10, 20)
    for (let i = 1; i < s.machines.length; i++) {
      expect(s.machines[i].x).toBeGreaterThanOrEqual(s.machines[i - 1].x)
    }
    // First machine at origin
    expect(s.machines[0].x).toBe(10)
    expect(s.machines[0].y).toBe(20)
  })

  it("default constants are stable", () => {
    expect(DEFAULT_COLS_PER_ROW).toBe(6)
    expect(DEFAULT_MAX_ROWS_VISIBLE).toBe(2)
  })
})
