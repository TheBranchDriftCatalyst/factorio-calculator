// Hand-authored overrides for data NOT present in factoriolab's data.json.
// All values are in Factorio convention: entity-center-relative tile coords,
// integer or half-integer. Direction is the side of the entity the connection
// faces (default North orientation).
//
// Source of truth for refresh: https://github.com/wube/factorio-data
//   base/prototypes/entity/entities.lua
//   space-age/prototypes/entity/entities.lua
//
// Keep this file small and surgical — only entries that can't be derived.

import type { FluidConnection, Tile } from "../types"

// Inserter pickup/drop tile offsets (relative to inserter origin, N orientation).
// All vanilla + Space Age inserters are 1×1.
export const INSERTER_REACH: Readonly<Record<string, { pickup: Tile; drop: Tile }>> = {
  "burner-inserter": { pickup: [1, 0], drop: [-1, 0] },
  inserter: { pickup: [1, 0], drop: [-1, 0] },
  "fast-inserter": { pickup: [1, 0], drop: [-1, 0] },
  "bulk-inserter": { pickup: [1, 0], drop: [-1, 0] },
  "filter-inserter": { pickup: [1, 0], drop: [-1, 0] },
  "long-handed-inserter": { pickup: [2, 0], drop: [-2, 0] },
  "stack-inserter": { pickup: [1, 0], drop: [-1, 0] },
}

// Pipe connection positions per machine key. Only entries with fluid I/O.
// Positions match wube/factorio-data fluid_box.pipe_connections[].position
// (entity-center origin). Direction is the cardinal side of the entity.
export const FLUID_CONNECTIONS: Readonly<Record<string, ReadonlyArray<FluidConnection>>> = {
  "assembling-machine-2": [
    { position: [0, -1], direction: "north", role: "input-output" },
    { position: [0, 1], direction: "south", role: "input-output" },
  ],
  "assembling-machine-3": [
    { position: [0, -1], direction: "north", role: "input-output" },
    { position: [0, 1], direction: "south", role: "input-output" },
  ],
  "chemical-plant": [
    { position: [-1, -1], direction: "north", role: "input" },
    { position: [1, -1], direction: "north", role: "input" },
    { position: [-1, 1], direction: "south", role: "output" },
    { position: [1, 1], direction: "south", role: "output" },
  ],
  "oil-refinery": [
    { position: [-1, 2], direction: "south", role: "input" },
    { position: [1, 2], direction: "south", role: "input" },
    { position: [-2, -2], direction: "north", role: "output" },
    { position: [0, -2], direction: "north", role: "output" },
    { position: [2, -2], direction: "north", role: "output" },
  ],
  pumpjack: [{ position: [1, -1], direction: "north", role: "output" }],
  "offshore-pump": [{ position: [0, 1], direction: "south", role: "output" }],
  boiler: [
    { position: [-1, 0], direction: "west", role: "input" },
    { position: [1, 0], direction: "east", role: "output" },
  ],
  // TODO(phase-1): foundry, biochamber, electromagnetic-plant, cryogenic-plant
}
