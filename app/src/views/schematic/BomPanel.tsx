// "Bill of materials" panel. Tells the user EXACTLY what to take into
// Factorio to build this schematic: how many of each machine, how many
// belt tiles, how many inserters. Sums ceil-rounded machine counts from
// the flow + walks the blueprint's bus tree for belt tile totals.

import { useId, useMemo, useState } from "react"
import type { Catalog } from "../../factorio"
import type { Blueprint, BusBelt, BusNode } from "../../blueprint/types"
import type { FlowGraph } from "../../solver/expand"
import { fmt } from "../../util/format"
import { ItemIcon } from "../../components/Icon"
import type { BeltTier } from "../../blueprint/util/utilization"

interface Props {
  catalog: Catalog
  flow: FlowGraph | null
  blueprint: Blueprint | null
  /** Global belt tier (yellow/red/blue/turbo). */
  beltTier?: BeltTier
  /** Per-item belt overrides (item key → tier). */
  beltOverrides?: Record<string, BeltTier>
  defaultCollapsed?: boolean
}

// Factorio item keys for each belt tier — used to render the right
// sprite in the BOM. Order = highest tier wins when comparing two lanes
// on the same belt.
const BELT_TIER_ITEM_KEY: Record<BeltTier, string> = {
  yellow: "transport-belt",
  red: "fast-transport-belt",
  blue: "express-transport-belt",
  turbo: "turbo-transport-belt",
}
const BELT_TIER_LABEL: Record<BeltTier, string> = {
  yellow: "Transport belt",
  red: "Fast transport belt",
  blue: "Express transport belt",
  turbo: "Turbo transport belt",
}
// Rank for "higher tier" comparison.
const BELT_TIER_RANK: Record<BeltTier, number> = {
  yellow: 0,
  red: 1,
  blue: 2,
  turbo: 3,
}

interface MachineRow {
  key: string
  name: string
  count: number
  powerKW: number
}

