// Sidebar section: "Recipe Additions" — recommends items the user
// could add as targets based on what their current flow already
// produces / consumes. Click a row to add it as a target.
//
// Visual contract matches IntermediatesPanel / BomPanel / FuelsPanel
// via the shared CollapsiblePanel shell: same card-border + tracked
// uppercase header + chevron + right-aligned badge for the count.

import { useMemo, useState } from "react"
import type { Catalog } from "../../factorio"
import type { FlowGraph, Target } from "../../solver/expand"
import { CollapsiblePanel } from "../../components/CollapsiblePanel"
import { ItemIcon } from "../../components/Icon"
import { recommendRecipes, type RecipeSuggestion } from "./recommendRecipes"

interface Props {
  catalog: Catalog
  flow: FlowGraph
  /** Append a new target. The panel uses rate=1 as the seed; the
   *  Output picker can adjust afterward. */
  onAddTarget?: (target: Target) => void
  defaultCollapsed?: boolean
}

export function RecipeAdditionsPanel({
  catalog,
  flow,
  onAddTarget,
  defaultCollapsed = true,
}: Props) {
  const [minCoverage, setMinCoverage] = useState(0.5)
  const suggestions = useMemo(
    () => recommendRecipes(catalog, flow, { minCoverage, limit: 20 }),
    [catalog, flow, minCoverage],
  )
  const badge = (
    <span
      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300/90"
      data-testid="recipe-additions-count"
    >
      {suggestions.length}
    </span>
  )

  return (
    <CollapsiblePanel
      testId="recipe-additions-panel"
      title="✚ Recipe Additions"
      badge={badge}
      defaultCollapsed={defaultCollapsed}
      contentClassName="space-y-2"
    >
      {/* Filter bar — sits ABOVE the list, matches the column-header
          row used in IntermediatesPanel. */}
      <div
        className="flex items-center gap-2 pb-1 mb-1 border-b border-border/60"
        style={{ fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase" }}
      >
        <span className="flex-1 opacity-60">Min coverage</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={minCoverage}
          onChange={(e) => setMinCoverage(Number(e.target.value))}
          className="w-20 accent-cyan-400"
          data-testid="recipe-additions-min-coverage"
          aria-label="Minimum coverage filter"
        />
        <span className="font-mono opacity-70 w-8 text-right">
          {Math.round(minCoverage * 100)}%
        </span>
      </div>
      <div className="text-[10px] opacity-50 leading-tight px-0.5">
        Recipes whose ingredients are already on your bus. Click to add as
        a target.
      </div>
      {suggestions.length === 0 ? (
        <div className="text-xs opacity-50 italic py-2">
          No suggestions — every recipe with available ingredients is
          already in your flow.
        </div>
      ) : (
        <ul
          className="flex flex-col gap-0.5 max-h-64 overflow-y-auto"
          data-testid="recipe-additions-list"
        >
          {suggestions.map((s) => (
            <SuggestionRow
              key={s.recipe.key}
              catalog={catalog}
              suggestion={s}
              clickable={!!onAddTarget}
              onClick={() => onAddTarget?.({ item: s.item, rate: 1 })}
            />
          ))}
        </ul>
      )}
    </CollapsiblePanel>
  )
}

function SuggestionRow({
  catalog,
  suggestion,
  clickable,
  onClick,
}: {
  catalog: Catalog
  suggestion: RecipeSuggestion
  clickable: boolean
  onClick: () => void
}) {
  const { item, itemName, coverage, matched, missing } = suggestion
  const pct = Math.round(coverage * 100)
  // Coverage tier drives the chip color. 100% = teal accent (matches
  // IntermediatesPanel's "in-balance" highlight); 75%+ = cyan; lower
  // = muted cyan. Stays in the existing palette.
  const tier =
    coverage === 1 ? "full" : coverage >= 0.75 ? "high" : "partial"
  const chipBg =
    tier === "full"
      ? "bg-emerald-500/20 text-emerald-300"
      : tier === "high"
        ? "bg-cyan-500/15 text-cyan-200"
        : "bg-cyan-500/8 text-cyan-300/80"
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={!clickable}
        data-testid={`recipe-additions-row-${item}`}
        title={
          `Ingredients you have: ${matched.join(", ") || "(none)"}` +
          (missing.length ? `\nYou'd still need: ${missing.join(", ")}` : "")
        }
        className="w-full text-left flex items-center gap-2 px-1 py-0.5 rounded hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ItemIcon catalog={catalog} itemKey={item} size={16} />
        <span className="flex-1 truncate text-xs">{itemName}</span>
        <span
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${chipBg}`}
        >
          {matched.length}/{matched.length + missing.length}
        </span>
        <span className="text-[10px] font-mono opacity-50 w-7 text-right">
          {pct}%
        </span>
      </button>
    </li>
  )
}
