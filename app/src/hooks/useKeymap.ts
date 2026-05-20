import { useEffect } from "react"

export type KeymapActions = Record<string, () => void>

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if (target.isContentEditable) return true
  return false
}

export function useKeymap(actions: KeymapActions): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return

      const key = e.key.toLowerCase()
      const binding = [
        e.ctrlKey ? "ctrl+" : "",
        e.metaKey ? "meta+" : "",
        e.shiftKey ? "shift+" : "",
        e.altKey ? "alt+" : "",
        key,
      ].join("")

      const modified = e.ctrlKey || e.metaKey || e.shiftKey || e.altKey

      if (actions[binding]) {
        e.preventDefault()
        actions[binding]()
        return
      }

      if (!modified && actions[key]) {
        e.preventDefault()
        actions[key]()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [actions])
}
