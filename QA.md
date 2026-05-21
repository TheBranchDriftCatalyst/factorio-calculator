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

## 11. Schematic — Intermediates Panel (`src/views/schematic/IntermediatesPanel.tsx`, testid: `intermediates-panel`)
- Lists items with both produced + consumed > 0
- Columns: Item / Prod / Cons / Net
- Net color-coded (green ≈0, amber surplus, red deficit)

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
- Multi-select: count + distinct recipe rollup

## 14. Schematic — Sidebar Resize Handle (testid: `sidebar-resize-handle`)
- Drag to resize sidebar [240..720] px, default 320
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
- `schematic.config.v1` — all schematic knobs (incl. machineOverrides, beltOverrides, recipeChoices, machineCategoryDefaults, beltAssignments)
- `schematic.sidebarWidth.v1` — sidebar px
- `fbp.profiles.v1` — saved profiles
- `theme:name`, `theme:variant` — theme
- URL hash — active tab
- Cross-tab sync via storage events; same-tab via `SCHEMATIC_CONFIG_EVENT` CustomEvent

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

---

## Existing Test Coverage
- **Unit (`app/test/unit/`)**
  - `catalog.test.ts` — catalog loader, fluid detection, item icon merge
  - `solver.test.ts` — `expand()` with recipe choices, machine overrides, category defaults
  - `busLayout.test.ts` — 20 tests covering cells, belts, ports, groups, direct connections
- **Integration (`app/test/integration/`)**
  - `target-picker.test.tsx` — add/remove/change item/rate/mode/unit
- **E2E (`app/test/e2e/`)**
  - `app.spec.ts` — boot, theme, catalog stats, sankey/boxline/catalog render, add second target, combobox search, remove target, icon rendering, schematic canvas + cell inspector, zoom slider resizes canvas

## Coverage Gaps (high priority for new tests)
1. Multi-bus assignment (Default/Left/Right/L#/R#/+new variants) — no test
2. Direct connections + label rendering — no test
3. Belt truncation y0/y1 — no test
4. Recipe picker — no test
5. Default machine picker — no test
6. Intermediates panel — no test
7. Lane inspector belt-tier override — no test
8. Sidebar resize — no test
9. Command palette — no test
10. Profile sidebar (save/load/delete) — no test
11. Bottleneck-mode color buckets — no test (only toggle exists)
12. Camera pan/zoom math — no test
13. Cross-tab config sync — no test
14. `showCrossings` toggle effect — no test (just wired up)
15. Inputs picker — no test (only the implicit coverage via TargetPicker)
