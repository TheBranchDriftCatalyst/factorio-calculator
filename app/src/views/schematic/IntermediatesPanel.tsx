// "Intermediates" side-panel section. Lists every item that is both
// PRODUCED and CONSUMED inside the current factory, with per-second rates
// and the net leftover (produced - consumed). For a tight design the
// leftover is zero; non-zero indicates excess that must be sunk somewhere
// (chest, waste, or another consumer the user hasn't added).

import { useMemo } from "react"
import type { Catalog } from "../../factorio"
import { useCatalog } from "../../factorio/CatalogContext"
import type { FlowGraph } from "../../solver/expand"
import { fmtRateUnit, type RateUnit } from "../../util/format"
import { useRateUnit } from "../../util/RateUnitContext"
import { ItemIcon } from "../../components/Icon"
import { CollapsiblePanel } from "../../components/CollapsiblePanel"

interface Props {
  flow: FlowGraph | null
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
  /**
   * True when at least one producer is a multi-product recipe and this
   * item isn't the demand-driving one for that recipe. In that case the
   * surplus is structurally forced (you can't crack oil to petroleum
   * without also making heavy + light) and the player has to PLAN A SINK
   * for the byproduct, not just shave off a producer machine.
   */
  isByproduct: boolean
}

export function IntermediatesPanel({
  flow,
  defaultCollapsed = true,
  highlightedItem,
  onItemClick,
}: Props) {
  const catalog = useCatalog()
  const rateUnit = useRateUnit()
  const rows: Row[] = useMemo(() => {
    if (!flow) return []
    const produced = new Map<string, number>()
    const consumed = new Map<string, number>()
    // Items that come out of a multi-product recipe (oil refinery, etc.)
    // are flagged as candidate byproducts. The recipe was sized for
    // SOMEONE'S demand on it; any product whose demand is less than its
    // production rate is structurally a byproduct.
    const isMultiProductProducer = new Set<string>()
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
      // Output multiplier from machine productivity (EM-plant, foundry).
      // Productivity boosts PRODUCTS only — ingredients are still
      // consumed at the base per-craft rate.
      const prodMult = 1 + (n.machine?.prodBonus ?? 0)
      const multi = n.recipe.products.length > 1
      for (const p of n.recipe.products) {
        produced.set(p.item, (produced.get(p.item) ?? 0) + p.amount * prodMult * actualCraftsPerSec)
        if (multi) isMultiProductProducer.add(p.item)
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
      if (p <= 0) continue
      // A "byproduct" is one whose surplus is structurally forced by a
      // multi-product recipe — the player must SINK it (chest, flare,
      // void) rather than just removing a producer machine. Single-
      // product recipes' surpluses are pure ceil-overshoot.
      // Target outputs are excluded: the player asked for that product
      // explicitly, so calling petroleum-gas a byproduct of itself would
      // be misleading — that overflow is just ceil-overshoot on the
      // refinery's primary product.
      const isTargetOutput = outputCons > 0
      const isByproduct =
        isMultiProductProducer.has(item) && !isTargetOutput && p - c > 1e-6
      // Show items that are either internally consumed (real
      // intermediates) OR forced byproducts of a multi-product recipe
      // (need a sink — actionable for the player even with 0 consumers).
      if (internalCons <= 0 && !isByproduct) continue
      out.push({
        item,
        itemName: catalog.items.get(item)?.name ?? item,
        produced: p,
        consumed: c,
        leftover: p - c,
        isByproduct,
      })
    }
    // Byproducts surface first — they're actionable (need a sink) vs
    // pure overshoot which is just bookkeeping noise.
    return out.sort((a, b) => {
      if (a.isByproduct !== b.isByproduct) return a.isByproduct ? -1 : 1
      return b.produced - a.produced
    })
  }, [flow, catalog])

  // Don't render when there's nothing to show — keeps the panel tight on
  // simple factories (e.g. just an iron-plate target with no intermediates).
  if (rows.length === 0) return null

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
    >
      {rows.length}
    </span>
  )

  return (
    <CollapsiblePanel
      testId="intermediates-panel"
      title="⚙ Intermediates"
      badge={badge}
      defaultCollapsed={defaultCollapsed}
    >
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
    </CollapsiblePanel>
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
  // Status classification:
  //   ok        — produced ≈ consumed (green)
  //   surplus   — produced > consumed, single-product recipe → just ceil
  //               overshoot, shave a machine if it bothers you (amber)
  //   byproduct — produced > consumed, multi-product recipe → forced by
  //               recipe shape, needs a SINK (cyan; actionable!)
  //   deficit   — produced < consumed, never happens after balanceCeil
  //               but the renderer is defensive (red)
  const eps = 1e-6
  let state: "ok" | "surplus" | "byproduct" | "deficit" = "ok"
  if (row.leftover > eps) state = row.isByproduct ? "byproduct" : "surplus"
  else if (row.leftover < -eps) state = "deficit"
  const stateColor =
    state === "ok"
      ? "rgba(16, 185, 129, 0.95)"
      : state === "byproduct"
      ? "rgba(34, 211, 238, 0.95)" // cyan — distinct from amber surplus
      : state === "surplus"
      ? "rgba(245, 158, 11, 0.95)"
      : "rgba(255, 46, 99, 0.95)"
  const stateTitle =
    state === "byproduct"
      ? "Byproduct (multi-product recipe forces this overflow — needs a sink)"
      : state === "surplus"
      ? "Surplus (ceil-overshoot from rounding producer up to whole machines)"
      : state === "deficit"
      ? "Deficit (real demand exceeds production — bug if you see this)"
      : "Balanced"
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
        data-testid={`intermediate-${row.item}-status`}
        data-state={state}
        className="w-24 text-right font-mono inline-flex items-center justify-end gap-1"
        style={{ fontSize: 10, color: stateColor }}
        title={`${stateTitle}: ${row.leftover >= 0 ? "+" : ""}${fmtRateUnit(
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
