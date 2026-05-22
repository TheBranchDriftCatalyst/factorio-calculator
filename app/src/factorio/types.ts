// Canonical typed shapes for the Factorio catalog.
// Nothing else in the app should look at upstream JSON directly —
// it should reach the typed records through factorio/index.ts.

export type Size = readonly [width: number, height: number]
export type Tile = readonly [x: number, y: number]

export type Direction = "north" | "south" | "east" | "west"
export type FluidRole = "input" | "output" | "input-output"

export interface Item {
  key: string
  name: string
  iconCol: number
  iconRow: number
  stackSize?: number
  fuelValue?: number // joules per item (energy released when burned)
  fuelCategory?: string // e.g. "chemical", "nuclear" — set only for fuel items
}

export interface Recipe {
  key: string
  name: string
  category: string
  time: number // seconds at speed=1
  ingredients: ReadonlyArray<{ item: string; amount: number }>
  products: ReadonlyArray<{ item: string; amount: number; probability?: number }>
}

export interface Machine {
  key: string
  name: string
  craftingCategories: ReadonlySet<string>
  craftingSpeed: number
  prodBonus: number
  moduleSlots: number
  power: number // watts
  energySource: "electric" | "burner" | "heat" | "fluid" | "void"
  /**
   * When `energySource === "burner"`, which fuel categor(ies) the machine
   * accepts (e.g. "chemical", "nuclear"). Empty when not a burner.
   */
  fuelCategories: ReadonlySet<string>
  size?: Size // tile footprint, may be undefined for entries not in sizes.json yet
  /**
   * Maximum I/O streams this machine can accept on input/output sides,
   * split by solid vs fluid. Populated from `machineSlots.ts` overrides.
   * Used by feasibility checks (can a recipe physically run on this
   * machine?) and by factory templates (the manifold layout needs to
   * know where to place the input ports).
   */
  slots: {
    input: { solid: number; fluid: number }
    output: { solid: number; fluid: number }
  }
}

export interface Belt {
  key: string
  name: string
  itemsPerSecond: number
}

export interface Inserter {
  key: string
  name: string
  reach: { pickup: Tile; drop: Tile } // tile offsets, relative to inserter origin, default N orientation
}

export interface Module {
  key: string
  name: string
  effect: { speed?: number; productivity?: number; consumption?: number; pollution?: number; quality?: number }
}

export interface FluidConnection {
  position: Tile // entity-center-relative (Factorio convention)
  direction: Direction
  role: FluidRole
}

// Sprite sheet metadata. Single sheet per dataset, 32×32 cells, 0-indexed.
export interface SpriteSheet {
  hash: string // filename suffix: images/sprite-sheet-{hash}.png
  width: number // px
  height: number // px
  cell: number // px per cell (always 32 in Factorio)
}

// What the canonical typed catalog looks like.
// All downstream code (solver, sankey, blueprint) reads from this.
export interface Catalog {
  items: ReadonlyMap<string, Item>
  recipes: ReadonlyMap<string, Recipe>
  machines: ReadonlyMap<string, Machine>
  belts: ReadonlyMap<string, Belt>
  inserters: ReadonlyMap<string, Inserter>
  modules: ReadonlyMap<string, Module>
  /** Items that are FLUIDS (water, crude-oil, etc.) — carried by pipes, not belts. */
  fluidItems: ReadonlySet<string>
  /**
   * Items that count as raw, un-craftable resources for the solver: ores,
   * pumped fluids, agricultural raw products, scrap. Populated from
   * dataset-level signals (`resources[]`, `planets[].resources.*`) plus a
   * fallback for items that have no non-recycling recipe producing them.
   * Lets modded datasets declare their own raw items without hard-coding.
   */
  rawItems: ReadonlySet<string>
  // Pipe connection positions per machine key. Empty array if machine has no fluid I/O.
  fluidConnections: ReadonlyMap<string, ReadonlyArray<FluidConnection>>
  // Producers indexed by crafting_category for solver lookup.
  machinesByCategory: ReadonlyMap<string, ReadonlyArray<Machine>>
  // Recipes indexed by output item key for solver lookup.
  recipesByProduct: ReadonlyMap<string, ReadonlyArray<Recipe>>
  // Sprite sheet metadata for icon rendering.
  sprites: SpriteSheet
}

