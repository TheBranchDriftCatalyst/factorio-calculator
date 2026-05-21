// Builds a typed Catalog from Kirk's raw dataset + our local overrides.
// This is the only place that knows the upstream JSON shape.

import sizesJson from "./data/sizes.json"
import { FLUID_CONNECTIONS, INSERTER_REACH } from "./data/overrides"
import type {
  Belt,
  Catalog,
  FluidConnection,
  Inserter,
  Item,
  KirkRawDataset,
  KirkRawMachine,
  KirkRawRecipe,
  Machine,
  Module,
  Recipe,
  Size,
} from "./types"

const SIZES = sizesJson as unknown as Record<string, [number, number]>

function localized(name: string, loc?: Record<string, string>): string {
  return loc?.["en"] ?? name
}

function toItem(raw: KirkRawDataset["items"][number]): Item {
  // Kirk's fluid records use `item_key` instead of `key`; tolerate either.
  const key = raw.key ?? (raw as unknown as { item_key?: string }).item_key ?? ""
  return {
    key,
    name: localized(key, raw.localized_name),
    iconCol: raw.icon_col ?? 0,
    iconRow: raw.icon_row ?? 0,
    stackSize: raw.stack_size,
    fuelValue: raw.fuel_value,
  }
}

/**
 * When merging items + fluids, an entry from `raw.fluids` may shadow a
 * proper entry from `raw.items` (the items array carries the real
 * `icon_col` / `icon_row` for fluids; fluids-records only carry
 * temperature metadata). Keep the entry with non-zero icon coords,
 * falling back to the later one if neither has icons.
 */
function mergeItems(a: Item, b: Item): Item {
  const aHasIcon = a.iconCol > 0 || a.iconRow > 0
  const bHasIcon = b.iconCol > 0 || b.iconRow > 0
  if (aHasIcon && !bHasIcon) return a
  if (bHasIcon && !aHasIcon) return b
  return b
}

function toRecipe(raw: KirkRawRecipe): Recipe {
  const norm = (xs: KirkRawRecipe["ingredients"]) =>
    xs.map((x) => ({
      item: x.name,
      amount:
        x.amount ??
        (x.amount_min !== undefined && x.amount_max !== undefined
          ? (x.amount_min + x.amount_max) / 2
          : 0),
      probability: x.probability,
    }))
  return {
    key: raw.key,
    name: localized(raw.key, raw.localized_name),
    category: raw.category,
    time: raw.energy_required ?? 0.5,
    ingredients: norm(raw.ingredients),
    products: norm(raw.results),
  }
}

function toMachine(raw: KirkRawMachine): Machine {
  const sourceType = raw.energy_source?.type ?? "electric"
  const energySource: Machine["energySource"] =
    sourceType === "burner" || sourceType === "heat" || sourceType === "fluid" || sourceType === "void"
      ? sourceType
      : "electric"
  // Burners may declare a single `fuel_category` (Kirk's vanilla shape) or
  // an array `fuel_categories` (Space-Age & modded data). Accept both so
  // multi-category burners (e.g. accepts "chemical" OR "nuclear") work.
  const fuelCategories = new Set<string>()
  if (raw.energy_source?.fuel_category) fuelCategories.add(raw.energy_source.fuel_category)
  for (const c of raw.energy_source?.fuel_categories ?? []) fuelCategories.add(c)
  const sz = SIZES[raw.key]
  return {
    key: raw.key,
    name: localized(raw.key, raw.localized_name),
    craftingCategories: new Set(raw.crafting_categories ?? raw.resource_categories ?? []),
    craftingSpeed: raw.crafting_speed ?? raw.mining_speed ?? 1,
    prodBonus: raw.prod_bonus ?? 0,
    moduleSlots: raw.module_slots ?? 0,
    power: raw.energy_usage ?? 0,
    energySource,
    fuelCategories,
    size: sz ? ([sz[0], sz[1]] as Size) : undefined,
  }
}

const collectMachines = (raw: KirkRawDataset): KirkRawMachine[] => [
  ...raw.crafting_machines,
  ...(raw.mining_drills ?? []),
  ...(raw.boilers ?? []),
  ...(raw.offshore_pumps ?? []),
  ...(raw.rocket_silo ?? []),
  ...(raw.agricultural_tower ?? []),
]

function indexBy<T, K>(items: ReadonlyArray<T>, key: (t: T) => K): Map<K, T> {
  const m = new Map<K, T>()
  for (const it of items) m.set(key(it), it)
  return m
}

