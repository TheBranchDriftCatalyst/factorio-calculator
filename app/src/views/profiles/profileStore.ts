// Profile = named snapshot of the current `targets` + `inputs` arrays,
// persisted via the pluggable KVStore. The store is local by default
// (localStorage) and switches to GitHub Gist when the user opts in
// via the storage settings. All callers go through these helpers so
// the storage shape stays in one place.

import type { Input, Target } from "../../solver/expand"
import type { KVStore } from "../../storage"
import { getJson, setJson } from "../../storage"

export interface Profile {
  id: string
  name: string
  targets: Target[]
  /** Pre-supplied inputs that prune the recipe tree. Optional for backwards
   *  compat with profiles saved before inputs were supported. */
  inputs?: Input[]
  createdAt: number
}

const STORAGE_KEY = "fbp.profiles.v1"

function isProfile(p: unknown): p is Profile {
  return (
    !!p &&
    typeof p === "object" &&
    typeof (p as Profile).id === "string" &&
    typeof (p as Profile).name === "string" &&
    Array.isArray((p as Profile).targets) &&
    typeof (p as Profile).createdAt === "number"
  )
}

async function readAll(store: KVStore): Promise<Profile[]> {
  const parsed = await getJson<unknown[]>(store, STORAGE_KEY)
  if (!parsed || !Array.isArray(parsed)) return []
  // Defensive shape filter — drop anything that doesn't look like a
  // Profile, so a hand-edited / stale storage entry can't crash the UI.
  return parsed.filter(isProfile)
}

async function writeAll(store: KVStore, profiles: Profile[]): Promise<void> {
  await setJson(store, STORAGE_KEY, profiles)
}

function makeId(): string {
  // Avoid pulling in `crypto.randomUUID` (not present in jsdom). A
  // short timestamp + random suffix is plenty for distinguishing rows.
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export async function listProfiles(store: KVStore): Promise<Profile[]> {
  return readAll(store)
}

export async function saveProfile(
  store: KVStore,
  name: string,
  targets: Target[],
  inputs: Input[] = [],
): Promise<Profile> {
  const existing = await readAll(store)
  const resolvedName = name.trim() || `Profile ${existing.length + 1}`
  // Case-insensitive lookup so "My Setup" and "my setup" treat as the
  // same profile — saving overwrites in-place rather than duplicating.
  const matchIdx = existing.findIndex(
    (p) => p.name.toLowerCase() === resolvedName.toLowerCase(),
  )
  const profile: Profile = {
    id: matchIdx >= 0 ? existing[matchIdx].id : makeId(),
    name: resolvedName,
    // Deep-copy so later edits to live state don't mutate the saved snapshot.
    targets: targets.map((t) => ({ item: t.item, rate: t.rate })),
    inputs: inputs.map((i) => ({ item: i.item, rate: i.rate })),
    // Preserve original creation timestamp on overwrite so sort-by-age
    // stays stable.
    createdAt: matchIdx >= 0 ? existing[matchIdx].createdAt : Date.now(),
  }
  const next =
    matchIdx >= 0
      ? existing.map((p, i) => (i === matchIdx ? profile : p))
      : [...existing, profile]
  await writeAll(store, next)
  return profile
}

export async function deleteProfile(store: KVStore, id: string): Promise<void> {
  const existing = await readAll(store)
  await writeAll(
    store,
    existing.filter((p) => p.id !== id),
  )
}

export async function loadProfile(store: KVStore, id: string): Promise<Profile | null> {
  const existing = await readAll(store)
  return existing.find((p) => p.id === id) ?? null
}

export async function nextProfileName(store: KVStore): Promise<string> {
  const existing = await readAll(store)
  return `Profile ${existing.length + 1}`
}
