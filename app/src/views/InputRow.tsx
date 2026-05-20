import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button"
import { Input } from "@thebranchdriftcatalyst/catalyst-ui/ui/input"
import type { Catalog } from "../factorio"
import { ItemCombobox } from "../components/ItemCombobox"
import { RATE_UNIT_MULT, type RateUnit } from "../util/format"

interface Props {
  catalog: Catalog
  index: number
  item: string
  /** items/sec — canonical model */
  rate: number
  /** display unit for the input */
  rateUnit: RateUnit
  draftValue: number
  canRemove: boolean
  onItemChange: (item: string) => void
  onDraftChange: (draftValue: number, nextRate: number) => void
  onRateUnitChange: (unit: RateUnit, nextDraft: number) => void
  onRemove: () => void
}

/**
 * One row in the InputPicker — an item + its supplied rate. The user is
 * telling the solver "assume I already have this much of this item
 * available," which prunes the recipe tree downstream of it. Simpler than
 * OutputRow because there's no machines mode (you don't *produce* an
 * input here — you bring it in from outside).
 */
export function InputRow({
  catalog,
  index,
  item,
  rate,
  rateUnit,
  draftValue,
  canRemove,
  onItemChange,
  onDraftChange,
  onRateUnitChange,
  onRemove,
}: Props) {
  const onValueInput = (raw: string) => {
    const v = Number(raw)
    if (!Number.isFinite(v) || v < 0) return
    const r = v / RATE_UNIT_MULT[rateUnit]
    onDraftChange(v, r)
  }

  return (
    <li
      className="flex items-center gap-2"
      data-testid={`input-row-${index}`}
    >
      <ItemCombobox
        catalog={catalog}
        value={item}
        onChange={onItemChange}
        testId={`input-item-${index}`}
      />
      <Input
        data-testid={`input-rate-${index}`}
        type="number"
        step="0.1"
        min="0"
        className="w-24 font-mono"
        style={{ fontVariantNumeric: "tabular-nums" }}
        value={draftValue}
        onChange={(e) => onValueInput(e.target.value)}
        aria-label={`supplied rate items per ${rateUnit}`}
      />
      <div
        className="inline-flex shrink-0"
        role="group"
        aria-label="rate unit"
      >
        {(["sec", "min", "hr"] as RateUnit[]).map((u, j) => {
          const active = u === rateUnit
          return (
            <button
              key={u}
              type="button"
              data-testid={`input-rate-unit-${index}-${u}`}
              onClick={() => onRateUnitChange(u, rate * RATE_UNIT_MULT[u])}
              style={{
                padding: "3px 7px",
                fontFamily: '"JetBrains Mono", var(--font-mono), ui-monospace, monospace',
                fontSize: "10px",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: active ? "#000" : "rgba(255,255,255,0.55)",
                background: active ? "var(--signature, #FFC940)" : "transparent",
                border: "1px solid rgba(125, 211, 252, 0.4)",
                borderRightWidth: j === 2 ? 1 : 0,
                cursor: "pointer",
                lineHeight: 1.2,
              }}
              title={`per ${u === "sec" ? "second" : u === "min" ? "minute" : "hour"}`}
            >
              /{u === "sec" ? "s" : u}
            </button>
          )
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid={`input-remove-${index}`}
        onClick={onRemove}
        disabled={!canRemove}
        aria-label="remove input"
      >
        ×
      </Button>
    </li>
  )
}
