// Belt + pipe utilization heatmap helpers.
//
// Factorio belt tier throughput, verified against the wiki
// (https://wiki.factorio.com/Belt_transport_system) May 2026:
//
//   tier    speed     belt total   per lane
//   yellow  1.875 t/s 15 items/s   7.5 items/s
//   red     3.75  t/s 30 items/s   15  items/s
//   blue    5.625 t/s 45 items/s   22.5 items/s
//   turbo   7.5   t/s 60 items/s   30  items/s
//
// Belts are 2 lanes; on a straight belt items stay on their lane.
// fbp-aae bead is the canonical reference for all belt/lane mechanics.
//
// Pipe throughput depends on segment length, but for a short connector
// (≤17 pipes) the standard throughput is 1200 fluid units/sec.
// Long pipe runs degrade. We default to the "short segment" throughput.

export type BeltTier = "yellow" | "red" | "blue" | "turbo"

/**
 * Items per second PER LANE (one of the two lanes of a belt).
 * Half of the commonly-quoted full-belt throughput.
 *
 * Originally these were half this large (mislabeled — the source
 * wiki number is FULL belt throughput, and we were treating it as
 * per-lane). Corrected May 2026 — utilization rendering pre-fix was
 * showing 2× the real available capacity.
 */
export const BELT_TIER_LANE_CAPACITY: Record<BeltTier, number> = {
  yellow: 7.5,
  red: 15,
  blue: 22.5,
  turbo: 30,
}

/** Full belt throughput across BOTH lanes — commonly quoted number. */
export const BELT_TIER_BELT_CAPACITY: Record<BeltTier, number> = {
  yellow: 15,
  red: 30,
  blue: 45,
  turbo: 60,
}

/** Belt linear speed in tiles/sec. */
export const BELT_TIER_SPEED: Record<BeltTier, number> = {
  yellow: 1.875,
  red: 3.75,
  blue: 5.625,
  turbo: 7.5,
}

export const BELT_TIER_LABELS: Record<BeltTier, string> = {
  yellow: "Yellow · 15/s belt",
  red: "Red · 30/s belt",
  blue: "Blue · 45/s belt",
  turbo: "Turbo · 60/s belt",
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
