// Detailed render of a single Cell — recipe name + machine, then two
// clearly-distinguished blocks: CONSUMES (inputs from bus) and PRODUCES
// (outputs to bus). Each row carries an item icon, item name, rate, and
// a utilization chip vs the configured belt tier. Used by InspectorPanel
// for both "hover preview" and "pinned" states (toggled via `expanded`).

import { useId, useMemo } from "react"
import type { Catalog } from "../../../factorio"
import type { Cell, CellPort } from "../../../blueprint/types"
import { fmtPct, fmtRateUnit, type RateUnit } from "../../../util/format"
import { laneUtilization, type BeltTier } from "../../../blueprint/util/utilization"
import type { SchematicConfig } from "../SchematicConfig"
import { ItemIcon } from "../../../components/Icon"

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
  const recipe = catalog.recipes.get(cell.recipeKey)
  const compatibleMachines = useMemo(() => {
    if (!recipe) return []
    const list = catalog.machinesByCategory.get(recipe.category) ?? []
    return [...list].sort((a, b) => b.craftingSpeed - a.craftingSpeed)
  }, [catalog, recipe])
  const overrideKey = config.machineOverrides?.[cell.recipeKey]
  // useId so multiple CellDetails (e.g. multi-select rendered side-by-side)
  // don't produce duplicate label-for ids.
  const machineSelectId = useId()

  // Effective machine for this cell — override or the solver's default
  // (fastest in the recipe's category).
  const machine = useMemo(() => {
    if (overrideKey) return catalog.machines.get(overrideKey)
    return compatibleMachines[0]
  }, [overrideKey, catalog, compatibleMachines])

  const onMachineChange = (v: string) => {
    const next = { ...(config.machineOverrides ?? {}) }
    if (v === "__default") {
      delete next[cell.recipeKey]
    } else {
      next[cell.recipeKey] = v
    }
    updateConfig("machineOverrides", next)
  }

  return (
    <div className={expanded ? "space-y-3" : "space-y-2"}>
      {/* Recipe header — name + machine icon + count */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 8px",
          background: "rgba(255,255,255,0.04)",
          borderLeft: "3px solid rgba(255,201,64,0.7)",
          borderRadius: 3,
        }}
      >
        {machine && <ItemIcon catalog={catalog} itemKey={machine.key} size={28} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="font-medium truncate">{cell.recipeName}</div>
          <div className="opacity-70" style={{ fontSize: 10.5 }}>
            {machine?.name ?? "—"} ·{" "}
            <span className="font-mono">×{cell.demanded}</span> · {cell.w}×{cell.h} tiles
          </div>
        </div>
      </div>

      {/* Machine override dropdown */}
      {compatibleMachines.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <label
            className="opacity-80 text-[10px] uppercase tracking-wide"
            htmlFor={machineSelectId}
          >
            Machine
          </label>
          <select
            id={machineSelectId}
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

      {/* CONSUMES block — sky-blue accent matches bus-input arrows */}
      <PortBlock
        title="Consumes"
        sub="from bus"
        ports={cell.inputs}
        accent="rgba(125, 211, 252, 0.85)"
        accentBg="rgba(125, 211, 252, 0.08)"
        catalog={catalog}
        beltTier={beltTier}
        rateUnit={rateUnit}
        config={config}
      />

      {/* PRODUCES block — amber accent matches bus-output arrows */}
      <PortBlock
        title="Produces"
        sub="to bus"
        ports={cell.outputs}
        accent="rgba(255, 201, 64, 0.85)"
        accentBg="rgba(255, 201, 64, 0.08)"
        catalog={catalog}
        beltTier={beltTier}
        rateUnit={rateUnit}
        config={config}
      />
    </div>
  )
}

function PortBlock({
  title,
  sub,
  ports,
  accent,
  accentBg,
  catalog,
  beltTier,
  rateUnit,
  config,
}: {
  title: string
  sub: string
  ports: ReadonlyArray<CellPort>
  accent: string
  accentBg: string
  catalog: Catalog
  beltTier: BeltTier
  rateUnit: RateUnit
  config: SchematicConfig
}) {
  return (
    <div
      style={{
        background: accentBg,
        border: `1px solid ${accent.replace(/, [\d.]+\)$/, ", 0.25)")}`,
        borderRadius: 4,
        padding: "6px 8px",
      }}
    >
      <div
        className="uppercase tracking-wide font-medium"
        style={{ fontSize: 9.5, color: accent, marginBottom: 4 }}
      >
        {title} <span className="opacity-70 font-normal">· {sub}</span>
      </div>
      {ports.length === 0 ? (
        <div className="opacity-50" style={{ fontSize: 11 }}>
          —
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {ports.map((p, i) => (
            <PortRow
              key={`${p.item}-${p.beltX}-${i}`}
              port={p}
              catalog={catalog}
              // Per-item override beats global tier.
              effectiveTier={config.beltOverrides?.[p.item] ?? beltTier}
              rateUnit={rateUnit}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PortRow({
  port,
  catalog,
  effectiveTier,
  rateUnit,
}: {
  port: CellPort
  catalog: Catalog
  effectiveTier: BeltTier
  rateUnit: RateUnit
}) {
  const itemName = catalog.items.get(port.item)?.name ?? port.item
  const isFluid = catalog.fluidItems.has(port.item)
  const u = laneUtilization(port.rate, effectiveTier, isFluid)
  return (
    <div
      data-testid={`port-${port.item}`}
      style={{ display: "flex", alignItems: "center", gap: 6 }}
      title={`${itemName} · ${fmtRateUnit(port.rate, rateUnit)} (belt col ${port.beltX})`}
    >
      <ItemIcon catalog={catalog} itemKey={port.item} size={20} />
      <span className="flex-1 truncate" style={{ fontSize: 11 }}>
        {itemName}
      </span>
      <span
        className="font-mono"
        style={{ fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}
      >
        {fmtRateUnit(port.rate, rateUnit)}
      </span>
      <span
        className="font-mono"
        style={{
          background: u.color,
          color:
            u.label === "ok" || u.label === "idle" ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0.92)",
          padding: "1px 4px",
          fontSize: 9,
          minWidth: 36,
          textAlign: "right",
          borderRadius: 2,
        }}
        title={`Utilization on ${effectiveTier} belt — ${u.label}`}
      >
        {fmtPct(u.ratio)}
      </span>
    </div>
  )
}
