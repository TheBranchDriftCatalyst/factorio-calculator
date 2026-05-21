// Picker for items with multiple recipes. Lets the user pin which recipe
// gets used so the schematic doesn't over-populate with alternate chains
// (e.g. basic vs advanced oil processing for petroleum-gas).

import { useMemo, useState } from "react"
import type { Catalog } from "../../factorio"
import { isRecyclingRecipe, type FlowGraph } from "../../solver/expand"

interface Props {
  catalog: Catalog
  /**
   * The CURRENT solved flow. RecipePicker only shows items that actually
   * appear in this flow (no point in offering recipes for items the
   * schematic doesn't touch).
   */
  flow: FlowGraph | null
  /** Current map: item key → chosen recipe key. */
  choices: Record<string, string>
  /** Called with a NEW choices map whenever the user picks a recipe. */
  onChange: (next: Record<string, string>) => void
  defaultCollapsed?: boolean
}

interface MultiRecipeItem {
  item: string
  itemName: string
  recipes: Array<{ key: string; name: string }>
}

export function RecipePicker({
  catalog,
  flow,
  choices,
  onChange,
  defaultCollapsed = true,
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  // Items that ACTUALLY flow through the current schematic — derived from
  // edge items + recipe-node products. Anything outside this set is
  // irrelevant noise for the picker.
  const itemsInFlow = useMemo(() => {
    const set = new Set<string>()
    if (!flow) return set
    for (const e of flow.edges) set.add(e.item)
    for (const n of flow.nodes) {
      if (!n.recipe) continue
      for (const p of n.recipe.products) set.add(p.item)
    }
    return set
  }, [flow])

  // Multi-recipe items intersected with items in the current flow.
  // Recycling recipes are excluded — they destroy items for component
  // recovery and aren't a meaningful "way to produce" an item.
  const items: MultiRecipeItem[] = useMemo(() => {
    const out: MultiRecipeItem[] = []
    for (const [itemKey, allRecipes] of catalog.recipesByProduct.entries()) {
      const recipes = allRecipes.filter((r) => !isRecyclingRecipe(r))
      if (recipes.length < 2) continue
      if (!itemsInFlow.has(itemKey)) continue
      const item = catalog.items.get(itemKey)
      out.push({
        item: itemKey,
        itemName: item?.name ?? itemKey,
        recipes: recipes.map((r) => ({ key: r.key, name: r.name })),
      })
    }
    return out.sort((a, b) => a.itemName.localeCompare(b.itemName))
  }, [catalog, itemsInFlow])

  if (items.length === 0) {
    // Nothing to pick — render nothing rather than an empty collapsible.
    return null
  }

  const setChoice = (item: string, recipeKey: string | null) => {
    const next = { ...choices }
    if (recipeKey === null) delete next[item]
    else next[item] = recipeKey
    onChange(next)
  }

  const activeCount = items.filter((i) => choices[i.item]).length

  return (
    <div
      data-testid="recipe-picker"
      className="text-xs bg-card border border-border rounded"
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30"
        aria-expanded={!collapsed}
      >
        <span className="font-medium uppercase tracking-wide text-[10px] opacity-80">
          ⚙ Recipes
        </span>
        <span className="flex items-center gap-2">
          {activeCount > 0 && (
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
              {activeCount} PINNED
            </span>
          )}
          <span className="opacity-60">{collapsed ? "▸" : "▾"}</span>
        </span>
      </button>
      {!collapsed && (
        <div className="px-3 py-2 space-y-1.5 border-t border-border max-h-80 overflow-auto">
          {items.map((mr) => (
            <RecipeRow
              key={mr.item}
              entry={mr}
              chosen={choices[mr.item] ?? null}
              onChange={(k) => setChoice(mr.item, k)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RecipeRow({
  entry,
  chosen,
  onChange,
}: {
  entry: MultiRecipeItem
  chosen: string | null
  onChange: (recipeKey: string | null) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label
        className="opacity-80 truncate"
        htmlFor={`rp-${entry.item}`}
        title={entry.itemName}
      >
        {entry.itemName}
      </label>
      <select
        id={`rp-${entry.item}`}
        data-testid={`recipe-choice-${entry.item}`}
        value={chosen ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className="text-xs font-mono bg-background border border-border rounded px-1 py-0.5"
        style={{ height: 22, maxWidth: 160 }}
      >
        <option value="">default</option>
        {entry.recipes.map((r) => (
          <option key={r.key} value={r.key}>
            {r.name}
          </option>
        ))}
      </select>
    </div>
  )
}
