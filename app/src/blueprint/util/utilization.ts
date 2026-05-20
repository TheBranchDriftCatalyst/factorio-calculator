// Belt utilization heatmap helpers.
//
// Factorio belt tiers (items/sec per lane):
//   yellow → 15  (tier 1, easy unlocks)
//   red    → 30  (tier 2)
//   blue   → 45  (tier 3, end of vanilla)
//   turbo  → 60  (Space Age, late-game)
//
// We surface a small enum + helpers so the schematic can show
// utilization against the user's actual belt choice — a 30 items/s
// flow saturates a yellow belt but barely touches turbo.

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

export interface UtilLevel {
  /** 0..∞ — capped at 10 visually */
  ratio: number
  /** CSS color string for filling a lane swatch */
  color: string
  /** descriptive bucket label */
  label: "idle" | "ok" | "warm" | "saturated" | "overloaded"
}

export function laneUtilization(rate: number, tier: BeltTier = "yellow"): UtilLevel {
  const cap = BELT_TIER_LANE_CAPACITY[tier]
  const ratio = rate / cap
  if (ratio < 0.05) return { ratio, color: "rgba(82, 82, 91, 0.75)", label: "idle" }
  if (ratio < 0.5) return { ratio, color: "rgba(16, 185, 129, 0.78)", label: "ok" }
  if (ratio < 0.85) return { ratio, color: "rgba(245, 158, 11, 0.85)", label: "warm" }
  if (ratio <= 1.0) return { ratio, color: "rgba(255, 46, 99, 0.85)", label: "saturated" }
  return { ratio, color: "rgba(255, 46, 99, 1)", label: "overloaded" }
}
