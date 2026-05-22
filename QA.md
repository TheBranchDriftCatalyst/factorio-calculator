# Factorio Blueprint Calculator — QA Inventory

This document enumerates all user-facing functionality so we can design a
test pyramid (unit → integration → e2e) against it. Review and trim before
we start writing tests. Mark each item with **U** (unit), **I** (integration),
**E** (e2e), or **—** (skip).

> Conventions
> - File paths are rooted at `app/`.
> - "Testid" refers to the `data-testid` attribute on the rendered element.
> - "Existing" = item is already covered by `app/test/`.

---

## 1. Global Header / HUD
- App title strip — "Factorio Blueprint Calculator" with amber underline · `src/App.tsx`
- HUD ticker (status bar) — primary target + count, power MW, top-4 raw rates, cell/flow counts, dataset name · `src/components/HudStrip.tsx`

## 2. Targets / Outputs (`src/views/TargetPicker.tsx`, testid: `target-picker`) **(existing integration coverage)**
- `+ Add target` — appends row with first unused item (testid: `target-add`)
- Per row:
  - Item combobox with fuzzy search (`target-item-{i}`, `target-item-{i}-dropdown`)
  - Rate/Machines mode toggle (`target-mode-{i}-rate|machines`)
  - Numeric rate input (`target-rate-{i}`)
  - Per-row unit toggle /s · /min · /hr (`target-rate-unit-{i}-sec|min|hr`)
  - Remove button — disabled when only 1 target (`target-remove-{i}`)

## 3. Inputs / Supplied Inputs (`src/views/InputPicker.tsx`, testid: `input-picker`)
- `+ Add input`
- Empty state: "No supplied inputs..." (testid: `inputs-empty`)
- Per row: item combobox, rate input, unit toggle, remove (`input-{kind}-{i}`)

## 4. Tab Navigation (`src/App.tsx`)
- Four tabs: Sankey / BoxLine / Schematic / Catalog (`tab-{name}`)
- Keyboard `1` / `2` / `3` / `4`
- URL hash mirror (`#/sankey` etc.); survives reload

## 5. Sankey View (`src/views/SankeyView.tsx`, testid: `sankey-svg`) **(existing e2e)**
- D3 sankey, color-coded node pills (recipe vs source/output)
- Lane labels with item icon + rate (rate format `\d+\.\d+/s`)
- Hover tooltips on node + link
- Drag-to-reorder nodes vertically within column

## 6. BoxLine View (`src/views/BoxLineView.tsx`, testid: `boxline-svg`) **(existing e2e)**
- Boxes + curved connector edges
- Orientation toggle LR vs TB (`boxline-orient-lr|tb`)
- Drag node to reposition; edges re-route
- Edge labels: rate + item name

## 7. Schematic — Canvas (`src/views/SchematicView.tsx`)
- Viewport (testid: `schematic-viewport`), canvas (`schematic-canvas`)
- CSS grid background that tracks camera transform (extends full viewport)
- Camera (`src/hooks/useCamera.ts`):
  - Pan: Space + drag, middle-click drag
  - Zoom: Cmd/Ctrl + wheel (cursor-anchored)
  - `F` — fit to selection or whole blueprint
  - `0` — reset camera
  - Camera hint badge (testid: `camera-hint`)
- Cell click → pin (Shift / Cmd for multi-select)
- Lane click → pin lane (inspector below)
- Hover → ephemeral inspector preview
- `Escape` clears selection
- Bottleneck mode (`B` key):
  - Top-right badge (testid: `bottleneck-badge`)
  - Bottom-right color legend (testid: `bottleneck-legend`)
- Blueprint stats line above viewport: cell/group/belt/inserter counts + W×H
- Unsupported-recipe warning (amber count if fallback footprints used)

## 8. Schematic — Topology Panel (`src/views/schematic/TopologyPanel.tsx`)
- Collapsible header (testid: `topology-panel`)
- Belt group:
  - Belt tier select (yellow/red/blue/turbo) — `tf-beltTier`
  - Belt spacing slider 0–3
  - Belt width slider 1–4
  - Belts per block 2–8
  - Min trunk consumers 2–6
  - Max sub-bus depth 1–6
  - Output bus segmented: left / split
