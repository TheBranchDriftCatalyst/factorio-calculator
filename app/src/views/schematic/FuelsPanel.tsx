// "Fuels" side-panel section. Lists every fuel item known to the catalog
// (coal, solid-fuel, rocket-fuel, nuclear-fuel, …) and — for fuels that
// are actually consumed by burners in the current flow — the total burn
// rate and number of consuming machines.
//
// Even fuels that AREN'T used by the current factory are listed (dimmed)
// so the player can see what's available. Burn rate is computed as
//   sum(ceil(node.count) * machine.power) / fuel.fuelValue
// grouped by fuel category, mirroring how Factorio's burner inserter
// would actually consume.

import { useMemo } from "react"
import type { Catalog, Item } from "../../factorio"
import { useCatalog } from "../../factorio/CatalogContext"
import type { FlowGraph } from "../../solver/expand"
import { fmt, fmtRateUnit, type RateUnit } from "../../util/format"
import { useRateUnit } from "../../util/RateUnitContext"
import { ItemIcon } from "../../components/Icon"
import { CollapsiblePanel } from "../../components/CollapsiblePanel"

interface Props {
  flow: FlowGraph | null
  defaultCollapsed?: boolean
}

interface Row {
  item: string
  itemName: string
  fuelValue: number // joules / item
  fuelCategory: string
  burnRate: number // items/sec (0 when unused)
  burners: number // # machines burning this fuel (0 when unused)
  used: boolean
}

export function FuelsPanel({ flow, defaultCollapsed = true }: Props) {
  const catalog = useCatalog()
  const rateUnit = useRateUnit()
  const rows: Row[] = useMemo(() => {
    // 1. Collect every fuel item from the catalog (anything with both a
    //    positive fuelValue and a fuelCategory).
    const fuels: Item[] = []
    for (const it of catalog.items.values()) {
      if (it.fuelValue && it.fuelValue > 0 && it.fuelCategory) fuels.push(it)
    }

    // 2. Walk the flow once, grouping watts + machine counts by the
    //    fuel-category the burner machines accept. Machines that aren't
    //    burners (electric / heat / fluid / void) contribute nothing.
    const wattsByCategory = new Map<string, number>()
    const burnersByCategory = new Map<string, number>()
    if (flow) {
      for (const n of flow.nodes) {
        const m = n.machine
        if (!m || m.energySource !== "burner") continue
        if (m.fuelCategories.size === 0 || m.power <= 0) continue
        const ceilMachines = Math.max(1, Math.ceil(n.count))
        // Multi-category burners (e.g. accepts chemical OR nuclear) get
        // attributed to ALL their categories; in vanilla every burner
        // declares exactly one category so this is a no-op in practice.
        for (const cat of m.fuelCategories) {
          wattsByCategory.set(cat, (wattsByCategory.get(cat) ?? 0) + ceilMachines * m.power)
          burnersByCategory.set(cat, (burnersByCategory.get(cat) ?? 0) + ceilMachines)
        }
      }
    }

    // 3. For each fuel, divide the category's total watts by THIS fuel's
    //    energy value to get items/sec. Within a category multiple fuels
    //    are interchangeable — surfacing burn-rate against every fuel
    //    lets the player compare ("how much coal vs solid-fuel would I
    //    need?") without re-running the solver.
    const out: Row[] = []
    for (const it of fuels) {
      const watts = wattsByCategory.get(it.fuelCategory!) ?? 0
      const burners = burnersByCategory.get(it.fuelCategory!) ?? 0
      const burnRate = watts > 0 ? watts / it.fuelValue! : 0
      out.push({
        item: it.key,
        itemName: it.name,
        fuelValue: it.fuelValue!,
        fuelCategory: it.fuelCategory!,
        burnRate,
        burners,
        used: watts > 0,
      })
    }
    // Used fuels first (descending burn rate), then unused alphabetical.
    return out.sort((a, b) => {
      if (a.used !== b.used) return a.used ? -1 : 1
      if (a.used) return b.burnRate - a.burnRate
      return a.itemName.localeCompare(b.itemName)
    })
  }, [flow, catalog])

  // Mirror IntermediatesPanel: hide the panel entirely when there's
  // nothing relevant to show (e.g. a flow that contains zero burners AND
  // a catalog with no fuel items defined — e.g. mini test datasets).
  if (rows.length === 0) return null

  const usedCount = rows.reduce((n, r) => n + (r.used ? 1 : 0), 0)

  const badge = (
    <span
      className="font-mono"
      style={{
        background: "rgba(255,201,64,0.85)",
        color: "rgba(0,0,0,0.9)",
        padding: "1px 6px",
        fontSize: 9,
        letterSpacing: "0.06em",
      }}
      title={`${usedCount} in use · ${rows.length} known`}
    >
      {usedCount}/{rows.length}
    </span>
  )

  return (
    <CollapsiblePanel
      testId="fuels-panel"
      title="⚙ Fuels"
      badge={badge}
      defaultCollapsed={defaultCollapsed}
    >
      <div
        className="flex items-center gap-2 px-1 pb-1 mb-1 border-b border-border/60"
        style={{ fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase" }}
      >
        <span style={{ width: 18 }} />
        <span className="flex-1 opacity-60">Fuel</span>
        <span className="w-14 text-right opacity-60">Energy</span>
        <span className="w-16 text-right opacity-60">Burn rate</span>
        <span className="w-12 text-right opacity-60">Burners</span>
      </div>
      {rows.map((r) => (
        <FuelRow key={r.item} row={r} rateUnit={rateUnit} catalog={catalog} />
      ))}
    </CollapsiblePanel>
  )
}

function FuelRow({
  row,
  rateUnit,
  catalog,
}: {
  row: Row
  rateUnit: RateUnit
  catalog: Catalog
}) {
  return (
    <div
      data-testid={`fuel-${row.item}`}
      className="flex items-center gap-2 px-1 py-0.5 rounded"
      style={{ opacity: row.used ? 1 : 0.5 }}
      title={row.used ? `${row.fuelCategory} · in use` : `${row.fuelCategory} · not used in this flow`}
    >
      <ItemIcon catalog={catalog} itemKey={row.item} size={16} />
      <span className="flex-1 truncate" title={row.item}>
        {row.itemName}
      </span>
      <span className="w-14 text-right font-mono opacity-80" style={{ fontSize: 10 }}>
        {fmt(row.fuelValue / 1e6)} MJ
      </span>
      <span className="w-16 text-right font-mono opacity-80" style={{ fontSize: 10 }}>
        {row.used ? fmtRateUnit(row.burnRate, rateUnit) : "—"}
      </span>
      <span className="w-12 text-right font-mono opacity-80" style={{ fontSize: 10 }}>
        {row.used ? fmt(row.burners) : "—"}
      </span>
    </div>
  )
}
