// GitHub Gist-backed KVStore. Each KEY becomes a FILE inside ONE Gist,
// FILE BODY = value. Cross-device sync without a backend: the user
// pastes a Personal Access Token (PAT) with the `gist` scope, the
// adapter auto-creates a private gist on first write (if no gistId is
// configured) and reads/writes its files thereafter.
//
// Cost model:
//   • Reads: 1 API call to GET the whole gist, then cached in memory.
//   • Writes: 1 API call to PATCH the gist with the changed file.
//   • List: free from the cached gist contents.
// We don't try to debounce writes — most user actions are one-shot
// (save profile, delete profile) and the GitHub rate limit (5000
// req/hr authenticated) is plenty for that.
//
// Failure modes:
//   • Bad PAT → all calls return null / silently fail. Caller should
//     show a "sync disconnected" indicator (via testConnection).
//   • Network down → reads return null, writes are dropped. We do
//     NOT queue retries here — the user's local store (chained via
//     `CachingKVStore`) keeps state intact.
//
// Key → filename mapping: keys are used verbatim as gist filenames.
// Gist forbids slashes in filenames, so callers should use `.`-
// separated keys (e.g. `fbp.profiles.v1`).

import type { KVStore } from "./types"

interface GistFile {
  filename: string
  content: string
  truncated?: boolean
  raw_url?: string
}

interface GistResponse {
  id: string
  files: Record<string, GistFile>
  description?: string
  public: boolean
}

export interface GistConfig {
  /** GitHub Personal Access Token with the `gist` scope. */
  token: string
  /** Existing gist id to use. When undefined, the adapter auto-creates a private gist on first write. */
  gistId?: string
  /** Description applied when creating the gist. */
  description?: string
}

const API_BASE = "https://api.github.com"
const DEFAULT_DESCRIPTION = "factorio-blueprint-calculator sync store"

export class GistKVStore implements KVStore {
  readonly id = "gist" as const
  readonly label = "GitHub Gist"

  private readonly token: string
  private gistId: string | undefined
  private readonly description: string
  /** Cached gist contents — refetched at most once per `cacheTtlMs`. */
  private cache: Record<string, string> | null = null
  private cacheAt = 0
  private readonly cacheTtlMs = 5000
  /** Hook fired whenever a gist is auto-created so the caller can persist the id. */
  onGistCreated?: (id: string) => void

  constructor(cfg: GistConfig) {
    this.token = cfg.token
    this.gistId = cfg.gistId
    this.description = cfg.description ?? DEFAULT_DESCRIPTION
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    }
  }

  private async fetchGist(): Promise<Record<string, string> | null> {
    if (!this.gistId) return {}
    if (this.cache && Date.now() - this.cacheAt < this.cacheTtlMs) {
      return this.cache
    }
    try {
      const res = await fetch(`${API_BASE}/gists/${this.gistId}`, {
        headers: this.headers(),
      })
      if (!res.ok) return null
      const body = (await res.json()) as GistResponse
      const out: Record<string, string> = {}
      for (const [filename, file] of Object.entries(body.files)) {
        // Files over 1 MB come back with `truncated: true` and need a
        // separate fetch to `raw_url`. We follow the redirect once; if
        // it fails we fall back to the (possibly clipped) inline body.
        if (file.truncated && file.raw_url) {
          try {
            const raw = await fetch(file.raw_url)
            if (raw.ok) {
              out[filename] = await raw.text()
              continue
            }
          } catch {
            // fall through to inline body
          }
        }
        out[filename] = file.content
      }
      this.cache = out
      this.cacheAt = Date.now()
      return out
    } catch {
      return null
    }
  }

  private async writeFiles(files: Record<string, GistFile | null>): Promise<boolean> {
    // First write with no gistId → create gist (POST /gists).
    if (!this.gistId) {
      const body = {
        description: this.description,
        public: false,
        files: Object.fromEntries(
          Object.entries(files)
            .filter(([, f]) => f != null)
            .map(([k, f]) => [k, { content: f!.content }]),
        ),
      }
      try {
        const res = await fetch(`${API_BASE}/gists`, {
          method: "POST",
          headers: { ...this.headers(), "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        if (!res.ok) return false
        const json = (await res.json()) as GistResponse
        this.gistId = json.id
        this.onGistCreated?.(json.id)
        this.cache = null
        return true
      } catch {
        return false
      }
    }
    // Subsequent writes → PATCH the existing gist. Setting a file's
    // content to null removes it.
    try {
      const res = await fetch(`${API_BASE}/gists/${this.gistId}`, {
        method: "PATCH",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      })
      if (!res.ok) return false
      this.cache = null
      return true
    } catch {
      return false
    }
  }

  async get(key: string): Promise<string | null> {
    const cache = await this.fetchGist()
    if (!cache) return null
    return cache[key] ?? null
  }

  async set(key: string, value: string): Promise<void> {
    await this.writeFiles({ [key]: { filename: key, content: value } })
  }

  async remove(key: string): Promise<void> {
    if (!this.gistId) return
    // GitHub removes a file when its entry is sent as null in the
    // PATCH body.
    await this.writeFiles({ [key]: null })
  }

  async list(prefix = ""): Promise<string[]> {
    const cache = await this.fetchGist()
    if (!cache) return []
    const keys = Object.keys(cache)
    if (!prefix) return keys
    return keys.filter((k) => k.startsWith(prefix))
  }

  /**
   * Validate the token + gist by making one cheap GET. Returns null
   * on success, an error message on failure. Used by the settings UI.
   */
  async testConnection(): Promise<string | null> {
    try {
      // /user is the cheapest authenticated call.
      const res = await fetch(`${API_BASE}/user`, { headers: this.headers() })
      if (res.status === 401 || res.status === 403) return "Token rejected by GitHub"
      if (!res.ok) return `GitHub returned ${res.status}`
      if (this.gistId) {
        const gres = await fetch(`${API_BASE}/gists/${this.gistId}`, { headers: this.headers() })
        if (gres.status === 404) return "Gist not found (will be created on first write)"
        if (!gres.ok) return `Gist read returned ${gres.status}`
      }
      return null
    } catch (e) {
      return e instanceof Error ? e.message : "network error"
    }
  }

  /** Exposed so the settings panel can show "writing to gist <id>". */
  getGistId(): string | undefined {
    return this.gistId
  }
}
