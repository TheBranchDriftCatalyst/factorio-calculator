<div align="center">

# Factorio Calculator

### A production-planning, ratio-solving, blueprint-visualizing calculator for [Factorio](https://factorio.com/) — including the Space Age expansion.

[![Deploy to GitHub Pages](https://github.com/TheBranchDriftCatalyst/factorio-calculator/actions/workflows/deploy.yml/badge.svg)](https://github.com/TheBranchDriftCatalyst/factorio-calculator/actions/workflows/deploy.yml)
[![Docker image](https://github.com/TheBranchDriftCatalyst/factorio-calculator/actions/workflows/docker.yml/badge.svg)](https://github.com/TheBranchDriftCatalyst/factorio-calculator/actions/workflows/docker.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![GitHub stars](https://img.shields.io/github/stars/TheBranchDriftCatalyst/factorio-calculator?style=social)](https://github.com/TheBranchDriftCatalyst/factorio-calculator/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/TheBranchDriftCatalyst/factorio-calculator?style=social)](https://github.com/TheBranchDriftCatalyst/factorio-calculator/network/members)

**[🚀 Live Demo](https://thebranchdriftcatalyst.github.io/factorio-calculator/)**  ·  **[🐳 Docker Image](https://github.com/TheBranchDriftCatalyst/factorio-calculator/pkgs/container/factorio-calculator)**  ·  **[🐛 Report a bug](https://github.com/TheBranchDriftCatalyst/factorio-calculator/issues/new)**

</div>

---

## What is this?

**Factorio Calculator** is a modern open-source **production-ratio calculator** for [Factorio](https://factorio.com/) and the **Space Age** expansion. Punch in a target — *"I want 60 green circuits per second"* — and get back the exact number of assemblers, miners, refineries, foundries, and biochambers you need, the raw resources to feed them, the power draw to run them, and a beautiful interactive **Sankey / Box-Line / Schematic** diagram of the whole supply chain.

Built on the [Kirk McDonald](https://github.com/KirkMcDonald/kirkmcdonald.github.io) dataset format, this is a from-scratch **React 19 + TypeScript + Tailwind v4** rewrite with a multi-target solver, fuzzy command palette, drag-rearrangeable graphs, a planned blueprint exporter, and full Space Age recipe support.

> *Stop scribbling ratios on a napkin. Plan your megabase like an adult.*

## Table of Contents

- [Features](#features)
- [Live Demo](#live-demo)
- [Screenshots](#screenshots)
- [Quick Start](#quick-start)
- [Running with Docker](#running-with-docker)
- [Self-Hosting / Deployment](#self-hosting--deployment)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Roadmap](#roadmap)
- [Updating Game Data](#updating-game-data)
- [Contributing](#contributing)
- [Credits & Lineage](#credits--lineage)
- [License](#license)

## Features

### Production planning
- **Multi-target solver** — solve for *several* outputs at once; shared intermediates collapse into a single merged DAG instead of being double-counted.
- **Full Space Age support** — quality modules, foundries, biochambers, cryogenic plants, electromagnetic plants, agriculture towers, and all the new recipes.
- **Vanilla 1.1 and 2.0 datasets** bundled — pick your era.
- **Modules + beacons** in the ratio math (productivity, speed, quality, efficiency).
- **Per-recipe overrides** — pick which recipe (basic vs. advanced oil processing, casting vs. smelting) the solver chooses.
- **Belt & pipe sizing** — yellow / red / blue / green belts and underground pipe lengths factored into capacity.

### Visualization
- **Sankey view** — interactive flow diagram with d3-sankey, lane labels, draggable nodes.
- **Box-Line view** — layered DAG with LR/TB toggle, free drag, and per-edge rate labels.
- **Schematic view** *(Phase 1, in progress)* — places machines on the Factorio tile grid for true-scale planning, with planned **blueprint string export** so you can paste a layout straight into the game.
- **Catalyst-UI theming** — dark/light themes, runtime CSS-variable injection, looks sharp at any resolution.

### Developer experience
- **TypeScript end-to-end** with strict mode.
- **Vitest** unit + integration suite, **Playwright** E2E suite — 32 tests at last count.
- **Single typed `Catalog`** boundary — only `src/factorio/` touches raw dataset JSON; swap datasets without touching the solver or views.
- **GitHub Pages auto-deploy** + **GHCR Docker image** on every push to `master`.
- **Fuzzy command palette** (`cmdk`) — `Cmd+K` to jump to any item, recipe, or setting.

## Live Demo

| Build | URL |
|---|---|
| **Web** | <https://thebranchdriftcatalyst.github.io/factorio-calculator/> |
| **Docker** | `ghcr.io/thebranchdriftcatalyst/factorio-calculator:latest` |

## Screenshots

> Fresh React-UI screenshots are pending — see [issue `factorio-calculator-bqx`](https://github.com/TheBranchDriftCatalyst/factorio-calculator/issues) for the capture list. In the meantime, the live demo is one click away.

## Quick Start

### Option 1 — Just use the live site

Go to <https://thebranchdriftcatalyst.github.io/factorio-calculator/>. No install needed.

### Option 2 — Run locally

```bash
git clone https://github.com/TheBranchDriftCatalyst/factorio-calculator.git
cd factorio-calculator/app
npm install
npm run dev
# → http://localhost:5179/
```

## Running with Docker

A pre-built image is published to GHCR on every push to `master`, served by nginx.

```bash
docker run --rm -p 8080:80 ghcr.io/thebranchdriftcatalyst/factorio-calculator:latest
# → http://localhost:8080/
```

Or build locally:

```bash
docker build -t factorio-calculator .
docker run --rm -p 8080:80 factorio-calculator
```

## Self-Hosting / Deployment

The project ships two production deploy targets out of the box:

- **GitHub Pages** — `.github/workflows/deploy.yml`. Every push to `master` rebuilds the app and publishes it at `/<repo>/`.
- **GHCR Docker image** — `.github/workflows/docker.yml`. Pushes to `master` and version tags publish a multi-arch image to `ghcr.io/<owner>/factorio-calculator`.

For a path-prefixed deploy, set `VITE_BASE` at build time:

```bash
cd app
VITE_BASE=/factorio-calculator/ npm run build
```

## Architecture

The React app is built around one strict boundary: **only `src/factorio/` knows the shape of the raw dataset JSON.** Everything else consumes a typed `Catalog`, so swapping datasets (vanilla → Space Age → modpack) only touches one directory.

```
data/*.json (Kirk McDonald dataset format)
        │
        ▼
src/factorio/    ◄── only place that touches raw JSON
        │
   typed Catalog
        │
        ├──► src/solver/expand.ts        (multi-target DAG expansion)
        │
        ├──► src/views/SankeyView.tsx    (d3-sankey)
        │
        ├──► src/views/BoxLineView.tsx   (layered DAG)
        │
        └──► src/views/SchematicView.tsx (Phase 1, tile-grid + blueprint export)
```

Full architecture notes, design decisions, and phase plans live in [`app/docs/`](app/docs/).

## Tech Stack

- **React 19** + **TypeScript 5.6** — strict mode end-to-end.
- **Vite 7** — dev server, build, HMR.
- **Tailwind CSS v4** + `@tailwindcss/vite`.
- **[catalyst-ui](https://www.npmjs.com/package/@thebranchdriftcatalyst/catalyst-ui)** — Radix-based primitives, theme provider, dark mode.
- **d3** + **d3-sankey** — flow diagrams.
- **cmdk** — fuzzy command palette.
- **Vitest** + **@testing-library/react** + **Playwright** — unit, integration, E2E.
- **nginx** (in the Docker image) — static serve, gzip, cache headers.

## Roadmap

| Phase | Status | Scope |
|---|---|---|
| **Phase 0** | ✅ Shipped | Sankey + Box-Line + multi-target solver. |
| **Phase 0.5** | ✅ Shipped | catalyst-ui theming, fuzzy combobox, drag, 32 tests, CI. |
| **Phase 1** | 🚧 In progress | Tile-grid schematic view, blueprint string export, fluid connections for Space Age buildings, beacon/power-pole coverage. |
| **Phase 2** | 🗓️ Planned | LP-based multi-output recipe choice (oil cracking, coal liquefaction), modules + beacons in the math. |
| **Phase 3** | 💭 Ideas | Train-network planner, recipe-modpack auto-import. |

Open issues track ready-to-work tasks — see [issues](https://github.com/TheBranchDriftCatalyst/factorio-calculator/issues). Project planning is tracked in [`app/docs/phases.md`](app/docs/phases.md).

## Updating Game Data

The datasets in [`data/`](data/) and sprite sheets in [`images/`](images/) are kept verbatim from upstream so they can be refreshed in place when Factorio patches drop. They're generated by `factoriodump` (from the [factorio-tools](https://github.com/KirkMcDonald/factorio-tools) repository). The in-tree `dump.lua` and `process_data.py` are the legacy data-extraction scripts and are preserved for the same reason.

When a new Factorio patch or expansion drops:

1. Run `factoriodump` against your installed game + mods to produce a new `<name>-<version>.json`.
2. Drop it into `data/`.
3. The dataset picker in the UI auto-discovers any JSON in that directory.

## Contributing

PRs welcome. Please:

1. Open an issue first if it's a meaningful change — let's talk through scope before you spend a weekend on it.
2. `cd app && npm install && npm test && npm run test:e2e` should all pass.
3. Match the existing code style — TS strict, no `any`, no raw dataset-JSON access outside `src/factorio/`.

If you're not sure where to start, look for `good first issue` labels.

## Credits & Lineage

This project stands on the shoulders of [**Kirk McDonald's Factorio Calculator**](https://github.com/KirkMcDonald/kirkmcdonald.github.io) — the canonical Factorio production-ratio calculator that the whole community has relied on for nearly a decade. The dataset format, the game-data extraction pipeline (`dump.lua`, `process_data.py`), and the underlying ratio math all originate from Kirk's work.

If this calculator has saved you spreadsheet time, **please consider supporting Kirk's work** on [his Patreon](https://www.patreon.com/kirkmcdonald) — he built the foundation everything here stands on.

The React rewrite, the multi-target solver, the new visualizations, the schematic view, and all CI/Docker tooling are by [@TheBranchDriftCatalyst](https://github.com/TheBranchDriftCatalyst).

## License

[Apache License 2.0](LICENSE) — same as upstream. Use it, fork it, ship it.

---

<div align="center">

### ⭐ If this saved you from a ratio-math headache, star the repo — it genuinely helps others find it.

[![Star History Chart](https://api.star-history.com/svg?repos=TheBranchDriftCatalyst/factorio-calculator&type=Date)](https://star-history.com/#TheBranchDriftCatalyst/factorio-calculator&Date)

**Keywords:** factorio calculator · factorio production planner · factorio ratio calculator · factorio space age calculator · factorio blueprint calculator · factorio sankey diagram · factorio recipe calculator · factorio modules beacons calculator · factorio belt calculator · factorio assembler ratios · kirk mcdonald calculator · factorio megabase planner

</div>
