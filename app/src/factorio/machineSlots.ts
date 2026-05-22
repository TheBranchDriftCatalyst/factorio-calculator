// Machine I/O slot constraints — what the upstream Kirk dataset
// doesn't carry, hardcoded here from the Factorio prototype data.
//
// Kirk's catalog tells us a machine's category and speed but NOT how
// many input/output streams it can physically accept. For most
// downstream work (factory templates, manifold layout, feasibility
// validation) we need that detail.
//
// MACHINE_SLOTS is the canonical source. Add new machines here as
// modded datasets appear. Unknown machines fall back to PERMISSIVE
// defaults (so we never falsely reject something we just don't know
// about).
//
// Caveat for assembler-2/3: the single "fluid box" can act as input
// OR output depending on the recipe, not both. We model it as 1 fluid
// in + 1 fluid out independently — slightly permissive (says
// theoretically both could happen), but correctly rejects recipes that
// need >1 fluid stream on either side. In practice no vanilla recipe
// uses both an input fluid AND output fluid on an assembler, so the
// permissiveness is invisible.

export interface MachineSlots {
  input: { solid: number; fluid: number }
  output: { solid: number; fluid: number }
}

/**
 * Permissive defaults for machines we don't have explicit data on.
 * High enough that no real recipe will trip the feasibility check, so
 * unknown-machine validation is effectively a no-op (don't penalize
 * what we don't understand).
 */
export const PERMISSIVE_SLOTS: MachineSlots = {
  input: { solid: 16, fluid: 16 },
  output: { solid: 16, fluid: 16 },
}

/**
 * Per-machine slot data, keyed by machine.key. Covers vanilla 2.0 and
 * Space Age production machines. Modded datasets will surface unknown
 * machines — those fall back to PERMISSIVE_SLOTS until added here.
 */
export const MACHINE_SLOTS: Record<string, MachineSlots> = {
  // Vanilla assemblers
  "assembling-machine-1": {
    input: { solid: 2, fluid: 0 },
    output: { solid: 1, fluid: 0 },
  },
  // AM-2: 4 ingredient slots in vanilla 2.0 (was incorrectly 2 here,
  // causing 3+-input recipes like military-science-pack to be flagged
  // ⚠ infeasible when they're actually buildable).
  "assembling-machine-2": {
    input: { solid: 4, fluid: 1 },
    output: { solid: 1, fluid: 1 },
  },
  // AM-3: 6 ingredient slots in vanilla 2.0. Same correction.
  "assembling-machine-3": {
    input: { solid: 6, fluid: 1 },
    output: { solid: 1, fluid: 1 },
  },
  // Chemistry
  "chemical-plant": {
    input: { solid: 2, fluid: 2 },
    output: { solid: 1, fluid: 2 },
  },
  "oil-refinery": {
    input: { solid: 0, fluid: 2 },
    output: { solid: 0, fluid: 3 },
  },
  // Smelting
  "stone-furnace": {
    input: { solid: 1, fluid: 0 },
    output: { solid: 1, fluid: 0 },
  },
  "steel-furnace": {
    input: { solid: 1, fluid: 0 },
    output: { solid: 1, fluid: 0 },
  },
  "electric-furnace": {
    input: { solid: 1, fluid: 0 },
    output: { solid: 1, fluid: 0 },
  },
  // Space Age
  foundry: {
    input: { solid: 2, fluid: 1 },
    output: { solid: 1, fluid: 1 },
  },
  "electromagnetic-plant": {
    input: { solid: 4, fluid: 1 },
    output: { solid: 2, fluid: 0 },
  },
  biochamber: {
    input: { solid: 4, fluid: 1 },
    output: { solid: 2, fluid: 1 },
  },
  // Centrifuge (uranium processing): 2 solid in, 4 solid out.
  centrifuge: {
    input: { solid: 2, fluid: 0 },
    output: { solid: 4, fluid: 0 },
  },
  // Misc producing entities — limited recipe shapes, model conservatively.
  "rocket-silo": {
    input: { solid: 1, fluid: 0 },
    output: { solid: 1, fluid: 0 },
  },
  "agricultural-tower": {
    input: { solid: 1, fluid: 0 },
    output: { solid: 1, fluid: 0 },
  },
  "captive-biter-spawner": {
    input: { solid: 1, fluid: 0 },
    output: { solid: 1, fluid: 0 },
  },
  // Mining drills — categorize loosely. They have no real "recipe slots"
  // but the solver may treat them as producers in some setups.
  "burner-mining-drill": {
    input: { solid: 1, fluid: 0 }, // raw resource
    output: { solid: 1, fluid: 0 },
  },
  "electric-mining-drill": {
    input: { solid: 1, fluid: 1 }, // some ores need fluid (uranium → sulfuric acid)
    output: { solid: 1, fluid: 0 },
  },
  "big-mining-drill": {
    input: { solid: 1, fluid: 1 },
    output: { solid: 2, fluid: 0 },
  },
}

/**
 * Look up a machine's slot constraints. Returns PERMISSIVE_SLOTS if the
 * machine isn't in the override table (so unknown machines don't get
 * false-rejected during feasibility checks).
 */
export function slotsFor(machineKey: string): MachineSlots {
  return MACHINE_SLOTS[machineKey] ?? PERMISSIVE_SLOTS
}
