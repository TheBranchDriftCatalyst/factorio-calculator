# Architecture

## Top-level data flow

```
                  Kirk McDonald's dataset (data/space-age-2.0.55.json)
                                       │
                              data/loader.ts (fetch)
                                       │
                                  KirkRawDataset
                                       │
                          factorio/index.ts: loadCatalog(raw)
                                       │
                                    Catalog            ← single typed record
                       ┌───────────────┼────────────────┐
                       ▼               ▼                ▼
              solver/expand.ts   views/SankeyView    views/SchematicView (P1)
                       │                                │
                    FlowGraph ──► views/BoxLineView    blueprint/layout/busLayout
                       │                                │
                    (multi-target,                   Blueprint
                     merged DAG)                        │
                                              blueprint/render/CanvasTiles
                                                        │
                                              (P1.C: blueprint string export)
```

## Module map

| Path | Purpose |
|---|---|
| `src/factorio/` | Catalog module. **Only** module that knows Kirk's raw JSON shape. Re-exports typed `Catalog` + helpers. |
| `src/factorio/data/sizes.json` | Vendored building footprints (from factoriolab). |
| `src/factorio/data/overrides.ts` | Hand-authored inserter reaches + fluid pipe connections. |
| `src/data/loader.ts` | Fetches a dataset JSON from `/data/` (symlinked in dev, root-served in prod). |
| `src/solver/expand.ts` | Phase-0 solver: recursive DAG expansion over multiple targets. Power, machine counts, raw inputs aggregated. |
| `src/views/SankeyView.tsx` | d3-sankey rendering, lane labels, vertical drag along column. |
| `src/views/BoxLineView.tsx` | Layered DAG, LR/TB toggle, free drag, edge rate labels. |
| `src/views/TargetPicker.tsx` | Multi-target input list (add/remove/edit rate). |
| `src/components/Icon.tsx` | Renders a 32×32 sprite from the active sheet via `background-position`. |
| `src/components/ItemCombobox.tsx` | cmdk-based fuzzy-search dropdown. |
| `src/blueprint/` *(Phase 1)* | Schematic layout + render + (future) blueprint-string export. |

## The `factorio/` contract

The contract is: **nothing outside `factorio/` reaches into upstream JSON
shapes.** The rest of the app reads only the typed `Catalog` returned by
`loadCatalog(rawDataset)`.

This means:
- Swapping datasets (vanilla, Space Age, mod packs) only touches `factorio/`.
- Adding new building dimensions or fluid connections only touches `factorio/data/`.
- The solver, sankey view, schematic view all consume the same typed surface.

See [factorio/README.md](../src/factorio/README.md) for the refresh recipes.

## Test pyramid

| Layer | Location | Count | What it tests |
|---|---|---:|---|
| Unit | `test/unit/catalog.test.ts` | 8 | Raw → Catalog translation invariants |
| Unit | `test/unit/solver.test.ts` | 10 | DAG expansion: shared intermediates, multi-target merging, raw-input aggregation, edge cases |
| Integration | `test/integration/target-picker.test.tsx` | 5 | TargetPicker behavior — add/remove/edit rows |
| E2E | `test/e2e/app.spec.ts` | 9 | Full app: theme, tabs, sankey/boxline render, fuzzy combobox, target add/remove, catalog summary |
| **Total** | | **32** | |

Phase 1 will add (per Seat 4):
- Property-based tests with `@fast-check/vitest` (no machine overlaps, all belt ports connected)
- Golden snapshot layouts for 5 canonical recipes
- Performance budget in CI: green-circuit layout `<150 ms`, build fails at 2×

## External dependencies

| Pkg | Purpose |
|---|---|
| `@thebranchdriftcatalyst/catalyst-ui` | UI primitives, theme system. Provides `ThemeProvider`, `Card`, `Tabs`, `Button`, `Input`. |
| `cmdk` | Fuzzy-search combobox. |
| `d3`, `d3-sankey` | Diagram rendering. |
| `lucide-react` | Icons (chevron, check). |
| `tailwindcss` v4, `@tailwindcss/vite`, `tailwindcss-animate` | Styling. |

## Theme system

- Catalyst's runtime CSS-variable injection via `<ThemeProvider>` (catalyst-ui) writes a `<style id="catalyst-ui-theme">` tag.
- A static `import "@thebranchdriftcatalyst/catalyst-ui/themes/catalyst"` provides first-paint tokens.
- `<html class="theme-catalyst dark">` set in `index.html`; localStorage seeded in `main.tsx` so first-time visitors default to dark.
- Body chrome uses `var(--background)` / `var(--foreground)` so the page doesn't fall back to browser-default light.
