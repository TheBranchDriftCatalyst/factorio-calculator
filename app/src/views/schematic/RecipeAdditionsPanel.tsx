// Sidebar section: "Recipe Additions" — recommends items the user
// could add as targets based on what their current flow already
// produces / consumes. Click a row to add it as a target.

import { useMemo, useState } from "react"
import type { Catalog } from "../../factorio"
import type { FlowGraph, Target } from "../../solver/expand"
import { recommendRecipes, type RecipeSuggestion } from "./recommendRecipes"

interface Props {
  catalog: Catalog
  flow: FlowGraph
  /**
   * Called when the user clicks a suggestion. The panel appends a
   * target with rate 1/sec — App can adjust afterward via the
   * Output picker. Returning false (or not providing the handler)
   * disables the click affordance.
   */
  onAddTarget?: (target: Target) => void
}

export function RecipeAdditionsPanel({ catalog, flow, onAddTarget }: Props) {
  const [expanded, setExpanded] = useState(true)
  const [minCoverage, setMinCoverage] = useState(0.5)
  const suggestions = useMemo(
    () => recommendRecipes(catalog, flow, { minCoverage, limit: 20 }),
    [catalog, flow, minCoverage],
  )

  return (
    <section
      data-testid="recipe-additions-panel"
      className="rounded border border-border bg-card p-3 flex flex-col gap-2"
    >
      <header className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-xs uppercase tracking-wider opacity-70 hover:opacity-100"
        >
          {expanded ? "▾" : "▸"} Recipe Additions ({suggestions.length})
        </button>
        {expanded && (
          <label className="flex items-center gap-1 text-[10px] opacity-60">
            <span>min&nbsp;%</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={minCoverage}
              onChange={(e) => setMinCoverage(Number(e.target.value))}
              className="w-16"
              data-testid="recipe-additions-min-coverage"
            />
            <span className="font-mono w-6 text-right">
              {Math.round(minCoverage * 100)}
            </span>
          </label>
        )}
      </header>
      {expanded && (
        <div className="text-[11px] opacity-50 leading-tight">
          Recipes whose ingredients are already on your bus. Click to add
          as a target.
        </div>
      )}
      {expanded && suggestions.length === 0 && (
        <div className="text-xs opacity-50 italic py-2">
          No suggestions — every recipe with available ingredients is
          already in your flow.
        </div>
      )}
      {expanded && suggestions.length > 0 && (
        <ul
          className="flex flex-col gap-1 max-h-64 overflow-y-auto"
          data-testid="recipe-additions-list"
        >
          {suggestions.map((s) => (
            <SuggestionRow
              key={s.recipe.key}
              suggestion={s}
              clickable={!!onAddTarget}
              onClick={() => onAddTarget?.({ item: s.item, rate: 1 })}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function SuggestionRow({
  suggestion,
  clickable,
  onClick,
}: {
  suggestion: RecipeSuggestion
  clickable: boolean
  onClick: () => void
}) {
  const { itemName, coverage, matched, missing } = suggestion
  const pct = Math.round(coverage * 100)
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={!clickable}
        data-testid={`recipe-additions-row-${suggestion.item}`}
        title={
          `Ingredients you have: ${matched.join(", ") || "(none)"}` +
          (missing.length ? `\nYou'd still need: ${missing.join(", ")}` : "")
        }
        className="w-full text-left flex items-center gap-2 px-1.5 py-1 rounded hover:bg-cyan-500/10 disabled:cursor-not-allowed"
      >
        <span className="flex-1 truncate text-xs">{itemName}</span>
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded"
          style={{
            background:
              coverage === 1
                ? "rgba(0, 252, 214, 0.2)"
                : coverage >= 0.75
                  ? "rgba(125, 211, 252, 0.15)"
                  : "rgba(125, 211, 252, 0.08)",
            color:
              coverage === 1
                ? "rgba(0, 252, 214, 0.95)"
                : "rgba(186, 230, 253, 0.9)",
          }}
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
