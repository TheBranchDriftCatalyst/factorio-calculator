import { useEffect, useMemo, useRef } from "react"
import { Command as CmdkCommand } from "cmdk"

export interface Command {
  id: string
  label: string
  hint?: string
  group?: string
  onSelect: () => void
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: Command[]
}

interface GroupedCommands {
  group: string
  commands: Command[]
}

function groupCommands(commands: Command[]): GroupedCommands[] {
  const groups: GroupedCommands[] = []
  const lookup = new Map<string, GroupedCommands>()
  for (const cmd of commands) {
    const groupName = cmd.group ?? ""
    let entry = lookup.get(groupName)
    if (!entry) {
      entry = { group: groupName, commands: [] }
      lookup.set(groupName, entry)
      groups.push(entry)
    }
    entry.commands.push(cmd)
  }
  return groups
}

export function CommandPalette({ open, onOpenChange, commands }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      // Autofocus the input when palette opens
      const t = setTimeout(() => inputRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
  }, [open])

  const grouped = useMemo(() => groupCommands(commands), [commands])

  if (!open) return null

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) {
      onOpenChange(false)
    }
  }

  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.6)",
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "15vh",
      }}
    >
      <div
        data-testid="command-palette"
        className="bg-card border border-border"
        style={{
          width: 560,
          maxHeight: "60vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
          borderRadius: 0,
        }}
      >
        <CmdkCommand
          label="Command Palette"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault()
              onOpenChange(false)
            }
          }}
        >
          <CmdkCommand.Input
            ref={inputRef}
            placeholder="Type a command or search…"
            className="bg-transparent"
            style={{
              width: "100%",
              padding: "12px 14px",
              fontFamily: "Inter, sans-serif",
              fontSize: 14,
              border: "none",
              outline: "none",
              borderBottom: "1px solid var(--border)",
              color: "inherit",
            }}
          />
          <CmdkCommand.List
            style={{
              maxHeight: "50vh",
              overflowY: "auto",
              padding: "4px 0",
            }}
          >
            <CmdkCommand.Empty
              style={{
                padding: "12px 14px",
                fontSize: 13,
                opacity: 0.6,
              }}
            >
              No results.
            </CmdkCommand.Empty>
            {grouped.map((g) => (
              <CmdkCommand.Group key={g.group || "_"} heading={g.group || undefined}>
                {g.commands.map((cmd) => (
                  <CmdkCommand.Item
                    key={cmd.id}
                    value={`${cmd.label} ${cmd.id}`}
                    onSelect={() => {
                      cmd.onSelect()
                      onOpenChange(false)
                    }}
                    className="px-3 flex items-center gap-2"
                    style={{
                      height: 32,
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ flex: 1 }}>{cmd.label}</span>
                    {cmd.hint && (
                      <span
                        className="font-mono"
                        style={{
                          fontSize: 10,
                          color: "var(--signature, #ffb000)",
                        }}
                      >
                        {cmd.hint}
                      </span>
                    )}
                  </CmdkCommand.Item>
                ))}
              </CmdkCommand.Group>
            ))}
          </CmdkCommand.List>
        </CmdkCommand>
      </div>
      <style>{`
        [data-testid="command-palette"] [cmdk-item][aria-selected="true"],
        [data-testid="command-palette"] [cmdk-item][data-selected="true"] {
          background-color: color-mix(in oklab, var(--primary) 15%, transparent);
        }
        [data-testid="command-palette"] [cmdk-group-heading] {
          padding: 6px 14px 4px;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          opacity: 0.55;
        }
      `}</style>
    </div>
  )
}