function groupBy<T, K>(items: ReadonlyArray<T>, key: (t: T) => Iterable<K>): Map<K, T[]> {
  const m = new Map<K, T[]>()
  for (const it of items) {
    for (const k of key(it)) {
      const list = m.get(k) ?? []
      list.push(it)
      m.set(k, list)
    }
  }
  return m
}

export function loadCatalog(raw: KirkRawDataset): Catalog {
  const itemsList = [...(raw.items ?? []), ...((raw.fluids as KirkRawDataset["items"]) ?? [])].map(toItem)
  const recipes = (raw.recipes ?? []).map(toRecipe)
  const machines = collectMachines(raw).map(toMachine)
  const belts: Belt[] = (raw.belts ?? []).map((b) => ({
    key: b.key,
    name: localized(b.key, b.localized_name),
    // Kirk's data uses Factorio's per-tick lane speed; 1 belt = 2 lanes * 60 ticks.
    itemsPerSecond: b.speed * 480,
  }))
  const modules: Module[] = (raw.modules ?? []).map((m) => ({
    key: m.item_key,
    name: localized(m.item_key, m.localized_name),
    effect: {
      speed: m.effect?.speed,
      productivity: m.effect?.productivity,
      consumption: m.effect?.consumption,
      pollution: m.effect?.pollution,
      quality: m.effect?.quality,
    },
  }))

  const itemByKey = indexBy(itemsList, (i) => i.key)
  const inserters: Inserter[] = Object.entries(INSERTER_REACH).map(([key, reach]) => ({
    key,
    name: itemByKey.get(key)?.name ?? key,
    reach,
  }))

  const fluidConnections = new Map<string, ReadonlyArray<FluidConnection>>(
    Object.entries(FLUID_CONNECTIONS),
  )

  // Set of fluid item keys. Kirk's dataset uses `item_key` on fluid
  // records. We also scan recipe ingredients/products for `type: "fluid"`
  // as a belt-and-suspenders catch for custom datasets that might leave
  // the top-level fluids list incomplete.
  const fluidSet = new Set<string>()
  for (const f of (raw.fluids ?? []) as ReadonlyArray<{
    item_key?: string
    key?: string
  }>) {
    const k = f.item_key ?? f.key
    if (k) fluidSet.add(k)
  }
  for (const r of raw.recipes ?? []) {
    for (const ing of r.ingredients ?? []) {
      if (ing.type === "fluid") fluidSet.add(ing.name)
    }
    for (const p of r.results ?? []) {
      if (p.type === "fluid") fluidSet.add(p.name)
    }
  }
  const fluidItems: ReadonlySet<string> = fluidSet

  const sprites = {
    hash: raw.sprites?.hash ?? "",
    width: raw.sprites?.width ?? 0,
    height: raw.sprites?.height ?? 0,
    cell: 32,
  }

  // Items merged with icon-aware fallback so a fluid record (no icon
  // coords) doesn't shadow a real items record (proper icon_col/row).
  const itemsMap = new Map<string, Item>()
  for (const it of itemsList) {
    const prev = itemsMap.get(it.key)
    itemsMap.set(it.key, prev ? mergeItems(prev, it) : it)
  }

  // Stamp fuel value + category onto items from the top-level `fuel`
  // registry. Kirk's dataset keeps fuel metadata OUT of items proper, so
  // without this pass `item.fuelValue` would always be undefined.
  for (const f of raw.fuel ?? []) {
    const k = f.item_key ?? f.key
    if (!k) continue
    const existing = itemsMap.get(k)
    if (!existing) continue
    const fuelValue = f.value ?? f.fuel_value
    const fuelCategory = f.category ?? f.fuel_category
    itemsMap.set(k, {
      ...existing,
      fuelValue: fuelValue ?? existing.fuelValue,
      fuelCategory: fuelCategory ?? existing.fuelCategory,
    })
  }

  return {
    items: itemsMap as ReadonlyMap<string, Item>,
    recipes: indexBy(recipes, (r) => r.key),
    machines: indexBy(machines, (m) => m.key),
    belts: indexBy(belts, (b) => b.key),
    inserters: indexBy(inserters, (i) => i.key),
    modules: indexBy(modules, (m) => m.key),
    fluidItems,
    fluidConnections,
    machinesByCategory: groupBy(machines, (m) => m.craftingCategories),
    recipesByProduct: groupBy(recipes, (r) => r.products.map((p) => p.item)),
    sprites,
  }
}
