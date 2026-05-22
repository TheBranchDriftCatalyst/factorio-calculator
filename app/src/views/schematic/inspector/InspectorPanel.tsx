// Polymorphic inspector — empty state, hover preview, single-pin, multi-
// select aggregate, or pinned lane. Picks the right sub-component for
// whatever the user has interacted with.

import type { Blueprint, Cell } from "../../../blueprint/types"
import { fmt } from "../../../util/format"
import type { BeltTier } from "../../../blueprint/util/utilization"
import type { SchematicConfig } from "../SchematicConfig"
import { CellDetails } from "./CellDetails"
import { LaneDetails } from "./LaneDetails"

interface Props {
  blueprint: Blueprint
  hovered: Cell | null
  selectedKeys: Set<string>
  selectedLane: { beltX: number; lane: "A" | "B"; item: string; rate: number } | null
  cellByKey: Map<string, Cell>
  onClear: () => void
  beltTier: BeltTier
  config: SchematicConfig
  updateConfig: <K extends keyof SchematicConfig>(key: K, value: SchematicConfig[K]) => void
  // App-owned solver-relevant override; CellDetails dispatches edits via the setter.
  machineOverrides: Record<string, string>
  setMachineOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>>
}

export function InspectorPanel({
  blueprint,
  hovered,
  selectedKeys,
  selectedLane,
  cellByKey,
  onClear,
  beltTier,
  config,
  updateConfig,
  machineOverrides,
  setMachineOverrides,
}: Props) {
  // Lane selected — show its details + consumers/producers list.
  if (selectedLane) {
    return (
      <LaneDetails
        blueprint={blueprint}
        lane={selectedLane}
        beltTier={beltTier}
        onClear={onClear}
        config={config}
        updateConfig={updateConfig}
      />
    )
  }
  // State 0: no selection AND no hover — pure empty state.
  if (selectedKeys.size === 0 && !hovered) {
    return (
      <div
        className="text-xs opacity-60 px-3 py-3 border border-dashed border-border rounded h-full"
        data-testid="cell-inspector-empty"
      >
        <div className="font-medium opacity-80 mb-1">Inspector</div>
        <div>
          Click any cell to pin its details. <kbd className="px-1 rounded bg-muted">⇧</kbd>{" "}
          click adds, <kbd className="px-1 rounded bg-muted">⌘</kbd> click toggles,{" "}
          <kbd className="px-1 rounded bg-muted">⎋</kbd> clears.
        </div>
      </div>
    )
  }

  // State 1: only hovered (ephemeral preview).
  if (selectedKeys.size === 0 && hovered) {
    return (
      <div
        className="text-xs bg-card border border-border rounded p-3 h-full"
        data-testid="cell-inspector"
      >
        <div className="opacity-50 mb-2 uppercase tracking-wide text-[10px]">
          hovering (click to pin)
        </div>
        <CellDetails
          cell={hovered}
          beltTier={beltTier}
          beltOverrides={config.beltOverrides ?? {}}
          machineOverrides={machineOverrides}
          setMachineOverrides={setMachineOverrides}
          machineCategoryDefaults={config.machineCategoryDefaults ?? {}}
        />
      </div>
    )
  }

  // State 2: exactly one selected (pinned detail panel).
  if (selectedKeys.size === 1) {
    const [key] = selectedKeys
    const cell = cellByKey.get(key)
    if (!cell) {
      return (
        <div
          className="text-xs opacity-60 px-3 py-3 border border-dashed border-border rounded h-full"
          data-testid="cell-inspector"
        >
          Selected cell not found in current blueprint.
          <button className="ml-2 underline" onClick={onClear}>
            clear
          </button>
        </div>
      )
    }
    return (
      <div
        className="text-xs bg-card border border-border rounded p-3 h-full"
        data-testid="cell-inspector"
        data-state="pinned"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="opacity-50 uppercase tracking-wide text-[10px]">pinned</div>
          <button className="opacity-60 hover:opacity-100 underline" onClick={onClear}>
            clear
          </button>
        </div>
        <CellDetails
          cell={cell}
          expanded
          beltTier={beltTier}
          beltOverrides={config.beltOverrides ?? {}}
          machineOverrides={machineOverrides}
          setMachineOverrides={setMachineOverrides}
          machineCategoryDefaults={config.machineCategoryDefaults ?? {}}
        />
      </div>
    )
  }

  // State N: multi-select aggregate.
  const cells = [...selectedKeys]
    .map((k) => cellByKey.get(k))
    .filter((c): c is Cell => c !== undefined)
  const totalMachines = cells.reduce((s, c) => s + c.demanded, 0)
  const recipes = cells.map((c) => ({
    key: c.recipeKey,
    name: c.recipeName,
    demanded: c.demanded,
  }))

  return (
    <div
      className="text-xs bg-card border border-border rounded p-3 h-full"
      data-testid="cell-inspector"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="opacity-50 uppercase tracking-wide text-[10px]">
          {cells.length} selected
        </div>
        <button className="opacity-60 hover:opacity-100 underline" onClick={onClear}>
          clear
        </button>
      </div>
      <div className="space-y-1 mb-3">
        <div>
          <span className="opacity-60">Total machines: </span>
          <span className="font-mono">{fmt(totalMachines)}</span>
        </div>
        <div>
          <span className="opacity-60">Distinct recipes: </span>
          <span className="font-mono">{cells.length}</span>
        </div>
      </div>
      <div className="opacity-60 mb-1">Recipes</div>
      <ul className="space-y-0.5 max-h-[40vh] overflow-auto">
        {recipes.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-2">
            <span className="truncate">{r.name}</span>
            <span className="font-mono opacity-70 shrink-0">×{fmt(r.demanded)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
