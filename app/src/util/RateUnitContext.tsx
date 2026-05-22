// React context for the active rate-display unit (sec / min / hr). Lives
// at App level (single source of truth), threaded down to any component
// that renders a rate via `fmtRateUnit(...)`. Avoided drilling through
// SchematicView → InspectorPanel → CellDetails by exposing this context.
//
// `useRateUnit()` throws when no provider is mounted so the failure mode
// is a stack trace, not a silently mis-rendered rate.

import { createContext, useContext, type ReactNode } from "react"
import type { RateUnit } from "./format"

const RateUnitContext = createContext<RateUnit | null>(null)

export function RateUnitProvider({
  value,
  children,
}: {
  value: RateUnit
  children: ReactNode
}) {
  return <RateUnitContext.Provider value={value}>{children}</RateUnitContext.Provider>
}

export function useRateUnit(): RateUnit {
  const ctx = useContext(RateUnitContext)
  if (ctx === null) {
    throw new Error(
      "useRateUnit() called outside of <RateUnitProvider>. Wrap the consuming tree in <RateUnitProvider value={rateUnit}>.",
    )
  }
  return ctx
}
