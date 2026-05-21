// "Intermediates" side-panel section. Lists every item that is both
// PRODUCED and CONSUMED inside the current factory, with per-second rates
// and the net leftover (produced - consumed). For a tight design the
// leftover is zero; non-zero indicates excess that must be sunk somewhere
// (chest, waste, or another consumer the user hasn't added).

import { useMemo, useState } from "react"
import type { Catalog } from "../../factorio"
import type { FlowGraph } from "../../solver/expand"
import { fmtRateUnit, type RateUnit } from "../../util/format"

interface Props {
  catalog: Catalog
  flow: FlowGraph | null
  rateUnit: RateUnit
  defaultCollapsed?: boolean
}

interface Row {
  item: string
  itemName: string
  produced: number
  consumed: number
  leftover: number
}

export function IntermediatesPanel({
  catalog,
  flow,
  rateUnit,
  defaultCollapsed = true,
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  const rows: Row[] = useMemo(() => {
    if (!flow) return []
    const produced = new Map<string, number>()
    const consumed = new Map<string, number>()
    for (const n of flow.nodes) {
      if (!n.recipe) continue
      for (const p of n.recipe.products) {
        produced.set(p.item, (produced.get(p.item) ?? 0) + p.amount * n.rate)
      }
      for (const ing of n.recipe.ingredients) {
        consumed.set(ing.item, (consumed.get(ing.item) ?? 0) + ing.amount * n.rate)
      }
    }
    const out: Row[] = []
    const items = new Set([...produced.keys(), ...consumed.keys()])
    for (const item of items) {
      const p = produced.get(item) ?? 0
      const c = consumed.get(item) ?? 0
      // Intermediate = produced AND consumed within the factory.
      if (p <= 0 || c <= 0) continue
      out.push({
        item,
        itemName: catalog.items.get(item)?.name ?? item,
        produced: p,
        consumed: c,
        leftover: p - c,
      })
    }
    return out.sort((a, b) => b.produced - a.produced)
  }, [flow, catalog])

  // Don't render when there's nothing to show — keeps the panel tight on
  // simple factories (e.g. just an iron-plate target with no intermediates).
  if (rows.length === 0) return null

  return (
    <div
      data-testid="intermediates-panel"
      className="text-xs bg-card border border-border rounded"
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30"
        aria-expanded={!collapsed}
      >
        <span className="font-medium uppercase tracking-wide text-[10px] opacity-80">
          ⚙ Intermediates
        </span>
        <span className="flex items-center gap-2">
          <span
            className="font-mono"
            style={{
              background: "rgba(255,201,64,0.85)",
              color: "rgba(0,0,0,0.9)",
              padding: "1px 6px",
              fontSize: 9,
              letterSpacing: "0.06em",
            }}
          >
            {rows.length}
          </span>
          <span className="opacity-60">{collapsed ? "▸" : "▾"}</span>
        </span>
      </button>
      {!collapsed && (
        <div className="px-3 py-2 border-t border-border max-h-80 overflow-auto">
          <div
            className="flex items-center gap-2 px-1 pb-1 mb-1 border-b border-border/60"
            style={{ fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase" }}
          >
            <span className="flex-1 opacity-60">Item</span>
            <span className="w-16 text-right opacity-60">Prod</span>
            <span className="w-16 text-right opacity-60">Cons</span>
            <span className="w-16 text-right opacity-60">Net</span>
          </div>
          {rows.map((r) => (
            <IntermediateRow key={r.item} row={r} rateUnit={rateUnit} />
          ))}
        </div>
      )}
    </div>
  )
}

function IntermediateRow({ row, rateUnit }: { row: Row; rateUnit: RateUnit }) {
  // Leftover swatch: green ≈ 0, amber if surplus, red if deficit. Small
  // tolerance for floating-point fuzz.
  const eps = 1e-6
  let netColor = "rgba(16, 185, 129, 0.9)" // green = balanced
  if (row.leftover > eps) netColor = "rgba(245, 158, 11, 0.9)" // amber = surplus
  if (row.leftover < -eps) netColor = "rgba(255, 46, 99, 0.95)" // red = deficit
  return (
    <div
      data-testid={`intermediate-${row.item}`}
      className="flex items-center gap-2 px-1 py-0.5"
    >
      <span className="flex-1 truncate" title={row.item}>
        {row.itemName}
      </span>
      <span className="w-16 text-right font-mono opacity-80" style={{ fontSize: 10 }}>
        {fmtRateUnit(row.produced, rateUnit)}
      </span>
      <span className="w-16 text-right font-mono opacity-80" style={{ fontSize: 10 }}>
        {fmtRateUnit(row.consumed, rateUnit)}
      </span>
      <span
        className="w-16 text-right font-mono"
        style={{ fontSize: 10, color: netColor }}
      >
        {row.leftover >= 0 ? "+" : ""}
        {fmtRateUnit(row.leftover, rateUnit)}
      </span>
    </div>
  )
}
