# `app/` documentation

The new React-based Factorio calculator. Reuses the original
`kirkmcdonald.github.io/data/*.json` datasets but rewrites the UI, solver,
and visualizations from scratch.

## Index

| Doc | Contents |
|---|---|
| [phases.md](./phases.md) | What shipped (Phase 0, 0.5) and what's planned (Phase 1+). |
| [decisions.md](./decisions.md) | Locked-in design decisions with rejected alternatives + reasoning. |
| [architecture.md](./architecture.md) | Module layout, data flow, and the `factorio/` catalog contract. |
| [council-phase-1.md](./council-phase-1.md) | Full transcripts of the 4-seat adversarial council on the Phase 1 plan. |

## Status snapshot

- Phase 0: shipped (Sankey + BoxLine + multi-target solver).
- Phase 0.5: shipped (catalyst-ui theming, fuzzy combobox, drag, 32 tests).
- Phase 1: in progress. Scope narrowed dramatically after the council ruling — see [phases.md](./phases.md).

## How to run

```bash
cd app
npm install
npm run dev        # http://localhost:5179/app/
npm test           # vitest (unit + integration)
npm run test:e2e   # playwright
```

Static deploy target: `kirkmcdonald.github.io/app/`. The legacy `calc.html`
at the repo root stays untouched.
