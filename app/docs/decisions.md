# Locked-in decisions

Decisions that survived the Phase 1 council ruling. Each has the rejected
alternative + reasoning. If you want to overturn one, argue against the
reasoning, not the decision.

## D1. Layout primitive: main-bus template
**Use a typed-lane main bus with side cells along the bus.**
- **Rejected**: MAXRECTS / skyline / `potpack` free packing.
- **Why**: free packing optimizes for area with no knowledge of net topology — packer/router waterfall is the 90s VLSI failure pattern (Seat 1). Real bases are ribbons against a bus, not blobs (Seat 2).

## D2. Belt routing: straight drops in Phase 1; A\* + ripup/reroute in Phase 2
**Phase 1.A draws straight perpendicular belt drops between bus and cell.**
**Phase 2 upgrades to sequential A\* with one ripup/reroute pass.**
- **Rejected**: one-shot per-net A\* with no congestion model.
- **Why**: one-shot fails on the first crossing. Negotiated-congestion ripup/reroute is the cheapest unlock from "demo" to "actually works." Sequential A\* without ripup will visibly fail on the 10th–50th net (Seat 1).

## D3. Pipes: separate pass, deferred to Phase 2+
**Pipes use a rectilinear Steiner heuristic with pump-segment awareness.**
- **Rejected**: pairwise A\* shared with belts.
- **Why**: pipes are multi-terminal, undirected, segment-length-limited (250 tiles vanilla → pumps repeat), and cannot Y-merge between different fluids. Treating them as 4-connected grid edges produces 3× more pipe than needed and silently violates pump rules (Seats 1, 2).

## D4. Belt tier is a solver decision, not a router decision
**The solver picks "1 yellow vs 1 red vs 2 yellow" based on recipe rate.**
- **Rejected**: router infers belt tier from throughput during pathfinding.
- **Why**: belt tier is a rate decision, not a geometric one. Coupling them tangles two NP-hard problems (Seat 1).

## D5. Beacons and modules: removed from Phase 1 entirely
**No beacon/module math in solver, no beacon-row layout in packer until both ship together.**
- **Rejected**: solver math now, layout later.
- **Why**: beacons drive placement, not the other way around. Solver math without beacon-row layout produces machine counts the packer can't honor — Seat 2 calls this "a lie."

## D6. Exported artifact: deferred re-evaluation
**Phase 1 validates with a visual MVP. The "paste into Factorio 2.0" blueprint-string export is a Phase 1.C re-evaluation, not a Phase 1 requirement.**
- **Rejected (for Phase 1)**: blueprint-string export as the go/no-go thesis.
- **Why**: user call. We validate visually first, then decide whether the export is the unlock or whether the schematic alone justifies the work. Seat 3 still strongly argues this is the share moment; we don't disagree, just sequencing it after visual proof.

## D7. Render: layered Canvas with quadtree hit-testing
**Base canvas (static tiles) + interaction canvas (hover/select). `d3-quadtree` for hit-testing.**
- **Rejected**: SVG retained-mode for hundreds of tiles.
- **Why**: SVG with 500+ interactive elements janks on `mousemove`. Canvas with manual hit-testing is the standard answer (Seat 4).

## D8. Layout runs in a Web Worker (added in Phase 1.B)
**Single message API: `solve(plan) → layout`. Worker boundary set up before the router is written.**
- **Rejected**: layout on the main thread.
- **Why**: A\* on a 200×200 grid run N times per belt will hang the UI ~1.5s for 30 belts. Retrofitting a Worker after the fact is painful (Seat 4).

## D9. Mod-set scope: Space Age only (Phase 1), documented
**The 30 footprints, 7 fluid connections, 7 inserter reaches we vendored are Space Age-specific.**
- **Rejected**: pretend to be mod-agnostic.
- **Why**: YAFC-CE's pitch is "works with mods"; we'd lose that competition with a hardcoded dataset. Honest scoping > misleading generality (Seat 3).

## D10. Sprite assets: keep existing sprite sheet usage, flag for review
**Continue using `images/sprite-sheet-*.png` from the upstream repo for the schematic.**
- **Rejected**: extract additional Wube art assets.
- **Why**: [Factorio:Copyrights](https://wiki.factorio.com/Factorio:Copyrights) — Wube retains art rights; mod carve-out doesn't apply to a web calculator (Seat 3). Sprites already in the repo are inherited from Kirk McDonald's calculator under his license; we don't add anything new. Re-evaluate before any public deployment.

## Open questions queued for after Phase 1.A MVP

1. Should the schematic style stay "tile-grid hint" (16-px squares, sprite icons) or move to pure node-edge diagram (no game pretense)?
2. Should we publish behind a disclaimer + opt-in mod-data upload, or stay vanilla+SA only?
3. When (not if) we add the blueprint string export, do we ship our own encoder or vendor `factorio-blueprint` from npm?
