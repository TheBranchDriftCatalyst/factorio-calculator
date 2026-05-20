# Phases

## Phase 0 — Foundation (shipped)

- New Vite + React 19 + TS + Tailwind v4 app at `./app/`
- `factorio/` catalog module: single point of translation from Kirk's raw dataset to typed `Catalog`
  - 30 building footprints (vendored from factoriolab)
  - 7 inserter reaches + 7 fluid-connection layouts (hand-authored)
  - Sprite sheet metadata for icon rendering
- Phase-0 solver: recursive flow-graph expander for multi-target, multi-recipe DAGs (no oil cracking yet)
- Sankey view (d3-sankey), BoxLine view (D3, custom)
- catalyst-ui from npm (`@thebranchdriftcatalyst/catalyst-ui@^2.1.1`)

## Phase 0.5 — UI polish + tests (shipped)

- Multi-target input list (add/remove/edit per-row rates)
- cmdk fuzzy-search ItemCombobox with icon + name + `category · machine` subtitle
- Catalyst-ui properly integrated (`ThemeProvider`, dark default, `Card`/`Tabs`/`Button`/`Input`)
- Sankey enhancements: lane rate labels, machine counts, top-anchored node labels, vertical drag
- BoxLine enhancements: LR/TB orientation toggle, free drag, edge rate labels
- Test pyramid: 18 unit + 5 integration + 9 E2E = **32 tests**

## Phase 1 — Blueprint schematic (in progress, narrowed)

**Original plan**: rectangle packing + Manhattan A* belt routing + power poles + beacon coverage + module math in solver.

**Council ruling** (see [council-phase-1.md](./council-phase-1.md)): the original plan was unanimously flagged as wrong-shaped. Phase 1 is now:

### Phase 1.A — Visual MVP (shipped, iterating)

Fourth tab alongside Sankey + BoxLine + Catalog. Schematic renders a main-bus blueprint of the solver's flow graph.

**Layout primitives:**
- **Trunk bus** at the top: items consumed by ≥2 downstream recipes go on 2-lane belts here.
- **Sub-bus groups** stacked vertically below: items consumed by exactly 1 downstream recipe go on the consumer-group's own local 2-lane bus, rendered with the same style INSIDE the group frame.
- Each group identified via union-find on local-item edges (recipe-to-recipe chains of single-consumer items).
- Each group has its own local gutter row with local inserters.
- Trunk gutter row has trunk inserters.

**Render details (`CanvasTiles.tsx`):**
- 2-lane belts with item-colored sublanes + flow arrows
- Inserter glyphs (sky-ring ▼ = input, amber-ring ▲ = output, inner dot = item color)
- Per-port drop lines (solid input, dashed output), colored by item
- Throughput badges per cell (total output items/s)
- Cell hover highlight (thicker cyan border)
- Configurable tile size via ± zoom controls
- Group frame: violet dashed border + label "sub-bus · N local items · M cells"

**Test pyramid total: 54 tests passing** (43 unit/integration + 11 E2E).

Verified:
- Green-circuit (1 group, 0 trunk belts, 6 local items, all in one sub-bus).
- Advanced circuit (2 vertically-stacked groups, 1 trunk belt).
- Processing unit (5 vertically-stacked groups, 6 trunk belts, 57 flows).

### Phase 1.B — Tests + Worker (after MVP lands)

- Property-based: no overlapping machines, every belt port connects
- Golden snapshots for 5 canonical recipes
- CI perf budget (`<150 ms` per layout)
- Move layout off the main thread into a Web Worker (per Seat 4: retrofitting is painful)

### Phase 1.C — Blueprint-string export (deferred; re-evaluate after MVP)

The original "does the output paste into Factorio 2.0?" thesis was deferred at the user's call — we validate via visual MVP first, then decide whether the blueprint-string export is the unlock or whether the schematic alone is enough.

## Explicitly deferred (Phase 2+)

| What | Why deferred | Council reference |
|---|---|---|
| Free rectangle packing | Council unanimously: wrong primitive. Use bus template instead. | Seats 1, 2 |
| A\* belt routing with ripup/reroute | Phase 1.A uses straight-lane drops only | Seats 1, 4 |
| Pipe Steiner tree + pump segments | Pipes ≠ belts; separate algorithmic problem | Seats 1, 2 |
| Power-pole + beacon coverage | Coupled second optimization (max-coverage set cover) | Seats 1, 2, 4 |
| Modules + beacons in solver math | Package deal with beacon-row layout | Seats 1, 2 |
| Multi-output recipe choice (oil cracking) | Solver-only PR, no visual component, separate work | Seat 4 |
| City-block archetype | Phase 3+ if main-bus ships well | Seat 2 |
| Tile-perfect game-accurate render | Council: "worst stool" between schematic and importable | Seats 2, 3 |
