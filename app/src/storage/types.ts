// Pluggable key-value store interface.
//
// The app persists various user state (profiles, prefs, overrides) and
// has historically read/written localStorage directly throughout. This
// abstraction lets us swap the backing store WITHOUT touching the
// callers — default = localStorage (per-device), opt-in = GitHub Gist
// (cross-device sync). Adding a third backend (IndexedDB, Supabase,
// etc.) is just another class implementing this interface.
//
// All methods are async. localStorage is naturally sync but wrapping
// it in promises lets callers write to a remote adapter without
// changing shape, and `await store.get(...)` parses fine either way.

export type KVStoreId = "local" | "gist" | "memory"

export interface KVStore {
  /** Stable id used to identify the active adapter in settings + telemetry. */
  readonly id: KVStoreId
  /** Human-readable label for the picker. */
  readonly label: string
  /**
   * Read raw string value at key. Returns null when missing.
   * Implementations MUST NOT throw — they should resolve null on transient
   * errors and let the caller decide whether to retry.
   */
  get(key: string): Promise<string | null>
  /** Write raw string at key. Overwrites silently. */
  set(key: string, value: string): Promise<void>
  /** Remove key. No-op when missing. */
  remove(key: string): Promise<void>
  /**
   * List known keys, optionally filtered by prefix. Adapters that can't
   * cheaply list (e.g. opaque blob stores) return an empty array — the
   * caller should treat that as "unsupported" and avoid relying on
   * enumeration.
   */
  list(prefix?: string): Promise<string[]>
}

/** JSON-helper convenience wrappers on top of the raw string store. */
export async function getJson<T>(store: KVStore, key: string): Promise<T | null> {
  const raw = await store.get(key)
  if (raw == null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function setJson<T>(store: KVStore, key: string, value: T): Promise<void> {
  await store.set(key, JSON.stringify(value))
}
