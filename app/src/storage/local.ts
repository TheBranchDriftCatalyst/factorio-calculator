// localStorage-backed KVStore. The default adapter — no setup, no
// network, per-browser. Quota is ~5 MB so callers should not stuff
// blobs here.

import type { KVStore } from "./types"

export class LocalStorageKVStore implements KVStore {
  readonly id = "local" as const
  readonly label = "Local browser storage"

  constructor(private readonly prefix = "") {}

  private k(key: string): string {
    return this.prefix ? `${this.prefix}${key}` : key
  }

  async get(key: string): Promise<string | null> {
    if (typeof window === "undefined") return null
    try {
      return window.localStorage.getItem(this.k(key))
    } catch {
      // Disabled cookies / sandboxed iframe / Safari private mode.
      return null
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(this.k(key), value)
    } catch {
      // Quota exceeded → silently drop. Caller chose a key; we don't
      // get to invalidate other keys to make room.
    }
  }

  async remove(key: string): Promise<void> {
    if (typeof window === "undefined") return
    try {
      window.localStorage.removeItem(this.k(key))
    } catch {
      // Same as set: ignore unrecoverable errors.
    }
  }

  async list(prefix = ""): Promise<string[]> {
    if (typeof window === "undefined") return []
    try {
      const wantedPrefix = this.k(prefix)
      const out: string[] = []
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i)
        if (!k) continue
        if (this.prefix && !k.startsWith(this.prefix)) continue
        if (wantedPrefix && !k.startsWith(wantedPrefix)) continue
        out.push(this.prefix ? k.slice(this.prefix.length) : k)
      }
      return out
    } catch {
      return []
    }
  }
}
