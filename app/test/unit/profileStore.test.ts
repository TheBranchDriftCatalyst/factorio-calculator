import { describe, it, expect, beforeEach } from "vitest"
import { MemoryKVStore } from "../../src/storage/memory"
import {
  deleteProfile,
  listProfiles,
  loadProfile,
  nextProfileName,
  saveProfile,
} from "../../src/views/profiles/profileStore"

describe("profileStore", () => {
  let store: MemoryKVStore
  beforeEach(() => {
    store = new MemoryKVStore()
  })

  it("returns an empty list when no profiles exist", async () => {
    expect(await listProfiles(store)).toEqual([])
  })

  it("saves and lists a profile", async () => {
    const p = await saveProfile(store, "alpha", [{ item: "iron-plate", rate: 1 }])
    expect(p.id).toMatch(/^p_/)
    expect(p.name).toBe("alpha")
    const list = await listProfiles(store)
    expect(list).toHaveLength(1)
    expect(list[0].targets).toEqual([{ item: "iron-plate", rate: 1 }])
  })

  it("preserves inputs when saving", async () => {
    await saveProfile(
      store,
      "beta",
      [{ item: "copper-cable", rate: 5 }],
      [{ item: "iron-plate", rate: 2 }],
    )
    const p = (await listProfiles(store))[0]
    expect(p.inputs).toEqual([{ item: "iron-plate", rate: 2 }])
  })

  it("overwrites by case-insensitive name match (preserves id)", async () => {
    const first = await saveProfile(store, "Setup", [{ item: "a", rate: 1 }])
    const second = await saveProfile(store, "setup", [{ item: "b", rate: 2 }])
    expect(second.id).toBe(first.id)
    const list = await listProfiles(store)
    expect(list).toHaveLength(1)
    expect(list[0].targets).toEqual([{ item: "b", rate: 2 }])
  })

  it("deletes by id", async () => {
    const p = await saveProfile(store, "tmp", [])
    await deleteProfile(store, p.id)
    expect(await listProfiles(store)).toEqual([])
  })

  it("loadProfile fetches a single profile by id", async () => {
    const p = await saveProfile(store, "x", [{ item: "i", rate: 1 }])
    expect(await loadProfile(store, p.id)).toMatchObject({ id: p.id, name: "x" })
    expect(await loadProfile(store, "missing")).toBeNull()
  })

  it("nextProfileName increments with existing count", async () => {
    expect(await nextProfileName(store)).toBe("Profile 1")
    await saveProfile(store, "a", [])
    expect(await nextProfileName(store)).toBe("Profile 2")
  })

  it("survives a corrupted JSON blob in the underlying store", async () => {
    await store.set("fbp.profiles.v1", "not json {")
    expect(await listProfiles(store)).toEqual([])
  })

  it("filters out shape-mismatched entries", async () => {
    await store.set(
      "fbp.profiles.v1",
      JSON.stringify([
        { id: "ok", name: "valid", targets: [], createdAt: 1 },
        { wrong: "shape" },
        null,
      ]),
    )
    const list = await listProfiles(store)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe("valid")
  })
})
