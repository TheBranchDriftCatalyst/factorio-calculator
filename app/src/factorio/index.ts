// Public API for the Factorio catalog module.
//
// Flow:
//   raw JSON (Kirk's dataset)
//     → loadCatalog(raw)            ← in catalog.ts
//     → Catalog                     ← typed in types.ts
//   The rest of the app touches only this `Catalog`.
//
// Static data lives under ./data/:
//   - sizes.json     (vendored from factoriolab — building footprints)
//   - overrides.ts   (hand-authored — inserter reaches, fluid connections)
//
// Refresh instructions: see README.md.

export { loadCatalog } from "./catalog"
export type {
  Belt,
  Catalog,
  Direction,
  FluidConnection,
  FluidRole,
  Inserter,
  Item,
  KirkRawDataset,
  Machine,
  Module,
  Recipe,
  Size,
  SpriteSheet,
  Tile,
} from "./types"
