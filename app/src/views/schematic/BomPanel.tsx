// "Bill of materials" panel. Tells the user EXACTLY what to take into
// Factorio to build this schematic: how many of each machine, how many
// belt tiles, how many inserters. Sums ceil-rounded machine counts from
// the flow + walks the blueprint's bus tree for belt tile totals.

import { useMemo, useState } from "react"
import type { Catalog } from "../../factorio"
import type { Blueprint, BusBelt, BusNode } from "../../blueprint/types"
import type { FlowGraph } from "../../solver/expand"
import { fmt } from "../../util/format"
import { ItemIcon } from "../../components/Icon"

interface Props {
  catalog: Catalog
  flow: FlowGraph | null
  blueprint: Blueprint | null
  defaultCollapsed?: boolean
}

interface MachineRow {
  key: string
  name: string
  count: number
  powerKW: number
}

export function BomPanel({ catalog, flow, blueprint, defaultCollapsed = true }: Props) {
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
    if (!blueprint) return { beltTiles: 0, inserters: 0, directTiles: 0 }
    // Walk the bus tree to sum belt tile counts. Each BusBelt covers
    // (y1 - y0) tiles when truncated, or the scope height otherwise.
    let beltTiles = 0
    const visit = (node: BusNode) => {
      const fallbackHi = node.y + node.h
      for (const b of node.belts) beltTiles += beltExtent(b, node.y, fallbackHi)
      for (const child of node.children) visit(child)
    }
    if (blueprint.root) visit(blueprint.root)
    // Direct-connection segments. Each is a short vertical run between
    // two cells — count as belt tiles too (they're built from belt items
    // in real Factorio).
    let directTiles = 0
    for (const d of blueprint.directConnections) {
      directTiles += Math.max(1, Math.abs(d.y1 - d.y0) + 1)
    }
    return {
      beltTiles,
      inserters: blueprint.inserters.length,
      directTiles,
    }
  }, [blueprint])

  if (!flow || (machines.length === 0 && transport.beltTiles === 0)) return null

  const totalMachines = machines.reduce((s, r) => s + r.count, 0)
  const totalPowerKW = machines.reduce((s, r) => s + r.powerKW, 0)
  const totalBelts = transport.beltTiles + transport.directTiles

  return (
    <div data-testid="bom-panel" className="text-xs bg-card border border-border rounded">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30"
        aria-expanded={!collapsed}
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
          <span className="opacity-60">{collapsed ? "▸" : "▾"}</span>
        </span>
      </button>
      {!collapsed && (
        <div className="px-3 py-2 border-t border-border space-y-3">
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
                Transport
              </div>
              {totalBelts > 0 && (
                <div
                  data-testid="bom-belts"
                  className="flex items-center gap-2 px-1 py-0.5"
                  title={
                    transport.directTiles > 0
                      ? `${transport.beltTiles} bus + ${transport.directTiles} direct-link tiles`
                      : `${transport.beltTiles} tiles`
                  }
                >
                  <ItemIcon catalog={catalog} itemKey="transport-belt" size={16} />
                  <span className="flex-1">Transport belt (tiles)</span>
                  <span
                    className="w-12 text-right font-mono font-medium"
                    style={{ fontSize: 11 }}
                  >
                    ×{fmt(totalBelts)}
                  </span>
                </div>
              )}
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
