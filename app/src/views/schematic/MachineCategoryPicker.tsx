// Picker for "default machine per crafting category." Lets the user say
// "use Assembling machine 1 for everything crafting" (e.g. because they
// haven't unlocked Assembler 2 yet) without having to pin each recipe
// individually. Per-recipe `machineOverrides` still wins over these.

import { useMemo } from "react"
import type { Catalog } from "../../factorio"
import type { FlowGraph } from "../../solver/expand"
import { CollapsiblePanel } from "../../components/CollapsiblePanel"

interface Props {
  catalog: Catalog
  /**
   * The current solved flow. We only list categories that actually have
   * recipes in this flow — listing every category in the catalog would
   * be noisy and most wouldn't be relevant to what the user's building.
   */
  flow: FlowGraph | null
  defaults: Record<string, string>
  onChange: (next: Record<string, string>) => void
  defaultCollapsed?: boolean
}

interface CategoryEntry {
  category: string
  machines: Array<{ key: string; name: string; speed: number }>
}

export function MachineCategoryPicker({
  catalog,
  flow,
  defaults,
  onChange,
  defaultCollapsed = true,
}: Props) {
  // Categories that appear in the current flow.
  const categoriesInFlow = useMemo(() => {
    const s = new Set<string>()
    if (!flow) return s
    for (const n of flow.nodes) {
      if (n.recipe?.category) s.add(n.recipe.category)
    }
    return s
  }, [flow])

  const entries: CategoryEntry[] = useMemo(() => {
    const out: CategoryEntry[] = []
    for (const cat of categoriesInFlow) {
      const machines = catalog.machinesByCategory.get(cat) ?? []
      if (machines.length === 0) continue
      out.push({
        category: cat,
        machines: [...machines]
          .sort((a, b) => a.craftingSpeed - b.craftingSpeed)
          .map((m) => ({ key: m.key, name: m.name, speed: m.craftingSpeed })),
      })
    }
    return out.sort((a, b) => a.category.localeCompare(b.category))
  }, [catalog, categoriesInFlow])

  if (entries.length === 0) return null

  const setDefault = (cat: string, machineKey: string | null) => {
    const next = { ...defaults }
    if (machineKey === null) delete next[cat]
    else next[cat] = machineKey
    onChange(next)
  }

  const activeCount = entries.filter((e) => defaults[e.category]).length

  const badge = activeCount > 0 ? (
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
  ) : undefined

  return (
    <CollapsiblePanel
      testId="machine-category-picker"
      title="⚙ Default Machines"
      badge={badge}
      defaultCollapsed={defaultCollapsed}
      contentClassName="space-y-1.5"
    >
      {entries.map((e) => (
        <CategoryRow
          key={e.category}
          entry={e}
          chosen={defaults[e.category] ?? null}
          onChange={(k) => setDefault(e.category, k)}
        />
      ))}
    </CollapsiblePanel>
  )
}

function CategoryRow({
  entry,
  chosen,
  onChange,
}: {
  entry: CategoryEntry
  chosen: string | null
  onChange: (machineKey: string | null) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label
        className="opacity-80 truncate"
        htmlFor={`mcp-${entry.category}`}
        title={entry.category}
      >
        {entry.category}
      </label>
      <select
        id={`mcp-${entry.category}`}
        data-testid={`category-default-${entry.category}`}
        value={chosen ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className="text-xs font-mono bg-background border border-border rounded px-1 py-0.5"
        style={{ height: 22, maxWidth: 160 }}
      >
        <option value="">fastest (auto)</option>
        {entry.machines.map((m) => (
          <option key={m.key} value={m.key}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  )
}
