// Belt packing — shared between bus-tree and interleaved layouts.
//
// Takes a list of (item, rate) pairs and packs them into 2-lane belts:
// solids pair up (one item per lane), fluids get their own pipe
// (Factorio fluids can't share a pipe). Belts are spaced + grouped
// per the LayoutConfig knobs so the user can tune density.

import type { BusBelt, BusLane } from "../types"

export interface PackResult {
  belts: BusBelt[]
  /** First tile column AFTER the last belt — the "gutter" where inserters go. */
  gutterX: number
  /** Lookup: item → absolute X column of its belt. */
  beltXByItem: Map<string, number>
}

/** Pack items into 2-lane vertical belt columns starting at `startX`. */
export function packBeltsAt(
  items: Array<[string, number]>,
  beltGroupSize: number,
  beltSpacing: number,
  beltWidth: number,
  startX: number,
  isFluid: (item: string) => boolean = () => false,
): PackResult {
  const belts: BusBelt[] = []
  const beltXByItem = new Map<string, number>()
  let cursorX = startX
  let beltsInGroup = 0
  // Sort: solid items first (they can pair up), then fluids (single-lane).
  const solids: Array<[string, number]> = []
  const fluids: Array<[string, number]> = []
  for (const it of items) (isFluid(it[0]) ? fluids : solids).push(it)
  const placeBelt = (laneA: BusLane, laneB?: BusLane) => {
    if (beltsInGroup > 0 && beltsInGroup % beltGroupSize === 0) {
      cursorX += 1
      beltsInGroup = 0
    }
    belts.push({ x: cursorX, laneA, laneB })
    beltXByItem.set(laneA.item, cursorX)
    if (laneB) beltXByItem.set(laneB.item, cursorX)
    cursorX += beltWidth + beltSpacing
    beltsInGroup += 1
  }
  for (let i = 0; i < solids.length; ) {
    const laneA: BusLane = { item: solids[i][0], rate: solids[i][1] }
    const laneB: BusLane | undefined =
      i + 1 < solids.length ? { item: solids[i + 1][0], rate: solids[i + 1][1] } : undefined
    placeBelt(laneA, laneB)
    i += laneB ? 2 : 1
  }
  for (const f of fluids) {
    placeBelt({ item: f[0], rate: f[1], isFluid: true })
  }
  return { belts, gutterX: cursorX, beltXByItem }
}