- Layout group:
  - Cell gap 0–4
  - Group gap 1–6
  - Mark crossings toggle (now wired)
- Display group:
  - Zoom 8–36 px/tile (`tf-zoom`)
  - Bottleneck mode toggle (`tf-bottleneckMode`)

## 9. Schematic — Recipes Panel (`src/views/schematic/RecipePicker.tsx`, testid: `recipe-picker`)
- Only renders when flow has items with multiple recipes (recycling filtered out)
- Pinned-count badge in header
- Per row: item name + dropdown ("default" or recipe key) — `recipe-choice-{item}`

## 10. Schematic — Default Machines (`src/views/schematic/MachineCategoryPicker.tsx`, testid: `machine-category-picker`)
- Per-category default machine picker
- Dropdown options include "fastest (auto)" + compatible machines — `category-default-{category}`

## 11a. Schematic — BOM Panel (`src/views/schematic/BomPanel.tsx`, testid: `bom-panel`)
- "Bill of materials" — what to take into Factorio to build this schematic
- Header badge: `{machines}M · {belts}B · {inserters}I`
- Machines section: per-machine row with icon, name, kW total, ceil count — testid `bom-machine-{key}`
- Transport section:
  - Belt tiles split per tier (yellow/red/blue/turbo), highest-tier override wins per belt — testid `bom-belts-{tier}`
  - Inserter total — testid `bom-inserters`
- Hidden when flow is empty (no machines and no belts)

## 11b. Schematic — Fuels Panel (`src/views/schematic/FuelsPanel.tsx`, testid: `fuels-panel`)
- Lists every catalog item with positive `fuelValue` + `fuelCategory`
- Header badge: `{used}/{known}` (used fuels / total known fuels)
- Columns: Fuel / Energy (MJ) / Burn rate / Burners
- For burner-consuming recipes in the flow: shows burn rate (items/sec attributed via shared `fuelCategory`) + number of burner machines
- Unused fuels dimmed (`opacity: 0.5`) — listed alphabetically after used ones
- Row testid: `fuel-{itemKey}`
- Hidden when catalog has no fuel items

