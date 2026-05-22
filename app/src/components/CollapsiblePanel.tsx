// Shared collapsible card used by the schematic side panels (BOM, Fuels,
// Intermediates, Machine defaults, Topology). All of those share the
// same card-border shell + a header button with a ▸/▾ chevron and an
// aria-controls'd content region. This consolidates that scaffolding so
// callers only supply the title, optional badge, and content body.

import { useId, useState } from "react"

interface Props {
  /** Title node rendered inside the header (e.g. "⚙ Intermediates"). */
  title: React.ReactNode
  /** Optional right-aligned chip (e.g. count badge "16" or "0/20"). */
  badge?: React.ReactNode
  /** Outer panel testid — mirrors what the old impls used. */
  testId?: string
  /** Whether the panel starts collapsed. Defaults to true. */
  defaultCollapsed?: boolean
  /**
   * Extra classes appended to the content wrapper. The base is
   * `px-3 py-2 border-t border-border`; callers append spacing utilities
   * like `space-y-3` when needed.
   */
  contentClassName?: string
  /** Panel content; rendered inside the aria-controls'd region. */
  children: React.ReactNode
}

export function CollapsiblePanel({
  title,
  badge,
  testId,
  defaultCollapsed = true,
  contentClassName,
  children,
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const panelId = useId()
  const contentClass =
    "px-3 py-2 border-t border-border" + (contentClassName ? ` ${contentClassName}` : "")

  return (
    <div data-testid={testId} className="text-xs bg-card border border-border rounded">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30"
        aria-expanded={!collapsed}
        aria-controls={panelId}
      >
        <span className="font-medium uppercase tracking-wide text-[10px] opacity-80">
          {title}
        </span>
        <span className="flex items-center gap-2">
          {badge}
          <span className="opacity-60" aria-hidden="true">
            {collapsed ? "▸" : "▾"}
          </span>
        </span>
      </button>
      {!collapsed && (
        <div id={panelId} className={contentClass}>
          {children}
        </div>
      )}
    </div>
  )
}
