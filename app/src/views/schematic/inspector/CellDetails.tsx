// Detailed render of a single Cell — recipe name, machine count,
// machine-override dropdown, and inputs/outputs lists with utilization
// chips. Used by InspectorPanel for both "hover preview" and "pinned"
// states (toggled via `expanded`).

import { useMemo } from "react"
import type { Catalog } from "../../../factorio"
import type { Cell } from "../../../blueprint/types"
import { fmtPct, fmtRateUnit, type RateUnit } from "../../../util/format"
import { laneUtilization, type BeltTier } from "../../../blueprint/util/utilization"
import type { SchematicConfig } from "../SchematicConfig"

interface Props {
  cell: Cell
  expanded?: boolean
  beltTier: BeltTier
  rateUnit: RateUnit
  catalog: Catalog
  config: SchematicConfig
  updateConfig: <K extends keyof SchematicConfig>(key: K, value: SchematicConfig[K]) => void
}

export function CellDetails({
  cell,
  expanded,
  beltTier,
  rateUnit,
  catalog,
  config,
  updateConfig,
}: Props) {
  // Compatible machines: every machine in this recipe's crafting category.
  // Sorted fastest-first to match the solver's default heuristic. Empty when
  // the recipe is unknown (shouldn't happen post-load, but be defensive).
  const recipe = catalog.recipes.get(cell.recipeKey)
  const compatibleMachines = useMemo(() => {
    if (!recipe) return []
    const list = catalog.machinesByCategory.get(recipe.category) ?? []
    return [...list].sort((a, b) => b.craftingSpeed - a.craftingSpeed)
  }, [catalog, recipe])
  const overrideKey = config.machineOverrides?.[cell.recipeKey]

  const onMachineChange = (v: string) => {
    const next = { ...(config.machineOverrides ?? {}) }
    if (v === "__default") {
      delete next[cell.recipeKey]
    } else {
      next[cell.recipeKey] = v
    }
    updateConfig("machineOverrides", next)
  }

  const util = (rate: number) => {
    const u = laneUtilization(rate, beltTier)
    return (
      <span
        className="font-mono ml-1 px-1 rounded"
        style={{
          background: u.color,
          color: u.label === "ok" || u.label === "idle" ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0.92)",
          fontSize: 9,
        }}
      >
        {fmtPct(u.ratio)}
      </span>
    )
  }
  return (
    <div className={expanded ? "space-y-3" : "space-y-2"}>
      <div>
        <div className="opacity-60 mb-1">Recipe</div>
        <div className="font-medium">{cell.recipeName}</div>
        <div className="opacity-70">
          {cell.demanded} machine{cell.demanded === 1 ? "" : "s"}
        </div>
        <div className="opacity-50 mt-1">
          {cell.w}×{cell.h} tiles
        </div>
        {compatibleMachines.length > 0 && (
          <div className="flex items-center justify-between gap-2 pt-2">
            <label
              className="opacity-80 text-[10px] uppercase tracking-wide"
              htmlFor="cell-machine-override"
            >
              Machine
            </label>
            <select
              id="cell-machine-override"
              data-testid="cell-machine-override"
              value={overrideKey ?? "__default"}
              onChange={(e) => onMachineChange(e.target.value)}
              className="text-xs font-mono bg-background border border-border rounded px-1 py-0.5"
              style={{ height: 22, minWidth: 160 }}
            >
              <option value="__default">Default (auto)</option>
              {compatibleMachines.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div>
        <div className="opacity-60 mb-1">
          Inputs <span className="text-sky-400">▶ from bus</span>
        </div>
        <ul className="space-y-0.5">
          {cell.inputs.length === 0 && <li className="opacity-50">—</li>}
          {cell.inputs.map((p, i) => (
            <li key={i}>
              <span className="font-mono">{fmtRateUnit(p.rate, rateUnit)}</span>
              {util(p.rate)} {p.item}{" "}
              <span className="opacity-50">(belt col {p.beltX})</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="opacity-60 mb-1">
          Outputs <span className="text-amber-400">◀ to bus</span>
        </div>
        <ul className="space-y-0.5">
          {cell.outputs.length === 0 && <li className="opacity-50">—</li>}
          {cell.outputs.map((p, i) => (
            <li key={i}>
              <span className="font-mono">{fmtRateUnit(p.rate, rateUnit)}</span>
              {util(p.rate)} {p.item}{" "}
              <span className="opacity-50">(belt col {p.beltX})</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
