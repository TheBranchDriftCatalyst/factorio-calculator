// Rich popover recipe picker. Replaces a plain <select> with a card-grid:
// each option shows the recipe name, crafting time, default machine,
// ingredient icons (with amounts), and product icons (with amounts), so
// the user can see exactly what each variation does before picking.

import { useEffect, useRef, useState } from "react"
import { ChevronsUpDown, Check } from "lucide-react"
import type { Catalog, Recipe } from "../factorio"
import { ItemIcon } from "./Icon"

interface Props {
  catalog: Catalog
  options: ReadonlyArray<Recipe>
  /** "" = "use solver default". */
  value: string
  onChange: (recipeKey: string) => void
  testId?: string
}

export function RecipePicker({ catalog, options, value, onChange, testId }: Props) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

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

  const selected = options.find((r) => r.key === value)
  const triggerLabel = selected?.name ?? "default"

  return (
    <div ref={containerRef} className="relative" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Recipe variation for this target"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 7px",
          fontFamily: '"JetBrains Mono", var(--font-mono), ui-monospace, monospace',
          fontSize: 10,
          letterSpacing: "0.04em",
          color: "rgba(255,255,255,0.85)",
          background: "rgba(255,176,0,0.06)",
          border: "1px solid rgba(255,176,0,0.28)",
          cursor: "pointer",
          maxWidth: 220,
          lineHeight: 1.2,
        }}
      >
        {/* Inline mini-icons so the trigger itself shows the chosen recipe's products. */}
        {selected ? (
          <span style={{ display: "inline-flex", gap: 2 }}>
            {selected.products.slice(0, 3).map((p, i) => (
              <ItemIcon key={`${p.item}-${i}`} catalog={catalog} itemKey={p.item} size={14} />
            ))}
          </span>
        ) : null}
        <span className="truncate" style={{ maxWidth: 140 }}>
          {triggerLabel}
        </span>
        <ChevronsUpDown style={{ width: 12, height: 12, opacity: 0.6 }} />
      </button>
      {open && (
        <div
          role="dialog"
          className="absolute right-0 top-full mt-1 border border-primary/40 rounded-md shadow-2xl overflow-hidden"
          style={{
            background: "var(--card)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
            zIndex: 100,
            width: 320,
            maxHeight: 360,
            overflowY: "auto",
          }}
          data-testid={testId ? `${testId}-popover` : undefined}
        >
          <RecipeCard
            key="__default"
            catalog={catalog}
            recipe={null}
            isSelected={value === ""}
            onClick={() => {
              onChange("")
              setOpen(false)
            }}
            testId={testId ? `${testId}-option-default` : undefined}
          />
          {options.map((r) => (
            <RecipeCard
              key={r.key}
              catalog={catalog}
              recipe={r}
              isSelected={value === r.key}
              onClick={() => {
                onChange(r.key)
                setOpen(false)
              }}
              testId={testId ? `${testId}-option-${r.key}` : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RecipeCard({
  catalog,
  recipe,
  isSelected,
  onClick,
  testId,
}: {
  catalog: Catalog
  recipe: Recipe | null // null = "default" pseudo-row
  isSelected: boolean
  onClick: () => void
  testId?: string
}) {
  // Look up the fastest machine in the recipe's category as a hint about
  // what would craft this. Cheap and informative.
  const machine = recipe
    ? [...(catalog.machinesByCategory.get(recipe.category) ?? [])].sort(
        (a, b) => b.craftingSpeed - a.craftingSpeed,
      )[0]
    : undefined

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="w-full text-left px-2 py-2 hover:bg-primary/15 border-b border-border/40 last:border-b-0"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        background: isSelected ? "rgba(255,201,64,0.10)" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, flex: 1 }}>
          {recipe ? recipe.name : "default (solver picks)"}
        </span>
        {recipe ? (
          <span
            className="font-mono"
            style={{
              fontSize: 9,
              opacity: 0.75,
              padding: "1px 5px",
              background: "rgba(255,255,255,0.06)",
              borderRadius: 2,
            }}
            title={`Crafting time at speed=1: ${recipe.time}s`}
          >
            {formatTime(recipe.time)}
          </span>
        ) : null}
        {isSelected && <Check style={{ width: 12, height: 12, opacity: 0.85 }} />}
      </div>
      {recipe && (
        <>
          {/* Ingredients → Products row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
              fontSize: 10,
              opacity: 0.95,
            }}
          >
            <IconList
              catalog={catalog}
              items={recipe.ingredients}
              emptyLabel="—"
            />
            <span style={{ opacity: 0.6, fontSize: 12 }}>→</span>
            <IconList
              catalog={catalog}
              items={recipe.products.map((p) => ({ item: p.item, amount: p.amount }))}
              emptyLabel="—"
            />
          </div>
          {machine && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 9,
                opacity: 0.6,
              }}
            >
              <span className="uppercase tracking-wide">{recipe.category}</span>
              <span>·</span>
              <span>{machine.name}</span>
            </div>
          )}
        </>
      )}
    </button>
  )
}

function IconList({
  catalog,
  items,
  emptyLabel,
}: {
  catalog: Catalog
  items: ReadonlyArray<{ item: string; amount: number }>
  emptyLabel: string
}) {
  if (items.length === 0)
    return <span style={{ opacity: 0.5 }}>{emptyLabel}</span>
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      {items.map((p, i) => {
        const name = catalog.items.get(p.item)?.name ?? p.item
        return (
          <span
            key={`${p.item}-${i}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
            title={`${p.amount} × ${name}`}
          >
            <ItemIcon catalog={catalog} itemKey={p.item} size={16} />
            <span
              className="font-mono"
              style={{ fontSize: 9, opacity: 0.85 }}
            >
              ×{p.amount}
            </span>
          </span>
        )
      })}
    </span>
  )
}

function formatTime(seconds: number): string {
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  return `${seconds.toFixed(0)}s`
}
