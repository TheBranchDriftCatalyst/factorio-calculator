# Adversarial cognitive council — Phase 1 plan review

Four blind peer reviewers, dispatched in parallel with web search, each
attacking the original Phase 1 plan from a different vantage. They did
not see each other's drafts.

## Original Phase 1 plan (what they were reviewing)

> 1. **Blueprint packer view** — `BlueprintView.tsx` on the Factorio tile grid. Rectangle packing for machine groups + Manhattan A\* routing for belts/inserters. Canvas/SVG hybrid.
> 2. **Extend overrides** — fluid connections for foundry, biochamber, electromagnetic plant, cryogenic plant.
> 3. **Power pole + beacon coverage** — for machine-adjacency cost in the packer.
> 4. **Solver phase 2** — multi-output recipe choice (oil cracking, coal liquefaction), modules + beacons in the math.

Approach in one phrase: **"rectangle packing → bus-aware machine module grouping → A\* belt/pipe routing."**

## Seat verdicts

| Seat | Role | Verdict | Headline attack |
|---|---|---|---|
| 1 | Algorithm / Optimization Skeptic (VLSI/OR) | **Needs reframing** | Pack-then-route is the 90s VLSI failure pattern; placement and routing are coupled. |
| 2 | Factorio Veteran (player) | **Wrong abstraction entirely** | Rectangle packing produces blobs; real factories produce ribbons against a bus. |
| 3 | UX Skeptic / Prior-Art Auditor | **Right idea, catastrophically wrong scope** | Without blueprint-string export this is a screenshot generator; FBE wins on every other axis. |
| 4 | Shipping Pragmatist | **Half-finished in 6 months as written** | Four open research problems wrapped in one ticket; dead-center in the fancy-demo trap. |

---

## Convergences (4 of 4 seats agreed)

1. **The original plan is the wrong shape.** Not "needs tweaks" — needs reframing.
2. **No free rectangle packing.** Use a main-bus template.
3. **Drop beacons + modules from Phase 1.** Coupled second optimization.
4. **Pipes are not belts.** Separate algorithmic pass; deferred to Phase 2+.
5. **Ship something small and concrete fast.** Each seat proposed a different minimal cut, but all four agreed the plan as written would not ship.

## Divergences (the interesting parts)

### The abstraction fork — Seat 2 vs Seat 3

- **Seat 2 (Factorio Veteran)**: schematic mode. Don't pretend to be a real Factorio blueprint. Render it abstractly so users know it's a plan, not a finished factory.
- **Seat 3 (UX Skeptic)**: real blueprint-string export. The on-screen render doesn't matter if the user can't paste the result into the game.

They agree on what's worst: a tile-accurate-looking render that *isn't* importable. Picture-between-the-stools is the worst stool.

**Resolution (council ruling)**:
- On-screen: schematic styling with tile-grid hints, not tile-accurate.
- Off-screen: blueprint-string export — deferred per user decision to **after** the visual MVP, then re-evaluate.

### On the routing approach — Seats 1, 2, 4

- **Seat 1 (Algo)**: A\* with negotiated-congestion ripup/reroute as the realistic middle of the heuristic ladder. Sequential A\* without ripup fails on the 10th net.
- **Seat 4 (Shipper)**: A\* in a Worker, fail visibly (red X) when a route can't fit. Don't pretend to solve MAPF.
- **Seat 2 (Player)**: it's not A\* — it's channel assignment on a bus.

**Resolution**: Phase 1.A uses **no routing** (straight perpendicular drops between bus and cell). Phase 2 adds sequential A\* with one ripup/reroute pass, in a Worker, with a visible-failure mode.

---

## Seat 1: Algorithm / Optimization Skeptic — full report

### Verdict
**Needs reframing.** The plan describes 1990s PCB autorouting in the wrong order, on the wrong primitives, and severely underestimates that the placement and routing are coupled, not sequential.

### Biggest algorithmic mistake
"Rectangle packing → A\* routing" as a two-pass pipeline. This is exactly what early VLSI tools tried and abandoned in the 90s. Pack-then-route is a guaranteed-failure pattern: the packer optimizes for *area* with no knowledge of *net topology*, so the router inherits an unroutable placement, fails on the 10th–50th net, and you have no principled fallback. Patterson et al. (arXiv:2310.01505) couldn't get correct blueprints past **12×12 tiles** even with full CP; doing 50–500 buildings with a naive pack+A\* pipeline will produce demos that look great on toy graphs and collapse spectacularly on green-circuit-and-up. The literature is unanimous: routing is **negotiated congestion + ripup/reroute over an iterative placement**, not a one-shot waterfall.

A second mistake: treating belts as plain Manhattan A\* edges. Belts have **direction, throughput caps (15/30/45/s), splitters, undergrounds with max length, and lane semantics**. A\* over a 4-connected grid models *none* of that. You will route a "valid path" that is throughput-illegal.

