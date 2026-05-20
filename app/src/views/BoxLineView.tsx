import { useMemo, useRef, useEffect, useState } from "react"
import * as d3 from "d3"
import { Button } from "@thebranchdriftcatalyst/catalyst-ui/ui/button"
import type { FlowGraph, FlowNode } from "../solver/expand"
import type { Catalog } from "../factorio"
import { fmt, fmtRateUnit, type RateUnit } from "../util/format"

interface Props {
  flow: FlowGraph
  catalog: Catalog
  rateUnit?: RateUnit
}

type Orientation = "LR" | "TB"

const WIDTH = 1200
const HEIGHT = 720
const NODE_W = 200
const NODE_H = 64
const COL_GAP = 90
const ROW_GAP = 18

function layerize(flow: FlowGraph): Map<string, number> {
  const incoming = new Map<string, string[]>()
  for (const n of flow.nodes) incoming.set(n.id, [])
  for (const e of flow.edges) incoming.get(e.target)?.push(e.source)
  const depth = new Map<string, number>()
  const visit = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const ins = incoming.get(id) ?? []
    const d = ins.length === 0 ? 0 : 1 + Math.max(...ins.map((p) => visit(p, seen)))
    depth.set(id, d)
    return d
  }
  for (const n of flow.nodes) visit(n.id)
  return depth
}

