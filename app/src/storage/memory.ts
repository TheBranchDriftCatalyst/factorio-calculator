// In-memory KVStore — for SSR, tests, and as a fallback when no
// other backend is configured. State lives in a Map and dies with the
// process / tab refresh. Useful in vitest where each test gets a fresh
// store with no localStorage cross-contamination.

import type { KVStore } from "./types"

export class MemoryKVStore implements KVStore {
  readonly id = "memory" as const
  readonly label = "Memory (volatile)"

  private readonly map = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value)
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key)
  }

  async list(prefix = ""): Promise<string[]> {
    if (!prefix) return [...this.map.keys()]
    return [...this.map.keys()].filter((k) => k.startsWith(prefix))
  }
}
