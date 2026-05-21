// Rich popover recipe picker. The trigger surfaces the chosen recipe's
// products. The popover lists every candidate recipe as a generous card:
// ingredients, products, machine + crafting time — full-size icons, clear
// hierarchy, easy to scan when comparing alternates (oil refinery,
// recycling, etc.).

import { useEffect, useRef, useState } from "react"
import { ChevronsUpDown, Check } from "lucide-react"
import type { Catalog, Machine, Recipe } from "../factorio"
import { ItemIcon } from "./Icon"

interface Props {
  catalog: Catalog
  options: ReadonlyArray<Recipe>
  /** "" = "use solver default". */
  value: string
  onChange: (recipeKey: string) => void
  testId?: string
}

// Visual sizes — bump in one place if we want to scale the picker.
const ICON_SIZE = 28
const TRIGGER_ICON = 18
const POPOVER_WIDTH = 380

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
          gap: 8,
          padding: "6px 10px",
          fontFamily: '"JetBrains Mono", var(--font-mono), ui-monospace, monospace',
          fontSize: 12,
          letterSpacing: "0.02em",
          color: "rgba(255,255,255,0.92)",
          background: "rgba(255,176,0,0.08)",
          border: "1px solid rgba(255,176,0,0.35)",
          borderRadius: 4,
          cursor: "pointer",
          maxWidth: 240,
          lineHeight: 1.2,
        }}
      >
        {selected ? (
          <span style={{ display: "inline-flex", gap: 3 }}>
            {selected.products.slice(0, 3).map((p, i) => (
              <ItemIcon
                key={`${p.item}-${i}`}
                catalog={catalog}
                itemKey={p.item}
                size={TRIGGER_ICON}
              />
            ))}
          </span>
        ) : null}
        <span className="truncate" style={{ maxWidth: 160 }}>
          {triggerLabel}
        </span>
        <ChevronsUpDown style={{ width: 14, height: 14, opacity: 0.7 }} />
      </button>
      {open && (
        <div
          role="dialog"
          className="absolute right-0 top-full mt-1 border border-primary/40 rounded-md shadow-2xl"
          style={{
            background: "var(--card)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
            zIndex: 100,
            width: POPOVER_WIDTH,
            maxHeight: 480,
            overflowY: "auto",
            overflowX: "hidden",
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
  recipe: Recipe | null
  isSelected: boolean
  onClick: () => void
  testId?: string
}) {
  // Default ("solver picks") row is purely informational — no recipe to render.
  if (!recipe) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className="w-full text-left hover:bg-primary/15 border-b border-border/40"
        style={{
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: isSelected ? "rgba(255,201,64,0.10)" : undefined,
        }}
      >
        <span
          style={{
            width: ICON_SIZE,
            height: ICON_SIZE,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255,255,255,0.05)",
            border: "1px dashed rgba(255,255,255,0.25)",
            borderRadius: 4,
            fontSize: 14,
            opacity: 0.7,
          }}
        >
          ⚙
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Default</div>
          <div style={{ fontSize: 10.5, opacity: 0.6 }}>Solver picks the primary recipe</div>
        </div>
        {isSelected && <Check style={{ width: 16, height: 16, opacity: 0.85 }} />}
      </button>
    )
  }

  // Fastest machine in the recipe's category — informative hint.
  const machine: Machine | undefined = [
    ...(catalog.machinesByCategory.get(recipe.category) ?? []),
  ].sort((a, b) => b.craftingSpeed - a.craftingSpeed)[0]

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="w-full text-left hover:bg-primary/15 border-b border-border/40 last:border-b-0"
      style={{
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        background: isSelected ? "rgba(255,201,64,0.12)" : undefined,
        borderLeft: isSelected ? "3px solid rgba(255,201,64,0.85)" : "3px solid transparent",
      }}
    >
      {/* Header — recipe name + time pill + checkmark */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            color: isSelected ? "rgba(255,201,64,0.95)" : "rgba(255,255,255,0.95)",
          }}
        >
          {recipe.name}
        </span>
        <span
          className="font-mono"
          style={{
            fontSize: 10.5,
            opacity: 0.85,
            padding: "2px 7px",
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 3,
          }}
          title={`Crafting time at speed=1: ${recipe.time}s`}
        >
          ⏱ {formatTime(recipe.time)}
        </span>
        {isSelected && (
          <Check style={{ width: 16, height: 16, color: "rgba(255,201,64,0.95)" }} />
        )}
      </div>

      {/* Ingredients → Products */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <IngredientBlock catalog={catalog} list={recipe.ingredients} label="In" />
        <span
          aria-hidden
          style={{
            fontSize: 18,
            opacity: 0.55,
            lineHeight: 1,
            paddingTop: 16,
          }}
        >
          →
        </span>
        <IngredientBlock
          catalog={catalog}
          list={recipe.products.map((p) => ({ item: p.item, amount: p.amount }))}
          label="Out"
          accent
        />
      </div>

      {/* Footer — machine + category */}
      {machine && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10.5,
            opacity: 0.65,
            paddingTop: 2,
            borderTop: "1px dashed rgba(255,255,255,0.08)",
            marginTop: 2,
          }}
        >
          <ItemIcon catalog={catalog} itemKey={machine.key} size={16} />
          <span>{machine.name}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span className="uppercase tracking-wide" style={{ fontSize: 9 }}>
            {recipe.category}
          </span>
        </div>
      )}
    </button>
  )
}

function IngredientBlock({
  catalog,
  list,
  label,
  accent,
}: {
  catalog: Catalog
  list: ReadonlyArray<{ item: string; amount: number }>
  label: string
  accent?: boolean
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "4px 6px",
        background: accent ? "rgba(255,201,64,0.06)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${accent ? "rgba(255,201,64,0.20)" : "rgba(255,255,255,0.06)"}`,
        borderRadius: 4,
      }}
    >
      <span
        style={{
          fontSize: 8.5,
          letterSpacing: "0.10em",
          textTransform: "uppercase",
          opacity: 0.55,
          color: accent ? "rgba(255,201,64,0.9)" : undefined,
        }}
      >
        {label}
      </span>
      {list.length === 0 ? (
        <span style={{ opacity: 0.5, fontSize: 11 }}>—</span>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {list.map((p, i) => {
            const name = catalog.items.get(p.item)?.name ?? p.item
            return (
              <span
                key={`${p.item}-${i}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 5px 2px 2px",
                  background: "rgba(0,0,0,0.35)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 3,
                }}
                title={`${p.amount} × ${name}`}
              >
                <ItemIcon catalog={catalog} itemKey={p.item} size={ICON_SIZE} />
                <span
                  className="font-mono"
                  style={{ fontSize: 11, fontWeight: 600, opacity: 0.95 }}
                >
                  ×{p.amount}
                </span>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatTime(seconds: number): string {
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  return `${seconds.toFixed(0)}s`
}
