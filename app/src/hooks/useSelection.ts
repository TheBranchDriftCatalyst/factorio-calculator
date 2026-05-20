// Figma-style click-to-pin selection over a set of string keys.
//
// - plain click           → replace selection with {key}
// - shift+click           → add to selection
// - meta/ctrl+click       → toggle (add if absent, remove if present)
// - Escape (global)       → clear selection
//
// Callers track their own "hover" state — this hook is purely about the
// persistent pinned selection.

import { useCallback, useEffect, useMemo, useState } from "react"

export interface UseSelectionResult {
  selected: Set<string>
  isSelected: (key: string) => boolean
  onClickCell: (
    key: string,
    e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) => void
  clear: () => void
}

export function useSelection(): UseSelectionResult {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const clear = useCallback(() => {
    setSelected((prev) => (prev.size === 0 ? prev : new Set()))
  }, [])

  const onClickCell = useCallback(
    (key: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
      setSelected((prev) => {
        if (e.shiftKey) {
          if (prev.has(key)) return prev
          const next = new Set(prev)
          next.add(key)
          return next
        }
        if (e.metaKey || e.ctrlKey) {
          const next = new Set(prev)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        }
        // Plain click: replace.
        if (prev.size === 1 && prev.has(key)) return prev
        return new Set([key])
      })
    },
    [],
  )

  // Global Escape clears.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const target = e.target as HTMLElement | null
        const tag = target?.tagName
        // Don't fight inputs / textareas / contenteditable.
        if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return
        clear()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [clear])

  const isSelected = useCallback((key: string) => selected.has(key), [selected])

  return useMemo(
    () => ({ selected, isSelected, onClickCell, clear }),
    [selected, isSelected, onClickCell, clear],
  )
}
