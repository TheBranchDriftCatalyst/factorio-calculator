// Rotates the browser tab favicon between a fixed set of variants.
//
// Why: the 4 favicon candidates (tl/tr/bl/br quadrants of the source
// composite) each look fine on their own; cycling them at a slow
// pulse gives the tab a subtle "alive" feel without flicker.
//
// Cadence: PAUSE_MS between swaps. Slow enough that it's not
// distracting; fast enough that switching back to the tab almost
// always shows a different frame.
//
// Lifecycle: starts immediately on import (via the side effect at
// the bottom). Stops automatically when the tab becomes hidden
// (visibilitychange → resumes on visible) to avoid burning CPU on
// background tabs. Honors prefers-reduced-motion — if the OS asks
// for less motion, we lock to the first frame and skip the timer
// entirely.

// Paths are RELATIVE to the deployed base (Vite serves the app under
// /app/ in dev and on GH Pages). `import.meta.env.BASE_URL` gives us
// that prefix at build time so the favicons resolve correctly in
// both environments without hard-coded "/app/".
//
// We rotate the 64-px variants — large enough that browsers don't
// alias them down to mush in pinned tabs, small enough that the
// network swap is instant. The static <link> tags in index.html
// supply additional 32/128 sizes as fallback context for the
// browser's icon picker.
const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/?$/, "/")
const FRAMES: ReadonlyArray<string> = [
  `${BASE}favicon-tl-64.png`,
  `${BASE}favicon-tr-64.png`,
  `${BASE}favicon-br-64.png`,
  `${BASE}favicon-bl-64.png`, // clockwise order
]
// 6s is a slow, breathing cadence — fast enough to be noticed but
// well past the "is this animating?" threshold where users squint at
// the tab. 2.5s was too snappy and read as a glitch.
const PAUSE_MS = 6000
const LINK_ID = "app-favicon"

let timer: number | null = null
let frame = 0

function applyFrame(): void {
  if (typeof document === "undefined") return
  const link = document.getElementById(LINK_ID) as HTMLLinkElement | null
  if (!link) return
  link.href = FRAMES[frame]
}

function advance(): void {
  frame = (frame + 1) % FRAMES.length
  applyFrame()
}

function start(): void {
  if (timer != null) return
  timer = window.setInterval(advance, PAUSE_MS)
}

function stop(): void {
  if (timer == null) return
  window.clearInterval(timer)
  timer = null
}

export function initRotatingFavicon(): void {
  if (typeof window === "undefined") return
  // Respect reduced-motion. Reads once at startup — users who
  // change the preference mid-session need to reload, which is
  // fine for a favicon.
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  if (reduced) {
    applyFrame() // pin frame 0 explicitly
    return
  }
  applyFrame()
  start()
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop()
    else start()
  })
}