### NP-hardness we're handwaving
Essentially everything: 2D rectangle packing (NP-hard), Manhattan Steiner tree with obstacles (NP-hard), multi-net routing with congestion (NP-hard), and the joint placement+routing problem (worse). Defensible heuristic ladder:

1. **Good-enough-fast (week 1, ship-it)**: Row/column main-bus template. Buildings placed in fixed-width lanes against a bus; belts are straight drops, not routed. The Busmaker / Kirk-style approach.
2. **Middle tier**: Force-directed placement + sequential A\* with ripup/reroute (Pathfinder-style negotiated congestion costs).
3. **Slow-better**: Simulated annealing on placement with router-in-the-loop cost (factorio_annealer's approach).
4. **Research tier**: CP-SAT on tiles per Patterson; only feasible for small modules (<20×20). Useful as a *module synthesizer*, not whole-base.

### Belts vs pipes — one router or two?
**Two passes, full stop.**
- **Belts**: directed, throughput-capped, lane-aware, undergrounds bridge ≤6 tiles, splitters are 2×1 active components. Closer to channel routing than maze routing.
- **Pipes**: undirected, T-junction-merging (any pipe connects to any neighbor), 250-tile segment limit with pumps as repeaters, throughput depends on segment topology not path. This is a **rectilinear Steiner tree with obstacles + segment-length constraint**, not a shortest path.

### Concrete decisions to lock in before code
1. Adopt a main-bus template skeleton for Phase 1, not free packing.
2. Router = sequential A\* with negotiated-congestion ripup/reroute, max ~5 iterations.
3. Pipes use a separate rectilinear Steiner heuristic (1-Steiner or batched A\* with shared-tree merging), pump-segment-aware.
4. Belt edges carry a throughput attribute; the solver, not the router, decides "1 yellow vs 1 red vs 2 yellow."
5. No beacons/modules in Phase 1's geometry.

### What to cut from Phase 1
Cut items 3 and 4 entirely. Cut "rectangle packing" — replace with **fixed-lane bus template + greedy machine-row fill**. Ship: bus template + machine rows + sequential A\* with one ripup pass + a separate pipe pass that's pairwise-A\* for now.

### Sources
- [Towards Automatic Design of Factorio Blueprints (Patterson et al., arXiv:2310.01505)](https://arxiv.org/abs/2310.01505)
- [Factorio-SAT — R-O-C-K-E-T](https://github.com/R-O-C-K-E-T/Factorio-SAT)
- [Buildasaurus/Factorio-Blueprint-Generator](https://github.com/Buildasaurus/Factorio-Blueprint-Generator)
- [elswindle/factorio_annealer](https://github.com/elswindle/factorio_annealer)
- [Seancheey/FactorioBeltRouter](https://github.com/Seancheey/FactorioBeltRouter)
- [tristanstraub/busmaker](https://github.com/tristanstraub/busmaker)
- [joelverhagen/FactorioTools](https://github.com/joelverhagen/FactorioTools)
- [VLSI Physical Design — Global Routing (Michigan)](http://vlsicad.eecs.umich.edu/KLMH/downloads/book/chapter5/chap5-111206.pdf)
- [Factorio Fluid system](https://wiki.factorio.com/Fluid_system)
- [FFF #430 — Drowning in Fluids](https://factorio.com/blog/post/fff-430)

---

## Seat 2: Factorio Veteran — full report

### Verdict
**Wrong abstraction entirely.** Rectangle-packing + A\* belt routing reproduces the visual surface of a Factorio screenshot while ignoring every structural primitive (buses, blocks, beacon rows, train stations, fluid pumps) that real players actually compose factories from.

### What real factories look like that the plan misses
Players never butt 3×3 assemblers edge-to-edge because (a) every machine needs an inserter on each input/output side — that's a 1-tile gutter minimum; (b) every machine needs power-pole and substation coverage which constrains spacing on a 7- or 18-tile pitch; (c) machines making the same recipe are placed in **rows aligned to belt direction**, not packed into squares — you want a long thin strip so the input belt and output belt run parallel along the long axis. A "pack the rectangles tightest" optimizer produces a blob; real layouts produce ribbons.

### The main-bus problem the plan ignores
The dominant base archetype the wiki literally has a tutorial for is the **main bus**: 4-wide belt groups, 2-tile gaps for undergrounds, fat lanes of iron/copper/green-circuit/steel running the length of the base, with side branches that peel off one or two belts per recipe block. The right primitive is **(a) a bus with N typed lanes, (b) production cells that consume from the bus and return to the bus, (c) split-off macros**. Belt routing on a known bus is **channel assignment**, not pathfinding.

For megabases the dominant archetype is the **city block** (~100×100, sized to roboport radius), with trains on the perimeter and one product per block.

### Beaconing changes everything
Once 12-beacon setups exist, **beacons drive placement, not machines**. A standard endgame layout is a beacon row 3 wide, then an assembler row, then a beacon row, then an assembler row — the assembler's position is determined entirely by which beacon cells overlap it. **Either commit to beacon-row layouts as a first-class primitive in Phase 1, or drop beacons from the solver in Phase 1.** Doing the math without the layout is a lie.

### Pipes are not belts
- Throughput per connection caps at ~1.2k/s vanilla; foundries chewing through 15k/s molten iron require **parallel pumped segments**.
- No Y-merges: two pipes carrying the same fluid can join, but two different fluids cannot share a segment ever.
- Pumps are directional and segment-defining.
- Underground pipes are 1-axis only — they cannot Y or T like undergrounds-of-belts can.

### Target audience
The picture-between-stools (too lossy to paste, too detailed to be a sketch) is the worst option. The thing that would actually get used is a **schematic** view (machines on a grid, typed belt edges, NOT real Factorio tiles) that communicates ratios and bus structure. Closer to what Helmod's matrix-solver users want.

### What to cut
- Cut general rectangle packing + A\* belt routing. Replace with **one** archetype: a parameterized main-bus generator.
- Cut beacons from solver math unless you also do beacon-row layout. They are a package deal.
- Cut module math from the packer's cost function.
- Keep fluid-connection overrides — necessary regardless.
- Add a pump/segment model for any fluid > ~1.2k/s.

### Sources
- [Tutorial:Main bus — Factorio Wiki](https://wiki.factorio.com/tutorial:main_bus)
- [Megabase Grid / City Block size — Forums](https://forums.factorio.com/viewtopic.php?t=105310)
- [Beacon — Factorio Wiki](https://wiki.factorio.com/Beacon)
- [Friday Facts #409 — Diminishing beacons](https://factorio.com/blog/post/fff-409)
- [Fluid system — Factorio Wiki](https://wiki.factorio.com/Fluid_system)
- [Friday Facts #416 — Fluids 2.0](https://factorio.com/blog/post/fff-416)
- [Helmod](https://mods.factorio.com/mod/helmod)
- [Factorio Factory Factory](https://factoriofactoryfactory.com/)

---

## Seat 3: UX Skeptic / Prior-Art Auditor — full report

### Verdict
**Right idea, catastrophically wrong scope.** This is a research-grade combinatorial-optimization problem ([Patterson 2023, ModRef](https://modref.github.io/papers/ModRef2023_TowardsAutomaticDesignOfFactorioBlueprints.pdf)) being tackled as a "Phase 1" hobby feature, while the actually-shippable win (export to a blueprint string) is conspicuously absent from the plan.

### Strongest competitor: teoxoy's Factorio Blueprint Editor
[fbe.teoxoy.com](https://fbe.teoxoy.com/) is the web-based incumbent. It already does the hard graphics work this plan implies: PIXI-based tile-grid rendering, import from Pastebin/Gist/FactorioPrints, history, image export, and an *oil outpost generator* (the only auto-layout feature shipped by anyone reputable, and notably scoped to a single recipe class). The plan as written produces a tile-grid renderer strictly worse than FBE except it derives its content from a solver. If users can't paste their result into the game, FBE wins on every other axis.

### The "import into the game" question
This is the load-bearing question and the plan does not answer it. The blueprint string format is a well-documented zlib+base64 wrapper around JSON. **If you do not emit a blueprint string, you have built a screenshot generator.** The plan must add "Phase 1.5: emit blueprint string" or it has no theory of value.

### What users actually want
Community-sentiment evidence is unkind to "auto-pack":
- Calculator threads show zero users asking for auto-layout; they argue about solver UX.
- In-game auto-routing already exists (BeltRouter mod). Users who want this have it where they need it.
- Factorio Prints' share economy is built around human-crafted, UPS-tuned designs.

### 80/20 cut
**Emit a valid Factorio 2.0 blueprint string from the existing solver DAG**, with naive grid placement (no fancy packing, no routing). Users paste it into FBE or the game, see "kirkmcdonald solved my recipe AND gave me a starter blueprint," screenshot it, post to r/factorio.

### Risks the plan ignores
- **Sprite/asset licensing**. Factorio:Copyrights says Wube retains all rights to art.
- **Naming/positioning collision**. "Factorio Blueprint Editor," "BlueprintBot" etc. — namespace is saturated.
- **Mod-set lock-in**. The 30 footprints + 7 fluid layouts are one mod set (Space Age).

### Three unavoidable questions
1. **Does the output paste into a live Factorio 2.0 game and build the factory?** Yes or no.
2. **What is the smallest demo that gets 100 upvotes on r/factorio?** Name the screenshot.
3. **Why will a user pick this over kirkmcdonald + FBE + their own brain?**

### Sources
- [Factorio Blueprint Editor (teoxoy)](https://fbe.teoxoy.com/) / [GitHub](https://github.com/teoxoy/factorio-blueprint-editor)
- [YAFC-CE](https://github.com/Yafc-CE/yafc-ce)
- [Blueprint string format](https://wiki.factorio.com/Blueprint_string_format)
- [factorio-blueprint-schemas](https://github.com/redruin1/factorio-blueprint-schemas)
- [BeltRouter mod](https://mods.factorio.com/mod/BeltRouter)
- [Factorio:Copyrights](https://wiki.factorio.com/Factorio:Copyrights)
- [Patterson, "Towards Automatic Design of Factorio Blueprints" (arXiv)](https://arxiv.org/html/2310.01505)

---

## Seat 4: Shipping Pragmatist — full report

### Verdict
**Ships in 1 month only if you cut the plan in half today. As written, it lands as a half-finished packer demo six months from now.**

### The "fancy demo" trap
"Rectangle packing + Manhattan A\* for belts/inserters + power poles + beacons + module math" is four open research problems wrapped in one ticket. Browser-based PCB autorouters (KiCad's Freerouting, EasyEDA) have full-time teams and still ship visibly-bad routes. Multi-agent belt routing on a shared grid is literally MAPF (Conflict-Based Search) — a published research area, not a weekend feature.

**Break out by inverting the goal**: ship a visually compelling read-only render of one canonical recipe DAG (e.g., green-circuit subfactory) in week 1. Generality comes later.

### What to build first (Phase 1.A, 1–3 days)
- `src/views/BlueprintView.tsx` + `src/blueprint/layout/rowPack.ts` + `src/blueprint/render/TileCanvas.tsx`.
- Layout: dumbest possible — one row per recipe in DAG topo order, machines laid left-to-right with a 2-tile gutter. No packing. No A\*. ~80 LOC.
- Render: single HTML canvas, tile = 16px, draw machine footprint rects + tinted icons.
- Belts: straight horizontal lane between row N and row N+1. No routing.
- **Acceptance**: green-circuit renders correctly. That screenshot is your north star.

### Tech-stack landmines
1. **d3 + interactive Canvas is a hand-rolled mess.** Layered canvases — base layer (static tiles) + interaction layer (hover/selection). Hover is bounding-box only.
2. **A\* on a 200×200 grid, run N times per belt, on the main thread, will jank.** Put the packer+router in a Web Worker behind a single `solve(plan) → layout` message. Do this *before* the router.
3. **Multi-belt routing is MAPF, not A\*.** Route belts in priority order, mark their tiles as obstacles, fail visibly when a route can't fit.
4. **Tailwind v4 @source scanning + large JSON = 40s+ cold starts.** Keep `data/*.json` out of any `@source` glob.
5. **GitHub Pages + Workers**: verify the production build hashes the worker chunk correctly under the Pages base path.

### Test strategy gaps
1. **Golden snapshot tests** for layout — 5 canonical recipes.
2. **Property-based tests** with `@fast-check/vitest`: no overlapping rectangles, every belt port connects.
3. **Performance budget in CI**: `expect(packAndRoute(greenCircuitPlan)).toCompleteWithin(150ms)`.

### Where this will die
Belt routing produces visually unacceptable spaghetti, you spend 8 weeks tuning heuristics, never ship the rest. Detect early with a **"ugly-route gate"** Playwright test asserting `beltCrossings < machineCount * 0.5`.

### Honest 7-day scope
**Ship**: row-pack layout, straight-lane belts, 4 new fluid overrides, canvas render of full DAG, click-to-highlight one recipe.
**Push to Phase 2+**: rectangle packing (use `potpack`), A\* belt routing, power poles, beacons, modules-in-math, inserter placement.

### Sources
- [potpack — Mapbox tiny rectangle packer](https://github.com/mapbox/potpack)
- [maxrects-packer (npm)](https://www.npmjs.com/package/maxrects-packer)
- [PathFinding.js](https://github.com/qiao/PathFinding.js/)
- [easystar.js](https://easystarjs.com/)
- [@fast-check/vitest](https://www.npmjs.com/package/@fast-check/vitest)
- [Conflict-Based Search for MAPF (Sharon et al.)](https://www.sciencedirect.com/science/article/pii/S0004370214001386)
- [Teoxoy Factorio Blueprint Editor](https://github.com/Teoxoy/factorio-blueprint-editor)
- [Tailwind v4 + Vite slow with large JSON (issue)](https://github.com/tailwindlabs/tailwindcss/issues/17699)
