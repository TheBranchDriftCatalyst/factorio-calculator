// Universal number formatter for rates, counts, and power.
//
// Goals:
// - Stay readable across 10+ orders of magnitude (cycles + Space Age can blow up).
// - Tabular-friendly: short, no exponent for typical factory rates.
// - Degrade gracefully into k/M/B/T, then scientific for genuinely huge values.

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : "−∞"
  if (n === 0) return "0"
  const abs = Math.abs(n)
  const sign = n < 0 ? "-" : ""
  if (abs < 0.01) return `${sign}<0.01`
  if (abs < 1) return sign + abs.toFixed(2)
  if (abs < 10) return sign + abs.toFixed(2)
  if (abs < 100) return sign + abs.toFixed(1)
  if (abs < 1_000) return sign + abs.toFixed(0)
  if (abs < 1e6) return sign + (abs / 1e3).toFixed(2) + "k"
  if (abs < 1e9) return sign + (abs / 1e6).toFixed(2) + "M"
  if (abs < 1e12) return sign + (abs / 1e9).toFixed(2) + "B"
  if (abs < 1e15) return sign + (abs / 1e12).toFixed(2) + "T"
  // Anything beyond ~10^15 is almost certainly a solver-cycle blowup; use
  // scientific notation rather than fabricating SI prefixes nobody uses.
  return sign + abs.toExponential(2)
}

export function fmtRate(n: number): string {
  return fmt(n) + "/s"
}

export type RateUnit = "sec" | "min" | "hr"

export const RATE_UNIT_MULT: Record<RateUnit, number> = {
  sec: 1,
  min: 60,
  hr: 3600,
}

const RATE_UNIT_SUFFIX: Record<RateUnit, string> = {
  sec: "/s",
  min: "/min",
  hr: "/hr",
}

/**
 * Format a rate (items/sec) into the user-selected display unit.
 * The numeric model stays in items/sec everywhere; this only changes
 * what the user sees.
 */
export function fmtRateUnit(rate: number, unit: RateUnit = "sec"): string {
  return fmt(rate * RATE_UNIT_MULT[unit]) + RATE_UNIT_SUFFIX[unit]
}

export function fmtPowerMW(watts: number): string {
  return fmt(watts / 1e6) + " MW"
}

export function fmtCount(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0"
  if (n < 1) return n.toFixed(2)
  if (n < 10) return n.toFixed(1)
  if (n < 1e6) return Math.round(n).toLocaleString()
  return fmt(n)
}

export function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—"
  if (n >= 10) return ">999%"
  return (n * 100).toFixed(0) + "%"
}