export function BoxLineView({ flow, catalog, rateUnit = "sec" }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [orientation, setOrientation] = useState<Orientation>("LR")

  // Layout positions, computed once per flow + orientation. Drag mutates this
  // ref so subsequent renders see the new positions.
  const layout = useMemo(() => {
    const depth = layerize(flow)
    const byDepth = new Map<number, FlowNode[]>()
    for (const n of flow.nodes) {
      const d = depth.get(n.id) ?? 0
      const list = byDepth.get(d) ?? []
      list.push(n)
      byDepth.set(d, list)
    }
    const pos = new Map<string, { x: number; y: number }>()
    const sortedDepths = [...byDepth.keys()].sort((a, b) => a - b)
    sortedDepths.forEach((d, colIdx) => {
      const col = byDepth.get(d)!
      if (orientation === "LR") {
        const totalH = col.length * NODE_H + (col.length - 1) * ROW_GAP
        const startY = (HEIGHT - totalH) / 2
        col.forEach((n, i) => {
          pos.set(n.id, {
            x: 20 + colIdx * (NODE_W + COL_GAP),
            y: startY + i * (NODE_H + ROW_GAP),
          })
        })
      } else {
        const totalW = col.length * NODE_W + (col.length - 1) * COL_GAP
        const startX = (WIDTH - totalW) / 2
        col.forEach((n, i) => {
          pos.set(n.id, {
            x: startX + i * (NODE_W + COL_GAP),
            y: 30 + colIdx * (NODE_H + ROW_GAP * 4),
          })
        })
      }
    })
    return { pos, edges: flow.edges, nodes: flow.nodes }
  }, [flow, orientation])

  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)
    svg.selectAll("*").remove()
    if (layout.nodes.length === 0) return

    const linkGen = d3
      .line<{ x: number; y: number }>()
      .x((d) => d.x)
      .y((d) => d.y)
      .curve(d3.curveBasis)

    const linkPath = (sourceId: string, targetId: string): string | null => {
      const s = layout.pos.get(sourceId)
      const t = layout.pos.get(targetId)
      if (!s || !t) return null
      if (orientation === "LR") {
        const sx = s.x + NODE_W
        const sy = s.y + NODE_H / 2
        const tx = t.x
        const ty = t.y + NODE_H / 2
        const mx = (sx + tx) / 2
        return (
          linkGen([
            { x: sx, y: sy },
            { x: mx, y: sy },
            { x: mx, y: ty },
            { x: tx, y: ty },
          ]) ?? ""
        )
      } else {
        const sx = s.x + NODE_W / 2
        const sy = s.y + NODE_H
        const tx = t.x + NODE_W / 2
        const ty = t.y
        const my = (sy + ty) / 2
        return (
          linkGen([
            { x: sx, y: sy },
            { x: sx, y: my },
            { x: tx, y: my },
            { x: tx, y: ty },
          ]) ?? ""
        )
      }
    }

    const edgesData = layout.edges.filter(
      (e) => layout.pos.has(e.source) && layout.pos.has(e.target),
    )
    const edgeRoot = svg.append("g").attr("fill", "none").attr("stroke-opacity", 0.6)
    // Two parallel selections keyed to the same data — simpler than nested
    // <g> + select("text"), and avoids brittle nested selectors.
    const edgePath = edgeRoot
      .append("g")
      .selectAll<SVGPathElement, (typeof edgesData)[number]>("path")
      .data(edgesData)
      .join("path")
      .attr("stroke", "var(--muted-foreground)")
      .attr("stroke-width", 1.5)
      .attr("d", (e) => linkPath(e.source, e.target))
    edgePath.append("title").text((e) => `${e.item}: ${fmtRateUnit(e.rate, rateUnit)}`)

    const labelX = (e: (typeof edgesData)[number]) => {
      const s = layout.pos.get(e.source)!
      const t = layout.pos.get(e.target)!
      return orientation === "LR" ? (s.x + NODE_W + t.x) / 2 : (s.x + t.x) / 2 + NODE_W / 2
    }
    const labelY = (e: (typeof edgesData)[number]) => {
      const s = layout.pos.get(e.source)!
      const t = layout.pos.get(e.target)!
      return orientation === "LR" ? (s.y + t.y) / 2 + NODE_H / 2 : (s.y + NODE_H + t.y) / 2
    }
    const edgeLabel = svg
      .append("g")
      .selectAll<SVGTextElement, (typeof edgesData)[number]>("text")
      .data(edgesData)
      .join("text")
      .attr("x", labelX)
      .attr("y", labelY)
      .attr("text-anchor", "middle")
      .attr("dy", "-4")
      .attr("fill", "var(--foreground)")
      .attr("paint-order", "stroke")
      .attr("stroke", "var(--background)")
      .attr("stroke-width", 3)
      .style("font-size", "10px")
      .text((e) => `${fmtRateUnit(e.rate, rateUnit)} ${e.item}`)

    const g = svg
      .append("g")
      .selectAll<SVGGElement, FlowNode>("g")
      .data(layout.nodes)
      .join("g")
      .attr("transform", (n) => {
        const p = layout.pos.get(n.id)!
        return `translate(${p.x},${p.y})`
      })
      .attr("cursor", "move")

    g.append("rect")
      .attr("width", NODE_W)
      .attr("height", NODE_H)
      .attr("rx", 8)
      .attr("fill", (n) => (n.recipe ? "var(--card)" : "var(--muted)"))
      .attr("stroke", (n) => (n.recipe ? "var(--primary)" : "var(--border)"))
      .attr("stroke-width", 1.5)

    g.append("text")
      .attr("x", 10)
      .attr("y", 22)
      .attr("fill", "var(--foreground)")
      .style("font-size", "12px")
      .style("font-weight", 600)
      .text((n) => (n.recipe ? n.recipe.name : catalog.items.get(n.id.replace("source:", ""))?.name ?? n.id.replace("source:", "")))

    g.append("text")
      .attr("x", 10)
      .attr("y", 40)
      .attr("fill", "var(--muted-foreground)")
      .style("font-size", "10px")
      .text((n) =>
        n.machine ? `${fmt(n.count)} × ${n.machine.name}` : fmtRateUnit(n.rate, rateUnit),
      )

    g.append("text")
      .attr("x", 10)
      .attr("y", 56)
      .attr("fill", "var(--muted-foreground)")
      .style("font-size", "10px")
      .text((n) => (n.powerW > 0 ? `${fmt(n.powerW / 1_000_000)} MW` : ""))

    // Free drag — updates the layout map and re-routes incident edges using
    // the cached path + label selections.
    const drag = d3
      .drag<SVGGElement, FlowNode>()
      .on("drag", (event, n) => {
        const p = layout.pos.get(n.id)
        if (!p) return
        p.x = event.x - NODE_W / 2
        p.y = event.y - NODE_H / 2
        d3.select<SVGGElement, FlowNode>(event.sourceEvent.currentTarget as SVGGElement).attr(
          "transform",
          `translate(${p.x},${p.y})`,
        )
        const incident = (e: (typeof edgesData)[number]) => e.source === n.id || e.target === n.id
        edgePath.filter(incident).attr("d", (e) => linkPath(e.source, e.target))
        edgeLabel.filter(incident).attr("x", labelX).attr("y", labelY)
      })
    g.call(drag)
  }, [layout, orientation, catalog, rateUnit])

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-xs opacity-60">Orientation:</span>
        <Button
          variant={orientation === "LR" ? "default" : "outline"}
          size="sm"
          data-testid="boxline-orient-lr"
          onClick={() => setOrientation("LR")}
        >
          Left → Right
        </Button>
        <Button
          variant={orientation === "TB" ? "default" : "outline"}
          size="sm"
          data-testid="boxline-orient-tb"
          onClick={() => setOrientation("TB")}
        >
          Top → Bottom
        </Button>
        <span className="ml-auto text-xs opacity-60">drag nodes to rearrange</span>
      </div>
      <svg
        ref={svgRef}
        role="img"
        aria-label="Recipe box-line diagram"
        data-testid="boxline-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full flex-1 min-h-0 bg-card rounded"
      />
    </div>
  )
}
