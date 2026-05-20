# factorio/ — entity catalog module

Self-contained module. Everything else in the app reads only the typed
`Catalog` returned by `loadCatalog(rawDataset)`. Upstream JSON shapes do
not leak past this folder.

## Flow

```
data/<dataset>.json    ──fetch──>    KirkRawDataset
                                          │
                                          ▼
                              loadCatalog(raw)
                                  │
        ┌─────────────────────────┼──────────────────────────┐
        ▼                         ▼                          ▼
  data/sizes.json         data/overrides.ts            types.ts
  (footprints)            (inserters + fluid I/O)      (canonical shapes)
                                  │
                                  ▼
                              Catalog  ── consumed by solver, sankey, blueprint
```

## Files

| File                | Role |
|---------------------|------|
| `index.ts`          | Public API. Only thing other modules import. |
| `types.ts`          | Canonical typed shapes + minimal upstream `KirkRaw*` types. |
| `catalog.ts`        | `loadCatalog(raw)` — single point of translation. |
| `data/sizes.json`   | Building footprints, vendored from factoriolab. |
| `data/overrides.ts` | Hand-authored inserter reaches + pipe connection positions. |

## Refreshing static data

### `sizes.json`

Pulled from [factoriolab/factoriolab](https://github.com/factoriolab/factoriolab)
`src/data/spa/data.json`, `items[].machine.size`.

```bash
curl -sL https://raw.githubusercontent.com/factoriolab/factoriolab/main/src/data/spa/data.json \
  | python3 -c "import json,sys; d=json.load(sys.stdin); \
    print(json.dumps({i['id']:i['machine']['size'] for i in d['items'] if i.get('machine',{}).get('size')}, indent=2, sort_keys=True))" \
  > app/src/factorio/data/sizes.json
```

### `overrides.ts`

Source of truth: [wube/factorio-data](https://github.com/wube/factorio-data),
`base/prototypes/entity/entities.lua` and `space-age/prototypes/entity/entities.lua`.
Read `fluid_box.pipe_connections[].position` and inserter
`pickup_position` / `insert_position` directly out of the Lua.

This file is small on purpose. Add entries only when the blueprint packer
needs them.

## Coverage status

- ✅ Building footprints: 30 entities (vanilla + Space Age machines)
- ⚠️ Fluid connections: 7 entities (assemblers 2/3, chem plant, refinery,
  pumpjack, offshore pump, boiler). Foundry, biochamber, electromagnetic plant,
  cryogenic plant: phase 1.
- ✅ Inserter reaches: all 7 vanilla + Space Age inserter variants.
- ❌ Power pole coverage: phase 1.
- ❌ Beacon coverage: phase 1.
