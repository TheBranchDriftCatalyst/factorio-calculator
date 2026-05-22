// Public surface of the storage layer.

export type { KVStore, KVStoreId } from "./types"
export { getJson, setJson } from "./types"
export { LocalStorageKVStore } from "./local"
export { MemoryKVStore } from "./memory"
export { GistKVStore, type GistConfig } from "./gist"
export { CachingKVStore } from "./caching"
export {
  StorageProvider,
  useStorage,
  type StorageSettings,
} from "./context"
