import { useMemo } from "react"
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button"
import { Input } from "@thebranchdriftcatalyst/catalyst-ui/ui/input"
import type { Catalog, Machine, Recipe } from "../factorio"
import { ItemCombobox } from "../components/ItemCombobox"
import { RecipePicker } from "../components/RecipePicker"
import { RATE_UNIT_MULT, type RateUnit } from "../util/format"

export type OutputMode = "rate" | "machines"

// Mirror solver picks so the UI's machine-count maths line up with the actual
// solver chain. Out of solver concern: solver still sees an items/sec target.
function pickRecipe(catalog: Catalog, item: string): Recipe | undefined {
  const candidates = catalog.recipesByProduct.get(item) ?? []
  return candidates.find((r) => r.key === item) ?? candidates[0]
}

function pickMachine(catalog: Catalog, recipe: Recipe): Machine | undefined {
  const candidates = catalog.machinesByCategory.get(recipe.category) ?? []
  if (candidates.length === 0) return undefined
  return [...candidates].sort((a, b) => b.craftingSpeed - a.craftingSpeed)[0]
}

/**
 * items/sec produced by `n` of the fastest machine running the primary recipe
 * for `item`. Returns undefined when no recipe/machine is available so callers
 * can keep the previous rate untouched.
 */
export function machinesToRate(
  catalog: Catalog,
  item: string,
  n: number,
): number | undefined {
  const recipe = pickRecipe(catalog, item)
  if (!recipe) return undefined
  const machine = pickMachine(catalog, recipe)
  if (!machine) return undefined
  const product = recipe.products.find((p) => p.item === item)
  if (!product || product.amount === 0 || recipe.time === 0) return undefined
  return n * (product.amount / recipe.time) * machine.craftingSpeed
}

interface Props {
  catalog: Catalog
  index: number
  item: string
  rate: number // items/sec — the canonical model
  mode: OutputMode
  /** Raw value the user typed; semantics depend on `mode`. */
  draftValue: number
  rateUnit: RateUnit
  canRemove: boolean
  /** Per-item recipe overrides. Empty string / undefined = "use default". */
  recipeChoice?: string
  /**
   * Called when the user picks an alternate recipe for THIS target item.
   * Pass empty string to clear the override (go back to solver default).
   */
  onRecipeChange?: (recipeKey: string) => void
  onItemChange: (item: string) => void
  onRateChange: (rate: number) => void
  onModeChange: (mode: OutputMode, nextDraft: number, nextRate: number) => void
  onDraftChange: (draftValue: number, nextRate: number) => void
  /** Per-row rate-unit toggle — affects how draftValue is interpreted. */
  onRateUnitChange: (unit: RateUnit, nextDraft: number) => void
  onRemove: () => void
}

