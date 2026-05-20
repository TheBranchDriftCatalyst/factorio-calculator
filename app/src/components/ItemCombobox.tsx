import { useEffect, useMemo, useRef, useState } from "react"
import { Command } from "cmdk"
import { ChevronsUpDown, Check } from "lucide-react"
import type { Catalog } from "../factorio"
import { ItemIcon } from "./Icon"

interface Props {
  catalog: Catalog
  value: string
  onChange: (key: string) => void
  testId?: string
}

// fzf-style fuzzy picker for catalog items. Renders icon + name + recipe
// metadata in each option. Wraps cmdk for matching/keyboard nav.
export function ItemCombobox({ catalog, value, onChange, testId }: Props) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const items = useMemo(() => {
    const out: Array<{ key: string; name: string; subtitle: string; searchText: string }> = []
    for (const itemKey of catalog.recipesByProduct.keys()) {
      const item = catalog.items.get(itemKey)
      const name = item?.name ?? itemKey
      const recipes = catalog.recipesByProduct.get(itemKey) ?? []
      const primary = recipes.find((r) => r.key === itemKey) ?? recipes[0]
      const machines = primary ? catalog.machinesByCategory.get(primary.category) ?? [] : []
      const machine = machines[0]
      const subtitle = primary
        ? `${primary.category}${machine ? ` · ${machine.name}` : ""}`
        : itemKey
      out.push({ key: itemKey, name, subtitle, searchText: `${itemKey} ${name} ${subtitle}` })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }, [catalog])

  const selected = items.find((i) => i.key === value)

  return (
    <div ref={containerRef} className="relative flex-1 min-w-64" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-2 w-full text-left bg-background border border-border rounded-md px-2 py-1.5 text-sm hover:border-primary/50 transition-colors"
      >
        <ItemIcon catalog={catalog} itemKey={value} size={20} />
        <span className="flex-1 truncate font-medium">{selected?.name ?? value}</span>
        <span className="text-xs opacity-60 truncate hidden sm:inline">{selected?.subtitle}</span>
        <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 border border-primary/40 rounded-md shadow-2xl overflow-hidden"
          style={{
            background: "var(--card)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
            // Beat the HudStrip's sticky z-index (50) so the dropdown
            // sits ABOVE the bar instead of being clipped underneath.
            zIndex: 100,
          }}
          data-testid={testId ? `${testId}-dropdown` : undefined}
        >
          <Command
            className="w-full"
            // cmdk's default scoring is fzf-style: matches by character order with bonuses
            filter={(itemValue, search) => {
              if (!search) return 1
              const i = itemValue.toLowerCase().indexOf(search.toLowerCase())
              if (i === -1) return 0
              // Prioritize prefix matches over later matches
              return 1 - i / (itemValue.length + 1)
            }}
          >
            <Command.Input
              placeholder="Search items…"
              autoFocus
              className="w-full bg-transparent px-3 py-2 text-sm border-b border-border outline-none placeholder:text-muted-foreground"
            />
            <Command.List className="max-h-80 overflow-y-auto p-1">
              <Command.Empty className="p-3 text-sm opacity-60">No items found.</Command.Empty>
              {items.map((it) => (
                <Command.Item
                  key={it.key}
                  value={it.searchText}
                  onSelect={() => {
                    onChange(it.key)
                    setOpen(false)
                  }}
                  className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm data-[selected=true]:bg-primary/15 data-[selected=true]:text-foreground"
                >
                  <ItemIcon catalog={catalog} itemKey={it.key} size={20} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{it.name}</div>
                    <div className="text-xs opacity-60 truncate">{it.subtitle}</div>
                  </div>
                  {it.key === value && <Check className="h-4 w-4 opacity-70" />}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </div>
      )}
    </div>
  )
}
