// React glue for the active KVStore.
//
// One provider at the app root resolves the chosen adapter (from a
// persisted setting in localStorage) and exposes it via context so
// any component can use the same store.
//
// Why context: hooks like profileStore need to know WHICH adapter to
// hit at runtime, and the answer changes when the user flips the
// setting. Threading the store through props would be miserable.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { CachingKVStore } from "./caching"
import { GistKVStore, type GistConfig } from "./gist"
import { LocalStorageKVStore } from "./local"
import type { KVStore, KVStoreId } from "./types"

/** Persisted config controlling which adapter is active. */
export interface StorageSettings {
  backend: "local" | "gist"
  /** Only used when backend === "gist". */
  gist?: GistConfig
}

const SETTINGS_KEY = "fbp.storage.settings.v1"
const DEFAULT_SETTINGS: StorageSettings = { backend: "local" }

function loadSettings(): StorageSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<StorageSettings>
    if (parsed.backend !== "local" && parsed.backend !== "gist") return DEFAULT_SETTINGS
    if (parsed.backend === "gist" && !parsed.gist?.token) return DEFAULT_SETTINGS
    return parsed as StorageSettings
  } catch {
    return DEFAULT_SETTINGS
  }
}

function persistSettings(s: StorageSettings): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // Quota / private mode → settings just live in memory for this tab.
  }
}

function buildStore(settings: StorageSettings, onGistCreated: (id: string) => void): KVStore {
  const local = new LocalStorageKVStore()
  if (settings.backend === "gist" && settings.gist?.token) {
    const gist = new GistKVStore(settings.gist)
    gist.onGistCreated = onGistCreated
    return new CachingKVStore(local, gist)
  }
  return local
}

interface StorageContextValue {
  store: KVStore
  settings: StorageSettings
  activeBackend: KVStoreId
  /** Switch the backend at runtime. Persists the change immediately. */
  setSettings: (next: StorageSettings) => void
  /** Pull remote → local for a key prefix (used after enabling Gist). */
  refreshFromRemote: (prefix?: string) => Promise<void>
  /**
   * PUSH every local key under `prefix` up to the remote. Used right
   * after switching to a remote backend so existing local profiles
   * immediately appear in the gist (otherwise the gist isn't created
   * until the next profile-save and the user sees nothing). Returns
   * the number of keys pushed.
   */
  pushToRemote: (prefix?: string) => Promise<number>
}

const StorageContext = createContext<StorageContextValue | null>(null)

export function StorageProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<StorageSettings>(loadSettings)

  // Auto-persist the gist id the moment GistKVStore creates a new gist
  // — otherwise the user would have to copy it manually from the API.
  const handleGistCreated = useCallback((id: string) => {
    setSettingsState((prev) => {
      if (prev.backend !== "gist" || !prev.gist) return prev
      const next: StorageSettings = {
        backend: "gist",
        gist: { ...prev.gist, gistId: id },
      }
      persistSettings(next)
      return next
    })
  }, [])

  const store = useMemo(() => buildStore(settings, handleGistCreated), [settings, handleGistCreated])

  // On settings change with a remote backend, pull remote keys into
  // the local cache so the UI sees what's already on the server.
  useEffect(() => {
    if (store instanceof CachingKVStore) {
      // Profiles are the only namespaced sync target today, so prefilter.
      store.refreshFromRemote("fbp.profiles").catch(() => {})
    }
  }, [store])

  const setSettings = useCallback((next: StorageSettings) => {
    persistSettings(next)
    setSettingsState(next)
  }, [])

  const refreshFromRemote = useCallback(
    async (prefix = "") => {
      if (store instanceof CachingKVStore) {
        await store.refreshFromRemote(prefix)
      }
    },
    [store],
  )

  const pushToRemote = useCallback(
    async (prefix = "") => {
      // Use a fresh LocalStorageKVStore (not the cached one) so we can
      // enumerate local-only keys regardless of which adapter is
      // currently active. Then write each to the remote half of the
      // cache (which fans out to GitHub).
      if (!(store instanceof CachingKVStore)) return 0
      const local = new LocalStorageKVStore()
      const keys = await local.list(prefix)
      let pushed = 0
      for (const k of keys) {
        const v = await local.get(k)
        if (v != null) {
          await store.set(k, v)
          pushed++
        }
      }
      return pushed
    },
    [store],
  )

  const value = useMemo<StorageContextValue>(
    () => ({
      store,
      settings,
      activeBackend: store.id,
      setSettings,
      refreshFromRemote,
      pushToRemote,
    }),
    [store, settings, setSettings, refreshFromRemote, pushToRemote],
  )

  return <StorageContext.Provider value={value}>{children}</StorageContext.Provider>
}

export function useStorage(): StorageContextValue {
  const ctx = useContext(StorageContext)
  if (!ctx) {
    // Fall back to a transient memory store so components don't crash
    // outside a provider (e.g. in some test render paths). Loud warn
    // so this doesn't silently regress in production.
    if (typeof console !== "undefined") {
      console.warn("useStorage called outside StorageProvider — using local fallback")
    }
    const fallback = new LocalStorageKVStore()
    return {
      store: fallback,
      settings: DEFAULT_SETTINGS,
      activeBackend: "local",
      setSettings: () => {},
      refreshFromRemote: async () => {},
      pushToRemote: async () => 0,
    }
  }
  return ctx
}
