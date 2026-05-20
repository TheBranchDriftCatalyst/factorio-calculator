// Figma/Tldraw-style camera: cursor-anchored zoom, wheel-pan, space-hold drag.
//
// The camera lives in CSS pixel space. The viewport is the OUTER div; the
// transformed inner div renders the world. Zoom is anchored at the cursor
// position (relative to the viewport), so the world point under the cursor
// stays put as scale changes.
//
// Wheel handling note: React's `onWheel` JSX prop attaches a *passive*
// listener, so calling `preventDefault()` inside it is silently dropped and
// the browser still page-zooms on ctrl+wheel. We bypass this by attaching
// the wheel handler imperatively with `{ passive: false }` via the returned
// `viewportRef`.

import { useCallback, useEffect, useRef, useState } from "react"
import type React from "react"

export interface Camera {
  x: number
  y: number
  scale: number
}

export interface UseCameraResult {
  camera: Camera
  transform: string
  isPanning: boolean
  /** Attach to the viewport element so we can install a non-passive wheel listener. */
  viewportRef: React.RefObject<HTMLDivElement | null>
  onMouseDown: (e: React.MouseEvent) => void
  onMouseMove: (e: React.MouseEvent) => void
  onMouseUp: (e: React.MouseEvent) => void
  reset: () => void
  fit: (contentW: number, contentH: number, viewportW: number, viewportH: number) => void
}

const MIN_SCALE = 0.25
const MAX_SCALE = 4
const ZOOM_SENSITIVITY = 0.005

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

export function useCamera(): UseCameraResult {
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 })
  const [isPanning, setIsPanning] = useState(false)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  // Refs hold transient interaction state without forcing re-renders.
  const spaceDownRef = useRef(false)
  const draggingRef = useRef(false)
  const lastPosRef = useRef<{ x: number; y: number } | null>(null)

  // Track Space key globally so user can hold it anywhere then drag the viewport.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Avoid hijacking Space inside form inputs.
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return
      if (e.code === "Space") {
        spaceDownRef.current = true
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceDownRef.current = false
        // If we were mid-drag with space, release.
        if (draggingRef.current) {
          draggingRef.current = false
          setIsPanning(false)
        }
      }
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [])

  // Non-passive wheel listener — required so preventDefault() actually
  // suppresses the browser's page-zoom on ctrl+wheel and rubber-band on
  // touchpads. React's `onWheel` prop registers a passive listener.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      setCamera((prev) => {
        if (e.ctrlKey || e.metaKey) {
          const factor = 1 - e.deltaY * ZOOM_SENSITIVITY
          const newScale = clamp(prev.scale * factor, MIN_SCALE, MAX_SCALE)
          if (newScale === prev.scale) return prev
          const ratio = newScale / prev.scale
          return {
            x: mouseX - (mouseX - prev.x) * ratio,
            y: mouseY - (mouseY - prev.y) * ratio,
            scale: newScale,
          }
        }
        return { ...prev, x: prev.x - e.deltaX, y: prev.y - e.deltaY }
      })
    }
    el.addEventListener("wheel", handler, { passive: false })
    return () => el.removeEventListener("wheel", handler)
  }, [])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Middle button OR space-held left button starts a grab-pan.
    const isMiddle = e.button === 1
    const isSpacePan = e.button === 0 && spaceDownRef.current
    if (isMiddle || isSpacePan) {
      e.preventDefault()
      draggingRef.current = true
      setIsPanning(true)
      lastPosRef.current = { x: e.clientX, y: e.clientY }
    }
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingRef.current || !lastPosRef.current) return
    const dx = e.clientX - lastPosRef.current.x
    const dy = e.clientY - lastPosRef.current.y
    lastPosRef.current = { x: e.clientX, y: e.clientY }
    setCamera((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }))
  }, [])

  const onMouseUp = useCallback((_e: React.MouseEvent) => {
    if (draggingRef.current) {
      draggingRef.current = false
      setIsPanning(false)
      lastPosRef.current = null
    }
  }, [])

  const reset = useCallback(() => {
    setCamera({ x: 0, y: 0, scale: 1 })
  }, [])

  const fit = useCallback(
    (contentW: number, contentH: number, viewportW: number, viewportH: number) => {
      if (contentW <= 0 || contentH <= 0 || viewportW <= 0 || viewportH <= 0) {
        setCamera({ x: 0, y: 0, scale: 1 })
        return
      }
      const raw = Math.min(viewportW / contentW, viewportH / contentH) * 0.95
      const scale = clamp(raw, MIN_SCALE, MAX_SCALE)
      const x = (viewportW - contentW * scale) / 2
      const y = (viewportH - contentH * scale) / 2
      setCamera({ x, y, scale })
    },
    [],
  )

  const transform = `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.scale})`

  return {
    camera,
    transform,
    isPanning,
    viewportRef,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    reset,
    fit,
  }
}
