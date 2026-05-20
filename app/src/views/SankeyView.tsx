import { useMemo, useRef, useEffect } from "react"
import * as d3 from "d3"
import { sankey as d3sankey, sankeyLinkHorizontal, type SankeyGraph } from "d3-sankey"
import type { FlowGraph } from "../solver/expand"
import type { Catalog } from "../factorio"
import { fmt, fmtRateUnit, type RateUnit } from "../util/format"

interface Props {
  flow: FlowGraph
  catalog: Catalog
  rateUnit?: RateUnit
}

interface IconCell {
  item: string
  col: number
  row: number
}

type SNode = {
  id: string
  label: string
  isRecipe: boolean
  count?: number
  powerMW?: number
  machineKey?: string
  machineIcon?: IconCell
  inputIcons?: IconCell[]
  /** for non-recipe (source/output) nodes — show the item icon */
  itemIcon?: IconCell
}
type SLink = { source: string; target: string; value: number; item: string; icon?: IconCell }

const WIDTH = 1200
const HEIGHT = 720
const NODE_WIDTH = 140

export function SankeyView({ flow, catalog, rateUnit = "sec" }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)

  const data = useMemo<SankeyGraph<SNode, SLink>>(() => {
    const labelFor = (id: string) => {
      if (id.startsWith("output:")) return catalog.items.get(id.slice(7))?.name ?? id.slice(7)
      if (id.startsWith("source:")) return catalog.items.get(id.slice(7))?.name ?? id.slice(7)
      return catalog.recipes.get(id)?.name ?? id
    }
    const iconFor = (key: string): IconCell | undefined => {
      const it = catalog.items.get(key)
      return it ? { item: key, col: it.iconCol, row: it.iconRow } : undefined
    }

    const nodes: SNode[] = flow.nodes.map((n) => {
      const machineIcon = n.machine ? iconFor(n.machine.key) : undefined
      const inputIcons = n.recipe
        ? n.recipe.ingredients
            .map((ing) => iconFor(ing.item))
            .filter((x): x is IconCell => x !== undefined)
        : undefined
      let itemIcon: IconCell | undefined
      if (n.id.startsWith("source:") || n.id.startsWith("output:")) {
        itemIcon = iconFor(n.id.slice(7))
      }
      return {
        id: n.id,
        label: labelFor(n.id),
        isRecipe: !!n.recipe,
        count: n.machine ? n.count : undefined,
        powerMW: n.powerW / 1_000_000,
        machineKey: n.machine?.key,
        machineIcon,
        inputIcons,
        itemIcon,
      }
    })
    const links: SLink[] = flow.edges
      .filter((e) => e.rate > 0)
      .map((e) => {
        const it = catalog.items.get(e.item)
        const icon: IconCell | undefined = it
          ? { item: e.item, col: it.iconCol, row: it.iconRow }
          : undefined
        return { source: e.source, target: e.target, value: e.rate, item: e.item, icon }
      })
    return { nodes, links } as unknown as SankeyGraph<SNode, SLink>
  }, [flow, catalog])

  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)
    svg.selectAll("*").remove()
    if (data.nodes.length === 0) return

    const layout = d3sankey<SNode, SLink>()
      .nodeId((d) => d.id)
      .nodeWidth(NODE_WIDTH)
      .nodePadding(18)
      .extent([
        [10, 30],
        [WIDTH - 10, HEIGHT - 10],
      ])

    let graph: SankeyGraph<SNode, SLink>
    try {
      graph = layout({
        nodes: data.nodes.map((d) => ({ ...d })),
        links: data.links.map((d) => ({ ...d })),
      })
    } catch {
      return
    }

    const color = d3.scaleOrdinal(d3.schemeTableau10)

    // Sprite-sheet URL — matches the Icon component's path scheme.
    const base = import.meta.env.DEV ? import.meta.env.BASE_URL : "/"
    const sheetUrl = `${base}images/sprite-sheet-${catalog.sprites.hash}.png`
    const SHEET_W = catalog.sprites.width
    const SHEET_H = catalog.sprites.height
    const SHEET_CELL = catalog.sprites.cell

    // Per-(col,row,size) <pattern> registry. Once created, any rect can
    // fill via url(#id). Keeps icon rendering DRY across nodes + lanes.
    const defs = svg.append("defs")
    const patternIds = new Map<string, string>()
    const iconPatternId = (col: number, row: number, size: number): string => {
      const key = `${col}-${row}-${size}`
      let id = patternIds.get(key)
      if (id) return id
      id = `sk-icon-${key}`
      patternIds.set(key, id)
      const scale = size / SHEET_CELL
      const pat = defs
        .append("pattern")
        .attr("id", id)
        .attr("patternUnits", "userSpaceOnUse")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", size)
        .attr("height", size)
      pat
        .append("image")
        .attr("href", sheetUrl)
        .attr("x", -col * size)
        .attr("y", -row * size)
        .attr("width", SHEET_W * scale)
        .attr("height", SHEET_H * scale)
        .attr("preserveAspectRatio", "none")
        .attr("image-rendering", "pixelated")
      return id
    }

    // -----------------------------------------------------------------
    // LINKS (curved sankey lanes)
    // -----------------------------------------------------------------
    const linkG = svg
      .append("g")
      .attr("fill", "none")
      .attr("stroke-opacity", 0.55)
      .selectAll("g")
      .data(graph.links)
      .join("g")
      .attr("data-link", "")

    linkG
      .append("path")
      .attr("class", "link-path")
      .attr("d", sankeyLinkHorizontal())
      .attr("stroke", (d) => color((d as unknown as SLink).item))
      .attr("stroke-width", (d) => Math.max(1.5, (d as { width?: number }).width ?? 1))
      .append("title")
      .text(
        (d) =>
          `${(d as unknown as SLink).item}: ${fmtRateUnit((d as unknown as SLink).value, rateUnit)}`,
      )

    // Lane label: <icon> <item name>  <rate>. Placed at the source side
    // so it doesn't crowd the target rect. Only on thick lanes (≥ 18 px).
    const LANE_ICON = 16
    linkG
      .filter((d) => ((d as { width?: number }).width ?? 0) >= 14)
      .each(function (d) {
        const link = d as unknown as SLink & {
          source: { x1: number }
          y0?: number
          y1?: number
        }
        const g = d3.select(this as SVGGElement)
        const x = (link.source.x1 ?? 0) + 6
        const y = ((link.y0 ?? 0) + (link.y1 ?? 0)) / 2
        const text = `${catalog.items.get(link.item)?.name ?? link.item}  ${fmtRateUnit(link.value, rateUnit)}`
        // Item icon (only if we have a sprite cell for it)
        if (link.icon) {
          g.append("rect")
            .attr("class", "lane-label-icon")
            .attr("x", x)
            .attr("y", y - LANE_ICON / 2)
            .attr("width", LANE_ICON)
            .attr("height", LANE_ICON)
            .attr("fill", `url(#${iconPatternId(link.icon.col, link.icon.row, LANE_ICON)})`)
            .style("pointer-events", "none")
        }
        g.append("text")
          .attr("class", "lane-label-text")
          .attr("x", link.icon ? x + LANE_ICON + 4 : x)
          .attr("y", y)
          .attr("dy", "0.35em")
          .attr("text-anchor", "start")
          .attr("fill", "var(--foreground)")
          .attr("paint-order", "stroke")
          .attr("stroke", "var(--background)")
          .attr("stroke-width", 4)
          .style("font-size", "10px")
          .style("font-weight", "500")
          .style("pointer-events", "none")
          .text(text)
      })

    // -----------------------------------------------------------------
    // NODES (recipe pills)
    // -----------------------------------------------------------------
    // Each node is rendered into a <g transform="translate(x0, y0)"> so
    // that on drag we can just update the transform — all child elements
    // (rect, icons, label) move together without per-element updates.
    type LaidOutNode = SNode & { x0: number; x1: number; y0: number; y1: number }
    const nodeG = svg
      .append("g")
      .selectAll<SVGGElement, LaidOutNode>("g")
      .data(graph.nodes as unknown as LaidOutNode[])
      .join("g")
      .attr("transform", (d) => `translate(${d.x0}, ${d.y0})`)
      .attr("cursor", "ns-resize")

    // Background pill
    nodeG
      .append("rect")
      .attr("class", "node-bg")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", (d) => d.x1 - d.x0)
      .attr("height", (d) => Math.max(1, d.y1 - d.y0))
      .attr("fill", (d) =>
        d.isRecipe ? "rgba(56, 102, 165, 0.85)" : "rgba(68, 68, 76, 0.85)",
      )
      .attr("stroke", "rgba(255,255,255,0.18)")
      .append("title")
      .text((d) => {
        const parts = [d.label]
        if (d.machineKey) parts.push(`${fmt(d.count ?? 0)} × ${d.machineKey}`)
        if (d.powerMW) parts.push(`${fmt(d.powerMW)} MW`)
        return parts.join("\n")
      })

    // Contents row inside the rect — INPUT icons : MACHINE icon × COUNT
    nodeG.each(function (d) {
      const g = d3.select(this as SVGGElement)
      const ICON = 22
      const GAP = 3
      const ROW_Y = 6
      let cur = 8

      const drawIcon = (col: number, row: number, size: number = ICON) => {
        g.append("rect")
          .attr("class", "node-icon")
          .attr("x", cur)
          .attr("y", ROW_Y)
          .attr("width", size)
          .attr("height", size)
          .attr("fill", `url(#${iconPatternId(col, row, size)})`)
        cur += size + GAP
      }

      const drawText = (text: string, fill = "#fff", bold = true) => {
        g.append("text")
          .attr("class", "node-row-text")
          .attr("x", cur)
          .attr("y", ROW_Y + ICON / 2)
          .attr("dominant-baseline", "central")
          .attr("fill", fill)
          .attr("paint-order", "stroke")
          .attr("stroke", "rgba(0,0,0,0.65)")
          .attr("stroke-width", 2.5)
          .style("font-size", "12px")
          .style("font-weight", bold ? "700" : "500")
          .style("font-family", '"JetBrains Mono", ui-monospace, monospace')
          .text(text)
        cur += text.length * 7 + GAP
      }

      if (d.isRecipe && d.inputIcons && d.machineIcon) {
        for (const ic of d.inputIcons) drawIcon(ic.col, ic.row, ICON)
        drawText(":", "rgba(255,255,255,0.7)", false)
        drawIcon(d.machineIcon.col, d.machineIcon.row, ICON)
        if (d.count != null) drawText(`× ${fmt(d.count)}`)
      } else if (d.itemIcon) {
        drawIcon(d.itemIcon.col, d.itemIcon.row, ICON)
      }
    })

    // Side label — recipe / source / output name, just right of the pill.
    nodeG
      .append("text")
      .attr("class", "node-label")
      .attr("x", (d) => d.x1 - d.x0 + 6)
      .attr("y", 16)
      .attr("text-anchor", "start")
      .attr("fill", "var(--foreground)")
      .attr("paint-order", "stroke")
      .attr("stroke", "var(--background)")
      .attr("stroke-width", 3)
      .style("font-size", "11px")
      .style("font-weight", "600")
      .style("pointer-events", "none")
      .text((d) => d.label)

    // -----------------------------------------------------------------
    // DRAG — vertical along column. Updates the node's transform AND
    // the path d (since the layout recomputes link routing).
    // -----------------------------------------------------------------
    const drag = d3
      .drag<SVGGElement, LaidOutNode>()
      .subject((_, d) => ({ x: d.x0, y: d.y0 }))
      .on("drag", function (event, d) {
        const height = d.y1 - d.y0
        d.y0 = Math.max(30, Math.min(HEIGHT - 10 - height, event.y))
        d.y1 = d.y0 + height
        d3.select(this).attr("transform", `translate(${d.x0}, ${d.y0})`)
        ;(layout as unknown as { update: (g: SankeyGraph<SNode, SLink>) => void }).update(graph)
        svg.selectAll<SVGPathElement, SLink>("path.link-path").attr("d", sankeyLinkHorizontal())
        // Re-position lane labels (their y depends on link source/target y).
        svg.selectAll<SVGGElement, SLink>("[data-link]").each(function (ld) {
          const link = ld as unknown as SLink & {
            source: { x1: number }
            y0?: number
            y1?: number
          }
          const x = (link.source.x1 ?? 0) + 6
          const y = ((link.y0 ?? 0) + (link.y1 ?? 0)) / 2
          const sel = d3.select(this)
          sel
            .select<SVGRectElement>(".lane-label-icon")
            .attr("x", x)
            .attr("y", y - LANE_ICON / 2)
          sel
            .select<SVGTextElement>(".lane-label-text")
            .attr("x", link.icon ? x + LANE_ICON + 4 : x)
            .attr("y", y)
        })
      })
    nodeG.call(drag as unknown as (sel: typeof nodeG) => void)
  }, [data, rateUnit])

  return (
    <svg
      ref={svgRef}
      role="img"
      aria-label="Recipe sankey diagram"
      data-testid="sankey-svg"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-full flex-1 min-h-0 bg-card rounded"
    />
  )
}