// --- Raw upstream shape (Kirk McDonald's dataset) ---
// We type only the fields we actually consume. Anything else is opaque.

export interface KirkRawDataset {
  items: ReadonlyArray<KirkRawItem>
  recipes: ReadonlyArray<KirkRawRecipe>
  crafting_machines: ReadonlyArray<KirkRawMachine>
  belts: ReadonlyArray<KirkRawBelt>
  modules: ReadonlyArray<KirkRawModule>
  sprites?: { hash?: string; width?: number; height?: number }
  // Plus other categories (fluids, mining_drills, boilers, …) we read opportunistically.
  mining_drills?: ReadonlyArray<KirkRawMachine>
  boilers?: ReadonlyArray<KirkRawMachine>
  offshore_pumps?: ReadonlyArray<KirkRawMachine>
  rocket_silo?: ReadonlyArray<KirkRawMachine>
  agricultural_tower?: ReadonlyArray<KirkRawMachine>
  fluids?: ReadonlyArray<KirkRawItem>
  /**
   * Mineable resource definitions (`resources[]` in Kirk's JSON). Each entry
   * declares the raw item(s) produced by mining/extraction. Used to
   * populate `Catalog.rawItems` so the solver knows what counts as a raw
   * input without hard-coding ore names.
   */
  resources?: ReadonlyArray<{
    key: string
    category?: string
    results?: ReadonlyArray<KirkRawRecipeIngredient>
  }>
  /**
   * Planet definitions. The `resources` sub-object lists items obtained
   * via mining (`resource`), offshore pumps (`offshore`), and agriculture
   * (`plants`). All three count as raw inputs for the solver.
   */
  planets?: ReadonlyArray<{
    key: string
    resources?: {
      resource?: ReadonlyArray<string>
      offshore?: ReadonlyArray<string>
      plants?: ReadonlyArray<string>
    }
  }>
  /**
   * Top-level fuel registry. Each entry pairs a fuel item with its
   * energy value (joules) and category (e.g. "chemical", "nuclear").
   */
  fuel?: ReadonlyArray<{
    item_key?: string
    key?: string
    value?: number
    fuel_value?: number
    category?: string
    fuel_category?: string
  }>
  [k: string]: unknown
}

export interface KirkRawItem {
  key: string
  localized_name?: Record<string, string>
  icon_col?: number
  icon_row?: number
  stack_size?: number
  fuel_value?: number
}

export interface KirkRawRecipeIngredient {
  name: string
  amount?: number
  amount_min?: number
  amount_max?: number
  probability?: number
  type?: "item" | "fluid"
}

export interface KirkRawRecipe {
  key: string
  localized_name?: Record<string, string>
  category: string
  energy_required?: number
  ingredients: ReadonlyArray<KirkRawRecipeIngredient>
  results: ReadonlyArray<KirkRawRecipeIngredient>
}

export interface KirkRawMachine {
  key: string
  localized_name?: Record<string, string>
  crafting_categories?: ReadonlyArray<string>
  resource_categories?: ReadonlyArray<string>
  crafting_speed?: number
  mining_speed?: number
  prod_bonus?: number
  module_slots?: number
  energy_usage?: number // watts
  energy_source?: {
    type?: string
    fuel_category?: string
    fuel_categories?: ReadonlyArray<string>
  }
}

export interface KirkRawBelt {
  key: string
  localized_name?: Record<string, string>
  speed: number // Factorio "speed" is items/tick per lane × 2 lanes
}

export interface KirkRawModule {
  // Kirk's dataset keys modules by `item_key`, not `key`.
  item_key: string
  category?: string
  localized_name?: Record<string, string>
  effect?: {
    speed?: number
    productivity?: number
    consumption?: number
    pollution?: number
    quality?: number
  }
}
