// A hand-rolled minimal dataset shaped like Kirk McDonald's space-age-*.json.
// Recipes mirror real Factorio: iron-plate from ore, copper-cable from plate,
// electronic-circuit from 1 iron-plate + 3 copper-cable.
// Used by unit tests so we never have to load the 4 MB real dataset.

import type { KirkRawDataset } from "../../src/factorio"

export const miniDataset: KirkRawDataset = {
  items: [
    { key: "iron-ore", localized_name: { en: "Iron ore" } },
    { key: "iron-plate", localized_name: { en: "Iron plate" } },
    { key: "copper-ore", localized_name: { en: "Copper ore" } },
    { key: "copper-plate", localized_name: { en: "Copper plate" } },
    { key: "copper-cable", localized_name: { en: "Copper cable" } },
    { key: "electronic-circuit", localized_name: { en: "Electronic circuit" } },
    // For the multi-product crude-oil-cracking recipe used by
    // intermediates-panel tests.
    { key: "crude-oil", localized_name: { en: "Crude oil" } },
    { key: "light-oil", localized_name: { en: "Light oil" } },
    { key: "heavy-oil", localized_name: { en: "Heavy oil" } },
  ],
  recipes: [
    {
      key: "iron-plate",
      localized_name: { en: "Iron plate" },
      category: "smelting",
      energy_required: 3.2,
      ingredients: [{ name: "iron-ore", amount: 1 }],
      results: [{ name: "iron-plate", amount: 1 }],
    },
    {
      key: "copper-plate",
      localized_name: { en: "Copper plate" },
      category: "smelting",
      energy_required: 3.2,
      ingredients: [{ name: "copper-ore", amount: 1 }],
      results: [{ name: "copper-plate", amount: 1 }],
    },
    {
      key: "copper-cable",
      localized_name: { en: "Copper cable" },
      category: "crafting",
      energy_required: 0.5,
      ingredients: [{ name: "copper-plate", amount: 1 }],
      results: [{ name: "copper-cable", amount: 2 }],
    },
    {
      key: "electronic-circuit",
      localized_name: { en: "Electronic circuit" },
      category: "crafting",
      energy_required: 0.5,
      ingredients: [
        { name: "iron-plate", amount: 1 },
        { name: "copper-cable", amount: 3 },
      ],
      results: [{ name: "electronic-circuit", amount: 1 }],
    },
    // Multi-product recipe used by intermediates-panel tests. Cracking
    // turns crude-oil into BOTH light-oil and heavy-oil — whichever the
    // user demands, the other is structurally forced as a byproduct. Lives
    // in its own "chemistry" category with its own machine (chemical-plant)
    // so it doesn't shift the solver's machine pick for existing recipes.
    {
      key: "crude-oil-cracking",
      localized_name: { en: "Crude oil cracking" },
      category: "chemistry",
      energy_required: 1,
      ingredients: [{ name: "crude-oil", amount: 10 }],
      results: [
        { name: "light-oil", amount: 3 },
        { name: "heavy-oil", amount: 1 },
      ],
    },
  ],
  crafting_machines: [
    {
      key: "stone-furnace",
      localized_name: { en: "Stone furnace" },
      crafting_categories: ["smelting"],
      crafting_speed: 1,
      module_slots: 0,
      energy_usage: 90_000,
      energy_source: { type: "burner" },
    },
    {
      key: "assembling-machine-1",
      localized_name: { en: "Assembling machine 1" },
      crafting_categories: ["crafting"],
      crafting_speed: 0.5,
      module_slots: 0,
      energy_usage: 75_000,
      energy_source: { type: "electric" },
    },
    // Pretend Space Age electromagnetic plant — +50% built-in prod.
    // Same crafting category as assembler-1 so the solver's "fastest in
    // category" pick lands on this when available. Used to exercise the
    // prodBonus solver path.
    {
      key: "electromagnetic-plant",
      localized_name: { en: "Electromagnetic plant" },
      crafting_categories: ["crafting"],
      crafting_speed: 2,
      module_slots: 0,
      prod_bonus: 0.5,
      energy_usage: 2_000_000,
      energy_source: { type: "electric" },
    },
    // Machine that crafts crude-oil-cracking. Distinct category so the
    // solver still picks furnace/EM-plant/assembler for other recipes.
    {
      key: "chemical-plant",
      localized_name: { en: "Chemical plant" },
      crafting_categories: ["chemistry"],
      crafting_speed: 1,
      module_slots: 0,
      energy_usage: 210_000,
      energy_source: { type: "electric" },
    },
  ],
  belts: [
    { key: "transport-belt", localized_name: { en: "Transport belt" }, speed: 0.03125 },
  ],
  modules: [],
}