export function OutputRow({
  catalog,
  index,
  item,
  rate,
  mode,
  draftValue,
  rateUnit,
  canRemove,
  recipeChoice,
  onRecipeChange,
  onItemChange,
  onModeChange,
  onDraftChange,
  onRateUnitChange,
  onRemove,
}: Props) {
  const unitSuffix = rateUnit === "sec" ? "/s" : rateUnit === "min" ? "/min" : "/hr"

  // Available recipe choices for THIS target's item. Recycling recipes are
  // excluded (they're the inverse of a normal recipe and would create a
  // loop in the solver if picked).
  const recipeOptions = useMemo(() => {
    const candidates = (catalog.recipesByProduct.get(item) ?? []).filter(
      (r) => r.category !== "recycling" && !r.key.endsWith("-recycling"),
    )
    return candidates
  }, [catalog, item])

  // Reconcile the canonical rate when the item changes in machines mode.
  // (Item swap from outside doesn't go through onDraftChange so we don't need to here.)
  const machinesPreview = useMemo(() => {
    if (mode !== "machines") return null
    const r = machinesToRate(catalog, item, draftValue)
    return r ?? null
  }, [mode, catalog, item, draftValue])

  const onModeButton = (next: OutputMode) => {
    if (next === mode) return
    if (next === "rate") {
      // Going machines → rate: seed the rate input with the current canonical
      // rate, expressed in the active unit.
      const nextDraft = rate * RATE_UNIT_MULT[rateUnit]
      onModeChange(next, nextDraft, rate)
    } else {
      // rate → machines: derive a sensible initial machine count from current
      // rate. Round up to the nearest whole machine (factories don't run
      // fractional builders). Fall back to 1 if recipe/machine missing.
      const recipe = pickRecipe(catalog, item)
      const machine = recipe ? pickMachine(catalog, recipe) : undefined
      const product = recipe?.products.find((p) => p.item === item)
      let count = 1
      if (recipe && machine && product && product.amount > 0) {
        const perMachine = (product.amount / recipe.time) * machine.craftingSpeed
        count = Math.max(1, Math.ceil(rate / perMachine))
      }
      const nextRate = machinesToRate(catalog, item, count) ?? rate
      onModeChange(next, count, nextRate)
    }
  }

  const onValueInput = (raw: string) => {
    const v = Number(raw)
    if (!Number.isFinite(v)) return
    if (mode === "rate") {
      // User-typed value lives in the active rate unit; canonical model is /s.
      const r = v / RATE_UNIT_MULT[rateUnit]
      onDraftChange(v, r)
    } else {
      const r = machinesToRate(catalog, item, v) ?? rate
      onDraftChange(v, r)
    }
  }

  return (
    <li
      className="flex items-center gap-2"
      data-testid={`target-row-${index}`}
    >
      <ItemCombobox
        catalog={catalog}
        value={item}
        onChange={onItemChange}
        testId={`target-item-${index}`}
      />

      <div
        className="inline-flex shrink-0"
        role="group"
        aria-label="target mode"
      >
        {(["rate", "machines"] as OutputMode[]).map((m, j) => {
          const active = m === mode
          return (
            <button
              key={m}
              type="button"
              data-testid={`target-mode-${index}-${m}`}
              onClick={() => onModeButton(m)}
              aria-pressed={active}
              style={{
                padding: "4px 10px",
                fontFamily:
                  '"JetBrains Mono", var(--font-mono), ui-monospace, monospace',
                fontSize: "10px",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: active ? "#000" : "rgba(255,255,255,0.55)",
                background: active ? "var(--signature, #FFC940)" : "transparent",
                border: "1px solid rgba(255,176,0,0.28)",
                borderRightWidth: j === 1 ? 1 : 0,
                cursor: "pointer",
                lineHeight: 1.2,
              }}
              title={
                m === "rate" ? "Specify target as a rate" : "Specify target as a machine count"
              }
            >
              {m}
            </button>
          )
        })}
      </div>

      <Input
        data-testid={`target-rate-${index}`}
        type="number"
        step={mode === "rate" ? "0.1" : "1"}
        min={mode === "rate" ? "0" : "1"}
        className="w-24 font-mono"
        style={{ fontVariantNumeric: "tabular-nums" }}
        value={draftValue}
        onChange={(e) => onValueInput(e.target.value)}
        aria-label={mode === "rate" ? `rate items per ${rateUnit}` : "machine count"}
      />

      {/* Per-row rate-unit toggle (only meaningful in rate mode; in
          machines mode it just affects the preview suffix). */}
      {mode === "rate" ? (
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
                data-testid={`target-rate-unit-${index}-${u}`}
                onClick={() => {
                  // Re-express the current canonical rate into the new unit
                  // so the visible number stays consistent.
                  onRateUnitChange(u, rate * RATE_UNIT_MULT[u])
                }}
                style={{
                  padding: "3px 7px",
                  fontFamily: '"JetBrains Mono", var(--font-mono), ui-monospace, monospace',
                  fontSize: "10px",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: active ? "#000" : "rgba(255,255,255,0.55)",
                  background: active ? "var(--signature, #FFC940)" : "transparent",
                  border: "1px solid rgba(255,176,0,0.28)",
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
      ) : (
        <span
          className="text-xs opacity-60 min-w-[5rem]"
          style={{ letterSpacing: "0.06em", textTransform: "uppercase" }}
        >
          {machinesPreview != null
            ? `≈ ${(machinesPreview * RATE_UNIT_MULT[rateUnit]).toFixed(2)}${unitSuffix}`
            : "machines"}
        </span>
      )}

      {/* Per-target recipe picker — visible whenever there's a known
          recipe so the user can always SEE ingredients → products as
          icon cards. With 2+ recipes it acts as a chooser; with 1 recipe
          it's informational (still clickable to confirm the default). */}
      {recipeOptions.length > 0 && onRecipeChange && (
        <RecipePicker
          catalog={catalog}
          options={recipeOptions}
          value={recipeChoice ?? ""}
          onChange={onRecipeChange}
          testId={`target-recipe-${index}`}
        />
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid={`target-remove-${index}`}
        onClick={onRemove}
        disabled={!canRemove}
        aria-label="remove target"
      >
        ×
      </Button>
    </li>
  )
}
