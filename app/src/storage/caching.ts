// Read-through / write-through cache wrapper.
//
// Wraps a slow remote KVStore (Gist) with a fast local KVStore
// (localStorage) so the UI doesn't wait on network for every read.
//
//   read:  localStorage hit  → return immediately
//          localStorage miss → fetch remote, populate local, return
//   write: write local first (sync-feeling),
//          then fire-and-forget remote write
//   list:  union of local + remote keys
//
// Conflict policy: LAST WRITE WINS. There's no per-key versioning here
// — if two devices both write a profile with the same id at the same
// time, the later remote write clobbers the earlier. For the tiny
// profile use case this is fine; a real CRDT would be overkill.

import type { KVStore } from "./types"

export class CachingKVStore implements KVStore {
  readonly id: KVStore["id"]
  readonly label: string
  /** Errors from background remote sync; subscribe via `onRemoteError`. */
  onRemoteError?: (key: string, op: "set" | "remove", err: unknown) => void

  constructor(
    private readonly local: KVStore,
    private readonly remote: KVStore,
  ) {
    // Identity comes from the remote — that's what the user opted into.
    this.id = remote.id
    this.label = `${remote.label} (cached locally)`
  }

  async get(key: string): Promise<string | null> {
    const cached = await this.local.get(key)
    if (cached != null) return cached
    const fresh = await this.remote.get(key)
    if (fresh != null) {
      // Populate cache so next read is instant.
      await this.local.set(key, fresh)
    }
    return fresh
  }

  async set(key: string, value: string): Promise<void> {
    // Local first so UI doesn't lag behind the user.
    await this.local.set(key, value)
    // Fire-and-forget — don't block the UI thread on network.
    this.remote.set(key, value).catch((err) => this.onRemoteError?.(key, "set", err))
  }

  async remove(key: string): Promise<void> {
    await this.local.remove(key)
    this.remote.remove(key).catch((err) => this.onRemoteError?.(key, "remove", err))
  }

  async list(prefix = ""): Promise<string[]> {
    const [l, r] = await Promise.all([this.local.list(prefix), this.remote.list(prefix)])
    // Dedup via Set.
    return [...new Set([...l, ...r])]
  }

  /**
   * Pull every key from the remote into the local cache. Use on
   * startup when the user has remote sync configured so device-2 sees
   * device-1's profiles even before the user touches them.
   */
  async refreshFromRemote(prefix = ""): Promise<void> {
    const keys = await this.remote.list(prefix)
    await Promise.all(
      keys.map(async (k) => {
        const v = await this.remote.get(k)
        if (v != null) await this.local.set(k, v)
      }),
    )
  }
}
