// Inspector panel rendered when the user pins a bus lane. Shows the
// lane's item, the rate it carries, current utilization vs the
// configured belt tier, the list of cells that produce / consume from
// that lane, and inline controls to override the belt tier or move the
// item to a different bus.

import { useId } from "react"
import type { Catalog } from "../../../factorio"
import type { Blueprint } from "../../../blueprint/types"
import { fmtPct, fmtRateUnit, type RateUnit } from "../../../util/format"
import {
  BELT_TIER_LABELS,
  laneUtilization,
  type BeltTier,
} from "../../../blueprint/util/utilization"
import type { SchematicConfig } from "../SchematicConfig"

interface Props {
  catalog: Catalog
  blueprint: Blueprint
  lane: { beltX: number; lane: "A" | "B"; item: string; rate: number }
  beltTier: BeltTier
  rateUnit: RateUnit
  onClear: () => void
  config: SchematicConfig
  updateConfig: <K extends keyof SchematicConfig>(key: K, value: SchematicConfig[K]) => void
}

export function LaneDetails({
  catalog,
  blueprint,
  lane,
  beltTier,
  rateUnit,
  onClear,
  config,
  updateConfig,
}: Props) {
  // useId so multiple LaneDetails (e.g. if we ever side-by-side them) don't
  // produce duplicate label-for ids in the DOM.
  const tierId = useId()
  const busId = useId()
  const itemName = catalog.items.get(lane.item)?.name ?? lane.item
  // Per-lane belt-tier override falls back to the global tier. Utilization
  // math + the "@ <tier>" caption both honor the override.
  const overrideTier = config.beltOverrides?.[lane.item]
  const effectiveTier = overrideTier ?? beltTier
  const isFluid = catalog.fluidItems.has(lane.item)
  const util = laneUtilization(lane.rate, effectiveTier, isFluid)

  const onBeltTierChange = (v: string) => {
    const next = { ...(config.beltOverrides ?? {}) }
    if (v === "__default") {
      delete next[lane.item]
    } else {
      next[lane.item] = v as BeltTier
    }
    updateConfig("beltOverrides", next)
  }

  // Aggregate producers + consumers by walking the flat cell list and
  // looking at ports that match (beltX, item).
  const producers: Array<{ key: string; name: string; rate: number }> = []
  const consumers: Array<{ key: string; name: string; rate: number }> = []
  for (const cell of blueprint.cells) {
    for (const p of cell.outputs) {
      if (p.beltX === lane.beltX && p.item === lane.item) {
        producers.push({ key: cell.recipeKey, name: cell.recipeName, rate: p.rate })
      }
    }
    for (const p of cell.inputs) {
      if (p.beltX === lane.beltX && p.item === lane.item) {
        consumers.push({ key: cell.recipeKey, name: cell.recipeName, rate: p.rate })
      }
    }
  }

  return (
    <div
      className="text-xs bg-card border border-border rounded p-3 h-full"
      data-testid="lane-inspector"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="opacity-50 uppercase tracking-wide text-[10px]">
          Lane · {lane.lane === "A" ? "Left" : "Right"} sub-lane
        </div>
        <button className="opacity-60 hover:opacity-100 underline" onClick={onClear}>
          clear
        </button>
      </div>
      <div className="space-y-1 mb-3">
        <div className="font-medium">{itemName}</div>
        <div>
          <span className="opacity-60">Rate: </span>
          <span className="font-mono">{fmtRateUnit(lane.rate, rateUnit)}</span>
          <span
            className="font-mono ml-2 px-1 rounded"
            style={{ background: util.color, color: "rgba(0,0,0,0.92)", fontSize: 9 }}
          >
            {fmtPct(util.ratio)}
          </span>
        </div>
        <div className="opacity-50 text-[10px]">
          @ {effectiveTier} belt · {util.label}
          {overrideTier && (
            <span className="ml-1" style={{ color: "#FFC940" }}>
              (override)
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <label
            className="opacity-80 text-[10px] uppercase tracking-wide"
            htmlFor={tierId}
          >
            Belt tier
          </label>
          <select
            id={tierId}
            data-testid="lane-belt-tier-override"
            value={overrideTier ?? "__default"}
            onChange={(e) => onBeltTierChange(e.target.value)}
            className="text-xs font-mono bg-background border border-border rounded px-1 py-0.5"
            style={{ height: 22, minWidth: 120 }}
          >
            <option value="__default">Default (global)</option>
            {(["yellow", "red", "blue", "turbo"] as BeltTier[]).map((t) => (
              <option key={t} value={t}>
                {BELT_TIER_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        {/* Bus assignment — move this item to a different bus column. */}
        <div className="flex items-center justify-between gap-2 mt-2">
          <label className="opacity-80 text-[11px]" htmlFor={busId}>
            Bus
          </label>
          <select
            id={busId}
            data-testid="lane-bus-assignment"
            value={config.beltAssignments?.[lane.item] ?? "__default"}
            onChange={(e) => {
              const next = { ...(config.beltAssignments ?? {}) }
              if (e.target.value === "__default") delete next[lane.item]
              else if (e.target.value === "__new_left") {
                const used = new Set(Object.values(next))
                let n = 2
                while (used.has(`L${n}`)) n++
                next[lane.item] = `L${n}`
              } else if (e.target.value === "__new_right") {
                const used = new Set(Object.values(next))
                let n = 2
                while (used.has(`R${n}`)) n++
                next[lane.item] = `R${n}`
              } else {
                next[lane.item] = e.target.value
              }
              updateConfig("beltAssignments", next)
            }}
            className="text-xs font-mono bg-background border border-border rounded px-1 py-0.5"
            style={{ height: 22, minWidth: 120 }}
          >
            <option value="__default">Default</option>
            <option value="left">Left bus</option>
            <option value="right">Right bus</option>
            {[
              ...new Set(
                Object.values(config.beltAssignments ?? {}).filter(
                  (b) => b !== "left" && b !== "right",
                ),
              ),
            ]
              .sort()
              .map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            <option value="__new_left">+ new left bus (L#)</option>
            <option value="__new_right">+ new right bus (R#)</option>
          </select>
        </div>
      </div>

      <div>
        <div className="opacity-60 mb-1">Producers</div>
        <ul className="space-y-0.5 mb-3">
          {producers.length === 0 && <li className="opacity-50">—</li>}
          {producers.map((p, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="truncate">{p.name}</span>
              <span className="font-mono opacity-70 shrink-0">
                {fmtRateUnit(p.rate, rateUnit)}
              </span>
            </li>
          ))}
        </ul>

        <div className="opacity-60 mb-1">Consumers</div>
        <ul className="space-y-0.5">
          {consumers.length === 0 && <li className="opacity-50">—</li>}
          {consumers.map((c, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="truncate">{c.name}</span>
              <span className="font-mono opacity-70 shrink-0">
                {fmtRateUnit(c.rate, rateUnit)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