## 11. Schematic — Intermediates Panel (`src/views/schematic/IntermediatesPanel.tsx`, testid: `intermediates-panel`)
- Lists items with both produced + consumed > 0, plus structurally-forced byproducts (multi-product recipes whose surplus needs a sink)
- Columns: Item / Prod / Cons / Status
- Row testids: `intermediate-{item}`; status badge testid `intermediate-{item}-status` with `data-state={ok|surplus|byproduct|deficit}`
- Status color-coded:
  - `ok` green (≈0 leftover)
  - `surplus` amber (single-product ceil-overshoot)
  - `byproduct` cyan (multi-product forced surplus — actionable, needs a sink)
  - `deficit` red (defensive — shouldn't occur after balanceCeil)
- Clicking a row highlights the item on the canvas; clicking again clears (Enter/Space also fire)

## 12. Schematic — Lane Inspector (testid: `lane-inspector`)
- Header: "Lane · Left/Right sub-lane"
- Item, rate, utilization badge (color + label)
- Effective tier indicator
- Belt tier override dropdown (`lane-belt-tier-override`)
- Bus assignment dropdown: Default / Left / Right / existing L#/R# / `+ new left bus (L#)` / `+ new right bus (R#)`
- Producers + Consumers tables (cell → rate)
- Clear / `Esc` to deselect

## 13. Schematic — Cell Inspector (testid: `cell-inspector`)
- Empty state (`cell-inspector-empty`)
- Hover preview (not pinned)
- Pinned single cell: recipe + machine count + power + I/O lists
- I/O shape row (testid: `cell-io-shape`) — shows the recipe's I/O shape label, e.g. `I/O 2:1` (2 inputs → 1 output, no fluids) or `I/O 2:3 (fluids: 2→3)` (suffix appears only when fluids are present on either side)
- Multi-select: count + distinct recipe rollup

## 14. Schematic — Sidebar Resize Handle (testid: `sidebar-resize-handle`)
- `role="separator"`, `aria-orientation="vertical"`, `aria-label="Resize right sidebar"`
- Drag to resize sidebar [240..720] px, default 320
- Keyboard-operable (per WAI-ARIA separator pattern):
  - `ArrowLeft` / `ArrowRight` — nudge 16px
  - `Shift + ArrowLeft/Right` — nudge 64px
  - `Home` — jump to max
  - `End` — jump to min
- `aria-valuenow` / `aria-valuemin` / `aria-valuemax` reflect current/configured bounds
- Persists to `schematic.sidebarWidth.v1`

## 15. Schematic — Direct Connections (new, no testid yet)
- 1 producer + 1 consumer in scope → 1-tile vertical segment instead of bus column
- Same (from, to) pair → 2-lane shared segment
- Label pill: item icon + rate at segment midpoint
- Segment fed by W-perimeter inserters at both endpoints

## 16. Schematic — Belt Truncation (new)
- Each belt's `y0..y1` ends at last consumer (final outputs extend to bottom)
- Icon strip + rotated labels clamp to truncated extent

## 17. Catalog View (`src/App.tsx`, testid: `catalog-summary`) **(existing e2e)**
- Read-only stat table: items / recipes / machines / etc.

## 18. Command Palette (`src/components/CommandPalette.tsx`, testid: `command-palette`)
- Trigger: ⌘K, Ctrl+K, `?`
- Commands: switch tab (1–4), set rate unit /s /min /hr, add target, show shortcuts

## 19. Profile Sidebar (`src/views/profiles/ProfileSidebar.tsx`, testid: `profile-sidebar-root`)
- Hover-trigger strip on left edge (`profile-sidebar-trigger`)
- Drawer slides in (`profile-sidebar-drawer`)
- Add profile flow: trigger → input → save / cancel (`profile-add-*`)
- Per row: name + target count + delete (`profile-row-{id}`, `profile-delete-{id}`)
- Empty state message

## 20. Persistence (localStorage)
- `fbp.targets.v1` — targets array
- `fbp.inputs.v1` — inputs array
- `fbp.machineOverrides.v1` — per-cell machine override map (owned by App, feeds solver)
- `fbp.recipeChoices.v1` — per-item recipe choice map (owned by App, feeds solver)
- `fbp.machineCategoryDefaults.v1` — per-category default machine map (owned by App, feeds solver)
- `schematic.config.v1` — view-only schematic knobs (zoom, beltSpacing, beltOverrides, beltAssignments, bottleneckMode, etc.). No longer carries machineOverrides / recipeChoices / machineCategoryDefaults — those got hoisted to App and live under their own keys.
- `schematic.sidebarWidth.v1` — sidebar px
- `fbp.profiles.v1` — saved profiles
- `theme:name`, `theme:variant` — theme
- URL hash — active tab
- Cross-tab sync: standard `storage` events on each of the dedicated keys above. The legacy `SCHEMATIC_CONFIG_EVENT` CustomEvent was removed when solver-relevant config was hoisted into App; same-tab updates flow through React state directly.
- Migration: on first mount App calls `loadLegacyOverrides()` ONCE to seed machineOverrides / recipeChoices / machineCategoryDefaults from any pre-existing `schematic.config.v1` blob, so prior persisted choices survive the hoist.

## 21. Theme System
- Themes: catalyst (light/dark), others?
- Boot-time pre-seed via localStorage (covered in e2e setup)

## 22. Global Keyboard Shortcuts (consolidated)
| Key | Scope | Action |
|---|---|---|
| 1/2/3/4 | global | switch tab |
| ⌘K / Ctrl+K / ? | global | command palette |
| F | schematic | fit to content |
| 0 | schematic | reset camera |
| B | schematic | bottleneck mode |
| Space + drag | schematic | pan |
| Cmd/Ctrl + wheel | schematic | zoom |
| Esc | schematic | clear selection |

## 23. Solver Web Worker (`src/solver/expand.worker.ts`, `src/solver/expandClient.ts`)
- `expand()` runs off the main thread via a Vite-native Web Worker so input typing / canvas painting stay smooth on big factories
- Catalog is hydrated ONCE per dataset via a `hydrate` postMessage and stashed at worker module scope; subsequent `solve` messages carry only `targets` / `inputs` / `machineOverrides` / `recipeChoices` / `machineCategoryDefaults`
- Request IDs (`nextId`) gate replies — stale responses from older in-flight requests are discarded so fast typing doesn't render a stale flow
- Fallback: if `new Worker()` throws or the worker emits an `error` event, `solveExpand()` runs `expand()` on the main thread; pending requests are rejected so callers don't hang
- Test-only `_resetExpandWorker()` teardown for unit/integration suites

## 24. Shared CollapsiblePanel Component (`src/components/CollapsiblePanel.tsx`)
- Single shell used by all 5 right-rail panels: BOM, Fuels, Intermediates, Machine Category, Topology
- `aria-expanded` on the header button; content region has matching `id` and `aria-controls`
- Chevron is `aria-hidden="true"` (decorative only — state is conveyed by aria-expanded)
- `defaultCollapsed` defaults to true; caller passes `testId`, `title`, optional `badge`, optional `contentClassName`

## 25. App-level Contexts (`src/factorio/CatalogContext.tsx`, `src/util/RateUnitContext.tsx`)
- `CatalogProvider` / `useCatalog()` — read-only `Catalog` provided at App level after loading completes. Right-rail panels consume the catalog via the hook rather than prop-drilling.
- `RateUnitProvider` / `useRateUnit()` — active rate-display unit (`sec` / `min` / `hr`). Threaded into BOM / Fuels / Intermediates / Lane / Cell inspectors via the hook.
- Both hooks throw when called outside their provider so misconfiguration is a stack trace, not a silently-wrong render.

---

## Existing Test Coverage
- **Unit (`app/test/unit/`)** — 57 tests
  - `solver.test.ts` — 18 tests · `expand()` with recipe choices, machine overrides, category defaults
  - `busLayout.test.ts` — 20 tests · cells, belts, ports, groups, direct connections
  - `catalog.test.ts` — 9 tests · catalog loader, fluid detection, item icon merge
  - `ioShape.test.ts` — 10 tests · I/O shape classification + label formatting
- **Integration (`app/test/integration/`)** — 5 tests
  - `target-picker.test.tsx` — add/remove/change item/rate/mode/unit
- **E2E (`app/test/e2e/`)** — 30 tests
  - `app.spec.ts` — 11 tests · boot, theme, catalog stats, sankey/boxline/catalog render, target/combobox flows, icon rendering, schematic canvas + cell inspector, zoom resize
  - `qa-coverage.spec.ts` — 11 tests · recipe picker, default machine picker, intermediates panel (incl. byproduct state), sidebar resize, command palette, bottleneck toggle, profile save/load
  - `schematic-deliverable.spec.ts` — 8 tests · cross-view schematic deliverables (BOM/fuels/intermediates, pinned cell/lane, bottleneck mode, rate units, layouts)
- Test artifacts (screenshots, traces) live in `app/test/e2e/_artifacts/` — not the old `__screenshots__/` directory.

## Coverage Gaps (high priority for new tests)
1. Multi-bus assignment (Default/Left/Right/L#/R#/+new variants) — no test
2. Direct connections rendering + label content — no test
3. Belt truncation `y0`/`y1` invariant (each belt ends at last consumer; final outputs extend to bottom) — no test
4. Lane inspector belt-tier override end-to-end — the dropdown change must propagate to the utilization badge / effective tier indicator; no test
5. Bottleneck-mode color BUCKETS per lane — we have a toggle test, not bucket-color assertions
6. Profile delete + empty state — only save/load roundtrip is covered
7. `InputPicker` — no integration coverage (only `TargetPicker` has it)
8. `useCamera` hook math (pan/zoom transforms, fit-to-content) — no unit test
9. Cross-tab config sync — no test that opens two pages and verifies `storage` event propagation across the dedicated keys
10. I/O shape row in Cell Inspector (`cell-io-shape`) — just landed, no E2E assertion
11. Web Worker fallback path — no test for what happens when worker init fails and `expand()` runs on the main thread
