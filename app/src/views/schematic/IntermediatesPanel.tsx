// "Intermediates" side-panel section. Lists every item that is both
// PRODUCED and CONSUMED inside the current factory, with per-second rates
// and the net leftover (produced - consumed). For a tight design the
// leftover is zero; non-zero indicates excess that must be sunk somewhere
// (chest, waste, or another consumer the user hasn't added).

import { useMemo, useState } from "react"
import type { Catalog } from "../../factorio"
import type { FlowGraph } from "../../solver/expand"
import { fmtRateUnit, type RateUnit } from "../../util/format"
import { ItemIcon } from "../../components/Icon"

interface Props {
  catalog: Catalog
  flow: FlowGraph | null
  rateUnit: RateUnit
  defaultCollapsed?: boolean
  /**
   * Item currently highlighted (lanes carrying it glow on canvas). Used
   * to mark the active row.
   */
  highlightedItem?: string | null
  /**
   * Called when the user clicks an intermediate row. Pass null to clear.
   * The caller is responsible for wiring this to whatever consumes
   * `highlightedItem` (typically the schematic canvas).
   */
  onItemClick?: (item: string | null) => void
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
  highlightedItem,
  onItemClick,
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  const rows: Row[] = useMemo(() => {
    if (!flow) return []
    const produced = new Map<string, number>()
    const consumed = new Map<string, number>()
    for (const n of flow.nodes) {
      if (!n.recipe) continue
      // The solver works in fractional crafts/sec so demand=supply
      // mathematically — but the schematic rounds machine counts UP to
      // whole integers, so REAL production from `ceil(count)` machines
      // outpaces solver demand. Use the rounded-up count to reveal the
      // real surplus a player would experience on a built factory.
      const ceilMachines = Math.max(1, Math.ceil(n.count))
      const speed = n.machine?.craftingSpeed ?? 1
      const time = n.recipe.time ?? 1
      // Crafts/sec at the integer machine count (vs n.rate which is the
      // fractional ideal demand).
      const actualCraftsPerSec = (ceilMachines * speed) / time
      for (const p of n.recipe.products) {
        produced.set(p.item, (produced.get(p.item) ?? 0) + p.amount * actualCraftsPerSec)
      }
      for (const ing of n.recipe.ingredients) {
        consumed.set(ing.item, (consumed.get(ing.item) ?? 0) + ing.amount * actualCraftsPerSec)
      }
    }
    const out: Row[] = []
    const items = new Set([...produced.keys(), ...consumed.keys()])
    for (const item of items) {
      const p = produced.get(item) ?? 0
      const internalCons = consumed.get(item) ?? 0
      // Items that ALSO leave the factory as a target product are
      // effectively consumed by the output sink — they aren't surplus
      // sitting on a belt. Without this, anything that's both a target
      // AND consumed internally (e.g. copper-plate target that also
      // feeds copper-cable) shows inflated surplus equal to the target
      // rate. After ceil-balance the real surplus should be ≤ 1
      // machine's output per producer (a few items/sec at most).
      const outputCons = flow.outputs.get(item) ?? 0
      const c = internalCons + outputCons
      // Intermediate = produced AND consumed within the factory
      // (internal consumption — outputs alone don't count, those are
      // pure outputs and belong on the Output rail, not here).
      if (p <= 0 || internalCons <= 0) continue
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
        <div className="px-3 py-2 border-t border-border">
          <div
            className="flex items-center gap-2 px-1 pb-1 mb-1 border-b border-border/60"
            style={{ fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase" }}
          >
            <span style={{ width: 18 }} />
            <span className="flex-1 opacity-60">Item</span>
            <span className="w-14 text-right opacity-60">Prod</span>
            <span className="w-14 text-right opacity-60">Cons</span>
            <span className="w-24 text-right opacity-60">Status</span>
          </div>
          {rows.map((r) => (
            <IntermediateRow
              key={r.item}
              row={r}
              rateUnit={rateUnit}
              catalog={catalog}
              active={highlightedItem === r.item}
              onClick={
                onItemClick
                  ? () => onItemClick(highlightedItem === r.item ? null : r.item)
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

function IntermediateRow({
  row,
  rateUnit,
  catalog,
  active,
  onClick,
}: {
  row: Row
  rateUnit: RateUnit
  catalog: Catalog
  active: boolean
  onClick?: () => void
}) {
  // Status classification — green ≈ balanced, amber = surplus, red = deficit.
  // Small tolerance for floating-point fuzz.
  const eps = 1e-6
  let state: "ok" | "surplus" | "deficit" = "ok"
  if (row.leftover > eps) state = "surplus"
  else if (row.leftover < -eps) state = "deficit"
  const stateColor =
    state === "ok"
      ? "rgba(16, 185, 129, 0.95)"
      : state === "surplus"
      ? "rgba(245, 158, 11, 0.95)"
      : "rgba(255, 46, 99, 0.95)"
  const isClickable = onClick != null
  return (
    <div
      data-testid={`intermediate-${row.item}`}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!onClick) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick()
        }
      }}
      className={
        "flex items-center gap-2 px-1 py-0.5 rounded " +
        (isClickable ? "cursor-pointer hover:bg-muted/40 " : "") +
        (active ? "bg-muted/60" : "")
      }
      style={{
        outline: active ? "1px solid rgba(255,201,64,0.7)" : undefined,
        outlineOffset: active ? "-1px" : undefined,
      }}
    >
      <ItemIcon catalog={catalog} itemKey={row.item} size={16} />
      <span className="flex-1 truncate" title={row.item}>
        {row.itemName}
      </span>
      <span className="w-14 text-right font-mono opacity-80" style={{ fontSize: 10 }}>
        {fmtRateUnit(row.produced, rateUnit)}
      </span>
      <span className="w-14 text-right font-mono opacity-80" style={{ fontSize: 10 }}>
        {fmtRateUnit(row.consumed, rateUnit)}
      </span>
      <span
        className="w-24 text-right font-mono inline-flex items-center justify-end gap-1"
        style={{ fontSize: 10, color: stateColor }}
        title={`${state}: ${row.leftover >= 0 ? "+" : ""}${fmtRateUnit(
          row.leftover,
          rateUnit,
        )}`}
      >
        <span style={{ opacity: 0.85 }}>
          {row.leftover >= 0 ? "+" : ""}
          {fmtRateUnit(row.leftover, rateUnit)}
        </span>
        <span
          style={{
            background: stateColor,
            color: "rgba(0,0,0,0.92)",
            padding: "0 4px",
            fontSize: 8,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          {state}
        </span>
      </span>
    </div>
  )
}
