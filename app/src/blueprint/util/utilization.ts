// Belt + pipe utilization heatmap helpers.
//
// Factorio belt tiers (items/sec per lane):
//   yellow → 15  (tier 1)
//   red    → 30  (tier 2)
//   blue   → 45  (tier 3)
//   turbo  → 60  (Space Age)
//
// Factorio pipe throughput depends on segment length, but for a short
// connector (≤17 pipes) the standard throughput is 1200 fluid units/sec.
// Long pipe runs degrade. We default to the "short segment" throughput.

export type BeltTier = "yellow" | "red" | "blue" | "turbo"

export const BELT_TIER_LANE_CAPACITY: Record<BeltTier, number> = {
  yellow: 15,
  red: 30,
  blue: 45,
  turbo: 60,
}

export const BELT_TIER_LABELS: Record<BeltTier, string> = {
  yellow: "Yellow · 15/s",
  red: "Red · 30/s",
  blue: "Blue · 45/s",
  turbo: "Turbo · 60/s",
}

/** Vanilla pipe throughput, fluid units / sec, short segment. */
export const PIPE_CAPACITY = 1200

export interface UtilLevel {
  /** 0..∞ — capped at 10 visually */
  ratio: number
  /** CSS color string for filling a lane swatch */
  color: string
  /** descriptive bucket label */
  label: "idle" | "ok" | "warm" | "saturated" | "overloaded"
}

/**
 * Returns the saturation level of a lane.
 * @param rate   items (or fluid units) per second on the lane.
 * @param tier   belt tier when the lane is a solid belt.
 * @param isFluid when true, uses pipe capacity instead of belt tier.
 */
export function laneUtilization(
  rate: number,
  tier: BeltTier = "yellow",
  isFluid = false,
): UtilLevel {
  const cap = isFluid ? PIPE_CAPACITY : BELT_TIER_LANE_CAPACITY[tier]
  const ratio = rate / cap
  if (ratio < 0.05) return { ratio, color: "rgba(82, 82, 91, 0.75)", label: "idle" }
  if (ratio < 0.5) return { ratio, color: "rgba(16, 185, 129, 0.78)", label: "ok" }
  if (ratio < 0.85) return { ratio, color: "rgba(245, 158, 11, 0.85)", label: "warm" }
  if (ratio <= 1.0) return { ratio, color: "rgba(255, 46, 99, 0.85)", label: "saturated" }
  return { ratio, color: "rgba(255, 46, 99, 1)", label: "overloaded" }
}
