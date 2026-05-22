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

  /**
   * Most recent write failure — populated by writeFiles when a write
   * fails, so callers can surface the actual reason (status + body)
   * instead of just "didn't work." Cleared on success.
   */
  lastWriteError?: { status?: number; message: string }

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
        if (!res.ok) {
          const text = await res.text().catch(() => "")
          this.lastWriteError = {
            status: res.status,
            message: `POST /gists → ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
          }
          return false
        }
        const json = (await res.json()) as GistResponse
        this.gistId = json.id
        this.onGistCreated?.(json.id)
        this.cache = null
        this.lastWriteError = undefined
        return true
      } catch (e) {
        this.lastWriteError = {
          message: `POST /gists network error: ${e instanceof Error ? e.message : "unknown"}`,
        }
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
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        this.lastWriteError = {
          status: res.status,
          message: `PATCH /gists/${this.gistId} → ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
        }
        return false
      }
      this.cache = null
      this.lastWriteError = undefined
      return true
    } catch (e) {
      this.lastWriteError = {
        message: `PATCH /gists network error: ${e instanceof Error ? e.message : "unknown"}`,
      }
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

/**
 * Per-step result for `runGistDiagnostics`. Each step reports an
 * explicit status code + a short, user-facing message — the previous
 * silent-fail catch blocks in writeFiles/testConnection masked these.
 */
export interface DiagnosticStep {
  name: string
  ok: boolean
  /** HTTP status code if the step hit GitHub; undefined for network errors. */
  status?: number
  message: string
  /** First chunk of the response body for debugging when ok=false. */
  bodyPreview?: string
}

export interface DiagnosticResult {
  steps: DiagnosticStep[]
  /** True iff every step's `ok` was true. */
  ok: boolean
  /** OAuth scopes the token actually has, parsed from /user's headers. */
  tokenScopes?: string[]
}

/**
 * Run a step-by-step health check against the GitHub API for a given
 * token. Surfaces the things `testConnection()` swallows: actual HTTP
 * statuses, the token's real scope list, and whether the gist endpoint
 * will accept a create/patch/delete.
 *
 * Steps:
 *   1. GET /user                — does the token authenticate at all?
 *   2. (read X-OAuth-Scopes)    — does it carry `gist`?
 *   3. POST /gists (probe)      — can it CREATE a private gist?
 *   4. DELETE /gists/{id}       — cleanup the probe gist.
 *
 * If gistId is provided, also does step 1.5: GET /gists/{id} — confirms
 * the configured gist is readable.
 */
export async function runGistDiagnostics(
  token: string,
  gistId?: string,
): Promise<DiagnosticResult> {
  const headers: HeadersInit = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  const steps: DiagnosticStep[] = []
  let tokenScopes: string[] | undefined

  const previewBody = async (res: Response): Promise<string> => {
    try {
      const t = await res.text()
      return t.slice(0, 200)
    } catch {
      return ""
    }
  }

  // Step 1: authenticate.
  try {
    const res = await fetch(`${API_BASE}/user`, { headers })
    const scopes = res.headers.get("x-oauth-scopes") ?? ""
    tokenScopes = scopes
      ? scopes.split(",").map((s) => s.trim()).filter(Boolean)
      : []
    if (res.ok) {
      steps.push({
        name: "Authenticate (GET /user)",
        ok: true,
        status: res.status,
        message: `OK — token scopes: ${tokenScopes.length ? tokenScopes.join(", ") : "(none / fine-grained)"}`,
      })
    } else {
      steps.push({
        name: "Authenticate (GET /user)",
        ok: false,
        status: res.status,
        message:
          res.status === 401
            ? "Token rejected — check it's valid and not expired"
            : res.status === 403
              ? "Token forbidden — rate-limited or scope mismatch"
              : `GitHub returned ${res.status}`,
        bodyPreview: await previewBody(res),
      })
      return { steps, ok: false, tokenScopes }
    }
  } catch (e) {
    steps.push({
      name: "Authenticate (GET /user)",
      ok: false,
      message: `Network error: ${e instanceof Error ? e.message : "unknown"}`,
    })
    return { steps, ok: false }
  }

  // Step 2: scope check. Classic PATs ship a non-empty x-oauth-scopes
  // header; fine-grained PATs ship an empty one and grant per-resource
  // permissions. For fine-grained tokens we can't introspect — just
  // note it.
  if (tokenScopes && tokenScopes.length > 0) {
    const hasGist = tokenScopes.includes("gist")
    steps.push({
      name: "Check 'gist' scope",
      ok: hasGist,
      message: hasGist
        ? "Token has 'gist' scope ✓"
        : `Token lacks 'gist' scope. Found: ${tokenScopes.join(", ")}. Re-create the PAT at github.com/settings/tokens with 'gist' checked.`,
    })
    if (!hasGist) return { steps, ok: false, tokenScopes }
  } else {
    steps.push({
      name: "Check 'gist' scope",
      ok: true,
      message:
        "Fine-grained PAT (or no scope header) — can't introspect; will probe write directly below.",
    })
  }

  // Step 2.5: if a gistId is configured, confirm it's readable.
  if (gistId) {
    try {
      const res = await fetch(`${API_BASE}/gists/${gistId}`, { headers })
      steps.push({
        name: `Read configured gist (GET /gists/${gistId.slice(0, 8)}…)`,
        ok: res.ok,
        status: res.status,
        message: res.ok
          ? "Configured gist is readable"
          : res.status === 404
            ? "Configured gist not found — leave the id blank to auto-create"
            : `GitHub returned ${res.status}`,
        bodyPreview: res.ok ? undefined : await previewBody(res),
      })
    } catch (e) {
      steps.push({
        name: "Read configured gist",
        ok: false,
        message: `Network error: ${e instanceof Error ? e.message : "unknown"}`,
      })
    }
  }

  // Step 3: probe-create a gist to confirm write access.
  let probeGistId: string | undefined
  try {
    const body = {
      description: "fbp-diagnostic probe (safe to delete)",
      public: false,
      files: {
        "fbp_probe.json": { content: JSON.stringify({ probe: true }) },
      },
    }
    const res = await fetch(`${API_BASE}/gists`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const json = (await res.json()) as { id: string }
      probeGistId = json.id
      steps.push({
        name: "Probe write (POST /gists)",
        ok: true,
        status: res.status,
        message: `Created probe gist ${probeGistId.slice(0, 8)}… — write access works`,
      })
    } else {
      steps.push({
        name: "Probe write (POST /gists)",
        ok: false,
        status: res.status,
        message: `GitHub rejected the create (${res.status}). Likely cause: ${
          res.status === 401 || res.status === 403
            ? "token lacks 'gist' scope or is fine-grained without Gists:read+write"
            : "rate limiting or temporary outage"
        }.`,
        bodyPreview: await previewBody(res),
      })
      return { steps, ok: false, tokenScopes }
    }
  } catch (e) {
    steps.push({
      name: "Probe write (POST /gists)",
      ok: false,
      message: `Network error: ${e instanceof Error ? e.message : "unknown"}`,
    })
    return { steps, ok: false, tokenScopes }
  }

  // Step 4: cleanup the probe.
  if (probeGistId) {
    try {
      const res = await fetch(`${API_BASE}/gists/${probeGistId}`, {
        method: "DELETE",
        headers,
      })
      steps.push({
        name: `Cleanup probe (DELETE /gists/${probeGistId.slice(0, 8)}…)`,
        ok: res.ok || res.status === 204,
        status: res.status,
        message:
          res.ok || res.status === 204
            ? "Probe gist deleted"
            : `Couldn't delete probe — visit github.com to remove ${probeGistId.slice(0, 8)}…`,
      })
    } catch {
      steps.push({
        name: "Cleanup probe",
        ok: false,
        message: `Couldn't delete probe — visit github.com to remove ${probeGistId.slice(0, 8)}…`,
      })
    }
  }

  const allOk = steps.every((s) => s.ok)
  return { steps, ok: allOk, tokenScopes }
}
