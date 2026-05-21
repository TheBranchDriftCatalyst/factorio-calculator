// Profile = named snapshot of the current `targets` array, persisted to
// localStorage. Sidebar reads/writes through these helpers so the storage
// shape stays in one place.

import type { Input, Target } from "../../solver/expand"

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

function safeRead(): Profile[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Defensive shape filter — drop anything that doesn't look like a Profile,
    // so a hand-edited / stale localStorage entry can't crash the UI.
    return parsed.filter(
      (p): p is Profile =>
        p &&
        typeof p === "object" &&
        typeof p.id === "string" &&
        typeof p.name === "string" &&
        Array.isArray(p.targets) &&
        typeof p.createdAt === "number",
    )
  } catch {
    return []
  }
}

function safeWrite(profiles: Profile[]): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles))
  } catch {
    // Private mode / quota exceeded — silently skip rather than crash.
  }
}

function makeId(): string {
  // Avoid pulling in `crypto.randomUUID` (not present in jsdom). A short
  // timestamp + random suffix is plenty for distinguishing profile rows.
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function listProfiles(): Profile[] {
  return safeRead()
}

export function saveProfile(name: string, targets: Target[], inputs: Input[] = []): Profile {
  const resolvedName = name.trim() || `Profile ${listProfiles().length + 1}`
  // Case-insensitive lookup so "My Setup" and "my setup" treat as the same
  // profile — saving overwrites in-place rather than creating a duplicate.
  const existing = safeRead()
  const matchIdx = existing.findIndex(
    (p) => p.name.toLowerCase() === resolvedName.toLowerCase(),
  )
  const profile: Profile = {
    id: matchIdx >= 0 ? existing[matchIdx].id : makeId(),
    name: resolvedName,
    // Deep-copy so later edits to live state don't mutate the saved snapshot.
    targets: targets.map((t) => ({ item: t.item, rate: t.rate })),
    inputs: inputs.map((i) => ({ item: i.item, rate: i.rate })),
    // Preserve original creation timestamp on overwrite so sort-by-age stays stable.
    createdAt: matchIdx >= 0 ? existing[matchIdx].createdAt : Date.now(),
  }
  const next = matchIdx >= 0
    ? existing.map((p, i) => (i === matchIdx ? profile : p))
    : [...existing, profile]
  safeWrite(next)
  return profile
}

export function deleteProfile(id: string): void {
  safeWrite(safeRead().filter((p) => p.id !== id))
}

export function loadProfile(id: string): Profile | null {
  return safeRead().find((p) => p.id === id) ?? null
}

export function nextProfileName(): string {
  return `Profile ${listProfiles().length + 1}`
}
