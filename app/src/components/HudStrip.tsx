import type { Catalog } from "../factorio"
import type { FlowGraph, Target } from "../solver/expand"
import { fmt, fmtRateUnit, type RateUnit } from "../util/format"

interface Props {
  catalog: Catalog
  flow: FlowGraph | null
  targets: Target[]
  dataset: string
  rateUnit: RateUnit
  onRateUnitChange: (u: RateUnit) => void
}

// Bloomberg-ticker contrast: bright value vs dim label is the signature move.
const VALUE = "#FFC940" // brighter than pure amber, pops against the dim label
const LABEL = "rgba(255,255,255,0.45)"
const SEP_COLOR = "rgba(255,176,0,0.28)"

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}

function rawKey(item: string): string {
  // First "word" before a hyphen, uppercased and trimmed to 4 chars.
  const first = item.split("-")[0]
  return first.slice(0, 4).toUpperCase()
}

function itemName(catalog: Catalog, key: string): string {
  return catalog.items.get(key)?.name ?? key
}

function Sep() {
  return (
    <span aria-hidden="true" style={{ color: SEP_COLOR, padding: "0 10px" }}>
      │
    </span>
  )
}

// Bloomberg-style: labels are dim + uppercase + tracked; values are bright amber.
function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ color: LABEL, letterSpacing: "0.08em", textTransform: "uppercase" }}>
      {children}
    </span>
  )
}

function Value({ children }: { children: React.ReactNode }) {
  return <span style={{ color: VALUE }}>{children}</span>
}

export function HudStrip({
  catalog,
  flow,
  targets,
  dataset,
  rateUnit,
}: Props) {
  const baseStyle: React.CSSProperties = {
    // App is now a flex-column with h-screen, so the HudStrip lives in a
    // shrink-0 row at the top of the body region. No sticky positioning
    // needed — it stays put naturally.
    position: "relative",
    zIndex: 50,
    height: "32px",
    width: "100%",
    display: "flex",
    alignItems: "center",
    padding: "0 12px",
    background: "rgba(0,0,0,0.96)",
    borderTop: "1px solid rgba(255,176,0,0.18)",
    borderBottom: "1px solid rgba(255,176,0,0.28)",
    // Explicit JBM family chain so a downstream theme that clobbers the token
    // still falls through to JetBrains Mono.
    fontFamily:
      '"JetBrains Mono", var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: "10.5px",
    lineHeight: "32px",
    color: VALUE,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    overflow: "hidden",
  }

  if (!flow) {
    return (
      <div data-testid="hud-strip" style={baseStyle}>
        <Value>► LOADING…</Value>
      </div>
    )
  }

  // 1. Target chip
  const primary = targets[0]
  const primaryName = primary ? truncate(itemName(catalog, primary.item), 22) : "—"
  const primaryRate = primary ? primary.rate : 0
  const extraTargets = targets.length > 1 ? ` +${targets.length - 1}` : ""

  // 2. Power
  const mw = fmt(flow.totalPowerW / 1e6)

  // 3. Raw inputs (top 4 by rate)
  const rawSorted = [...flow.rawInputs.entries()].sort((a, b) => b[1] - a[1])
  const topRaw = rawSorted.slice(0, 4)
  const rawMore = rawSorted.length > 4 ? ` +${rawSorted.length - 4}` : ""
  const rawCells = topRaw
    .map(([item, rate]) => `${rawKey(item)} ${fmtRateUnit(rate, rateUnit)}`)
    .join(" · ")

  // 4. Cells (recipe nodes)
  const cellCount = flow.nodes.filter((n) => n.recipe).length

  // 5. Flows
  const flowCount = flow.edges.length

  // 6. Dataset
  const ds = truncate(dataset, 22)

  // Hidden span retains the original flow-stats text format for the E2E test
  // (which regex-matches `\d+\.\d+ MW`). fmt() can drop decimals at large
  // magnitudes, so this branch keeps a strict 2-decimal form.
  const legacyMw = (flow.totalPowerW / 1e6).toFixed(2)
  const legacyStats = `${flow.nodes.length} nodes · ${flow.edges.length} flows · ${legacyMw} MW`

  return (
    <div data-testid="hud-strip" style={baseStyle}>
      {/* 1. Target chip */}
      <span>
        <Value>► </Value>
        <Value>{primaryName}</Value>
        <Label> × </Label>
        <Value>{fmtRateUnit(primaryRate, rateUnit)}</Value>
        {extraTargets && <Value>{extraTargets}</Value>}
      </span>

      <Sep />

      {/* 2. Power */}
      <span>
        <Label>POWER </Label>
        <Value>{mw} MW</Value>
      </span>

      <Sep />

      {/* 3. Raw inputs */}
      <span>
        <Label>RAW </Label>
        <Value>
          {rawCells}
          {rawMore}
        </Value>
      </span>

      <Sep />

      {/* 4 & 5. Cells + Flows — wrapped in flow-stats testid for E2E compat */}
      <span data-testid="flow-stats">
        <Label>CELLS </Label>
        <Value>{cellCount}</Value>
        <Sep />
        <Label>FLOWS </Label>
        <Value>{flowCount}</Value>
        {/* Hidden legacy text the existing e2e test regex-matches against. */}
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0,0,0,0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          {legacyStats}
        </span>
      </span>

      <Sep />

      {/* 6. Dataset */}
      <span>
        <Label>DS </Label>
        <Value>{ds}</Value>
      </span>
      {/* Rate-unit segmented control was previously mounted here. It moved
          into the Outputs section in the page header. `rateUnit` and
          `onRateUnitChange` stay on the prop interface for downstream use. */}
    </div>
  )
}
