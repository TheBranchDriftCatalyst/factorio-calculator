// Schema-driven settings panel for the schematic view.
// Reads TOPOLOGY_FIELDS and renders the appropriate control per row.
// All edits flow through a single `update` callback so consumers don't
// have to wire one handler per field.

import { useId, useMemo, useState } from "react"
import type { SchematicConfig } from "./SchematicConfig"
import { TOPOLOGY_FIELDS, type TopologyField } from "./topologyFields"

interface Props {
  config: SchematicConfig
  update: <K extends keyof SchematicConfig>(key: K, value: SchematicConfig[K]) => void
  /** initial collapsed state */
  defaultCollapsed?: boolean
}

export function TopologyPanel({ config, update, defaultCollapsed = false }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const panelId = useId()

  const fieldsByGroup = useMemo(() => {
    const m = new Map<string, TopologyField[]>()
    for (const f of TOPOLOGY_FIELDS) {
      if (!m.has(f.group)) m.set(f.group, [])
      m.get(f.group)!.push(f)
    }
    return m
  }, [])

  return (
    <div
      data-testid="topology-panel"
      className="text-xs bg-card border border-border rounded"
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30"
        aria-expanded={!collapsed}
        aria-controls={panelId}
      >
        <span className="font-medium uppercase tracking-wide text-[10px] opacity-80">
          ⚙ Topology
        </span>
        <span className="opacity-60" aria-hidden="true">
          {collapsed ? "▸" : "▾"}
        </span>
      </button>
      {!collapsed && (
        <div id={panelId} className="px-3 py-2 space-y-3 border-t border-border">
          {[...fieldsByGroup.entries()].map(([group, fields]) => (
            <section key={group}>
              <div className="uppercase tracking-wide text-[10px] opacity-50 mb-1.5">
                {group}
              </div>
              <div className="space-y-1.5">
                {fields.map((f) => (
                  <FieldRow key={f.key as string} field={f} config={config} update={update} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function FieldRow({
  field,
  config,
  update,
}: {
  field: TopologyField
  config: SchematicConfig
  update: <K extends keyof SchematicConfig>(key: K, value: SchematicConfig[K]) => void
}) {
  const value = config[field.key]
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="opacity-80 flex items-center gap-1" htmlFor={`tf-${field.key}`}>
        <span>{field.label}</span>
        {field.hint && (
          <kbd className="px-1 text-[9px] rounded bg-muted opacity-60">{field.hint}</kbd>
        )}
      </label>
      <FieldControl field={field} value={value} update={update} />
    </div>
  )
}

function FieldControl({
  field,
  value,
  update,
}: {
  field: TopologyField
  value: SchematicConfig[keyof SchematicConfig]
  update: <K extends keyof SchematicConfig>(key: K, value: SchematicConfig[K]) => void
}) {
  const id = `tf-${field.key}`
  switch (field.field.kind) {
    case "toggle": {
      const v = value as boolean
      return (
        <button
          id={id}
          type="button"
          data-testid={id}
          role="switch"
          aria-checked={v}
          onClick={() => update(field.key, !v as never)}
          className="px-2 py-0.5 rounded border font-mono text-[10px]"
          style={{
            background: v ? "rgba(255,201,64,0.85)" : "transparent",
            color: v ? "rgba(0,0,0,0.9)" : "rgba(255,255,255,0.7)",
            borderColor: v ? "rgba(255,176,0,0.6)" : "rgba(255,255,255,0.18)",
            minWidth: 56,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {v ? "On" : "Off"}
        </button>
      )
    }
    case "segmented": {
      const options = field.field.options
      return (
        <div className="inline-flex">
          {options.map((opt) => {
            const active = value === opt
            return (
              <button
                key={opt}
                type="button"
                onClick={() => update(field.key, opt as never)}
                data-testid={`${id}-${opt}`}
                className="px-2 py-0.5 font-mono text-[10px] border"
                style={{
                  background: active ? "rgba(255,201,64,0.85)" : "transparent",
                  color: active ? "rgba(0,0,0,0.9)" : "rgba(255,255,255,0.7)",
                  borderColor: "rgba(255,255,255,0.18)",
                  borderRightWidth: opt === options[options.length - 1] ? 1 : 0,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {opt}
              </button>
            )
          })}
        </div>
      )
    }
    case "select": {
      const options = field.field.options
      return (
        <select
          id={id}
          data-testid={id}
          value={value as string}
          onChange={(e) => update(field.key, e.target.value as never)}
          className="text-xs font-mono bg-background border border-border rounded px-1 py-0.5"
          style={{ height: 22, minWidth: 80 }}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )
    }
    case "slider": {
      const v = value as number
      const { min, max, step } = field.field
      return (
        <div className="flex items-center gap-2">
          <input
            id={id}
            data-testid={id}
            type="range"
            min={min}
            max={max}
            step={step}
            value={v}
            onChange={(e) => update(field.key, Number(e.target.value) as never)}
            className="w-24"
          />
          <span className="font-mono opacity-70" style={{ minWidth: 24, textAlign: "right" }}>
            {v}
          </span>
        </div>
      )
    }
  }
}