export function BomPanel({
  catalog,
  flow,
  blueprint,
  beltTier = "yellow",
  beltOverrides,
  defaultCollapsed = true,
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  const machines: MachineRow[] = useMemo(() => {
    if (!flow) return []
    const by = new Map<string, MachineRow>()
    for (const n of flow.nodes) {
      if (!n.machine || !n.recipe) continue
      const ceil = Math.max(1, Math.ceil(n.count - 1e-9))
      const power = ceil * n.machine.power
      const row = by.get(n.machine.key) ?? {
        key: n.machine.key,
        name: n.machine.name,
        count: 0,
        powerKW: 0,
      }
      row.count += ceil
      row.powerKW += power / 1000
      by.set(n.machine.key, row)
    }
    return [...by.values()].sort((a, b) => b.count - a.count)
  }, [flow])

  const transport = useMemo(() => {
    if (!blueprint) return { beltTilesByTier: new Map<BeltTier, number>(), inserters: 0 }
    // Resolve the effective tier for a belt: use the highest-tier override
    // among its lanes, else fall back to the global default. A single
    // belt tile maps to exactly one Factorio entity, so this is the tier
    // a player would actually place.
    const effectiveTierOf = (b: BusBelt): BeltTier => {
      const itemA = b.laneA?.item
      const itemB = b.laneB?.item
      const overrideA = itemA ? beltOverrides?.[itemA] : undefined
      const overrideB = itemB ? beltOverrides?.[itemB] : undefined
      const candidates = [overrideA, overrideB].filter(
        (t): t is BeltTier => t !== undefined,
      )
      if (candidates.length === 0) return beltTier
      // Highest-tier override wins so the belt isn't a bottleneck for
      // either lane.
      return candidates.reduce((best, t) => (BELT_TIER_RANK[t] > BELT_TIER_RANK[best] ? t : best))
    }
    const tilesByTier = new Map<BeltTier, number>()
    const add = (tier: BeltTier, n: number) =>
      tilesByTier.set(tier, (tilesByTier.get(tier) ?? 0) + n)
    const visit = (node: BusNode) => {
      const fallbackHi = node.y + node.h
      for (const b of node.belts) add(effectiveTierOf(b), beltExtent(b, node.y, fallbackHi))
      for (const child of node.children) visit(child)
    }
    if (blueprint.root) visit(blueprint.root)
    // Direct-link segments — short vertical runs between two cells.
    // No lane assignment, so they use the global tier.
    for (const d of blueprint.directConnections) {
      add(beltTier, Math.max(1, Math.abs(d.y1 - d.y0) + 1))
    }
    return {
      beltTilesByTier: tilesByTier,
      inserters: blueprint.inserters.length,
    }
  }, [blueprint, beltTier, beltOverrides])

  const totalBelts = [...transport.beltTilesByTier.values()].reduce((s, n) => s + n, 0)
  const panelId = useId()
  if (!flow || (machines.length === 0 && totalBelts === 0)) return null

  const totalMachines = machines.reduce((s, r) => s + r.count, 0)
  const totalPowerKW = machines.reduce((s, r) => s + r.powerKW, 0)
  // Sorted descending so the most-used tier comes first.
  const tierRows = (["turbo", "blue", "red", "yellow"] as BeltTier[])
    .map((t) => ({ tier: t, tiles: transport.beltTilesByTier.get(t) ?? 0 }))
    .filter((r) => r.tiles > 0)

  return (
    <div data-testid="bom-panel" className="text-xs bg-card border border-border rounded">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30"
        aria-expanded={!collapsed}
        aria-controls={panelId}
      >
        <span className="font-medium uppercase tracking-wide text-[10px] opacity-80">
          ⚒ Bill of materials
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
            title={`${totalMachines} machines · ${totalBelts} belt tiles · ${transport.inserters} inserters`}
          >
            {totalMachines}M · {totalBelts}B · {transport.inserters}I
          </span>
          <span className="opacity-60" aria-hidden="true">
            {collapsed ? "▸" : "▾"}
          </span>
        </span>
      </button>
      {!collapsed && (
        <div id={panelId} className="px-3 py-2 border-t border-border space-y-3">
          {/* Machines */}
          <div>
            <div
              className="px-1 pb-1 mb-1 opacity-60 uppercase tracking-wide"
              style={{ fontSize: 9 }}
            >
              Machines · {totalMachines} units · {fmt(totalPowerKW / 1000)} MW
            </div>
            {machines.map((m) => (
              <div
                key={m.key}
                data-testid={`bom-machine-${m.key}`}
                className="flex items-center gap-2 px-1 py-0.5"
              >
                <ItemIcon catalog={catalog} itemKey={m.key} size={16} />
                <span className="flex-1 truncate" title={m.key}>
                  {m.name}
                </span>
                <span
                  className="w-12 text-right font-mono opacity-75"
                  style={{ fontSize: 10 }}
                  title={`${fmt(m.powerKW)} kW total`}
                >
                  {fmt(m.powerKW)} kW
                </span>
                <span
                  className="w-12 text-right font-mono font-medium"
                  style={{ fontSize: 11 }}
                >
                  ×{fmt(m.count)}
                </span>
              </div>
            ))}
          </div>
          {/* Transport (belts + inserters) */}
          {(totalBelts > 0 || transport.inserters > 0) && (
            <div>
              <div
                className="px-1 pb-1 mb-1 opacity-60 uppercase tracking-wide"
                style={{ fontSize: 9 }}
              >
                Transport · {totalBelts} belts · {transport.inserters} inserters
              </div>
              {tierRows.map((r) => (
                <div
                  key={r.tier}
                  data-testid={`bom-belts-${r.tier}`}
                  className="flex items-center gap-2 px-1 py-0.5"
                  title={`${BELT_TIER_LABEL[r.tier]} — ${r.tiles} tiles`}
                >
                  <ItemIcon catalog={catalog} itemKey={BELT_TIER_ITEM_KEY[r.tier]} size={16} />
                  <span className="flex-1">{BELT_TIER_LABEL[r.tier]}</span>
                  <span
                    className="w-12 text-right font-mono font-medium"
                    style={{ fontSize: 11 }}
                  >
                    ×{fmt(r.tiles)}
                  </span>
                </div>
              ))}
              {transport.inserters > 0 && (
                <div
                  data-testid="bom-inserters"
                  className="flex items-center gap-2 px-1 py-0.5"
                >
                  <ItemIcon catalog={catalog} itemKey="inserter" size={16} />
                  <span className="flex-1">Inserters</span>
                  <span
                    className="w-12 text-right font-mono font-medium"
                    style={{ fontSize: 11 }}
                  >
                    ×{fmt(transport.inserters)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function beltExtent(b: BusBelt, scopeY0: number, scopeY1: number): number {
  const y0 = b.y0 ?? scopeY0
  const y1 = b.y1 ?? scopeY1
  return Math.max(1, y1 - y0)
}
