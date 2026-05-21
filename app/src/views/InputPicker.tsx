import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button"
import type { Catalog } from "../factorio"
import type { Input } from "../solver/expand"
import { RATE_UNIT_MULT, type RateUnit } from "../util/format"
import { InputRow } from "./InputRow"

interface Props {
  catalog: Catalog
  inputs: Input[]
  onChange: (inputs: Input[]) => void
}

interface RowUiState {
  draftValue: number
  unit: RateUnit
}

function defaultUiState(rate: number, unit: RateUnit = "sec"): RowUiState {
  return { draftValue: rate * RATE_UNIT_MULT[unit], unit }
}

const LABEL_STYLE: React.CSSProperties = {
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  opacity: 0.6,
  fontSize: "10.5px",
}

export function InputPicker({ catalog, inputs, onChange }: Props) {
  const allItems = useMemo(() => [...catalog.items.keys()].sort(), [catalog])

  const [uiState, setUiState] = useState<RowUiState[]>(() =>
    inputs.map((i) => defaultUiState(i.rate)),
  )

  // Re-sync uiState length + draft values when the inputs array reference
  // changes (e.g. profile load). Mirrors the TargetPicker pattern.
  const prevInputsRef = useRef(inputs)
  useEffect(() => {
    const prev = prevInputsRef.current
    if (prev === inputs) return
    setUiState((prevUi) => {
      const next: RowUiState[] = []
      for (let i = 0; i < inputs.length; i++) {
        const existing = prevUi[i]
        const t = inputs[i]
        if (existing) {
          const draftAsRate = existing.draftValue / RATE_UNIT_MULT[existing.unit]
          if (Math.abs(draftAsRate - t.rate) < 1e-9) {
            next.push(existing)
            continue
          }
          next.push({ unit: existing.unit, draftValue: t.rate * RATE_UNIT_MULT[existing.unit] })
        } else {
          next.push(defaultUiState(t.rate))
        }
      }
      return next
    })
    prevInputsRef.current = inputs
  }, [inputs])

  const setItem = (i: number, item: string) => {
    onChange(inputs.map((t, j) => (i === j ? { ...t, item } : t)))
  }

  const setDraft = (i: number, draftValue: number, nextRate: number) => {
    setUiState((prev) => prev.map((s, j) => (j === i ? { ...s, draftValue } : s)))
    onChange(inputs.map((t, j) => (i === j ? { ...t, rate: nextRate } : t)))
  }

  const setUnit = (i: number, unit: RateUnit, nextDraft: number) => {
    setUiState((prev) => prev.map((s, j) => (j === i ? { ...s, unit, draftValue: nextDraft } : s)))
  }

  const remove = (i: number) => {
    onChange(inputs.filter((_, j) => j !== i))
    setUiState((prev) => prev.filter((_, j) => j !== i))
  }

  const add = () => {
    const used = new Set(inputs.map((t) => t.item))
    const next = allItems.find((k) => !used.has(k)) ?? allItems[0] ?? "iron-plate"
    onChange([...inputs, { item: next, rate: 1 }])
    setUiState((prev) => [...prev, defaultUiState(1)])
  }

  return (
    <div className="flex flex-col gap-2" data-testid="input-picker">
      <h2 style={LABEL_STYLE}>Inputs</h2>
      {inputs.length === 0 ? (
        <div
          data-testid="inputs-empty"
          className="text-xs opacity-50 border border-dashed border-border rounded-md px-3 py-3 italic"
        >
          No supplied inputs — the solver will plan the full recipe chain.
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {inputs.map((t, i) => {
            const ui = uiState[i] ?? defaultUiState(t.rate)
            return (
              <InputRow
                key={i}
                catalog={catalog}
                index={i}
                item={t.item}
                rate={t.rate}
                rateUnit={ui.unit}
                draftValue={ui.draftValue}
                canRemove
                onItemChange={(item) => setItem(i, item)}
                onDraftChange={(d, r) => setDraft(i, d, r)}
                onRateUnitChange={(u, d) => setUnit(i, u, d)}
                onRemove={() => remove(i)}
              />
            )
          })}
        </ul>
      )}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="input-add"
          onClick={add}
        >
          + Add input
        </Button>
      </div>
    </div>
  )
}
