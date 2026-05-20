import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button"
import type { Catalog } from "../factorio"
import type { Target } from "../solver/expand"
import { RATE_UNIT_MULT, type RateUnit } from "../util/format"
import { OutputRow, machinesToRate, type OutputMode } from "./OutputRow"

interface Props {
  catalog: Catalog
  targets: Target[]
  onChange: (targets: Target[]) => void
}

// Per-row UI state — kept here (parallel to `targets`) because the canonical
// Target type is just {item, rate}. Mode + raw draft value + the row's own
// display unit (/s, /min, /hr) live alongside.
interface RowUiState {
  mode: OutputMode
  /** Raw value the user typed: in `unit` units for rate mode, machine count for machines mode. */
  draftValue: number
  unit: RateUnit
}

function defaultUiState(rate: number, unit: RateUnit = "sec"): RowUiState {
  return { mode: "rate", draftValue: rate * RATE_UNIT_MULT[unit], unit }
}

// Bloomberg-style: dim tracked uppercase label.
const LABEL_STYLE: React.CSSProperties = {
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  opacity: 0.6,
  fontSize: "10.5px",
}


export function TargetPicker({
  catalog,
  targets,
  onChange,
}: Props) {
  const allItems = useMemo(() => [...catalog.recipesByProduct.keys()].sort(), [catalog])

  // Parallel UI state — list keyed by index. Each row owns its own
  // display unit; the global selector was removed in favor of per-row.
  const [uiState, setUiState] = useState<RowUiState[]>(() =>
    targets.map((t) => defaultUiState(t.rate)),
  )

  // Keep uiState aligned with the targets array length (rows added/removed
  // by parent or by us). When targets change wholesale (e.g. a profile is
  // loaded), refresh each rate-mode row's draftValue using THAT row's unit
  // so the visible number reflects the new canonical rate.
  const prevTargetsRef = useRef(targets)
  useEffect(() => {
    const prev = prevTargetsRef.current
    if (prev === targets) return
    setUiState((prevUi) => {
      const next: RowUiState[] = []
      for (let i = 0; i < targets.length; i++) {
        const existing = prevUi[i]
        const t = targets[i]
        if (existing) {
          if (existing.mode === "machines") {
            next.push(existing)
            continue
          }
          const draftAsRate = existing.draftValue / RATE_UNIT_MULT[existing.unit]
          if (Math.abs(draftAsRate - t.rate) < 1e-9) {
            next.push(existing)
            continue
          }
          next.push({
            mode: "rate",
            unit: existing.unit,
            draftValue: t.rate * RATE_UNIT_MULT[existing.unit],
          })
        } else {
          next.push(defaultUiState(t.rate))
        }
      }
      return next
    })
    prevTargetsRef.current = targets
  }, [targets])

  const updateTargetRate = (i: number, rate: number) => {
    onChange(targets.map((t, j) => (i === j ? { ...t, rate } : t)))
  }

  const setItem = (i: number, item: string) => {
    const next = targets.map((t, j) => (i === j ? { ...t, item } : t))
    // If the row is in machines mode, re-derive the canonical rate from the
    // new item so the solver stays in sync with the visible machine count.
    const ui = uiState[i]
    if (ui?.mode === "machines") {
      const r = machinesToRate(catalog, item, ui.draftValue)
      if (r != null) next[i] = { ...next[i], rate: r }
    }
    onChange(next)
  }

  const setMode = (i: number, mode: OutputMode, nextDraft: number, nextRate: number) => {
    setUiState((prev) =>
      prev.map((s, j) => (j === i ? { ...s, mode, draftValue: nextDraft } : s)),
    )
    updateTargetRate(i, nextRate)
  }

  const setDraft = (i: number, draftValue: number, nextRate: number) => {
    setUiState((prev) =>
      prev.map((s, j) => (j === i ? { ...s, draftValue } : s)),
    )
    updateTargetRate(i, nextRate)
  }

  const setUnit = (i: number, unit: RateUnit, nextDraft: number) => {
    setUiState((prev) => prev.map((s, j) => (j === i ? { ...s, unit, draftValue: nextDraft } : s)))
  }

  const remove = (i: number) => {
    onChange(targets.filter((_, j) => j !== i))
    setUiState((prev) => prev.filter((_, j) => j !== i))
  }

  const add = () => {
    const used = new Set(targets.map((t) => t.item))
    const next = allItems.find((k) => !used.has(k)) ?? allItems[0]
    onChange([...targets, { item: next, rate: 1 }])
    setUiState((prev) => [...prev, defaultUiState(1)])
  }

  return (
    <div className="flex flex-col gap-2" data-testid="target-picker">
      <div className="flex items-center justify-between gap-3">
        <h2 style={LABEL_STYLE}>Outputs</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="target-add"
          onClick={add}
        >
          + Add target
        </Button>
      </div>
      <ul className="flex flex-col gap-1">
        {targets.map((t, i) => {
          const ui = uiState[i] ?? defaultUiState(t.rate)
          return (
            <OutputRow
              key={i}
              catalog={catalog}
              index={i}
              item={t.item}
              rate={t.rate}
              mode={ui.mode}
              draftValue={ui.draftValue}
              rateUnit={ui.unit}
              canRemove={targets.length > 1}
              onItemChange={(item) => setItem(i, item)}
              onRateChange={(r) => updateTargetRate(i, r)}
              onModeChange={(m, d, r) => setMode(i, m, d, r)}
              onDraftChange={(d, r) => setDraft(i, d, r)}
              onRateUnitChange={(u, d) => setUnit(i, u, d)}
              onRemove={() => remove(i)}
            />
          )
        })}
      </ul>
    </div>
  )
}
